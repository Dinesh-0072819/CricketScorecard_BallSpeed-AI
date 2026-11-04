"""
Fast cloud mode (for small servers such as Render's free plan, 0.1 CPU).

All ball detection runs on Roboflow; the server only decodes the video, JPEG-
encodes the frames it sends, and does the (cheap) tracking maths. There is no
local model inference and no server-side video rendering - the browser draws
the trajectory overlay on top of the original video.

  1. Decode the video once; send ~30 frames per second (every 2nd frame of a
     60 fps video) to Roboflow. Encoding and network requests overlap
     (thread pool), so Roboflow latency is hidden behind decoding.
  2. Build the delivery track from those detections (same tracker as local mode).
  3. Precision refine: send the few skipped frames next to the release and the
     bat contact, so the time of flight (speed) is frame-accurate again.

If Roboflow is unhealthy, `cloud_fast_scan` returns ok=False and the caller
falls back to the local engine.
"""
import concurrent.futures
import math
import os
import time
from typing import Callable, Dict, List, Optional

import cv2
import numpy as np

from ai.ball_detector import BallDetector
from ai.trajectory import link_detections, select_delivery, trim_delivery

SAMPLE_FPS = float(os.getenv("CLOUD_SAMPLE_FPS", "30"))
CONF = 0.15


def _clean_ts(ts: List[float], fps: float) -> List[float]:
    n = len(ts)
    if n >= 3:
        arr = np.asarray(ts, dtype=float)
        d = np.diff(arr)
        if np.all(d > 0) and 0.5 / fps < np.median(d) < 2.0 / fps:
            return (arr - arr[0]).tolist()
    return [i / fps for i in range(n)]


def cloud_fast_scan(video_path: str, cloud, progress: Optional[Callable[[int, int, str], None]] = None) -> Dict:
    t0 = time.time()
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 1 or fps > 1000:
        fps = 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    stride = max(1, int(round(fps / SAMPLE_FPS)))

    pool = concurrent.futures.ThreadPoolExecutor(max_workers=cloud.workers)
    futures = {}
    timestamps = []
    idx = 0
    health_checked = False
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        timestamps.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)
        if idx % stride == 0:
            b64, s = cloud._encode(frame)
            futures[idx] = pool.submit(cloud.detect_encoded, b64, s)
        idx += 1
        # early health check on the first few requests: bail out fast if Roboflow is down
        if not health_checked and len(futures) >= 8:
            first = list(futures.values())[:8]
            done, _ = concurrent.futures.wait(first, timeout=20)
            fails = sum(1 for f in done if f.result()[0] is None) + (8 - len(done))
            if fails >= 5:
                cap.release()
                pool.shutdown(wait=False, cancel_futures=True)
                err = next((f.result()[1] for f in done if f.result()[1]), "timeout")
                cloud.last_error = err
                return {"ok": False, "error": err}
            health_checked = True
        if progress and idx % 10 == 0:
            progress(idx, total, "roboflow-cloud (fast)")
    cap.release()

    dets: Dict[int, List[List[float]]] = {}
    fails = 0
    for i, fut in futures.items():
        res, err = fut.result()
        if res is None:
            fails += 1
            cloud.last_error = err
            continue
        dets[i] = BallDetector._filter([d for d in res if d[4] >= CONF], (H, W))
    pool.shutdown(wait=True)
    if futures and fails / len(futures) > 0.5:
        return {"ok": False, "error": cloud.last_error}

    return {
        "ok": True, "fps": float(fps), "width": W, "height": H, "frames": idx, "stride": stride,
        "detections": dets, "timestamps": _clean_ts(timestamps, fps),
        "engine": "roboflow-cloud (fast)", "cloud_requests": len(futures), "scan_seconds": time.time() - t0,
    }


def cloud_refine_ends(video_path: str, cloud, track: List[Dict], stride: int, W: int, H: int,
                      fps: float = 30.0) -> List[Dict]:
    """
    Precision pass for the time of flight, one parallel round of Roboflow calls:
      * release: ZOOMED crops (2x) along the path back towards the bowler's hand,
        because just after release the ball is only a few pixels wide;
      * arrival: the unsampled frames right after the end of the track.
    """
    if len(track) < 3:
        return track
    first, last = int(track[0]["frame"]), int(track[-1]["frame"])
    p0 = np.array([track[0]["x"], track[0]["y"]])
    p1 = np.array([track[1]["x"], track[1]["y"]])
    v0 = (p1 - p0) / max(1, track[1]["frame"] - first)
    pe = np.array([track[-1]["x"], track[-1]["y"]])
    pe1 = np.array([track[-2]["x"], track[-2]["y"]])
    ve = (pe - pe1) / max(1, last - track[-2]["frame"])

    back = max(4, int(round(0.3 * fps)))                       # look back ~0.3 s
    back_frames = [f for f in range(first - 1, first - back - 1, -1) if f >= 0]
    end_frames = [f for f in range(last + 1, last + stride + 1) if f % stride != 0]
    need = set(back_frames) | set(end_frames)
    if not need:
        return track

    cap = cv2.VideoCapture(video_path)
    frames = {}
    i = 0
    hi = max(need)
    while i <= hi:
        if not cap.grab():
            break
        if i in need:
            ok, fr = cap.retrieve()
            if ok:
                frames[i] = fr
        i += 1
    cap.release()

    # Two crops per frame, like the local engine: the ball at 1.5x and at 1.0x the
    # size the model was trained on (1280 long side). Tiny far balls show up in
    # the zoomed one, blurred ones in the other.
    train_scale = float(os.getenv("BALL_DETECT_LONG_SIDE", "1280")) / float(max(W, H))

    def crop_job(f, zoom_rel):
        side = int(min(640.0 / (zoom_rel * train_scale), W, H))   # crop side in original pixels
        zoom = 640.0 / side
        guess = p0 - v0 * (first - f)
        x0 = int(np.clip(guess[0] - side / 2, 0, max(0, W - side)))
        y0 = int(np.clip(guess[1] - side / 2, 0, max(0, H - side)))
        crop = cv2.resize(frames[f][y0:y0 + side, x0:x0 + side], (640, 640),
                          interpolation=cv2.INTER_CUBIC if zoom > 1 else cv2.INTER_AREA)
        res, err = cloud.detect_frame(crop)
        if not res:
            return f, []
        return f, [[x0 + d[0] / zoom, y0 + d[1] / zoom, d[2] / zoom, d[3] / zoom, d[4]] for d in res]

    def full_job(f):
        res, err = cloud.detect_frame(frames[f])
        return f, BallDetector._filter(res or [], (H, W))

    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=cloud.workers) as ex:
        jobs = [ex.submit(crop_job, f, z) for f in back_frames if f in frames for z in (1.5, 1.0)]
        jobs += [ex.submit(full_job, f) for f in end_frames if f in frames]
        for j in concurrent.futures.as_completed(jobs):
            f, dets = j.result()
            results.setdefault(f, []).extend(dets)

    by_f = {int(p["frame"]): dict(p) for p in track}

    def pt(f, d):
        return {"frame": f, "x": float(d[0]), "y": float(d[1]), "size": float(min(d[2], d[3])), "conf": float(d[4])}

    # walk back from the first tracked point, re-estimating the velocity (far balls move fewer pixels)
    cur_f, cur, v, misses = first, p0.copy(), v0.copy(), 0
    for f in back_frames:
        dets = [d for d in results.get(f, []) if d[4] >= 0.05 and max(d[2], d[3]) < 0.06 * max(W, H)]
        gap = cur_f - f
        guess = cur - v * gap
        gate = 8.0 + 0.7 * float(np.linalg.norm(v)) * gap
        dets = [d for d in dets if math.hypot(d[0] - guess[0], d[1] - guess[1]) < gate]
        if dets:
            d = min(dets, key=lambda d: math.hypot(d[0] - guess[0], d[1] - guess[1]))
            new = np.array(d[:2], dtype=float)
            v = 0.5 * v + 0.5 * (cur - new) / gap
            cur_f, cur, misses = f, new, 0
            by_f[f] = pt(f, d)
        else:
            misses += 1
            if misses >= 4:
                break

    for f in end_frames:
        guess = pe + ve * (f - last)
        gate = 10.0 + 0.8 * float(np.linalg.norm(ve)) * stride
        dets = [d for d in results.get(f, []) if d[4] >= 0.08 and math.hypot(d[0] - guess[0], d[1] - guess[1]) < gate]
        if dets:
            by_f[f] = pt(f, min(dets, key=lambda d: math.hypot(d[0] - guess[0], d[1] - guess[1])))
    return [by_f[f] for f in sorted(by_f)]


def build_track(scan: Dict, video_path: str, cloud) -> List[Dict]:
    diag = math.hypot(scan["width"], scan["height"])
    best = select_delivery(link_detections(scan["detections"], diag, max_gap=5 * scan["stride"]), diag)
    if best is None:
        return []
    track = trim_delivery(best.as_dicts(), diag, scan["fps"])
    track = cloud_refine_ends(video_path, cloud, track, scan["stride"], scan["width"], scan["height"], scan["fps"])
    return trim_delivery(track, diag, scan["fps"])
