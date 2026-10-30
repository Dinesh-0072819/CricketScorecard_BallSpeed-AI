import cv2
import subprocess
import os
import math
import platform
import shutil
import gc
import torch
import numpy as np
from ultralytics import YOLO

# Limit PyTorch CPU threads to prevent thread thrashing & memory spikes on cloud instances
try:
    torch.set_num_threads(1)
except Exception:
    pass


class VideoProcessor:

    def __init__(self):
        print("=" * 50)
        print("Loading Tennis Ball AI Model...")
        print("=" * 50)

        # 1. High-Performance OpenCV DNN Engine (2.3x faster than PyTorch, ultra-low ~40MB RAM)
        onnx_path = "weights/tennis_ball_detector.onnx"
        self.use_opencv_dnn = False
        self.is_custom_model = True

        if os.path.exists(onnx_path) and os.path.getsize(onnx_path) > 100000:
            try:
                self.net = cv2.dnn.readNetFromONNX(onnx_path)
                self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
                self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
                self.use_opencv_dnn = True
                print("Loaded High-Speed OpenCV DNN Engine: 2.3x faster execution, <50MB RAM.")
            except Exception as dnn_err:
                print(f"Notice: OpenCV DNN init: {dnn_err}. Using PyTorch fallback.")

        # 2. PyTorch Fallback
        model_path = "weights/tennis_ball_detector.pt"
        if not os.path.exists(model_path) or os.path.getsize(model_path) < 100000:
            if os.path.exists("tennis_ball_detector.pt") and os.path.getsize("tennis_ball_detector.pt") > 100000:
                model_path = "tennis_ball_detector.pt"
            else:
                print("Notice: weights/tennis_ball_detector.pt not found or unpulled. Using yolov8n.pt fallback...")
                model_path = "yolov8n.pt"
                self.is_custom_model = False

        self.model = YOLO(model_path)

        self.H = None
        print("Model Loaded Successfully")
        print("=" * 50)
        print()

    def set_perspective_calibration(self, image_points, real_world_points):
        """
        Set a perspective/ground-plane calibration and save it.
        """
        if len(image_points) != 4 or len(real_world_points) != 4:
            raise ValueError(
                "Perspective calibration requires exactly 4 image points "
                "and 4 real-world points."
            )

        image_points = [
            [float(x), float(y)] for x, y in image_points
        ]
        real_world_points = [
            [float(x), float(y)] for x, y in real_world_points
        ]

        import numpy as np

        src_points = np.array(image_points, dtype=np.float32)
        dst_points = np.array(real_world_points, dtype=np.float32)

        self.H, _ = cv2.findHomography(src_points, dst_points)

        if self.H is None:
            raise RuntimeError("Could not calculate perspective calibration matrix.")

        self.image_points = image_points
        self.real_world_points = real_world_points
        self.calib_mgr.save_calibration(image_points, real_world_points, self.H)
        
        print("Perspective calibration completed and saved successfully.")
        return self.H

    def _pixel_to_world(self, point):
        """Convert an image pixel point to calibrated ground coordinates."""
        if self.H is None:
            return None

        import numpy as np

        src = np.array(
            [[float(point[0]), float(point[1])]],
            dtype=np.float32
        ).reshape(-1, 1, 2)

        dst = cv2.perspectiveTransform(src, self.H)

        return (
            float(dst[0, 0, 0]),
            float(dst[0, 0, 1])
        )

    def process(
        self,
        input_video,
        output_video,
        max_speed=70,
        progress_callback=None
    ):
        from ai.tracker import ByteTracker
        from ai.speed import SpeedEstimator
        from ai.alarm import AlarmSystem

        cap = cv2.VideoCapture(input_video)

        if not cap.isOpened():
            print("ERROR : Cannot open video")
            return {"speed": 0.0, "status": "ERROR"}

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            total_frames = 1

        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 1:
            fps = 30

        print(f"Video FPS : {fps} | Total Frames : {total_frames}")

        temp_output = output_video.replace(".mp4", "_temp.mp4")
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")

        out = cv2.VideoWriter(
            temp_output,
            fourcc,
            fps,
            (width, height)
        )

        if not out.isOpened():
            cap.release()
            return {"speed": 0.0, "status": "ERROR"}

        # Initialize tracking, speed, and alarm modules (adapted confidence thresholds for night/floodlight turfs)
        tracker = ByteTracker(dt=1.0/fps, high_threshold=0.20, low_threshold=0.08)
        estimator = SpeedEstimator(fps=fps, max_speed_limit=max_speed)
        alarm = AlarmSystem(speed_limit=max_speed)

        detected_speed = 0.0
        maximum_speed = 0.0
        peak_instant_speed = 0.0
        status = "SAFE"
        frame_number = 0
        raw_frame_number = 0
        last_ball_frame = 0
        delivery_active = False
        delivery_finished = False
        flight_frames = 0
        trajectory_points = []
        delivery_trajectory_points = []

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            raw_frame_number += 1
            frame_number += 1

            if progress_callback:
                pct = min(92, max(1, int((frame_number / total_frames) * 92)))
                progress_callback(pct, frame_number, total_frames, f"AI Tracking Delivery: Frame {frame_number} of {total_frames} ({pct}%)")

            annotated = frame.copy()

            # Continuous OpenCV DNN inference across all frames ensures both daytime and night floodlight deliveries are reliably tracked
            run_detection = True

            # ---------------- BALL DETECTION (OpenCV DNN / PyTorch) ----------------
            detections = []
            scores = []

            if run_detection:
                if self.use_opencv_dnn:
                    blob = cv2.dnn.blobFromImage(frame, 1/255.0, (640, 640), swapRB=True, crop=False)
                    self.net.setInput(blob)
                    preds = self.net.forward()[0].T

                    mask = preds[:, 4] >= 0.08
                    valid_preds = preds[mask]
                    if len(valid_preds) > 0:
                        cxs, cys, bws, bhs = valid_preds[:, 0], valid_preds[:, 1], valid_preds[:, 2], valid_preds[:, 3]
                        boxes = np.stack([
                            (cxs - bws / 2.0) * (width / 640.0),
                            (cys - bhs / 2.0) * (height / 640.0),
                            bws * (width / 640.0),
                            bhs * (height / 640.0)
                        ], axis=1).astype(int).tolist()
                        confs = valid_preds[:, 4].tolist()

                        indices = cv2.dnn.NMSBoxes(boxes, confs, 0.08, 0.40)
                        for idx in indices:
                            b = boxes[idx]
                            detections.append((b[0] + b[2] // 2, b[1] + b[3] // 2))
                            scores.append(confs[idx])
                else:
                    predict_kwargs = {
                        "source": frame,
                        "imgsz": 640,
                        "conf": 0.08,  # Fetch lower-confidence items for ByteTrack
                        "iou": 0.40,
                        "verbose": False
                    }
                    if not self.is_custom_model:
                        predict_kwargs["classes"] = [32]  # 'sports ball' in standard COCO

                    with torch.inference_mode():
                        results = self.model.predict(**predict_kwargs)

                    for result in results:
                        if result.boxes is None:
                            continue
                        for box in result.boxes:
                            confidence = float(box.conf[0])
                            x1, y1, x2, y2 = map(int, box.xyxy[0])
                            cx = (x1 + x2) // 2
                            cy = (y1 + y2) // 2
                            detections.append((cx, cy))
                            scores.append(confidence)

            # ---------------- BYTETRACK & KALMAN ASSOCIATION ----------------
            active_tracks = tracker.update(detections, scores)
            
            ball_found = False
            current_center = None

            if active_tracks:
                # Select the delivery ball track (preferring track with forward delivery motion towards batsman)
                best_candidate = None
                best_metric = -1.0
                for tr in active_tracks:
                    score = tr.score
                    if len(tr.smoothed_history) >= 2:
                        p1 = tr.smoothed_history[-2]
                        p2 = tr.smoothed_history[-1]
                        dy = p2[1] - p1[1]
                        dx = p2[0] - p1[0]
                        spd = math.sqrt(dx * dx + dy * dy) * 0.025 * fps * 3.6
                        if dy > 0 and 15.0 <= spd <= 180.0:
                            score += 10.0 + (spd / 10.0)
                    if score > best_metric:
                        best_metric = score
                        best_candidate = tr
                primary_track = best_candidate if best_candidate else active_tracks[0]

                # Get the smoothed tracking coordinate from Kalman Filter history
                raw_center = primary_track.history[-1]
                smoothed_center = primary_track.smoothed_history[-1]
                
                current_center = (int(smoothed_center[0]), int(smoothed_center[1]))
                ball_found = True
                last_ball_frame = raw_frame_number
                trajectory_points.append(current_center)

                # Draw tracking target
                cv2.circle(annotated, current_center, 8, (0, 255, 0), 2)
                cv2.circle(annotated, current_center, 2, (0, 0, 255), -1)
                
                # Visual bounding box overlay around the current center
                r = 15
                cv2.rectangle(
                    annotated,
                    (current_center[0] - r, current_center[1] - r),
                    (current_center[0] + r, current_center[1] + r),
                    (0, 255, 0),
                    1
                )

                cv2.putText(
                    annotated,
                    f"ID: {primary_track.track_id} Conf: {primary_track.score:.2f}",
                    (current_center[0] - r, max(20, current_center[1] - r - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (0, 255, 0),
                    1
                )

                # ---------------- SPEED ESTIMATION & VALIDATION ----------------
                if len(primary_track.smoothed_history) >= 2:
                    p1 = primary_track.smoothed_history[-2]
                    p2 = primary_track.smoothed_history[-1]
                    
                    # Compute instantaneous speed strictly as per Section 6 principle
                    instant_speed, pixel_dist = estimator.calculate_speed(p1, p2, self.H)
                    
                    # Step 5: Peak selection - track maximum instantaneous velocity
                    if pixel_dist < 120.0 and 15.0 <= instant_speed <= 180.0:
                        if instant_speed > peak_instant_speed:
                            peak_instant_speed = instant_speed
                            if instant_speed >= 30.0 and not delivery_active:
                                delivery_active = True
                                delivery_finished = False

                        if not delivery_active and not delivery_finished and instant_speed >= 30.0:
                            delivery_active = True

                    # Validate and smooth speed for radar HUD display
                    detected_speed, valid = estimator.validate_and_smooth(
                        instant_speed, pixel_dist, detected_speed
                    )

                    if detected_speed > 15.0 and not delivery_active and not delivery_finished:
                        delivery_active = True

            if delivery_active:
                flight_frames += 1
                if current_center:
                    delivery_trajectory_points.append(current_center)

                # Check if ball has finished delivery flight (passed batsman, bat contact, or rebound)
                if len(delivery_trajectory_points) >= 2:
                    dy_step = delivery_trajectory_points[-1][1] - delivery_trajectory_points[-2][1]
                    if dy_step < -5.0:  # Bat contact or reversal
                        delivery_active = False
                        delivery_finished = True
                elif flight_frames > 25 and detected_speed < maximum_speed * 0.35:
                    delivery_active = False
                    delivery_finished = True

                print(
                    f"Frame {frame_number} | "
                    f"Tracked Ball {current_center} | "
                    f"Smoothed Speed {detected_speed:.1f} km/h"
                )

            # ---------------- BALL TRAIL DRAWING ----------------
            if ball_found and len(primary_track.smoothed_history) > 1:
                trail = primary_track.smoothed_history[-25:]
                for i in range(1, len(trail)):
                    thickness = max(1, int(i / 4))
                    pt1 = (int(trail[i-1][0]), int(trail[i-1][1]))
                    pt2 = (int(trail[i][0]), int(trail[i][1]))
                    cv2.line(annotated, pt1, pt2, (255, 255, 0), thickness)

            # Record peak smoothed velocity
            if detected_speed > maximum_speed:
                maximum_speed = detected_speed

            # ---------------- ALARM CONTROL ----------------
            status, status_color = alarm.check(maximum_speed)

            # ---------------- RADAR STYLE DISPLAY ----------------
            box_width = 240
            box_height = 200
            x1 = width - box_width - 20
            y1 = 20
            x2 = width - 20
            y2 = 20 + box_height

            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 0), -1)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 255, 255), 2)

            # Title
            cv2.putText(annotated, "BALL SPEED", (x1 + 15, y1 + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            
            # Speed value + unit
            cv2.putText(annotated, f"{maximum_speed:.1f} km/h", (x1 + 15, y1 + 75), cv2.FONT_HERSHEY_SIMPLEX, 1.0, status_color, 2)
            
            # Divider line
            cv2.line(annotated, (x1 + 15, y1 + 95), (x2 - 15, y1 + 95), (255, 255, 255), 1)

            # Limit Info
            cv2.putText(annotated, f"LIMIT: {int(max_speed)} km/h", (x1 + 15, y1 + 120), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            
            # Status
            cv2.putText(annotated, status, (x1 + 15, y1 + 150), cv2.FONT_HERSHEY_SIMPLEX, 0.7, status_color, 2)
            
            # State
            detect_text = "TRACKED" if ball_found else "LOST"
            detect_color = (0, 255, 0) if ball_found else (0, 0, 255)
            cv2.putText(annotated, detect_text, (x1 + 15, y1 + 180), cv2.FONT_HERSHEY_SIMPLEX, 0.5, detect_color, 1)

            out.write(annotated)

        cap.release()
        out.release()

        print()
        print("=" * 50)
        print("Video Processing Completed")
        print("=" * 50)
        print("Encoding Output Video...")
        print()

        if progress_callback:
            progress_callback(94, frame_number, total_frames, "Encoding output video overlay...")

        # Select video encoder based on platform (Darwin / Linux)
        if platform.system() == "Darwin":
            command = [
                "ffmpeg",
                "-y",
                "-i", temp_output,
                "-c:v", "h264_videotoolbox",
                "-b:v", "8M",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                "-an",
                output_video
            ]
        else:
            command = [
                "ffmpeg",
                "-y",
                "-i", temp_output,
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "26",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                "-an",
                output_video
            ]

        try:
            result = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )

            # Fallback encoder if primary failed
            if result.returncode != 0:
                print("Primary encoder failed. Switching to ultrafast libx264 fallback...")
                fallback_cmd = [
                    "ffmpeg",
                    "-y",
                    "-i", temp_output,
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-crf", "26",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    "-an",
                    output_video
                ]
                subprocess.run(fallback_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except Exception as enc_err:
            print(f"FFmpeg encoding note: {enc_err}")

        # Ensure output video exists (fallback copy if ffmpeg not installed or errored)
        if not os.path.exists(output_video) and os.path.exists(temp_output):
            shutil.copy(temp_output, output_video)

        if os.path.exists(temp_output) and os.path.exists(output_video):
            try:
                os.remove(temp_output)
            except Exception:
                pass

        # Analyze complete delivery trajectory for Angle of Deviation, Swing, and Turn
        from ai.delivery_analysis import analyze_delivery
        pts_to_analyze = delivery_trajectory_points if len(delivery_trajectory_points) >= 4 else trajectory_points
        analysis = analyze_delivery(
            pts_to_analyze,
            fps=fps,
            pixel_to_meter=0.025,
            speed_kmh=maximum_speed
        )

        print()
        print("=" * 50)
        print("CRICSPEED AI RESULTS")
        print("=" * 50)

        print(f"Frames Processed : {frame_number}")
        print(f"FPS              : {fps:.2f}")
        print(f"Maximum Speed    : {maximum_speed:.1f} km/h")
        print(f"Dev Angle (Turn) : {analysis['deviation_angle_deg']} deg")
        print(f"Air Swing        : {analysis['swing_cm']} cm")
        print(f"Turn Direction   : {analysis['turn_direction']}")
        print(f"Delivery Type    : {analysis['delivery_type']}")
        print(f"Speed Limit      : {max_speed:.1f} km/h")
        print(f"Status           : {status}")
        print(f"Output Video     : {output_video}")

        if self.H is not None:
            print("Distance Mode    : Perspective calibrated")
        else:
            print("Distance Mode    : Pixel-to-meter fallback")

        print("=" * 50)
        print("Completed Successfully")
        print()

        if progress_callback:
            progress_callback(100, frame_number, total_frames, "Delivery analysis complete!")

        # Free memory immediately on completion
        try:
            del cap
            del out
            gc.collect()
        except Exception:
            pass

        return {
            "speed": round(maximum_speed, 1),
            "status": status,
            "deviation_angle": analysis["deviation_angle_deg"],
            "turn_angle": analysis["turn_angle_deg"],
            "turn_direction": analysis["turn_direction"],
            "swing_cm": analysis["swing_cm"],
            "delivery_type": analysis["delivery_type"],
            "analysis": analysis
        }
