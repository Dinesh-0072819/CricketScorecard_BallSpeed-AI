"""
Delivery analysis: speed, bounce, swing and spin from a tracked ball path.

Coordinate convention used for classification ("pitch frame"):
    lateral  L  metres, POSITIVE = to the right as seen from the BOWLER's end
                (= the LEG side of a right-handed batsman)
    along    D  metres from the release point towards the batsman

    Right-handed batsman (RHB):
        ball moves towards +L (into the batsman, off -> leg)
            in the air        -> INSWING
            off the pitch     -> OFF_SPIN   (off-break)
        ball moves towards -L (away from the batsman, leg -> off)
            in the air        -> OUTSWING
            off the pitch     -> LEG_SPIN   (leg-break)
    Left-handed batsman: mirrored.

Two entry points:
    analyze_video_track(...)  image track from the video pipeline (frame, x, y, size)
    analyze_delivery(...)     generic; accepts an image track or a pitch-frame track
                              ([{"x": L, "y": D, "py": pixel_y}, ...]) for tests/tools.

SPEED
-----
Speed = release-to-batsman distance / time of flight. The time of flight comes
from the frame numbers of the first (release) and last (bat / stumps) tracked
positions, so it does not depend on a guessed pixel-to-metre scale. The
distance is the pitch length minus the two creases (bowler releases at the
popping crease, batsman plays at his popping crease): 20.12 - 2 x 1.22 = 17.68 m
for a standard pitch. Set PITCH_LENGTH_M (env) or the upload form field
`pitch_length_m` for turf / box-cricket pitches.
This is the AVERAGE speed over the flight; a speed gun shows release speed,
which is typically ~8-12% higher (tennis balls slow down more).
"""
import math
import os
from typing import Any, Dict, List, Optional

import numpy as np

# Thresholds (also imported by tests via config.py)
# Rule: ANY deviation after pitching = spin (towards batsman OFF_SPIN, away LEG_SPIN);
#       otherwise ANY deviation before pitching = swing (towards INSWING, away OUTSWING).
# The small floors below only ignore camera / tracking jitter on a straight ball.
TURN_MIN_DEG = float(os.getenv("TURN_MIN_DEG", "0.5"))      # STRAIGHT only below 0.5 deg turn after pitching
TURN_MIN_DEG_SLOW = float(os.getenv("TURN_MIN_DEG_SLOW", str(TURN_MIN_DEG)))
SPIN_SPEED_KMH = float(os.getenv("SPIN_SPEED_KMH", "95"))  # below this a ball is treated as slow / spin
TURN_MIN_LATERAL_M = 0.0                                   # and at least 3 cm sideways after bounce
SWING_MIN_M = float(os.getenv("SWING_MIN_M", "0.01"))      # STRAIGHT only below 1 cm swing before pitching
SIGNIFICANCE = float(os.getenv("DEVIATION_SIGNIFICANCE", "2.0"))   # deviation must exceed 2x its error bar      # in-air lateral curve to call it swing
CREASE_OFFSET_M = 1.22
DEFAULT_PITCH_LENGTH_M = float(os.getenv("PITCH_LENGTH_M", "20.12"))
BALL_DIAMETER_M = float(os.getenv("BALL_DIAMETER_M", "0.067"))   # tennis ball (leather = 0.072)
BALL_BOX_SCALE = float(os.getenv("BALL_BOX_SCALE", "1.0"))       # YOLO box / real ball size correction
PACE_MIN_KMH = float(os.getenv("PACE_MIN_KMH", "100"))
BOUNCE_SPEED_RETENTION = float(os.getenv("BOUNCE_SPEED_RETENTION", "0.9"))


# --------------------------------------------------------------------------- helpers
def _fallback(reason: str = "insufficient_data") -> Dict[str, Any]:
    return {
        "status": reason,
        "deviation_angle_deg": 0.0,
        "turn_angle_deg": 0.0,
        "turn_direction": "Straight",
        "swing_cm": 0.0,
        "turn_cm": 0.0,
        "delivery_type": "STRAIGHT",
        "spin_type": "NONE",
        "swing_type": "NONE",
        "bowler_style": "UNKNOWN",
        "bounce_index": None,
        "confidence": 0.0,
    }


def _robust_polyfit(x: np.ndarray, y: np.ndarray, deg: int, iters: int = 3) -> np.ndarray:
    """Least squares with simple iterative outlier down-weighting."""
    w = np.ones_like(y, dtype=float)
    coef = np.polyfit(x, y, deg, w=w)
    for _ in range(iters):
        r = y - np.polyval(coef, x)
        s = 1.4826 * np.median(np.abs(r)) + 1e-9
        w = 1.0 / np.maximum(1.0, np.abs(r) / (2.5 * s))
        coef = np.polyfit(x, y, deg, w=w)
    return coef


def _unscaled_cov(x: np.ndarray, deg: int) -> np.ndarray:
    """(X^T X)^-1 for a polynomial fit: multiply by sigma^2 to get the coefficient covariance."""
    X = np.vander(np.asarray(x, dtype=float), deg + 1)
    try:
        return np.linalg.inv(X.T @ X)
    except np.linalg.LinAlgError:
        return np.full((deg + 1, deg + 1), 1e6)


def _robust_sigma(res: np.ndarray, dof: int) -> float:
    """Scatter of the points around a fit (robust), with a small floor for perfect tracks."""
    res = np.asarray(res, dtype=float)
    if len(res) == 0:
        return 1.0
    mad = 1.4826 * float(np.median(np.abs(res - np.median(res))))
    rms = float(np.sqrt(np.sum(res ** 2) / max(1, dof)))
    return max(0.002, 0.5 * (mad + rms))   # >= 2 mm


def find_bounce(t: np.ndarray, py: np.ndarray) -> Optional[int]:
    """
    Bounce = the point where the vertical image velocity drops most sharply
    (ball stops going down the image and starts going up). Works for a camera
    behind either end. Returns an index into the arrays or None (full toss /
    yorker / too short).
    """
    n = len(t)
    if n < 6:
        return None
    vy = np.gradient(py, t)
    speed = np.median(np.abs(vy)) + 1e-6
    # noise level of the vertical velocity (from its own second differences)
    noise = 1.4826 * np.median(np.abs(np.diff(vy))) + 1e-6
    best, best_i = 0.0, None
    for i in range(2, n - 2):
        before = vy[max(0, i - 3):i].mean()
        after = vy[i + 1:i + 4].mean()
        # gravity and perspective only ever make the ball speed UP down the screen
        # before it pitches; a sharp DROP in downward speed is the bounce
        drop = before - after
        if drop > best:
            best, best_i = drop, i
    if best_i is None or best < max(0.5 * speed, 1.5 * noise):
        return None
    # snap to the lowest on-screen point near the kink
    lo, hi = max(0, best_i - 2), min(n, best_i + 3)
    best_i = lo + int(np.argmax(py[lo:hi]))
    if best_i < 2 or best_i > n - 2:
        return None
    return best_i


def _classify(
    L: np.ndarray, D: np.ndarray, bounce: Optional[int], hand: str, speed_kmh: Optional[float]
) -> Dict[str, Any]:
    """Core classifier in the pitch frame (see module docstring)."""
    n = len(L)
    hand = "LEFT" if str(hand).upper().startswith("L") else "RIGHT"
    mirror = -1.0 if hand == "LEFT" else 1.0   # +L towards leg side of this batsman

    pre_end = bounce if bounce is not None else n - 1
    pre_L, pre_D = L[:pre_end + 1], D[:pre_end + 1]

    # Every deviation is tested against its own error bar (from how much the tracked
    # points scatter around the fitted path), so even a small turn counts when the
    # track is clean, while camera/tracking jitter on a straight ball does not.

    # ---- swing: lateral curvature of the in-air path before the bounce ----
    swing_m, swing_dir, swing_sigma_m = 0.0, 0.0, float("inf")
    pre_res = None
    if len(pre_L) >= 4 and np.ptp(pre_D) > 0.5:
        dn = (pre_D - pre_D[0]) / np.ptp(pre_D)                       # 0..1 along the flight
        c = _robust_polyfit(dn, pre_L, 2) if len(pre_L) >= 5 else np.polyfit(dn, pre_L, 2)
        c2 = c[0]
        swing_m = abs(c2) / 4.0                                       # max bulge from the chord
        swing_dir = math.copysign(1.0, c2) if swing_m > 0 else 0.0    # direction of late movement
        pre_res = pre_L - np.polyval(c, dn)
        if len(pre_L) >= 5:
            sig = _robust_sigma(pre_res, len(pre_L) - 3)
            cov = _unscaled_cov(dn, 2)
            swing_sigma_m = math.sqrt(max(cov[0, 0], 0.0)) * sig / 4.0

    # ---- turn: change of direction at the bounce ----
    turn_deg, turn_m, turn_sigma_deg = 0.0, 0.0, float("inf")
    turn_reliable = False
    if bounce is not None and bounce >= 2 and n - bounce >= 3:
        preD, preL = D[:bounce + 1], L[:bounce + 1]
        if len(preD) >= 6 and np.ptp(preD) > 1.0:
            q = _robust_polyfit(preD, preL, 2)                                  # allows for swing
            a = float(2 * q[0] * preD[-1] + q[1])                               # dL/dD at the bounce
            g = np.array([2 * preD[-1], 1.0, 0.0])
            var_a_unit = float(g @ _unscaled_cov(preD, 2) @ g)
            res_a = preL - np.polyval(q, preD)
            dof_a = len(preD) - 3
        else:
            q = np.polyfit(preD, preL, 1)
            a = float(q[0])
            var_a_unit = float(_unscaled_cov(preD, 1)[0, 0]) if len(preD) >= 3 else 1e6
            res_a = preL - np.polyval(q, preD)
            dof_a = len(preD) - 2
        post_D, post_L = D[bounce:], L[bounce:]
        if np.ptp(post_D) > 0.2:
            qb = np.polyfit(post_D, post_L, 1)
            b = float(qb[0])                                                    # dL/dD after
            turn_deg = math.degrees(math.atan(b) - math.atan(a))
            # sideways distance from where a straight ball would be at the end of the track
            turn_m = (b - a) * float(post_D[-1] - post_D[0])
            # need enough of the path after the bounce to measure a change of direction
            turn_reliable = len(post_D) >= 4 and np.ptp(post_D) >= 1.0
            # error bar of the turn angle: pooled scatter of the points around both fits
            res_b = post_L - np.polyval(qb, post_D)
            sig = _robust_sigma(np.concatenate([res_a, res_b]), max(1, dof_a + len(post_D) - 2))
            var_b_unit = float(_unscaled_cov(post_D, 1)[0, 0]) if len(post_D) >= 3 else 1e6
            turn_sigma_deg = math.degrees(sig * math.sqrt(max(0.0, var_a_unit) + max(0.0, var_b_unit)))

    toward_leg_turn = (turn_deg * mirror) > 0
    toward_leg_swing = (swing_dir * mirror) > 0

    # slow balls (spinners) need a smaller turn to count than pace balls (cutters)
    turn_min = TURN_MIN_DEG_SLOW if (speed_kmh is None or speed_kmh < SPIN_SPEED_KMH) else TURN_MIN_DEG
    spin_type = "NONE"
    # User rule: ANY deviation after pitching (>= 1.0 deg) is spin. The error bar
    # does not block it; it only lowers the reported confidence.
    if turn_reliable and abs(turn_deg) >= turn_min and abs(turn_m) >= TURN_MIN_LATERAL_M:
        spin_type = "OFF_SPIN" if toward_leg_turn else "LEG_SPIN"
    swing_type = "NONE"
    if swing_m >= SWING_MIN_M:
        swing_type = "INSWING" if toward_leg_swing else "OUTSWING"

    # Rule: deviation after pitching decides first (spin), then deviation before
    # pitching (swing); STRAIGHT only when both are below their minimums.
    if spin_type != "NONE":
        delivery_type = spin_type
    elif swing_type != "NONE":
        delivery_type = swing_type
    else:
        delivery_type = "STRAIGHT"

    who = "RHB" if hand == "RIGHT" else "LHB"
    spin_sure = not (math.isfinite(turn_sigma_deg) and abs(turn_deg) < SIGNIFICANCE * turn_sigma_deg)
    swing_sure = not (math.isfinite(swing_sigma_m) and swing_m < SIGNIFICANCE * swing_sigma_m)
    spin_note = "" if spin_sure else f" \u2013 small turn, \u00b1{turn_sigma_deg:.1f}\u00b0 measurement error"
    swing_note = "" if swing_sure else f" \u2013 small swing, \u00b1{swing_sigma_m * 100:.0f} cm measurement error"
    if delivery_type == "OFF_SPIN":
        turn_direction = f"Off Break: turned {abs(turn_deg):.1f}\u00b0 into the {who} after pitching{spin_note}"
    elif delivery_type == "LEG_SPIN":
        turn_direction = f"Leg Break: turned {abs(turn_deg):.1f}\u00b0 away from the {who} after pitching{spin_note}"
    elif delivery_type == "INSWING":
        turn_direction = f"Inswing: curved {swing_m * 100:.0f} cm into the {who} before pitching{swing_note}"
    elif delivery_type == "OUTSWING":
        turn_direction = f"Outswing: curved {swing_m * 100:.0f} cm away from the {who} before pitching{swing_note}"
    else:
        # still tell the user what was measured
        if bounce is not None and not turn_reliable:
            turn_direction = "Straight (bat hit too soon after the bounce to measure turn)"
        elif abs(turn_deg) >= 0.5:
            side = "into" if toward_leg_turn else "away from"
            if math.isfinite(turn_sigma_deg) and abs(turn_deg) < SIGNIFICANCE * turn_sigma_deg:
                turn_direction = (f"Straight ({abs(turn_deg):.1f}\u00b0 {side} the {who} is within the "
                                  f"\u00b1{turn_sigma_deg:.1f}\u00b0 measurement error)")
            else:
                turn_direction = f"Straight (slight {abs(turn_deg):.1f}\u00b0 {side} the {who})"
        else:
            turn_direction = "Straight Line"

    style = "UNKNOWN"
    if speed_kmh:
        style = "PACER" if speed_kmh >= PACE_MIN_KMH else "SPINNER"

    return {
        "status": "ok",
        "deviation_angle_deg": round(float(abs(turn_deg)), 1),
        "turn_angle_deg": round(float(abs(turn_deg)), 1),
        "turn_angle_signed_deg": round(float(turn_deg * mirror), 2),   # + = towards this batsman's leg side
        "turn_cm": round(float(abs(turn_m)) * 100.0, 1),
        "turn_direction": turn_direction,
        "swing_cm": round(float(swing_m) * 100.0, 1),
        "delivery_type": delivery_type,
        "spin_type": spin_type,
        "swing_type": swing_type,
        "bowler_style": style,
        "bounce_index": int(bounce) if bounce is not None else None,
        "turn_measurable": bool(turn_reliable),
        "movement_confidence": "high" if (spin_sure if delivery_type in ("OFF_SPIN", "LEG_SPIN") else swing_sure) else "low",
        "turn_error_deg": round(float(turn_sigma_deg), 2) if math.isfinite(turn_sigma_deg) else None,
        "swing_error_cm": round(float(swing_sigma_m) * 100, 1) if math.isfinite(swing_sigma_m) else None,
        "batsman_hand": hand,
    }


# --------------------------------------------------------------------------- video tracks
def analyze_video_track(
    track: List[Dict[str, float]],
    fps: float,
    frame_w: int,
    frame_h: int,
    pitch_length_m: Optional[float] = None,
    batsman_hand: str = "RIGHT",
    ball_diameter_m: float = BALL_DIAMETER_M,
    timestamps: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """
    track: [{"frame", "x", "y", "size", "conf"}, ...] for ONE delivery (release -> bat),
    in original-video pixels, as produced by ai.trajectory.
    timestamps: optional per-frame times in seconds (exact timing for variable-fps phone videos).
    """
    if not track or len(track) < 5 or fps <= 0:
        out = _fallback()
        out.update({"speed_kmh": 0.0, "flight_time_s": 0.0})
        return out

    pitch_length_m = float(pitch_length_m or DEFAULT_PITCH_LENGTH_M)
    distance_m = max(1.0, pitch_length_m - 2 * CREASE_OFFSET_M)

    fr = np.array([p["frame"] for p in track], dtype=float)
    px = np.array([p["x"] for p in track], dtype=float)
    py = np.array([p["y"] for p in track], dtype=float)
    sz = np.array([max(1.0, p.get("size", 10.0)) for p in track], dtype=float)
    if timestamps is not None and len(timestamps) > int(fr[-1]):
        ts = np.asarray(timestamps, dtype=float)
        t = ts[fr.astype(int)] - ts[int(fr[0])]
    else:
        t = (fr - fr[0]) / fps
    T = float(t[-1])
    if T <= 0:
        out = _fallback()
        out.update({"speed_kmh": 0.0, "flight_time_s": 0.0})
        return out

    # ---- speed: time of flight over the release->batsman distance ----
    speed_mps = distance_m / T
    speed_kmh = speed_mps * 3.6

    # ---- bounce ----
    bounce = find_bounce(t, py)

    # ---- depth from apparent ball size (1/size is linear in depth) ----
    inv = 1.0 / sz
    # Depth is linear in time, with the ball keeping ~90% of its speed through the bounce.
    tau = t.copy()
    if bounce is not None:
        tau = t - (1.0 - BOUNCE_SPEED_RETENTION) * np.maximum(0.0, t - t[bounce])
    coef = _robust_polyfit(tau, inv, 1)
    inv_fit = np.clip(np.polyval(coef, tau), 1e-4, None)
    size_ratio = float(inv_fit[0] / inv_fit[-1])          # >1 ball approaches the camera
    approaching = size_ratio >= 1.0
    depth_ok = max(size_ratio, 1.0 / size_ratio) >= 1.3

    cx = frame_w / 2.0
    # Sideways metres: the ball's own apparent size is the local metres-per-pixel
    # scale (ball diameter / box size), smoothed by the 1/size fit. This is
    # independent of focal length and of where the camera stands.
    X_cam = (px - cx) * ball_diameter_m * inv_fit * BALL_BOX_SCALE
    # Along-the-pitch metres: from time (speed is constant in the air and drops
    # ~10% at the bounce); far more reliable than depth from box size, because
    # boxes of tiny, blurred far-away balls are inflated.
    along = distance_m * tau / max(1e-9, tau[-1])

    # image right == bowler's-view right when the camera is behind the bowler,
    # and the opposite when the camera is behind the batsman (ball approaching)
    L = -X_cam if approaching else X_cam
    # measure deviation relative to the delivery line (release -> bounce / end)
    ref = bounce if bounce is not None else len(L) - 1
    if along[ref] > 1e-3:
        slope = (L[ref] - L[0]) / (along[ref] - along[0] + 1e-9)
        L = L - L[0] - slope * (along - along[0])

    res = _classify(L, along, bounce, batsman_hand, speed_kmh)

    n = len(track)
    span = fr[-1] - fr[0] + 1
    conf = 0.35 + 0.35 * min(1.0, n / 25.0) + 0.2 * (n / span) + (0.1 if depth_ok else 0.0)
    if not approaching:
        conf -= 0.15   # camera behind the bowler: ball gets tiny, lateral noise is higher
    res.update({
        "speed_kmh": round(speed_kmh, 1),
        "flight_time_s": round(T, 3),
        "release_frame": int(fr[0]),
        "arrival_frame": int(fr[-1]),
        "bounce_frame": int(fr[bounce]) if bounce is not None else None,
        "bounce_point_px": [round(float(px[bounce]), 1), round(float(py[bounce]), 1)] if bounce is not None else None,
        "distance_m": round(distance_m, 2),
        "pitch_length_m": round(pitch_length_m, 2),
        "camera_end": "batsman" if approaching else "bowler",
        "size_trend_clear": bool(depth_ok),
        "track_points": n,
        "confidence": round(float(min(0.98, conf)), 2),
    })
    return res


# --------------------------------------------------------------------------- generic / legacy
def analyze_delivery(
    trajectory_points: List[Any],
    fps: float = 30.0,
    pixel_to_meter: float = 0.025,
    batsman_hand: str = "RIGHT",
    speed_kmh: Optional[float] = None,
    frame_size: Optional[tuple] = None,
    pitch_length_m: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Backwards-compatible entry point.
      * image track dicts with "frame" (and "size")  -> analyze_video_track
      * pitch-frame dicts {"x": lateral m, "y": along m, "py": pixel y}
      * plain (x, y) pixel tuples (live camera)      -> pixel approximation
    """
    if not trajectory_points or len(trajectory_points) < 4:
        return _fallback()

    first = trajectory_points[0]
    if isinstance(first, dict) and "frame" in first:
        w, h = frame_size or (1280, 720)
        return analyze_video_track(trajectory_points, fps, w, h, pitch_length_m, batsman_hand)

    if isinstance(first, dict) and "x" in first and "y" in first and "py" in first:
        L = np.array([float(p["x"]) for p in trajectory_points])
        D = np.array([float(p["y"]) for p in trajectory_points])
        py = np.array([float(p["py"]) for p in trajectory_points])
        bounce = find_bounce(D, py)
        if bounce is None:
            bounce = int(np.argmax(py)) if 0 < int(np.argmax(py)) < len(py) - 1 else None
        res = _classify(L - L[0], D - D[0], bounce, batsman_hand, speed_kmh)
        res["confidence"] = round(min(0.95, 0.5 + 0.05 * len(L)), 2)
        return res

    # plain pixel points (live camera): treat image as seen from behind the batsman
    pts = []
    for p in trajectory_points:
        if isinstance(p, dict):
            pts.append((float(p.get("px", p.get("x", 0))), float(p.get("py", p.get("y", 0)))))
        else:
            pts.append((float(p[0]), float(p[1])))
    pts = np.array(pts)
    if len(pts) < 5:
        return _fallback()
    t = np.arange(len(pts), dtype=float) / max(1.0, fps)
    bounce = find_bounce(t, pts[:, 1])
    L = -(pts[:, 0] - pts[0, 0]) * pixel_to_meter
    along = np.linspace(0.0, max(1.0, np.ptp(pts[:, 1]) * pixel_to_meter * 4), len(pts))
    ref = bounce if bounce is not None else len(L) - 1
    slope = (L[ref] - L[0]) / (along[ref] - along[0] + 1e-9)
    L = L - slope * along
    res = _classify(L, along, bounce, batsman_hand, speed_kmh)
    res["confidence"] = 0.5
    return res
