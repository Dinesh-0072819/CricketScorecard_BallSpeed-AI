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

        out_dir = os.path.dirname(os.path.abspath(output_video))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
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

        # Standard physical pixel-to-meter ratio (22-yard pitch fallback = 0.025 m/px)
        # Perspective matrix H is automatically used when ground calibration is active.
        pitch_scale = 0.025
        tracker = ByteTracker(dt=1.0/fps, high_threshold=0.35, low_threshold=0.15)
        estimator = SpeedEstimator(fps=fps, pixel_to_meter=pitch_scale, max_speed_limit=max_speed)
        estimator.smoothing_factor = 0.75
        alarm = AlarmSystem(speed_limit=max_speed)

        detected_speed = 0.0
        maximum_speed = 0.0
        status = "SAFE"
        frame_number = 0
        raw_frame_number = 0
        last_ball_frame = 0
        trajectory_points = []
        current_delivery_points = []
        current_burst_max_speed = 0.0
        delivery_bursts = []
        track_history = {}
        track_smoothed = {}
        track_max_speed = {}
        rf_failures = 0

        # ---------------- ROBOFLOW PARALLEL CLOUD PRE-FETCH ----------------
        cloud_detections = {}
        if self.use_roboflow and self.roboflow_api_key:
            if progress_callback:
                progress_callback(5, 0, total_frames, "Sending delivery frames to Roboflow Cloud GPU...")

            ws = self.roboflow_workspace or "cricspeed-ai"
            wf = self.roboflow_project or "cricket-ball-detector-vcricket-ball-detector-logic"
            ep = f"https://serverless.roboflow.com/infer/workflows/{ws}/cricket-ball-detector-vcricket-ball-detector-logic"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.roboflow_api_key.strip()}"
            }

            step = 2 if fps > 40.0 else 1
            frames_to_query = []
            f_idx = 0
            while True:
                ret, f = cap.read()
                if not ret:
                    break
                if f_idx % step == 0:
                    _, enc = cv2.imencode('.jpg', f, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                    b64_img = base64.b64encode(enc).decode('utf-8')
                    frames_to_query.append((f_idx, b64_img))
                f_idx += 1

            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            total_queries = len(frames_to_query)
            completed_queries = 0

            def _query_rf(item):
                nonlocal completed_queries
                frame_i, b64 = item
                payload = {
                    "api_key": self.roboflow_api_key.strip(),
                    "inputs": {"image": {"type": "base64", "value": b64}}
                }
                dets, scs = [], []
                try:
                    res = self.rf_session.post(ep, json=payload, headers=headers, timeout=12.0, verify=False)
                    if res.status_code == 200:
                        pred_data = res.json()
                        outputs = pred_data.get("outputs", [])
                        if outputs:
                            preds = outputs[0].get("predictions", {}).get("predictions", [])
                            for pred in preds:
                                dets.append((int(pred["x"]), int(pred["y"])))
                                scs.append(float(pred.get("confidence", 0.5)))
                except Exception as e:
                    pass
                completed_queries += 1
                if progress_callback and total_queries > 0:
                    prog = min(75, 5 + int((completed_queries / total_queries) * 70))
                    progress_callback(prog, completed_queries, total_queries, f"Cloud GPU Inferencing: {prog}%")
                return frame_i, dets, scs

            try:
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
                    for f_i, dets, scs in executor.map(_query_rf, frames_to_query):
                        cloud_detections[f_i] = (dets, scs)
                print(f"Roboflow Cloud GPU: parallel inference completed for {len(cloud_detections)} frames.")
            except Exception as e:
                print(f"Roboflow parallel execution note: {e}")

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            raw_frame_number += 1
            frame_number += 1

            if progress_callback:
                if cloud_detections:
                    pct = min(92, 75 + int((frame_number / total_frames) * 17))
                else:
                    pct = min(92, max(1, int((frame_number / total_frames) * 92)))
                progress_callback(pct, frame_number, total_frames, f"AI Tracking Delivery: Frame {frame_number} of {total_frames} ({pct}%)")

            annotated = frame.copy()

            detections = []
            scores = []
            used_cloud = False

            # ---------------- ROBOFLOW CLOUD GPU INFERENCE ----------------
            if cloud_detections:
                dets, scs = cloud_detections.get(raw_frame_number - 1, ([], []))
                detections = list(dets)
                scores = list(scs)
                used_cloud = True

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

            # Update speeds and trajectory history per track
            for tr in active_tracks:
                tid = tr.track_id
                if tid not in track_history:
                    track_history[tid] = []
                    track_smoothed[tid] = 0.0
                    track_max_speed[tid] = 0.0
                
                cur_p = tr.smoothed_history[-1]
                track_history[tid].append(cur_p)
                
                if len(tr.smoothed_history) >= 2:
                    p1 = tr.smoothed_history[-2]
                    p2 = tr.smoothed_history[-1]
                    inst_spd, pixel_dist = estimator.calculate_speed(p1, p2, self.H)
                    sm_spd, valid = estimator.validate_and_smooth(
                        inst_spd, pixel_dist, track_smoothed[tid]
                    )
                    track_smoothed[tid] = sm_spd
                    if sm_spd > track_max_speed[tid]:
                        track_max_speed[tid] = sm_spd

            if active_tracks:
                # Prioritize delivery track with highest speed or forward movement
                primary_track = max(
                    active_tracks,
                    key=lambda t: (track_max_speed.get(t.track_id, 0.0), t.score)
                )
                detected_speed = track_smoothed.get(primary_track.track_id, 0.0)
                if track_max_speed.get(primary_track.track_id, 0.0) > maximum_speed:
                    maximum_speed = track_max_speed[primary_track.track_id]

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

                print(
                    f"Frame {frame_number} | "
                    f"Tracked Ball {current_center} | "
                    f"Smoothed Speed {detected_speed:.1f} km/h (Max: {maximum_speed:.1f} km/h)"
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

            # Collect continuous delivery flight points during delivery movement
            if ball_found and current_center is not None and detected_speed >= 25.0:
                current_delivery_points.append(current_center)
                if detected_speed > current_burst_max_speed:
                    current_burst_max_speed = detected_speed
            else:
                if len(current_delivery_points) >= 5 and current_burst_max_speed >= 30.0:
                    delivery_bursts.append({
                        "max_speed": current_burst_max_speed,
                        "points": list(current_delivery_points)
                    })
                current_delivery_points = []
                current_burst_max_speed = 0.0

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

        # Select genuine delivery flight trajectory points
        if len(current_delivery_points) >= 5 and current_burst_max_speed >= 30.0:
            delivery_bursts.append({
                "max_speed": current_burst_max_speed,
                "points": list(current_delivery_points)
            })

        if delivery_bursts:
            best_burst = max(delivery_bursts, key=lambda b: b["max_speed"])
            pts_to_analyze = best_burst["points"]
            if best_burst["max_speed"] > maximum_speed:
                maximum_speed = best_burst["max_speed"]
        elif trajectory_points:
            pts_to_analyze = trajectory_points
        else:
            pts_to_analyze = []

        # Analyze complete delivery trajectory for Angle of Deviation, Swing, and Turn
        from ai.delivery_analysis import analyze_delivery
        analysis = analyze_delivery(
            pts_to_analyze,
            fps=fps,
            pixel_to_meter=pitch_scale,
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
