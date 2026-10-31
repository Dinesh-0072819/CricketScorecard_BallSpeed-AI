import cv2
import subprocess
import os
import math
import platform
import shutil
import gc
import base64
import torch
import requests
import numpy as np
from ultralytics import YOLO

# Limit PyTorch CPU threads to prevent thread thrashing & memory spikes on cloud instances
try:
    torch.set_num_threads(1)
except Exception:
    pass


def letterbox(im, new_shape=(640, 640), color=(114, 114, 114)):
    shape = im.shape[:2]
    r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
    new_unpad = int(round(shape[1] * r)), int(round(shape[0] * r))
    dw, dh = (new_shape[1] - new_unpad[0]) / 2, (new_shape[0] - new_unpad[1]) / 2
    if shape[::-1] != new_unpad:
        im = cv2.resize(im, new_unpad, interpolation=cv2.INTER_LINEAR)
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    return cv2.copyMakeBorder(im, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color), r, (dw, dh)


class VideoProcessor:

    def __init__(self):
        print("=" * 50)
        print("Loading Tennis Ball AI Model...")
        print("=" * 50)

        # 1. High-Performance, Ultra-Low RAM OpenCV DNN Engine (<50MB RAM, zero deadlock, zero OOM)
        onnx_path = "weights/tennis_ball_detector.onnx"
        self.use_onnx = False
        self.model = None

        if os.path.exists(onnx_path) and os.path.getsize(onnx_path) > 100000:
            try:
                self.net = cv2.dnn.readNetFromONNX(onnx_path)
                self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
                self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
                self.use_onnx = True
                print("Loaded High-Speed OpenCV DNN Engine: <50MB RAM, zero deadlock.")
            except Exception as e:
                print(f"OpenCV DNN init note: {e}")

        # 2. PyTorch Fallback (only loaded if ONNX not available)
        if not self.use_onnx:
            model_path = "weights/tennis_ball_detector.pt"
            if not os.path.exists(model_path) or os.path.getsize(model_path) < 100000:
                if os.path.exists("tennis_ball_detector.pt") and os.path.getsize("tennis_ball_detector.pt") > 100000:
                    model_path = "tennis_ball_detector.pt"
                else:
                    model_path = "yolov8n.pt"
            self.model = YOLO(model_path)

        self.H = None

        # Roboflow Cloud GPU inference configuration
        self.use_roboflow = os.getenv("USE_ROBOFLOW_CLOUD", "false").lower() == "true"
        self.roboflow_api_key = os.getenv("ROBOFLOW_API_KEY", "")
        self.roboflow_project = os.getenv("ROBOFLOW_PROJECT", "")
        self.roboflow_workspace = os.getenv("ROBOFLOW_WORKSPACE", "")
        self.roboflow_warned = False
        self.rf_session = requests.Session()
        self.roboflow_status_msg = "Ready" if (self.use_roboflow and self.roboflow_api_key) else "Disabled (local engine active)"
        if self.use_roboflow and self.roboflow_api_key:
            print("Roboflow Cloud GPU Integration: ENABLED")
        else:
            print("Roboflow Cloud GPU Integration: DISABLED (using local engine)")

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

        # Initialize tracking, speed, and alarm modules (Exact proven configuration)
        tracker = ByteTracker(dt=1.0/fps, high_threshold=0.40, low_threshold=0.15)
        estimator = SpeedEstimator(fps=fps, max_speed_limit=max_speed)
        alarm = AlarmSystem(speed_limit=max_speed)

        detected_speed = 0.0
        maximum_speed = 0.0
        status = "SAFE"
        frame_number = 0
        raw_frame_number = 0
        last_ball_frame = 0
        trajectory_points = []

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

            detections = []
            scores = []
            used_cloud = False

            # ---------------- ROBOFLOW CLOUD GPU INFERENCE ----------------
            if self.use_roboflow and self.roboflow_api_key:
                try:
                    _, img_encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                    b64_image = base64.b64encode(img_encoded).decode('utf-8')
                    
                    ws = self.roboflow_workspace or "cricspeed-ai"
                    wf = self.roboflow_project or "cricket-ball-detector-vcricket-ball-detector-logic"
                    if "cricket" in wf or "logic" in wf or "workflow" in wf:
                        ep = f"https://serverless.roboflow.com/infer/workflows/{ws}/cricket-ball-detector-vcricket-ball-detector-logic"
                        headers = {
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {self.roboflow_api_key.strip()}"
                        }
                        payload = {
                            "api_key": self.roboflow_api_key.strip(),
                            "inputs": {"image": {"type": "base64", "value": b64_image}}
                        }
                        res = self.rf_session.post(ep, json=payload, headers=headers, timeout=3.0)
                        if res.status_code == 200:
                            pred_data = res.json()
                            outputs = pred_data.get("outputs", [])
                            if outputs:
                                preds = outputs[0].get("predictions", {}).get("predictions", [])
                                for pred in preds:
                                    cx = int(pred["x"])
                                    cy = int(pred["y"])
                                    conf = float(pred.get("confidence", 0.5))
                                    detections.append((cx, cy))
                                    scores.append(conf)
                            used_cloud = True
                        else:
                            if not self.roboflow_warned:
                                err_preview = res.text[:120] if res.text else f"status {res.status_code}"
                                print(f"Roboflow Cloud notice (HTTP {res.status_code}): {err_preview}. Switching to high-speed local engine.")
                                self.roboflow_status_msg = f"HTTP {res.status_code}: {err_preview}"
                                self.roboflow_warned = True
                            self.use_roboflow = False
                    else:
                        clean_proj = self.roboflow_project.strip()
                        if "/" not in clean_proj:
                            clean_proj = f"{clean_proj}/1"
                        ep = f"https://detect.roboflow.com/{clean_proj}?api_key={self.roboflow_api_key.strip()}&confidence=15"
                        res = self.rf_session.post(
                            ep,
                            data=b64_image,
                            headers={'Content-Type': 'application/x-www-form-urlencoded'},
                            timeout=2.5
                        )
                        if res.status_code == 200:
                            pred_data = res.json()
                            for pred in pred_data.get("predictions", []):
                                cx = int(pred["x"])
                                cy = int(pred["y"])
                                conf = float(pred.get("confidence", 0.5))
                                detections.append((cx, cy))
                                scores.append(conf)
                            used_cloud = True
                        else:
                            if not self.roboflow_warned:
                                err_preview = res.text[:120] if res.text else f"status {res.status_code}"
                                print(f"Roboflow Cloud notice (HTTP {res.status_code}): {err_preview}. Switching to high-speed local engine.")
                                self.roboflow_status_msg = f"HTTP {res.status_code}: {err_preview}"
                                self.roboflow_warned = True
                            self.use_roboflow = False
                except Exception as rf_err:
                    if not self.roboflow_warned:
                        print(f"Roboflow Cloud connection note: {rf_err}. Switching to high-speed local engine.")
                        self.roboflow_status_msg = str(rf_err)
                        self.roboflow_warned = True
                    self.use_roboflow = False

            # ---------------- LOCAL BALL DETECTION (OPENCV DNN / PYTORCH) ----------------
            if not used_cloud:
                if self.use_onnx:
                    lb, r, (dw, dh) = letterbox(frame, (640, 640))
                    blob = cv2.dnn.blobFromImage(lb, 1/255.0, (640, 640), swapRB=True, crop=False)
                    self.net.setInput(blob)
                    preds = self.net.forward()[0].T
                    mask = preds[:, 4] >= 0.15
                    valid = preds[mask]
                    if len(valid) > 0:
                        cxs = (valid[:, 0] - dw) / r
                        cys = (valid[:, 1] - dh) / r
                        bws = valid[:, 2] / r
                        bhs = valid[:, 3] / r
                        boxes = np.stack([cxs - bws/2, cys - bhs/2, bws, bhs], axis=1).astype(int).tolist()
                        confs = valid[:, 4].tolist()
                        for idx in cv2.dnn.NMSBoxes(boxes, confs, 0.15, 0.40):
                            cx = int(boxes[idx][0] + boxes[idx][2]//2)
                            cy = int(boxes[idx][1] + boxes[idx][3]//2)
                            detections.append((cx, cy))
                            scores.append(confs[idx])
                elif self.model is not None:
                    with torch.inference_mode():
                        results = self.model.predict(
                            source=frame,
                            imgsz=640,
                            conf=0.15,
                            iou=0.40,
                            verbose=False
                        )

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
                # Select the best track: prioritize the ball in flight (moving towards batsman: dy > 0)
                # rather than a static background false positive (e.g. at 394, 779)
                best_track = active_tracks[0]
                if len(active_tracks) > 1:
                    best_score = -999.0
                    for tr in active_tracks:
                        if len(tr.smoothed_history) >= 2:
                            p_prev = tr.smoothed_history[-2]
                            p_curr = tr.smoothed_history[-1]
                            dy = p_curr[1] - p_prev[1]
                            dx = abs(p_curr[0] - p_prev[0])
                            
                            # Check if track is stationary in the background (< 6px movement over 10 frames)
                            is_static = False
                            if len(tr.smoothed_history) >= 10:
                                p_old = tr.smoothed_history[-10]
                                if abs(p_curr[0] - p_old[0]) < 6 and abs(p_curr[1] - p_old[1]) < 6:
                                    is_static = True
                                    
                            if is_static:
                                motion_score = -50.0
                            else:
                                motion_score = (dy * 3.0) + dx + (tr.score * 10.0)
                                
                            if motion_score > best_score:
                                best_score = motion_score
                                best_track = tr
                        elif tr.score > best_track.score:
                            best_track = tr

                primary_track = best_track
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
                    
                    instant_speed, pixel_dist = estimator.calculate_speed(p1, p2, self.H)
                    detected_speed, valid = estimator.validate_and_smooth(
                        instant_speed, pixel_dist, detected_speed
                    )

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
        pts_to_analyze = trajectory_points
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
