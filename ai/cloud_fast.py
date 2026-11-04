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
CONF = float(os.getenv("CLOUD_CONF", "0.05"))


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

    cloud.reset_stats()
    s_enc = min(1.0, cloud.long_side / float(max(W, H, 1)))
    sent_wh = (int(W * s_enc), int(H * s_enc)) if s_enc < 1 else (W, H)
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
            futures[idx] = pool.submit(cloud.detect_encoded, b64, s, sent_wh)
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
    cloud.max_conf_seen = 0.0

    dets: Dict[int, List[List[float]]] = {}
    fails = 0
    low_conf = too_big = 0
    for i, fut in futures.items():
        res, err = fut.result()
        if res is None:
            fails += 1
            cloud.last_error = err
            continue
        if res:
            cloud.max_conf_seen = max(getattr(cloud, "max_conf_seen", 0.0), max(d[4] for d in res))
        keep = [d for d in res if d[4] >= CONF]
        low_conf += len(res) - len(keep)
        dets[i] = BallDetector._filter(keep, (H, W))
        too_big += len(keep) - len(dets[i])
    pool.shutdown(wait=True)
    raw_hits = sum(1 for i in futures if i in dets and dets[i])
    print(f"[FastCloud] {len(futures)} frames sent, {fails} failed, {raw_hits} with a ball detection"
          f", max confidence {getattr(cloud, 'max_conf_seen', 0.0):.2f}"
          f"{' | last error: ' + str(cloud.last_error) if fails else ''}")
    seen = cloud.stats_text()
    print(f"[FastCloud] Roboflow returned: {seen} | dropped {low_conf} below conf {CONF}, "
          f"{too_big} too large/elongated for a ball (max {0.06 * max(W, H):.0f}px)")
    if futures and fails / len(futures) > 0.5:
        return {"ok": False, "error": cloud.last_error}

    return {
        "ok": True, "fps": float(fps), "width": W, "height": H, "frames": idx, "stride": stride,
        "detections": dets, "timestamps": _clean_ts(timestamps, fps),
        "engine": "roboflow-cloud (fast)", "cloud_requests": len(futures), "scan_seconds": time.time() - t0,
        "ball_frames": raw_hits, "roboflow_seen": seen,
    }


def _crop_dets(cloud, frame, center, zoom_rel, train_scale, W, H):
    """Send one 640x640 crop around `center`; the ball appears zoom_rel x its training size.
    Returns detections in full-frame pixels."""
    side = int(min(640.0 / (zoom_rel * train_scale), W, H))
    zoom = 640.0 / side
    x0 = int(np.clip(center[0] - side / 2, 0, max(0, W - side)))
    y0 = int(np.clip(center[1] - side / 2, 0, max(0, H - side)))
    crop = cv2.resize(frame[y0:y0 + side, x0:x0 + side], (640, 640),
                      interpolation=cv2.INTER_CUBIC if zoom > 1 else cv2.INTER_AREA)
    res, _ = cloud.detect_frame(crop)
    out = []
    for d in res or []:
        bw, bh = d[2] / zoom, d[3] / zoom
        if d[4] < CONF or max(bw, bh) > 0.06 * max(W, H) or max(bw, bh) / max(1e-3, min(bw, bh)) > 2.2:
            continue
        out.append([x0 + d[0] / zoom, y0 + d[1] / zoom, bw, bh, d[4]])
    return out


def _pt(f, d):
    return {"frame": int(f), "x": float(d[0]), "y": float(d[1]), "size": float(min(d[2], d[3])), "conf": float(d[4])}


def cloud_follow(video_path: str, cloud, track: List[Dict], W: int, H: int, fps: float = 30.0,
                 total_frames: int = 0) -> List[Dict]:
    """
    Dense pass along the delivery with ZOOMED crops (Roboflow shrinks a whole frame to
    640 px, where a far / fast ball is only a few pixels and often missed):
      * gaps inside the track: crops at 1.5x training scale around the interpolated position;
      * release: walk back towards the bowler's hand (1.5x and 1.0x crops), up to 0.35 s;
      * after the last point: follow the ball forward in rounds of parallel requests
        (wide 1.0x crops around the extrapolated position) until it is lost - this
        recovers the bounce and the arrival at the batsman, which sets the speed.
    """
    if len(track) < 3:
        return track
    first, last = int(track[0]["frame"]), int(track[-1]["frame"])
    back = max(4, int(round(0.35 * fps)))
    fwd = max(8, int(round(0.8 * fps)))
    lo, hi = max(0, first - back), last + fwd
    if total_frames:
        hi = min(hi, total_frames - 1)

    # keep the window's frames as JPEG in memory (small; Render free has 512 MB)
    store = {}
    cap = cv2.VideoCapture(video_path)
    i = 0
    while i <= hi:
        if not cap.grab():
            break
        if i >= lo:
            ok, fr = cap.retrieve()
            if ok:
                store[i] = cv2.imencode(".jpg", fr, [int(cv2.IMWRITE_JPEG_QUALITY), 92])[1]
        i += 1
    cap.release()
    hi = min(hi, max(store) if store else hi)

    def frame(f):
        return cv2.imdecode(store[f], cv2.IMREAD_COLOR)

    train_scale = float(os.getenv("BALL_DETECT_LONG_SIDE", "1280")) / float(max(W, H))
    by_f = {int(p["frame"]): dict(p) for p in track}
    ex = concurrent.futures.ThreadPoolExecutor(max_workers=cloud.workers)

    def run(jobs):
        """jobs: list of (frame, center, zoom). Returns {frame: [dets]} (all zooms merged)."""
        futs = {ex.submit(_crop_dets, cloud, frame(f), c, z, train_scale, W, H): f
                for f, c, z in jobs if f in store}
        out = {}
        for fu in concurrent.futures.as_completed(futs):
            try:
                out.setdefault(futs[fu], []).extend(fu.result())
            except Exception:
                pass
        for f, dl in out.items():
            seen.extend((f, d[0], d[1]) for d in dl)
        return out

    def moving(f, dl):
        return [d for d in dl if not is_static(f, d)]

    seen = []          # (frame, x, y) of every crop detection -> static-object suppression

    def is_static(f, d):
        # something that sits at the same spot in 3+ other frames is not a flying ball
        # (stumps, a logo, a ball lying on the ground)
        # (frames at least 3 apart, so a slow ball near the batsman is not mistaken for one)
        frames_hit = {g for g, x, y in seen if abs(g - f) >= 3 and abs(x - d[0]) < 5 and abs(y - d[1]) < 5}
        return len(frames_hit) >= 3

    def nearest(dets, guess, gate):
        dets = [d for d in dets if math.hypot(d[0] - guess[0], d[1] - guess[1]) < gate]
        return min(dets, key=lambda d: math.hypot(d[0] - guess[0], d[1] - guess[1])) if dets else None

    # ---- 1. gaps inside the track + release walk-back (one parallel round)
    fr_known = sorted(by_f)
    xs = np.array([by_f[f]["x"] for f in fr_known]); ys = np.array([by_f[f]["y"] for f in fr_known])
    # every frame of the span: fill the gaps AND re-measure the coarse points (a ball
    # that is ~8 px in the shrunk full frame is located far more precisely in a zoomed crop)
    gaps = list(range(first, last + 1))
    p0 = np.array([xs[0], ys[0]]); v0 = (np.array([xs[1], ys[1]]) - p0) / max(1, fr_known[1] - first)
    back_frames = [f for f in range(first - 1, lo - 1, -1)]
    jobs = [(f, (np.interp(f, fr_known, xs), np.interp(f, fr_known, ys)), 1.5) for f in gaps]
    jobs += [(f, p0 - v0 * (first - f), z) for f in back_frames for z in (1.5, 1.0)]
    res = run(jobs)
    for f in gaps:
        # leave-one-out guess: a coarse point may itself be a distractor
        o = [g for g in fr_known if g != f] or fr_known
        guess = (np.interp(f, o, [by_f[g]["x"] for g in o]), np.interp(f, o, [by_f[g]["y"] for g in o]))
        d = nearest(moving(f, res.get(f, [])), guess, 12.0 + 1.2 * float(np.linalg.norm(v0)))
        if d:
            by_f[f] = _pt(f, d)
    if first not in by_f:
        by_f[first] = dict(track[0])
    p0 = np.array([by_f[first]["x"], by_f[first]["y"]])
    cur_f, cur, v, misses = first, p0.copy(), v0.copy(), 0
    for f in back_frames:
        gap = cur_f - f
        guess = cur - v * gap
        d = nearest([d for d in moving(f, res.get(f, [])) if d[4] >= 0.05], guess, 8.0 + 0.7 * float(np.linalg.norm(v)) * gap)
        if d:
            new = np.array(d[:2], dtype=float)
            v = 0.5 * v + 0.5 * (cur - new) / gap
            cur_f, cur, misses = f, new, 0
            by_f[f] = _pt(f, d)
        else:
            misses += 1
            if misses >= 4:
                break

    # ---- 2. follow forward in rounds of parallel requests
    def vel_at_end():
        fs_ = sorted(by_f)[-3:]
        a, b = by_f[fs_[0]], by_f[fs_[-1]]
        return np.array([b["x"] - a["x"], b["y"] - a["y"]]) / max(1, fs_[-1] - fs_[0])

    batch = 6
    misses = 0
    f_next = last + 1
    while f_next <= hi and misses < 8:
        end_f = max(by_f)
        pe = np.array([by_f[end_f]["x"], by_f[end_f]["y"]])
        ve = vel_at_end()
        frames_b = list(range(f_next, min(hi, f_next + batch - 1) + 1))
        res = run([(f, pe + ve * (f - end_f), 1.0) for f in frames_b])
        for f in frames_b:
            end_f = max(by_f)
            pe = np.array([by_f[end_f]["x"], by_f[end_f]["y"]])
            ve = vel_at_end()
            gap = f - end_f
            gate = 15.0 + 0.9 * float(np.linalg.norm(ve)) * gap
            d = nearest(moving(f, res.get(f, [])), pe + ve * gap, gate)
            if d:
                by_f[f] = _pt(f, d)
                misses = 0
            else:
                misses += 1
        f_next = frames_b[-1] + 1
    ex.shutdown(wait=True)
    return [by_f[f] for f in sorted(by_f)]


def build_track(scan: Dict, video_path: str, cloud) -> List[Dict]:
    diag = math.hypot(scan["width"], scan["height"])
    best = select_delivery(link_detections(scan["detections"], diag, max_gap=5 * scan["stride"]), diag)
    if best is None:
        return []
    track = trim_delivery(best.as_dicts(), diag, scan["fps"])
    track = cloud_follow(video_path, cloud, track, scan["width"], scan["height"], scan["fps"], scan["frames"])
    return trim_delivery(track, diag, scan["fps"])
