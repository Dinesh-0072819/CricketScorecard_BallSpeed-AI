"""
Offline ball-trajectory reconstruction for CricSpeedAI.

The uploaded video is processed as a whole, so instead of an online tracker we:
  1. link per-frame YOLO detections into tracklets with a constant-velocity gate,
  2. chain tracklets that are separated by short detection gaps,
  3. drop static tracklets (balls lying on the grass, round logos, lights),
  4. pick the tracklet that looks most like a delivery (long, fast, consistent),
  5. trim it to the release -> bat/stumps segment.

A detection is a list/tuple: [cx, cy, w, h, conf] in original-frame pixels.
"""
import math
from typing import Dict, List, Optional, Sequence

import numpy as np


class Tracklet:
    __slots__ = ("frames", "pts", "sizes", "confs", "_bounced")

    def __init__(self, frame: int, det: Sequence[float]):
        self.frames = [frame]
        self.pts = [(float(det[0]), float(det[1]))]
        self.sizes = [float(min(det[2], det[3]))]
        self.confs = [float(det[4])]
        self._bounced = False

    # ---- geometry helpers -------------------------------------------------
    @property
    def last_frame(self) -> int:
        return self.frames[-1]

    def velocity(self) -> np.ndarray:
        """Per-frame velocity estimated from the last few points."""
        n = len(self.pts)
        if n < 2:
            return np.zeros(2)
        k = min(4, n - 1)
        p1 = np.array(self.pts[-1 - k])
        p2 = np.array(self.pts[-1])
        df = self.frames[-1] - self.frames[-1 - k]
        return (p2 - p1) / max(1, df)

    def predict(self, frame: int) -> np.ndarray:
        gap = frame - self.last_frame
        return np.array(self.pts[-1]) + self.velocity() * gap

    def add(self, frame: int, det: Sequence[float]):
        self.frames.append(frame)
        self.pts.append((float(det[0]), float(det[1])))
        self.sizes.append(float(min(det[2], det[3])))
        self.confs.append(float(det[4]))

    def extend(self, other: "Tracklet"):
        self.frames += other.frames
        self.pts += other.pts
        self.sizes += other.sizes
        self.confs += other.confs

    # ---- descriptors ------------------------------------------------------
    def path_length(self) -> float:
        p = np.asarray(self.pts)
        if len(p) < 2:
            return 0.0
        return float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum())

    def net_displacement(self) -> float:
        return float(math.dist(self.pts[0], self.pts[-1])) if len(self.pts) > 1 else 0.0

    def median_step(self) -> float:
        p = np.asarray(self.pts)
        if len(p) < 2:
            return 0.0
        f = np.asarray(self.frames, dtype=float)
        steps = np.linalg.norm(np.diff(p, axis=0), axis=1) / np.maximum(1.0, np.diff(f))
        return float(np.median(steps))

    def as_dicts(self) -> List[Dict[str, float]]:
        return [
            {"frame": f, "x": p[0], "y": p[1], "size": s, "conf": c}
            for f, p, s, c in zip(self.frames, self.pts, self.sizes, self.confs)
        ]


class OnlineLinker:
    """Greedy constant-velocity linking of detections into tracklets, one frame at a time."""

    def __init__(self, frame_diag: float, max_gap: int = 5):
        self.frame_diag = frame_diag
        self.max_gap = max_gap
        self.base_gate = max(30.0, frame_diag * 0.035)
        self.active: List[Tracklet] = []
        self.finished: List[Tracklet] = []

    def step(self, frame: int, dets: List[Sequence[float]]):
        still = []
        for t in self.active:
            (still if frame - t.last_frame <= self.max_gap else self.finished).append(t)
        self.active = still

        pairs = []
        for ti, t in enumerate(self.active):
            pred = t.predict(frame)
            gap = frame - t.last_frame
            speed = float(np.linalg.norm(t.velocity()))
            gate = self.base_gate * (0.6 if len(t.pts) >= 3 else 1.6) + 0.45 * speed * gap + 6.0 * gap
            for di, d in enumerate(dets):
                dist = math.hypot(d[0] - pred[0], d[1] - pred[1])
                if dist <= gate:
                    # prefer close + confident + size-consistent matches
                    size_pen = abs(min(d[2], d[3]) - t.sizes[-1]) / max(4.0, t.sizes[-1])
                    pairs.append((dist / gate + 0.3 * size_pen - 0.2 * d[4], ti, di))
        pairs.sort()
        used_t, used_d = set(), set()
        for _, ti, di in pairs:
            if ti in used_t or di in used_d:
                continue
            self.active[ti].add(frame, dets[di])
            used_t.add(ti)
            used_d.add(di)
        for di, d in enumerate(dets):
            if di not in used_d:
                self.active.append(Tracklet(frame, d))

    def moving_tracks(self, frame: int, limit: int = 3) -> List[Tracklet]:
        """Recently-updated tracklets that are clearly moving (ROI candidates)."""
        out = []
        for t in self.active:
            if frame - t.last_frame > self.max_gap or len(t.pts) < 2:
                continue
            if float(np.linalg.norm(t.velocity())) >= 1.5:
                out.append(t)
        out.sort(key=lambda t: (len(t.pts), np.mean(t.confs)), reverse=True)
        return out[:limit]

    def fresh_tracks(self, frame: int, limit: int = 2) -> List[Tracklet]:
        """Single-detection tracklets seen in the last 2 frames (could be a ball just released)."""
        out = [t for t in self.active if len(t.pts) == 1 and 0 < frame - t.last_frame <= 2]
        out.sort(key=lambda t: t.confs[-1], reverse=True)
        return out[:limit]

    def static_spots(self) -> List[tuple]:
        """Positions of long-lived stationary tracklets (balls lying on the grass etc.)."""
        spots = []
        for t in self.active + self.finished:
            if len(t.pts) >= 4 and _is_static(t, self.frame_diag):
                p = np.mean(np.asarray(t.pts), axis=0)
                spots.append((float(p[0]), float(p[1]), float(np.median(t.sizes))))
        return spots

    def finish(self) -> List[Tracklet]:
        return self.finished + self.active


def link_detections(
    dets_per_frame: Dict[int, List[Sequence[float]]],
    frame_diag: float,
    max_gap: int = 5,
) -> List[Tracklet]:
    """Offline linking of all detections (frame -> list of [cx, cy, w, h, conf])."""
    linker = OnlineLinker(frame_diag, max_gap)
    for frame in sorted(dets_per_frame.keys()):
        linker.step(frame, [d for d in dets_per_frame[frame] if d is not None])
    return linker.finish()


def _is_static(t: Tracklet, frame_diag: float) -> bool:
    if len(t.pts) < 3:
        return True
    return t.net_displacement() < max(12.0, 0.02 * frame_diag) or t.median_step() < 1.2


def chain_tracklets(tracklets: List[Tracklet], frame_diag: float, max_gap: int = 8) -> List[Tracklet]:
    """Join moving tracklets that continue each other after a short detection gap."""
    moving = sorted([t for t in tracklets if not _is_static(t, frame_diag)], key=lambda t: t.frames[0])
    used = set()
    chains = []
    for i, t in enumerate(moving):
        if i in used:
            continue
        chain = Tracklet(t.frames[0], [*t.pts[0], t.sizes[0], t.sizes[0], t.confs[0]])
        chain.frames, chain.pts, chain.sizes, chain.confs = list(t.frames), list(t.pts), list(t.sizes), list(t.confs)
        used.add(i)
        grown = True
        while grown:
            grown = False
            best = None
            for j, u in enumerate(moving):
                if j in used:
                    continue
                gap = u.frames[0] - chain.last_frame
                if gap < 1 or gap > max_gap:
                    continue
                pred = chain.predict(u.frames[0])
                speed = float(np.linalg.norm(chain.velocity()))
                gate = 25.0 + 0.6 * speed * gap
                dist = math.hypot(u.pts[0][0] - pred[0], u.pts[0][1] - pred[1])
                # never join pieces moving in opposite directions (delivery -> shot)
                if len(u.pts) >= 2:
                    vu = u.velocity() if len(u.pts) <= 4 else (np.array(u.pts[min(3, len(u.pts) - 1)]) - np.array(u.pts[0])) / max(1, u.frames[min(3, len(u.pts) - 1)] - u.frames[0])
                    vc = chain.velocity()
                    if np.linalg.norm(vu) > 2 and np.linalg.norm(vc) > 2 and float(vu @ vc) < 0:
                        # allowed only if it looks like the pitch bounce: the ball was going down
                        # the screen and now goes up, while the sideways motion carries on
                        bounce_like = (vc[1] > 0 and vu[1] < 0 and
                                       abs(vu[0] - vc[0]) <= 0.6 * max(np.linalg.norm(vu), np.linalg.norm(vc)) + 2.0
                                       and 0.3 < np.linalg.norm(vu) / np.linalg.norm(vc) < 2.5
                                       and gap <= 3 and not getattr(chain, "_bounced", False))
                        if not bounce_like:
                            continue
                if dist <= gate and (best is None or dist < best[0]):
                    best = (dist, j, u)
            if best is not None:
                v_before = chain.velocity()
                chain.extend(best[2])
                if v_before[1] > 0 and best[2].velocity()[1] < 0:
                    chain._bounced = True
                used.add(best[1])
                grown = True
        chains.append(chain)
    return chains


def delivery_score(t: Tracklet, frame_diag: float) -> float:
    """Heuristic score: long, fast, directionally consistent, confident tracks win."""
    n = len(t.pts)
    if n < 5:
        return 0.0
    p = np.asarray(t.pts)
    f = np.asarray(t.frames, dtype=float)
    # travel: how far the ball moves in the image. Uses the path length of a
    # lightly smoothed path so a V-shaped bounce in an end-on view still counts.
    extent = float(np.max(np.linalg.norm(p - p[0], axis=1)))
    ps = p[::2] if n >= 8 else p
    travel = float(np.linalg.norm(np.diff(ps, axis=0), axis=1).sum())
    extent = max(extent, 0.7 * travel)
    if extent < 0.05 * frame_diag:
        return 0.0
    # smoothness: a ball in flight has near-constant velocity between frames;
    # junk tracks (bats, players, flickering false positives) jump around.
    vel = np.diff(p, axis=0) / np.maximum(1.0, np.diff(f))[:, None]
    speed = np.linalg.norm(vel, axis=1)
    if len(vel) >= 3:
        acc = np.linalg.norm(np.diff(vel, axis=0), axis=1)
        roughness = float(np.median(acc) / (np.median(speed) + 1.0))
    else:
        roughness = 1.0
    smooth = 1.0 / (1.0 + 4.0 * roughness)
    conf = float(np.mean(t.confs))
    span = f[-1] - f[0] + 1
    fill = n / span
    return extent * smooth * (0.5 + conf) * (0.5 + fill) * min(1.0, n / 12.0)


def select_delivery(tracklets: List[Tracklet], frame_diag: float) -> Optional[Tracklet]:
    chains = chain_tracklets(tracklets, frame_diag)
    scored = [(delivery_score(c, frame_diag), c) for c in chains]
    scored = [s for s in scored if s[0] > 0]
    if not scored:
        return None
    scored.sort(key=lambda s: s[0], reverse=True)
    best_score, best = scored[0]

    # A struck ball (shot) starts where the delivery ended, a few frames later.
    # If the top track looks like the continuation of another strong track,
    # the earlier one is the delivery.
    # The delivery can be short (fast ball, 30 fps) while the shot is long and
    # clear, so even a much weaker preceding track wins if the top track starts
    # right where it ended.
    for score, cand in scored[1:]:
        if score < 0.08 * best_score or len(cand.pts) < 4:
            continue
        gap = best.frames[0] - cand.frames[-1]
        if 0 <= gap <= 15 and math.dist(best.pts[0], cand.pts[-1]) < 0.4 * frame_diag:
            return cand
    return best


def trim_delivery(track: List[Dict[str, float]], frame_diag: float = 0.0, fps: float = 60.0) -> List[Dict[str, float]]:
    """
    Cut the track to the delivery flight: drop pre-release hand movement and
    everything after the ball hits the bat / reverses direction.
    """
    if len(track) < 5:
        return track
    hand_px_per_frame = 0.003 * frame_diag * (30.0 / max(1.0, fps)) if frame_diag else 0.0
    p = np.array([[d["x"], d["y"]] for d in track])
    f = np.array([d["frame"] for d in track], dtype=float)

    n = len(p)

    # End: bat contact / rebound. The pitch bounce is NOT an end: in an end-on
    # view it flips only the vertical image velocity while the sideways velocity
    # and the speed stay continuous. Anything else that reverses is a hit.
    end = n
    bounce_seen = False
    bounce_i = -10
    for i in range(2, n - 1):
        j = max(i - 2, bounce_i)           # never measure "before" across the bounce
        if j >= i:
            continue
        v_prev = (p[i] - p[j]) / max(1.0, f[i] - f[j])
        v_next = (p[i + 1] - p[i]) / max(1.0, f[i + 1] - f[i])
        sp, sn = np.linalg.norm(v_prev), np.linalg.norm(v_next)
        if sp < 1.0 or sn < 1.0:
            continue
        cosang = float(v_prev @ v_next / (sp * sn))
        ratio = sn / sp
        if cosang < 0.5:
            vertical_flip = v_prev[1] > 0 and v_next[1] < v_prev[1]
            x_continuous = abs(v_next[0] - v_prev[0]) <= 0.6 * max(sp, sn) + 2.0
            if not bounce_seen and vertical_flip and x_continuous and 0.35 < ratio < 2.5:
                bounce_seen = True
                bounce_i = i
                continue
            if cosang < -0.17 or ratio > 2.0:
                end = i + 1
                break
        # sudden speed jump = bat contact
        if ratio > 2.2 and sn > 4.0:
            end = i + 1
            break
    out = track[:end]

    # Start: skip leading near-stationary points (ball still in hand / bowler's run-up)
    start = 0
    p = p[:end]
    f = f[:end]
    for i in range(len(p) - 3):
        step = np.linalg.norm(p[i + 1] - p[i]) / max(1.0, f[i + 1] - f[i])
        if step >= 1.5:
            start = i
            break
    # still in the bowler's hand: much slower than the flight that follows, or
    # nearly stationary (threshold scales with image size and frame rate)
    def step(i):
        return np.linalg.norm(p[i + 1] - p[i]) / max(1.0, f[i + 1] - f[i])

    while start < len(p) - 5:
        s1 = step(start)
        nxt = float(np.median([step(start + k) for k in (1, 2, 3)]))
        if nxt > 1.0 and (s1 < 0.4 * nxt or s1 < hand_px_per_frame):
            start += 1
        else:
            break
    return out[start:]
