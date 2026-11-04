"""
Single pass over a video that collects ball detections efficiently.

  * Full tiled search every `stride` frames (every frame if the video is <=30 fps).
  * While a moving candidate exists, one 640 ROI crop around its predicted
    position on EVERY frame (cheap, and catches frames the search skips).
  * When a new moving candidate appears, the last few buffered frames are
    re-checked around the back-extrapolated path, which recovers the release
    frames (important for time-of-flight speed).
  * Optional Roboflow cloud detections replace the local tiled search; if the
    cloud fails it automatically falls back to the local model.

Memory stays small: only a ring buffer of the last few frames is kept.
"""
import math
import os
from collections import deque
from typing import Callable, Dict, List, Optional

import cv2
import numpy as np

from ai.ball_detector import BallDetector, _nms
from ai.trajectory import OnlineLinker

BACKFILL = 14         # frames kept for backfilling the release
SEARCH_CONF = 0.15
ROI_CONF = 0.10
BACKFILL_CONF = 0.05   # only accepted right on the predicted path


def _near_static(d, spots) -> bool:
    for sx, sy, ss in spots:
        if math.hypot(d[0] - sx, d[1] - sy) <= max(6.0, 1.5 * ss):
            return True
    return False


def _merge(existing: List[List[float]], new: List[List[float]]) -> List[List[float]]:
    return _nms(existing + new, iou=0.3) if new else existing


def _clean_timestamps(ts: List[float], fps: float) -> List[float]:
    """Use container timestamps if they are sane (monotonic, ~fps), else frame/fps."""
    n = len(ts)
    if n < 3:
        return [i / fps for i in range(n)]
    arr = np.asarray(ts, dtype=float)
    d = np.diff(arr)
    if np.all(d > 0) and 0.5 / fps < np.median(d) < 2.0 / fps:
        return (arr - arr[0]).tolist()
    return [i / fps for i in range(n)]


def collect_detections(
    video_path: str,
    detector: Optional[BallDetector],
    cloud=None,
    progress: Optional[Callable[[int, int, str], None]] = None,
) -> Dict:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 1 or fps > 1000:
        fps = 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    diag = math.hypot(width, height)

    # Full-frame search interval. ROI crops follow a moving ball on every frame
    # and backfill recovers the release, so the expensive tiled search only has
    # to *find* the ball once in a while (~15 times per second is plenty).
    search_hz = float(os.getenv("BALL_SEARCH_HZ", "15"))
    stride = max(1, int(round(fps / search_hz)))
    use_cloud = cloud is not None and getattr(cloud, "active", False)
    cloud_chunk = 24
    cloud_ok_frames = 0
    engine = "roboflow-cloud" if use_cloud else f"local-{detector.backend if detector else 'none'}"

    linker = OnlineLinker(diag)
    dets: Dict[int, List[List[float]]] = {}
    timestamps: List[float] = []           # seconds, per frame (phone videos are often variable-fps)
    buf = deque(maxlen=BACKFILL)          # (idx, frame)
    backfilled = set()                     # tracklet ids already backfilled
    n_infer = 0
    idx = 0
    static_spots = []

    def local_tiled(frame):
        nonlocal n_infer
        n_infer += 4
        return detector.detect_tiled(frame, SEARCH_CONF)

    def local_roi(frame, center, zoom=1.0, conf=ROI_CONF):
        nonlocal n_infer
        n_infer += 1
        return detector.detect_roi(frame, center, conf, zoom=zoom)

    def zoom_for(size_px):
        # balls smaller than ~9 px at training scale are detected far better zoomed in
        return 1.5 if size_px * detector.train_long_side / float(max(height, width)) < 9 else 1.0

    while True:
        # ---- read a chunk (lets the cloud client work in parallel) ----------
        chunk = []
        for _ in range(cloud_chunk if use_cloud else 1):
            ok, fr = cap.read()
            if not ok:
                break
            chunk.append(fr)
            timestamps.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)
        if not chunk:
            break

        cloud_dets = {}
        if use_cloud:
            frames = {idx + k: f for k, f in enumerate(chunk)}
            cloud_dets, ok_ratio = cloud.detect_frames(frames)
            cloud_ok_frames += len(cloud_dets)
            if ok_ratio < 0.5:
                print(f"[BallSearch] Roboflow unhealthy ({cloud.last_error}); switching to local model")
                use_cloud = False
                engine = f"local-{detector.backend if detector else 'none'} (cloud failed: {cloud.last_error})"

        for frame in chunk:
            # 1) search: denser while nothing is moving, sparser while we follow a ball
            moving = linker.moving_tracks(idx, limit=2)
            every = stride if not moving else stride * 2
            if idx in cloud_dets:
                found = [d for d in cloud_dets[idx] if d[4] >= SEARCH_CONF]
                found = BallDetector._filter(found, frame.shape)
            elif detector is not None and idx % every == 0:
                found = local_tiled(frame)
            else:
                found = []

            # 2) follow moving candidates (and fresh, non-static single detections) with ROI crops
            if detector is not None:
                if idx % 10 == 0:
                    static_spots = linker.static_spots()
                targets = [(t.predict(idx), t.sizes[-1]) for t in moving]
                targets += [(np.array(t.pts[-1]), t.sizes[-1]) for t in linker.fresh_tracks(idx)
                            if not _near_static([*t.pts[-1]], static_spots)]
                for pred, size in targets:
                    if any(math.hypot(d[0] - pred[0], d[1] - pred[1]) < 40 for d in found):
                        continue
                    found = _merge(found, local_roi(frame, pred, zoom_for(size)))

            dets[idx] = found
            linker.step(idx, found)
            buf.append((idx, frame))

            # 3) backfill the start of newly-moving candidates (release frames)
            if detector is not None:
                for t in linker.moving_tracks(idx, limit=2):
                    key = (t.frames[0], round(t.pts[0][0]), round(t.pts[0][1]))
                    if key in backfilled or len(t.pts) < 2 or len(t.pts) > 4:
                        continue
                    backfilled.add(key)
                    # Walk back along the ball's own path, one frame at a time.
                    # Far from the camera the ball is tiny and moves fewer pixels
                    # per frame, so: zoom in hard, accept low confidence only very
                    # close to the predicted path, and re-estimate the velocity
                    # after every accepted point.
                    v = np.array(t.velocity(), dtype=float)
                    cur_f, cur_p = t.frames[0], np.array(t.pts[0], dtype=float)
                    tiny = zoom_for(t.sizes[0]) > 1.0 or min(width, height) < 600
                    misses = 0
                    for bidx, bframe in reversed(buf):
                        if bidx >= cur_f:
                            continue
                        gap = cur_f - bidx
                        guess = cur_p - v * gap
                        got = local_roi(bframe, guess, conf=BACKFILL_CONF, zoom=2.0 if tiny else 1.5)
                        speed = float(np.linalg.norm(v))
                        gate = 6.0 + 0.6 * speed * gap
                        got = [d for d in got
                               if math.hypot(d[0] - guess[0], d[1] - guess[1]) < gate
                               and d[4] >= (BACKFILL_CONF if math.hypot(d[0] - guess[0], d[1] - guess[1]) < 0.5 * gate
                                            else ROI_CONF)]
                        if got:
                            best = min(got, key=lambda d: math.hypot(d[0] - guess[0], d[1] - guess[1]))
                            dets[bidx] = _merge(dets.get(bidx, []), [best])
                            new_p = np.array(best[:2], dtype=float)
                            v = 0.5 * v + 0.5 * (cur_p - new_p) / gap
                            cur_f, cur_p = bidx, new_p
                            misses = 0
                        else:
                            misses += 1
                            if misses >= 5:
                                break
                    # also fill skipped frames inside the young tracklet
                    for (fa, pa), (fb, pb) in zip(zip(t.frames, t.pts), zip(t.frames[1:], t.pts[1:])):
                        for bidx, bframe in buf:
                            if fa < bidx < fb:
                                a = (bidx - fa) / (fb - fa)
                                guess = (pa[0] + a * (pb[0] - pa[0]), pa[1] + a * (pb[1] - pa[1]))
                                got = local_roi(bframe, guess, zoom_for(t.sizes[0]))
                                if got:
                                    dets[bidx] = _merge(dets.get(bidx, []), got)

            idx += 1
            if progress:
                progress(idx, total, engine)

    cap.release()
    return {
        "fps": float(fps),
        "width": width,
        "height": height,
        "frames": idx,
        "detections": dets,
        "timestamps": _clean_timestamps(timestamps, fps),
        "engine": engine,
        "local_inferences": n_infer,
        "cloud_frames": cloud_ok_frames,
    }


def refine_track(video_path: str, detector: Optional[BallDetector], track: List[Dict],
                 fps: float, max_back_s: float = 0.6, max_misses: int = 5) -> List[Dict]:
    """
    Second, targeted pass over the selected delivery only:
      * fills frames missing inside the track (ROI at the interpolated position)
      * walks back from the first point towards the bowler's hand (release)
    Costs a few dozen inferences, so the full-frame search can stay sparse.
    """
    if detector is None or len(track) < 3:
        return track
    first, last = int(track[0]["frame"]), int(track[-1]["frame"])
    lo = max(0, first - int(round(max_back_s * fps)))
    need = set(range(lo, last + 1))
    cap = cv2.VideoCapture(video_path)
    frames = {}
    i = 0
    while i <= last:
        ok = cap.grab()
        if not ok:
            break
        if i in need:
            ok, fr = cap.retrieve()
            if ok:
                frames[i] = fr
        i += 1
    cap.release()
    if not frames:
        return track

    H, W = next(iter(frames.values())).shape[:2]
    small_video = min(W, H) < 600
    by_f = {int(p["frame"]): dict(p) for p in track}

    def zoom_for(size_px):
        return 2.0 if size_px * detector.train_long_side / float(max(H, W)) < 9 or small_video else 1.0

    def nearest(dets, guess, gate, min_conf):
        dets = [d for d in dets if math.hypot(d[0] - guess[0], d[1] - guess[1]) < gate and d[4] >= min_conf]
        return min(dets, key=lambda d: math.hypot(d[0] - guess[0], d[1] - guess[1])) if dets else None

    def as_pt(f, d):
        return {"frame": f, "x": float(d[0]), "y": float(d[1]), "size": float(min(d[2], d[3])), "conf": float(d[4])}

    # 1) gaps inside the track
    fs = sorted(by_f)
    for a, b in zip(fs, fs[1:]):
        if b - a < 2 or b - a > 8:
            continue
        pa, pb = by_f[a], by_f[b]
        for f in range(a + 1, b):
            if f not in frames:
                continue
            r = (f - a) / (b - a)
            guess = (pa["x"] + r * (pb["x"] - pa["x"]), pa["y"] + r * (pb["y"] - pa["y"]))
            step = math.hypot(pb["x"] - pa["x"], pb["y"] - pa["y"]) / (b - a)
            d = nearest(detector.detect_roi(frames[f], guess, BACKFILL_CONF, zoom=zoom_for(pa["size"])),
                        guess, 8 + 0.8 * step, BACKFILL_CONF)
            if d is not None:
                by_f[f] = as_pt(f, d)

    # 2) walk back to the release
    fs = sorted(by_f)
    cur_f = fs[0]
    cur = np.array([by_f[cur_f]["x"], by_f[cur_f]["y"]])
    # velocity from the first two points only: later points may already be past the bounce
    v = (np.array([by_f[fs[1]]["x"], by_f[fs[1]]["y"]]) - cur) / max(1, fs[1] - cur_f)
    size = by_f[cur_f]["size"]
    misses = 0
    for f in range(cur_f - 1, lo - 1, -1):
        if f not in frames:
            break
        gap = cur_f - f
        guess = cur - v * gap
        speed = float(np.linalg.norm(v))
        gate = 8.0 + 0.7 * speed * gap
        d = None
        # try a strong zoom first (tiny far ball), then training scale (blurred, bigger ball)
        for z in (max(1.5, zoom_for(size)), 1.0):
            d = nearest(detector.detect_roi(frames[f], guess, BACKFILL_CONF, zoom=z), guess, gate, BACKFILL_CONF)
            if d is not None:
                break
        if d is not None:
            new = np.array(d[:2], dtype=float)
            v = 0.5 * v + 0.5 * (cur - new) / gap
            cur_f, cur, size = f, new, float(min(d[2], d[3]))
            by_f[f] = as_pt(f, d)
            misses = 0
        else:
            misses += 1
            if misses >= max_misses:
                break
    return [by_f[f] for f in sorted(by_f)]


def dense_search(video_path: str, detector: Optional[BallDetector], f0: int, f1: int,
                 conf: float = 0.10) -> Dict[int, List[List[float]]]:
    """Full tiled search on every frame in [f0, f1) - used only to repair a bad track."""
    out: Dict[int, List[List[float]]] = {}
    if detector is None or f1 <= f0:
        return out
    cap = cv2.VideoCapture(video_path)
    i = 0
    while i < f1:
        if not cap.grab():
            break
        if i >= f0:
            ok, fr = cap.retrieve()
            if ok:
                out[i] = detector.detect_tiled(fr, conf)
        i += 1
    cap.release()
    return out
