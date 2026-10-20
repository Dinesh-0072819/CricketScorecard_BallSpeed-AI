import logging
import math
from typing import List, Dict, Optional
import numpy as np

from config import (
    MIN_TRACK_POINTS,
    MIN_PITCH_SPAN_M,
)

logger = logging.getLogger(__name__)


def clean_track(
    points: List[Dict[str, float]],
    min_points: int = MIN_TRACK_POINTS,
    min_pitch_span_m: float = MIN_PITCH_SPAN_M
) -> Optional[List[Dict[str, float]]]:
    """
    Clean and validate a raw ball delivery trajectory.
    1. Sorts points chronologically by 't'.
    2. Removes duplicate frames.
    3. Rejects spatial outliers using Median Absolute Deviation (MAD).
    4. Interpolates short tracking gaps (<= 2 frames).
    5. Validates forward pitch progression (bowler -> batsman).
    6. Truncates track at reversal point if ball is hit or rebounds near batsman end.
    7. Enforces minimum point count and pitch span thresholds.

    Returns cleaned list of dicts {"x", "y", "px", "py", "t"} or None if invalid.
    """
    if not points or len(points) < 2:
        logger.info("Track rejected: insufficient raw points (< 2)")
        return None

    # 1. Sort chronologically by time 't'
    sorted_pts = sorted(points, key=lambda p: p.get("t", 0.0))

    # 2. Remove duplicate timestamps or identical positions
    deduped: List[Dict[str, float]] = []
    for pt in sorted_pts:
        if not deduped:
            deduped.append(dict(pt))
            continue
        prev = deduped[-1]
        dt = pt.get("t", 0.0) - prev.get("t", 0.0)
        # Skip if timestamp is identical
        if abs(dt) < 1e-4:
            continue
        deduped.append(dict(pt))

    if len(deduped) < 3:
        logger.info(f"Track rejected: only {len(deduped)} unique points after deduplication")
        return None

    # 3. Outlier rejection: filter abrupt physical teleports / noise
    # Calculate step distances
    filtered: List[Dict[str, float]] = [deduped[0]]
    for i in range(1, len(deduped)):
        prev = filtered[-1]
        curr = deduped[i]
        
        dx = curr["x"] - prev["x"]
        dy = curr["y"] - prev["y"]
        dt = curr.get("t", 0.0) - prev.get("t", 0.0)
        if dt <= 0:
            dt = 1.0 / 30.0

        step_dist = math.sqrt(dx * dx + dy * dy)
        speed_m_s = step_dist / dt

        # Cricket ball world record speed is ~161 km/h (44.7 m/s).
        # We allow a generous physical ceiling of 85 m/s (~306 km/h).
        # Any instantaneous jump faster than 85 m/s or massive lateral shift (|dx| > 1.2m per frame) is false YOLO noise
        if (dt > 0.01 and speed_m_s > 85.0) or abs(dx) > 1.2:
            logger.debug(f"Rejecting outlier detection at t={curr.get('t', 0.0):.3f} (speed {speed_m_s * 3.6:.1f} km/h, dx={dx:.2f}m)")
            continue

        filtered.append(curr)

    if len(filtered) < min_points:
        logger.info(f"Track rejected: {len(filtered)} points remaining after outlier filtering (min: {min_points})")
        return None

    # MAD filtering on frame-to-frame lateral jumps
    lateral_jumps = [abs(filtered[i]["x"] - filtered[i-1]["x"]) for i in range(1, len(filtered))]
    if len(lateral_jumps) >= 4:
        med = float(np.median(lateral_jumps))
        mad = float(np.median([abs(j - med) for j in lateral_jumps]))
        mad_threshold = med + max(0.25, 4.0 * mad)
        
        mad_filtered: List[Dict[str, float]] = [filtered[0]]
        for i in range(1, len(filtered)):
            jump = abs(filtered[i]["x"] - mad_filtered[-1]["x"])
            if jump > mad_threshold and jump > 0.40:
                logger.debug(f"MAD outlier rejected at t={filtered[i].get('t', 0.0):.3f}: jump={jump:.2f}m > thresh={mad_threshold:.2f}m")
                continue
            mad_filtered.append(filtered[i])
        filtered = mad_filtered

    if len(filtered) < min_points:
        logger.info(f"Track rejected: {len(filtered)} points after MAD filtering")
        return None

    # 4. Interpolate small gaps (<= 2 missing frames)
    # Estimate nominal dt from median dt
    dts = [filtered[i].get("t", 0.0) - filtered[i-1].get("t", 0.0) for i in range(1, len(filtered))]
    valid_dts = [d for d in dts if d > 0.005]
    nominal_dt = float(np.median(valid_dts)) if valid_dts else (1.0 / 30.0)
    if nominal_dt <= 0.005:
        nominal_dt = 1.0 / 30.0

    interpolated: List[Dict[str, float]] = []
    for i in range(len(filtered) - 1):
        p1 = filtered[i]
        p2 = filtered[i + 1]
        interpolated.append(p1)

        dt_gap = p2.get("t", 0.0) - p1.get("t", 0.0)
        gap_frames = int(round(dt_gap / nominal_dt)) - 1

        if 1 <= gap_frames <= 2:
            # Linearly interpolate missing 1 or 2 frames
            for step in range(1, gap_frames + 1):
                frac = step / float(gap_frames + 1)
                interp_pt = {
                    "x": p1["x"] + frac * (p2["x"] - p1["x"]),
                    "y": p1["y"] + frac * (p2["y"] - p1["y"]),
                    "px": p1["px"] + frac * (p2["px"] - p1["px"]),
                    "py": p1["py"] + frac * (p2["py"] - p1["py"]),
                    "t": p1.get("t", 0.0) + frac * dt_gap
                }
                interpolated.append(interp_pt)
    interpolated.append(filtered[-1])

    # 5. Delivery validity filter & Bat Reversal Truncation
    # Ball must travel from bowler end (small y) to batsman end (larger y)
    net_y = interpolated[-1]["y"] - interpolated[0]["y"]
    if net_y <= 0:
        logger.info(f"Track rejected: negative net pitch distance ({net_y:.2f}m) - possible return throw or reverse direction")
        return None

    # If y reverses near the batsman end (e.g. ball hit back or rebounded off pads/bat after y >= 12m),
    # truncate the track at the point of maximum pitch advancement
    max_y_idx = 0
    max_y_val = -1e9
    for idx, pt in enumerate(interpolated):
        if pt["y"] > max_y_val:
            max_y_val = pt["y"]
            max_y_idx = idx

    # If there is a noticeable reversal after max y:
    if max_y_idx < len(interpolated) - 1:
        reversal_drop = max_y_val - interpolated[-1]["y"]
        if reversal_drop > 0.40 and max_y_val >= 10.0:
            logger.info(f"Reversal detected near batsman end (peak y={max_y_val:.2f}m, final y={interpolated[-1]['y']:.2f}m). Truncating at idx {max_y_idx}.")
            interpolated = interpolated[:max_y_idx + 1]

    # 6. Check final point count and pitch span
    if len(interpolated) < min_points:
        logger.info(f"Track rejected: final points count {len(interpolated)} < MIN_TRACK_POINTS ({min_points})")
        return None

    final_span = interpolated[-1]["y"] - interpolated[0]["y"]
    if final_span < min_pitch_span_m:
        logger.info(f"Track rejected: pitch span {final_span:.2f}m < MIN_PITCH_SPAN_M ({min_pitch_span_m}m)")
        return None

    return interpolated
