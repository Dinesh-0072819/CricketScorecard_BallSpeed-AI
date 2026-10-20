import math
import logging
from typing import List, Dict, Any, Optional
import numpy as np

from config import (
    TURN_MIN_DEG,
    SWING_MIN_M,
    SPIN_SPEED_MAX,
    MIN_TRACK_POINTS,
)

logger = logging.getLogger(__name__)


def _fit_trajectory_angle(points: List[Dict[str, float]]) -> Optional[float]:
    """
    Fits a linear line x = m*y + c through trajectory points and returns the angle
    in degrees relative to the pitch axis (+y direction).
    Angle is in degrees: positive = drifting to image right (+x).
    """
    if len(points) < 2:
        return None
    ys = np.array([p["y"] for p in points], dtype=np.float64)
    xs = np.array([p["x"] for p in points], dtype=np.float64)

    # Check if pitch displacement is sufficient
    dy = ys[-1] - ys[0]
    if abs(dy) < 0.1:
        return None

    # Polyfit x as a function of y: x = m*y + c
    poly = np.polyfit(ys, xs, 1)
    slope = poly[0]  # dx / dy
    angle_rad = math.atan(slope)
    return math.degrees(angle_rad)


def _detect_bounce_index(track: List[Dict[str, float]]) -> Optional[int]:
    """
    Detects bounce point using vertical trajectory inflection in pixel row (py)
    or ground plane progression.
    Returns index of the bounce point in track, or None if no bounce detected.
    """
    n = len(track)
    if n < 4:
        return None

    pys = [p.get("py", 0.0) for p in track]
    
    # Smooth py trajectory slightly with a 3-point moving average
    smoothed_py = []
    for i in range(n):
        start = max(0, i - 1)
        end = min(n, i + 2)
        smoothed_py.append(sum(pys[start:end]) / (end - start))

    # Look for a local maximum in py (ball reaches lowest physical point on ground)
    # Pitch bounce typically occurs between 20% and 85% of pitch traversal
    best_bounce_idx = None
    max_drop_after = 0.0

    for i in range(1, n - 1):
        y_pos = track[i].get("y", 0.0)
        # Cricket bounce must happen on the pitch (y between 5m and 19m)
        if not (5.0 <= y_pos <= 19.5):
            continue

        # Check local peak: py at i is greater than neighbors
        diff_prev = smoothed_py[i] - smoothed_py[i - 1]
        diff_next = smoothed_py[i] - smoothed_py[i + 1]

        if diff_prev >= 0 and diff_next >= 0 and (diff_prev + diff_next) > max_drop_after:
            max_drop_after = diff_prev + diff_next
            best_bounce_idx = i

    # Fallback: if no strict local peak, check velocity change or largest py row
    if best_bounce_idx is None:
        valid_indices = [
            i for i in range(1, n - 1)
            if 6.0 <= track[i].get("y", 0.0) <= 19.0
        ]
        if valid_indices:
            best_bounce_idx = max(valid_indices, key=lambda idx: smoothed_py[idx])

    return best_bounce_idx


def analyze_delivery(
    track: List[Dict[str, float]],
    batsman_hand: str = "RIGHT",
    speed_kmh: Optional[float] = None
) -> Dict[str, Any]:
    """
    Analyzes ball movement for a single cricket delivery.

    Parameters:
      track: list of dicts {"x": lateral metres (+ = image right),
                            "y": pitch metres from bowler's stumps (0..20.12),
                            "py": ball pixel row}
      batsman_hand: "RIGHT" | "LEFT" (default "RIGHT")
      speed_kmh: optional float estimated ball speed in km/h

    Returns dict containing:
      status: "ok" | "insufficient_data" | "no_bounce_found" | "error"
      delivery_type: "OFF_SPIN" | "LEG_SPIN" | "INSWING" | "OUTSWING" | "STRAIGHT"
      spin_type: "OFF_SPIN" | "LEG_SPIN" | "NONE"
      swing_type: "INSWING" | "OUTSWING" | "NONE"
      turn_angle_deg: float
      swing_cm: float
      bounce_xy_m: [bounce_x, bounce_y] or None
      length: "Yorker" | "Full" | "Good Length" | "Short" | "Full Toss"
      line: "Outside Off" | "Off Stump" | "Middle Stump" | "Leg Stump" | "Down Leg"
      bowler_style: "SPINNER" | "PACER"
      confidence: float (0.0..1.0)
      explain: dict with XAI reasoning
    """
    hand = batsman_hand.upper().strip() if batsman_hand else "RIGHT"
    if hand not in ("RIGHT", "LEFT"):
        hand = "RIGHT"

    # Default fallback structure on error
    fallback_res: Dict[str, Any] = {
        "status": "insufficient_data",
        "delivery_type": "STRAIGHT",
        "spin_type": "NONE",
        "swing_type": "NONE",
        "turn_angle_deg": 0.0,
        "swing_cm": 0.0,
        "bounce_xy_m": None,
        "length": "Good Length",
        "line": "Middle Stump",
        "bowler_style": "PACER",
        "confidence": 0.0,
        "explain": {
            "reason": "Insufficient tracking points for analysis",
            "pre_angle_deg": 0.0,
            "post_angle_deg": 0.0,
            "threshold_turn_deg": float(TURN_MIN_DEG),
            "threshold_swing_cm": float(SWING_MIN_M * 100.0),
            "batsman_hand": hand
        }
    }

    if not track or len(track) < MIN_TRACK_POINTS:
        fallback_res["status"] = "insufficient_data"
        fallback_res["explain"]["reason"] = f"Track has {len(track) if track else 0} points (minimum required: {MIN_TRACK_POINTS})"
        return fallback_res

    try:
        # Detect bounce point
        bounce_idx = _detect_bounce_index(track)

        # 1. Trajectory segments & Bounce coordinates
        bounce_xy_m = None
        if bounce_idx is not None and 1 <= bounce_idx < len(track) - 1:
            pre_bounce_track = track[:bounce_idx + 1]
            post_bounce_track = track[bounce_idx:]
            bounce_xy_m = [
                round(float(track[bounce_idx]["x"]), 3),
                round(float(track[bounce_idx]["y"]), 3)
            ]
        else:
            # Full toss or unresolvable bounce
            pre_bounce_track = track
            post_bounce_track = []

        # 2. Pre-bounce and post-bounce horizontal angles
        pre_angle = _fit_trajectory_angle(pre_bounce_track)
        post_angle = _fit_trajectory_angle(post_bounce_track) if post_bounce_track else None

        if pre_angle is None:
            pre_angle = 0.0

        # Turn angle calculation
        # Delta angle: positive means turning to image right (+x)
        turn_angle_deg = 0.0
        delta_angle = 0.0
        if post_angle is not None:
            delta_angle = post_angle - pre_angle
            turn_angle_deg = round(abs(delta_angle), 2)

        # 3. Swing (pre-bounce air deflection) calculation
        # Measure maximum lateral deviation from the straight release-to-bounce chord
        swing_cm = 0.0
        swing_dir = 0.0  # +1 = right (+x), -1 = left (-x)
        if len(pre_bounce_track) >= 3:
            p_start = pre_bounce_track[0]
            p_end = pre_bounce_track[-1]
            dy_chord = p_end["y"] - p_start["y"]
            dx_chord = p_end["x"] - p_start["x"]

            if abs(dy_chord) > 1.0:
                max_dev = 0.0
                for pt in pre_bounce_track[1:-1]:
                    # Linear interpolation along chord
                    frac = (pt["y"] - p_start["y"]) / dy_chord
                    expected_x = p_start["x"] + frac * dx_chord
                    dev = pt["x"] - expected_x
                    if abs(dev) > abs(max_dev):
                        max_dev = dev
                swing_cm = round(abs(max_dev) * 100.0, 1)
                swing_dir = 1.0 if max_dev > 0 else -1.0

        # 4. Length categorization
        # Based on bounce distance to batsman stumps (20.12m)
        if bounce_xy_m is not None:
            dist_to_stumps = 20.12 - bounce_xy_m[1]
            if dist_to_stumps < 2.0:
                length = "Yorker"
            elif dist_to_stumps < 4.0:
                length = "Full"
            elif dist_to_stumps < 7.0:
                length = "Good Length"
            else:
                length = "Short"
        else:
            length = "Full Toss"

        # 5. Line categorization
        # Measured lateral position at delivery arrival
        arrival_x = track[-1]["x"]
        # For RHB: negative x is off side, positive x is leg side
        # For LHB: positive x is off side, negative x is leg side
        x_rel_off = arrival_x if hand == "LEFT" else -arrival_x

        if x_rel_off > 0.35:
            line = "Outside Off"
        elif x_rel_off > 0.08:
            line = "Off Stump"
        elif x_rel_off >= -0.08:
            line = "Middle Stump"
        elif x_rel_off >= -0.35:
            line = "Leg Stump"
        else:
            line = "Down Leg"

        # 6. Delivery & Spin/Swing Classification
        # Relative to batsman hand:
        # Turn toward batsman leg side = OFF_SPIN
        # Turn toward batsman off side = LEG_SPIN
        # For RHB: leg side = +x (delta_angle > 0), off side = -x (delta_angle < 0)
        # For LHB: leg side = -x (delta_angle < 0), off side = +x (delta_angle > 0)
        spin_type = "NONE"
        swing_type = "NONE"

        has_significant_turn = turn_angle_deg >= float(TURN_MIN_DEG)
        has_significant_swing = (swing_cm / 100.0) >= float(SWING_MIN_M)

        if has_significant_turn:
            if hand == "RIGHT":
                spin_type = "OFF_SPIN" if delta_angle > 0 else "LEG_SPIN"
            else:  # LEFT
                spin_type = "OFF_SPIN" if delta_angle < 0 else "LEG_SPIN"

        if has_significant_swing:
            if hand == "RIGHT":
                # Swing toward leg side (+x) is inswing for RHB
                swing_type = "INSWING" if swing_dir > 0 else "OUTSWING"
            else:  # LEFT
                # Swing toward leg side (-x) is inswing for LHB
                swing_type = "INSWING" if swing_dir < 0 else "OUTSWING"

        # Overall delivery type
        if has_significant_turn:
            delivery_type = spin_type
        elif has_significant_swing:
            delivery_type = swing_type
        else:
            delivery_type = "STRAIGHT"

        # Bowler style determination
        if speed_kmh is not None and speed_kmh > 0:
            if speed_kmh > SPIN_SPEED_MAX:
                bowler_style = "PACER"
            elif has_significant_turn and speed_kmh <= SPIN_SPEED_MAX:
                bowler_style = "SPINNER"
            elif has_significant_swing:
                bowler_style = "PACER"
            else:
                bowler_style = "PACER" if speed_kmh > 95.0 else "SPINNER"
        else:
            bowler_style = "SPINNER" if has_significant_turn else "PACER"

        # 7. Confidence Score (0.0 .. 1.0)
        pts_score = min(1.0, len(track) / 20.0)
        bounce_score = 1.0 if bounce_xy_m is not None else 0.70
        confidence = round(0.5 * pts_score + 0.5 * bounce_score, 2)

        # 8. Explainable AI (XAI) dictionary
        reasons = []
        if has_significant_turn:
            reasons.append(f"Turned {turn_angle_deg:.1f}° off pitch ({'toward leg side' if spin_type == 'OFF_SPIN' else 'away to off side'} for {hand} hander)")
        if has_significant_swing:
            reasons.append(f"Swung {swing_cm:.1f}cm in air ({swing_type})")
        if not has_significant_turn and not has_significant_swing:
            reasons.append(f"Holding straight line (turn {turn_angle_deg:.1f}° < {TURN_MIN_DEG}°, swing {swing_cm:.1f}cm < {SWING_MIN_M * 100}cm)")

        reason_str = "; ".join(reasons)

        explain_dict = {
            "reason": reason_str,
            "pre_angle_deg": round(pre_angle, 2),
            "post_angle_deg": round(post_angle, 2) if post_angle is not None else None,
            "threshold_turn_deg": float(TURN_MIN_DEG),
            "threshold_swing_cm": float(SWING_MIN_M * 100.0),
            "batsman_hand": hand
        }

        return {
            "status": "ok" if bounce_xy_m is not None else "no_bounce_found",
            "delivery_type": delivery_type,
            "spin_type": spin_type,
            "swing_type": swing_type,
            "turn_angle_deg": turn_angle_deg,
            "swing_cm": swing_cm,
            "bounce_xy_m": bounce_xy_m,
            "length": length,
            "line": line,
            "bowler_style": bowler_style,
            "confidence": confidence,
            "explain": explain_dict
        }

    except Exception as e:
        logger.error(f"Error in analyze_delivery: {e}", exc_info=True)
        fallback_res["status"] = "error"
        fallback_res["explain"]["reason"] = f"Internal error during analysis: {str(e)}"
        return fallback_res
