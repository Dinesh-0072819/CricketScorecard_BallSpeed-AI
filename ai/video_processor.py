"""
CricSpeedAI video pipeline.

  1. ball_search.collect_detections  - finds the ball in every frame
       (Roboflow cloud if configured and healthy, else the local YOLO model run
        at its 1280 training scale with ROI tracking + release backfill)
  2. trajectory.*                    - picks the delivery track, trims release -> bat
  3. delivery_analysis               - speed (time of flight), bounce, swing, spin
  4. second pass                     - draws the overlay video, encodes with ffmpeg
"""
import gc
import math
import os
import platform
import shutil
import subprocess

import cv2
import numpy as np

from ai.ball_detector import BallDetector
from ai.ball_search import collect_detections
from ai.delivery_analysis import DEFAULT_PITCH_LENGTH_M, analyze_video_track
from ai.roboflow_client import RoboflowClient
from ai.trajectory import link_detections, select_delivery, trim_delivery
from ai.utils import CalibrationManager

TYPE_COLORS = {  # BGR, matches frontend DeliveryTypeBadge
    "OFF_SPIN": (0, 171, 255),
    "LEG_SPIN": (68, 23, 255),
    "INSWING": (254, 242, 0),
    "OUTSWING": (118, 230, 0),
    "STRAIGHT": (184, 163, 148),
}


class VideoProcessor:
    def __init__(self):
        print("=" * 50)
        print("Loading Tennis Ball AI Model...")
        try:
            self.detector = BallDetector("weights")
        except Exception as e:
            print(f"Local model unavailable: {e}")
            self.detector = None
        self.cloud = RoboflowClient()
        self.use_roboflow = self.cloud.active
        self.is_custom_model = self.detector is not None
        self.calib_mgr = CalibrationManager(os.getenv("CALIBRATION_PATH", "config_calibration.json"))
        self.H = None
        print(f"Local engine : {self.detector.backend if self.detector else 'NONE'}")
        print(f"Roboflow     : {self.cloud.status}")
        print("=" * 50)

    # ------------------------------------------------------------------ status / compat
    @property
    def roboflow_status_msg(self):
        return self.cloud.status

    def detect_live(self, frame, last_pos=None, conf=0.15):
        """Detections for one live-camera frame: [[cx, cy, w, h, conf], ...]."""
        if self.detector is None:
            return []
        return self.detector.detect_fast(frame, conf=conf, last_pos=last_pos)

    def set_perspective_calibration(self, image_points, real_world_points):
        if len(image_points) != 4 or len(real_world_points) != 4:
            raise ValueError("Perspective calibration requires exactly 4 image points and 4 real-world points.")
        src = np.array([[float(x), float(y)] for x, y in image_points], dtype=np.float32)
        dst = np.array([[float(x), float(y)] for x, y in real_world_points], dtype=np.float32)
        self.H, _ = cv2.findHomography(src, dst)
        if self.H is None:
            raise RuntimeError("Could not calculate perspective calibration matrix.")
        self.calib_mgr.save_calibration(src.tolist(), dst.tolist(), self.H)
        return self.H

    # ------------------------------------------------------------------ main entry
    def process(
        self,
        input_video,
        output_video,
        max_speed=70,
        progress_callback=None,
        batsman_hand="RIGHT",
        pitch_length_m=None,
    ):
        pitch_length_m = float(pitch_length_m or DEFAULT_PITCH_LENGTH_M)

        def prog(pct, frame, total, msg):
            if progress_callback:
                progress_callback(int(pct), frame, total, msg)

        # ---------------- 1. detection pass ----------------
        def on_scan(i, total, engine):
            if i % 5 == 0 or i == total:
                pct = min(85, int(i / max(1, total) * 85))
                prog(pct, i, total, f"Tracking ball ({engine}): frame {i} of {total}")

        if self.detector is None and not self.cloud.active:
            return self._empty_result("ERROR: no ball detection model available", max_speed)

        scan = collect_detections(input_video, self.detector, self.cloud, on_scan)
        fps, W, H = scan["fps"], scan["width"], scan["height"]
        total = scan["frames"]
        diag = math.hypot(W, H)
        print(f"Video {W}x{H} @ {fps:.2f} fps, {total} frames | engine={scan['engine']} "
              f"| local inferences={scan['local_inferences']}")

        # ---------------- 2. delivery track ----------------
        tracklets = link_detections(scan["detections"], diag)
        best = select_delivery(tracklets, diag)
        track = trim_delivery(best.as_dicts()) if best is not None else []

        # ---------------- 3. analysis ----------------
        if len(track) >= 5:
            analysis = analyze_video_track(
                track, fps, W, H,
                pitch_length_m=pitch_length_m,
                batsman_hand=batsman_hand,
                timestamps=scan.get("timestamps"),
            )
        else:
            analysis = analyze_video_track([], fps, W, H)
            analysis["status"] = "ball_not_found"

        speed = float(analysis.get("speed_kmh", 0.0))
        # sanity: outside the physically possible range = tracking error
        if speed and not (15.0 <= speed <= 170.0):
            print(f"Speed {speed:.1f} km/h outside plausible range -> rejected")
            analysis["status"] = "implausible_speed"
            analysis["speed_kmh_raw"] = speed
            speed = 0.0
        status = "NO-BALL" if speed > float(max_speed) else "SAFE"
        if speed > float(max_speed):
            self._log_alarm(speed, max_speed)

        # ---------------- 4. overlay video ----------------
        prog(86, total, total, "Rendering overlay video...")
        self._render(input_video, output_video, track, analysis, speed, status, max_speed, fps, W, H, prog, total)

        print("=" * 50)
        print(f"Engine        : {scan['engine']}")
        print(f"Track         : {len(track)} pts, frames {track[0]['frame'] if track else '-'}-"
              f"{track[-1]['frame'] if track else '-'}")
        print(f"Speed         : {speed:.1f} km/h (flight {analysis.get('flight_time_s')} s over "
              f"{analysis.get('distance_m')} m)")
        print(f"Bounce frame  : {analysis.get('bounce_frame')}")
        print(f"Delivery type : {analysis.get('delivery_type')}  turn {analysis.get('turn_angle_signed_deg')} deg"
              f"  swing {analysis.get('swing_cm')} cm")
        print("=" * 50)
        prog(100, total, total, "Delivery analysis complete!")
        gc.collect()

        return {
            "speed": round(speed, 1),
            "status": status,
            "deviation_angle": analysis.get("deviation_angle_deg", 0.0),
            "turn_angle": analysis.get("turn_angle_deg", 0.0),
            "turn_direction": analysis.get("turn_direction", "Straight"),
            "swing_cm": analysis.get("swing_cm", 0.0),
            "delivery_type": analysis.get("delivery_type", "STRAIGHT"),
            "engine": scan["engine"],
            "analysis": analysis,
            "trajectory": [[int(p["frame"]), round(p["x"], 1), round(p["y"], 1)] for p in track],
        }

    # ------------------------------------------------------------------ helpers
    def _empty_result(self, msg, max_speed):
        print(msg)
        return {"speed": 0.0, "status": "ERROR", "deviation_angle": 0.0, "turn_angle": 0.0,
                "turn_direction": "Straight", "swing_cm": 0.0, "delivery_type": "STRAIGHT",
                "analysis": {"status": msg}, "trajectory": []}

    @staticmethod
    def _log_alarm(speed, limit):
        try:
            import datetime
            os.makedirs("logs", exist_ok=True)
            with open(os.path.join("logs", "alarms.log"), "a") as f:
                ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                f.write(f"[{ts}] ALERT: Ball Speed {speed:.1f} km/h (Limit: {limit} km/h)\n")
        except Exception:
            pass

    def _render(self, input_video, output_video, track, analysis, speed, status, max_speed, fps, W, H, prog, total):
        out_dir = os.path.dirname(os.path.abspath(output_video))
        os.makedirs(out_dir, exist_ok=True)
        temp_output = output_video.replace(".mp4", "_temp.mp4")
        if temp_output == output_video:
            temp_output = output_video + ".temp.mp4"

        cap = cv2.VideoCapture(input_video)
        writer = cv2.VideoWriter(temp_output, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))

        by_frame = {int(p["frame"]): p for p in track}
        release = track[0]["frame"] if track else None
        arrival = track[-1]["frame"] if track else None
        bounce_f = analysis.get("bounce_frame")
        bounce_px = analysis.get("bounce_point_px")
        dtype = analysis.get("delivery_type", "STRAIGHT")
        type_color = TYPE_COLORS.get(dtype, (255, 255, 255))
        status_color = (0, 0, 255) if status == "NO-BALL" else (0, 255, 0)
        scale = max(0.6, min(W, H) / 720.0)

        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if track and release - 2 <= idx <= arrival + int(fps * 1.5):
                # trail of the delivery up to this frame
                pts = [(int(p["x"]), int(p["y"])) for p in track if p["frame"] <= idx]
                for a, b in zip(pts, pts[1:]):
                    cv2.line(frame, a, b, (0, 255, 255), max(2, int(2 * scale)), cv2.LINE_AA)
                if idx in by_frame:
                    p = by_frame[idx]
                    r = int(max(8, p["size"] * 0.9))
                    cv2.circle(frame, (int(p["x"]), int(p["y"])), r, (0, 255, 0), 2, cv2.LINE_AA)
                if bounce_f is not None and bounce_px and idx >= bounce_f:
                    bx, by = int(bounce_px[0]), int(bounce_px[1])
                    cv2.ellipse(frame, (bx, by), (int(18 * scale), int(7 * scale)), 0, 0, 360, (0, 0, 255), 2)
                    cv2.putText(frame, "BOUNCE", (bx + int(14 * scale), by + int(5 * scale)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5 * scale, (0, 0, 255), 2, cv2.LINE_AA)

            # HUD (values appear once the ball has been released)
            show = track and idx >= release
            self._hud(frame, W, scale, speed if show else 0.0, status if show else "-",
                      status_color, max_speed, dtype if show else "-", type_color, analysis if show else {},
                      tracked=idx in by_frame)
            writer.write(frame)
            idx += 1
            if idx % 15 == 0:
                prog(86 + int(8 * idx / max(1, total)), idx, total, "Rendering overlay video...")
        cap.release()
        writer.release()

        prog(95, total, total, "Encoding output video...")
        self._encode(temp_output, output_video)

    @staticmethod
    def _hud(frame, W, scale, speed, status, status_color, max_speed, dtype, type_color, analysis, tracked):
        bw, bh = int(250 * scale), int(190 * scale)
        x1, y1 = W - bw - int(15 * scale), int(15 * scale)
        x2, y2 = x1 + bw, y1 + bh
        overlay = frame.copy()
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 255), 1)
        f = cv2.FONT_HERSHEY_SIMPLEX
        lh = int(26 * scale)
        x = x1 + int(12 * scale)
        y = y1 + lh
        cv2.putText(frame, "BALL SPEED", (x, y), f, 0.5 * scale, (255, 255, 255), 1, cv2.LINE_AA)
        y += int(lh * 1.3)
        cv2.putText(frame, f"{speed:.1f} km/h", (x, y), f, 0.95 * scale, status_color, 2, cv2.LINE_AA)
        y += lh
        cv2.putText(frame, f"LIMIT {int(max_speed)} km/h  {status}", (x, y), f, 0.45 * scale, status_color, 1, cv2.LINE_AA)
        y += lh
        cv2.putText(frame, dtype.replace("_", " "), (x, y), f, 0.6 * scale, type_color, 2, cv2.LINE_AA)
        y += lh
        if analysis:
            cv2.putText(frame, f"Turn {analysis.get('turn_angle_deg', 0):.1f} deg  Swing {analysis.get('swing_cm', 0):.0f} cm",
                        (x, y), f, 0.42 * scale, (255, 255, 255), 1, cv2.LINE_AA)
        y += lh
        cv2.putText(frame, "TRACKED" if tracked else "", (x, y), f, 0.45 * scale, (0, 255, 0), 1, cv2.LINE_AA)

    @staticmethod
    def _encode(temp_output, output_video):
        cmds = []
        if platform.system() == "Darwin":
            cmds.append(["ffmpeg", "-y", "-i", temp_output, "-c:v", "h264_videotoolbox", "-b:v", "8M",
                         "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", output_video])
        cmds.append(["ffmpeg", "-y", "-i", temp_output, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
                     "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", output_video])
        for cmd in cmds:
            try:
                r = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, timeout=120)
                if r.returncode == 0 and os.path.exists(output_video) and os.path.getsize(output_video) > 1024:
                    break
            except Exception as e:
                print(f"FFmpeg note: {e}")
        if not (os.path.exists(output_video) and os.path.getsize(output_video) > 1024) and os.path.exists(temp_output):
            shutil.copy(temp_output, output_video)
        if os.path.exists(temp_output) and os.path.exists(output_video) and os.path.getsize(output_video) > 1024:
            try:
                os.remove(temp_output)
            except Exception:
                pass
