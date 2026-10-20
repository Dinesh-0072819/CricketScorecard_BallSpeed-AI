import logging
from typing import List, Tuple, Dict, Any, Optional
import cv2
import numpy as np

from config import OVERLAY_HOLD_SECONDS

logger = logging.getLogger(__name__)

# BGR color constants
COLOR_CYAN = (254, 242, 0)      # #00f2fe in BGR
COLOR_AMBER = (0, 171, 255)     # #ffab00 in BGR
COLOR_EMERALD = (118, 230, 0)   # #00e676 in BGR
COLOR_CRIMSON = (68, 23, 255)   # #ff1744 in BGR
COLOR_WHITE = (255, 255, 255)
COLOR_GREY = (180, 180, 180)
COLOR_DARK_BG = (15, 10, 5)


def draw_live_trail(
    frame: np.ndarray,
    smoothed_history: List[Tuple[float, float]],
    current_center: Optional[Tuple[int, int]] = None
) -> None:
    """
    Draws a fading cyan (#00f2fe) polyline over the last ~30 ball points
    plus a bright dot on the current ball position.
    """
    if not smoothed_history or len(smoothed_history) < 2:
        return

    try:
        pts = smoothed_history[-30:]
        n = len(pts)

        # Draw fading cyan trail
        for i in range(1, n):
            alpha = float(i) / float(n)
            color = (
                int(COLOR_CYAN[0] * alpha),
                int(COLOR_CYAN[1] * alpha),
                int(COLOR_CYAN[2] * alpha)
            )
            thickness = max(1, int(round(1.0 + alpha * 2.5)))
            pt1 = (int(round(pts[i - 1][0])), int(round(pts[i - 1][1])))
            pt2 = (int(round(pts[i][0])), int(round(pts[i][1])))
            cv2.line(frame, pt1, pt2, color, thickness, cv2.LINE_AA)

        # Highlight current position
        target_center = current_center if current_center else (int(pts[-1][0]), int(pts[-1][1]))
        cv2.circle(frame, target_center, 6, COLOR_CYAN, -1, cv2.LINE_AA)
        cv2.circle(frame, target_center, 9, (255, 255, 255), 1, cv2.LINE_AA)
    except Exception as e:
        logger.debug(f"Error drawing live trail: {e}")


def draw_post_delivery_hud(
    frame: np.ndarray,
    analysis: Optional[Dict[str, Any]],
    overlay_age: float,
    speed_kmh: float = 0.0,
    trajectory_points: Optional[List[Dict[str, Any]]] = None
) -> None:
    """
    Renders post-delivery HUD overlay during OVERLAY_HOLD_SECONDS:
      - Bounce marker (amber circle + "BOUNCE") at bounce pixel position
      - Pre-bounce path line (emerald) and post-bounce path line (crimson)
      - Semi-transparent banner: DELIVERY_TYPE | turn° | length | speed km/h
        plus explain['reason'] and confidence bar.
      - If status != 'ok', shows a small grey note.
      - Scaled dynamically for 480p, 720p, and 1080p readability.
    """
    if not analysis or overlay_age > OVERLAY_HOLD_SECONDS:
        return

    try:
        h, w = frame.shape[:2]
        scale = max(0.65, min(1.4, w / 720.0))
        status = analysis.get("status", "error")

        # -------------------------------------------------------------
        # 1. Trajectory Lines & Bounce Marker
        # -------------------------------------------------------------
        if status == "ok" and trajectory_points and len(trajectory_points) >= 3:
            # Locate bounce point in pixel space
            bounce_idx = None
            bounce_xy = analysis.get("bounce_xy_m")
            if bounce_xy:
                # Find matching point closest to bounce_xy
                min_dist = 1e9
                for idx, pt in enumerate(trajectory_points):
                    dx = pt.get("x", 0.0) - bounce_xy[0]
                    dy = pt.get("y", 0.0) - bounce_xy[1]
                    dist = dx * dx + dy * dy
                    if dist < min_dist:
                        min_dist = dist
                        bounce_idx = idx

            if bounce_idx is not None and 1 <= bounce_idx < len(trajectory_points):
                # Pre-bounce path (Emerald #00e676)
                pre_pts = np.array(
                    [[int(pt["px"]), int(pt["py"])] for pt in trajectory_points[:bounce_idx + 1]],
                    dtype=np.int32
                ).reshape((-1, 1, 2))
                if len(pre_pts) >= 2:
                    cv2.polylines(frame, [pre_pts], isClosed=False, color=COLOR_EMERALD, thickness=int(3 * scale), lineType=cv2.LINE_AA)

                # Post-bounce path (Crimson #ff1744)
                post_pts = np.array(
                    [[int(pt["px"]), int(pt["py"])] for pt in trajectory_points[bounce_idx:]],
                    dtype=np.int32
                ).reshape((-1, 1, 2))
                if len(post_pts) >= 2:
                    cv2.polylines(frame, [post_pts], isClosed=False, color=COLOR_CRIMSON, thickness=int(3 * scale), lineType=cv2.LINE_AA)

                # Bounce marker (Amber #ffab00 circle + "BOUNCE")
                b_px = int(round(trajectory_points[bounce_idx]["px"]))
                b_py = int(round(trajectory_points[bounce_idx]["py"]))
                b_radius = int(8 * scale)

                # Amber pulse circle
                cv2.circle(frame, (b_px, b_py), b_radius, COLOR_AMBER, -1, cv2.LINE_AA)
                cv2.circle(frame, (b_px, b_py), b_radius + 4, (255, 255, 255), int(2 * scale), cv2.LINE_AA)

                # "BOUNCE" label with dark shadow
                label = "BOUNCE"
                font_scale = 0.45 * scale
                (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
                lx = b_px - lw // 2
                ly = b_py - b_radius - 6
                # Shadow
                cv2.putText(frame, label, (lx + 1, ly + 1), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), 2, cv2.LINE_AA)
                # Text
                cv2.putText(frame, label, (lx, ly), cv2.FONT_HERSHEY_SIMPLEX, font_scale, COLOR_AMBER, 1, cv2.LINE_AA)

        # -------------------------------------------------------------
        # 2. Semi-Transparent Analysis Banner
        # -------------------------------------------------------------
        if status == "ok":
            delivery_type = analysis.get("delivery_type", "STRAIGHT")
            turn = analysis.get("turn_angle_deg", 0.0)
            length = analysis.get("length", "Good Length")
            speed = speed_kmh if speed_kmh > 0 else 0.0
            confidence = float(analysis.get("confidence", 0.8))
            explain = analysis.get("explain", {})
            reason = explain.get("reason", "")

            # Banner dimensions
            banner_w = int(min(w - 30, 480 * scale))
            banner_h = int(72 * scale)
            bx1 = int((w - banner_w) // 2)
            by1 = int(h - banner_h - 20)
            bx2 = bx1 + banner_w
            by2 = by1 + banner_h

            # Draw semi-transparent dark rounded/bordered background
            overlay_roi = frame[by1:by2, bx1:bx2]
            dark_rect = np.full_like(overlay_roi, COLOR_DARK_BG)
            cv2.addWeighted(dark_rect, 0.78, overlay_roi, 0.22, 0, overlay_roi)
            cv2.rectangle(frame, (bx1, by1), (bx2, by2), COLOR_CYAN, 1, cv2.LINE_AA)

            # Header text
            header_text = f"{delivery_type}  |  {turn:.1f}\u00b0 TURN  |  {length.upper()}  |  {speed:.1f} KM/H"
            font_size_head = 0.52 * scale
            cv2.putText(frame, header_text, (bx1 + int(14 * scale), by1 + int(24 * scale)),
                        cv2.FONT_HERSHEY_SIMPLEX, font_size_head, COLOR_CYAN, 2, cv2.LINE_AA)

            # Sub-reason text
            sub_text = reason[:55] if len(reason) > 55 else reason
            font_size_sub = 0.40 * scale
            cv2.putText(frame, sub_text, (bx1 + int(14 * scale), by1 + int(46 * scale)),
                        cv2.FONT_HERSHEY_SIMPLEX, font_size_sub, COLOR_WHITE, 1, cv2.LINE_AA)

            # Confidence bar
            bar_w = int(100 * scale)
            bar_h = int(6 * scale)
            bar_x = bx1 + int(14 * scale)
            bar_y = by1 + int(56 * scale)
            fill_w = int(bar_w * max(0.0, min(1.0, confidence)))

            cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h), (60, 60, 60), -1)
            cv2.rectangle(frame, (bar_x, bar_y), (bar_x + fill_w, bar_y + bar_h), COLOR_EMERALD, -1)
            cv2.putText(frame, f"CONF {int(confidence * 100)}%", (bar_x + bar_w + int(8 * scale), bar_y + int(6 * scale)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35 * scale, COLOR_GREY, 1, cv2.LINE_AA)

        else:
            # Small grey note for non-ok statuses
            note_text = "Analysis: not enough tracking points"
            if status == "no_bounce_found":
                note_text = "Analysis: full toss (no pitch bounce)"
            elif status == "error":
                note_text = "Analysis: calculation error"

            font_size = 0.45 * scale
            (nw, nh), _ = cv2.getTextSize(note_text, cv2.FONT_HERSHEY_SIMPLEX, font_size, 1)
            nx1 = int((w - nw) // 2) - 10
            ny1 = int(h - 45)
            nx2 = nx1 + nw + 20
            ny2 = ny1 + nh + 12

            if 0 <= ny1 and ny2 <= h and 0 <= nx1 and nx2 <= w:
                overlay_roi = frame[ny1:ny2, nx1:nx2]
                dark_rect = np.full_like(overlay_roi, (20, 20, 20))
                cv2.addWeighted(dark_rect, 0.70, overlay_roi, 0.30, 0, overlay_roi)
                cv2.rectangle(frame, (nx1, ny1), (nx2, ny2), (100, 100, 100), 1)
                cv2.putText(frame, note_text, (nx1 + 10, ny1 + nh + 4),
                            cv2.FONT_HERSHEY_SIMPLEX, font_size, COLOR_GREY, 1, cv2.LINE_AA)

    except Exception as e:
        logger.debug(f"Error drawing post-delivery HUD: {e}")
