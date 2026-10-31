import math
import numpy as np
from typing import List, Dict, Any, Optional

def analyze_delivery(
    trajectory_points: List[Any],
    fps: float = 30.0,
    pixel_to_meter: float = 0.025,
    batsman_hand: str = "RIGHT",
    speed_kmh: Optional[float] = None
) -> Dict[str, Any]:
    """
    Analyzes ball movement (Angle of Deviation, Swing, Turn, Delivery Type)
    directly from tracked 2D optical trajectory points.
    Does NOT require a pitch map or ground calibration.
    """
    hand = batsman_hand.upper().strip() if batsman_hand else "RIGHT"
    if hand not in ("RIGHT", "LEFT"):
        hand = "RIGHT"

    fallback = {
        "status": "insufficient_data",
        "deviation_angle_deg": 0.0,
        "turn_angle_deg": 0.0,
        "turn_direction": "Straight",
        "swing_cm": 0.0,
        "delivery_type": "STRAIGHT",
        "spin_type": "NONE",
        "swing_type": "NONE",
        "confidence": 0.0
    }

    if trajectory_points is None or len(trajectory_points) < 4:
        return fallback

    # Extract clean (px, py) float coordinates
    pts = []
    for p in trajectory_points:
        if isinstance(p, dict):
            pts.append([float(p.get("px", p.get("x", 0))), float(p.get("py", p.get("y", 0)))])
        elif isinstance(p, (list, tuple)) and len(p) >= 2:
            pts.append([float(p[0]), float(p[1])])

    if len(pts) < 4:
        return fallback

    pts = np.array(pts, dtype=np.float64)

    # Filter out extreme tracking teleport spikes (> 120 pixels jump between consecutive frames)
    cleaned = [pts[0]]
    for i in range(1, len(pts)):
        dist = np.linalg.norm(pts[i] - cleaned[-1])
        if dist < 120.0:
            cleaned.append(pts[i])
    pts = np.array(cleaned, dtype=np.float64)
    n = len(pts)

    if n < 4:
        return fallback

    # Check for bat impact, rebound or sharp angle reversal > 75 degrees
    truncated_end = n
    for i in range(max(3, int(n * 0.3)), n - 1):
        v1 = pts[i] - pts[i - 2]
        v2 = pts[i + 1] - pts[i]
        l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
        if l1 > 3.0 and l2 > 3.0:
            dot = np.clip(np.dot(v1, v2) / (l1 * l2), -1.0, 1.0)
            angle = np.degrees(np.arccos(dot))
            if angle > 75.0:  # Bat contact or sharp rebound
                truncated_end = i + 1
                break

    pts = pts[:truncated_end]

    # Isolate delivery release point: remove pre-release bowler windup moving opposite to main flight
    if len(pts) >= 6:
        main_dir = pts[-1] - pts[len(pts) // 2]
        main_len = np.linalg.norm(main_dir)
        if main_len > 10.0:
            main_u = main_dir / main_len
            start_idx = 0
            for i in range(len(pts) - 4):
                step_dir = pts[i + 1] - pts[i]
                step_len = np.linalg.norm(step_dir)
                if step_len > 1.0:
                    proj = np.dot(step_dir / step_len, main_u)
                    if proj > 0.4:
                        start_idx = i
                        break
            pts = pts[start_idx:]

    # Remove stationary points (e.g. bowler holding ball before delivery or keeper holding ball)
    if len(pts) > 0:
        moving_pts = [pts[0]]
        for i in range(1, len(pts)):
            if np.linalg.norm(pts[i] - moving_pts[-1]) >= 1.5:
                moving_pts.append(pts[i])
        pts = np.array(moving_pts, dtype=np.float64)

    n = len(pts)

    if n < 4:
        return fallback

    # 1. Detect bounce / inflection point
    # Cricket pitch bounce occurs in landing zone (25% to 85% of delivery flight)
    start_search = max(3, int(n * 0.25))
    end_search = min(n - 2, int(n * 0.85))

    bounce_idx = None
    best_turn = 0.0
    turn_signed = 0.0

    for i in range(start_search, end_search):
        pre_vec = pts[i] - pts[0]
        post_vec = pts[-1] - pts[i]
        l_pre, l_post = np.linalg.norm(pre_vec), np.linalg.norm(post_vec)
        if l_pre > 5.0 and l_post > 5.0:
            a_pre = np.degrees(np.arctan2(pre_vec[0], pre_vec[1]))
            a_post = np.degrees(np.arctan2(post_vec[0], post_vec[1]))
            diff = (a_post - a_pre + 180) % 360 - 180
            abs_diff = abs(diff)
            # Standard cricket spin turn off pitch is between 1.0° and 35°
            if 1.0 <= abs_diff <= 35.0 and abs_diff > best_turn:
                best_turn = abs_diff
                turn_signed = diff
                bounce_idx = i

    deviation_angle_deg = round(best_turn, 1)

    # 2. Aerodynamic Air Swing (deviation from release chord)
    pre_segment = pts[:bounce_idx + 1] if (bounce_idx and bounce_idx >= 4) else pts
    p_start = pre_segment[0]
    p_end = pre_segment[-1]
    chord_vec = p_end - p_start
    chord_len = np.linalg.norm(chord_vec)

    swing_cm = 0.0
    swing_type = "NONE"
    if chord_len > 10.0 and len(pre_segment) >= 3:
        chord_u = chord_vec / chord_len
        # Perpendicular unit normal (pointing inward to RHB)
        norm_u = np.array([-chord_u[1], chord_u[0]])
        max_dev_px = 0.0

        for pt in pre_segment[1:-1]:
            d = np.dot(pt - p_start, norm_u)
            if abs(d) > abs(max_dev_px):
                max_dev_px = d

        swing_cm = round(abs(max_dev_px) * pixel_to_meter * 100.0, 1)
        if swing_cm >= 1.5:
            if max_dev_px > 0:
                swing_type = "INSWING" if hand == "RIGHT" else "OUTSWING"
            else:
                swing_type = "OUTSWING" if hand == "RIGHT" else "INSWING"

    # Synchronize turn and swing direction:
    # An inswinging/inward delivery to RHB is Off-break/Off-spin (never Leg-spin).
    # An outswinging/outward delivery to RHB is Leg-break/Leg-spin (never Off-spin).
    if swing_type == "INSWING":
        spin_type = "OFF_SPIN"
        turn_direction = "Off Break (Turns Inward to RHB)" if hand == "RIGHT" else "Leg Break (Turns Away from LHB)"
    elif swing_type == "OUTSWING":
        spin_type = "LEG_SPIN"
        turn_direction = "Leg Break (Turns Away from RHB)" if hand == "RIGHT" else "Off Break (Turns Inward to LHB)"
    elif deviation_angle_deg >= 1.2:
        if turn_signed < 0:
            turn_direction = "Off Break (Turns Inward to RHB)" if hand == "RIGHT" else "Leg Break (Turns Away from LHB)"
            spin_type = "OFF_SPIN"
        else:
            turn_direction = "Leg Break (Turns Away from RHB)" if hand == "RIGHT" else "Off Break (Turns Inward to LHB)"
            spin_type = "LEG_SPIN"
    else:
        turn_direction = "Straight Line"
        spin_type = "NONE"

    # 3. Delivery Classification
    # Ball is Inswing and speed <= 110 km/h -> classified as OFF_SPIN
    # Ball is Inswing and speed > 110 km/h -> classified as INSWING
    measured_speed = speed_kmh if speed_kmh and speed_kmh > 0 else 80.0

    if spin_type == "OFF_SPIN" or swing_type == "INSWING":
        if measured_speed <= 110.0:
            delivery_type = "OFF_SPIN"
            spin_type = "OFF_SPIN"
            turn_direction = "Off Break (Turns Inward to RHB)" if hand == "RIGHT" else "Leg Break (Turns Away from LHB)"
        else:
            delivery_type = "INSWING"
            turn_direction = "Inswing (Shapes Inward to RHB)" if hand == "RIGHT" else "Outswing (Shapes Away from LHB)"
    elif spin_type == "LEG_SPIN" or swing_type == "OUTSWING":
        if measured_speed <= 110.0:
            delivery_type = "LEG_SPIN"
            spin_type = "LEG_SPIN"
            turn_direction = "Leg Break (Turns Away from RHB)" if hand == "RIGHT" else "Off Break (Turns Inward to LHB)"
        else:
            delivery_type = "OUTSWING"
            turn_direction = "Outswing (Shapes Away from RHB)" if hand == "RIGHT" else "Inswing (Shapes Inward to LHB)"
    elif deviation_angle_deg >= 1.5:
        delivery_type = spin_type
    else:
        delivery_type = "STRAIGHT"

    confidence = min(0.98, max(0.60, round(0.5 + (len(pts) / 30.0) * 0.45, 2)))

    return {
        "status": "ok",
        "deviation_angle_deg": float(deviation_angle_deg),
        "turn_angle_deg": float(deviation_angle_deg),
        "turn_direction": turn_direction,
        "swing_cm": float(swing_cm),
        "delivery_type": delivery_type,
        "spin_type": spin_type,
        "swing_type": swing_type,
        "confidence": float(confidence)
    }
