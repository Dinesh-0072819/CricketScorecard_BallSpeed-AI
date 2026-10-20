import cv2
import subprocess
import os
import math
from ultralytics import YOLO


class VideoProcessor:

    def __init__(self):
        print("=" * 50)
        print("Loading Tennis Ball AI Model...")
        print("=" * 50)

        # Existing Antigravity-trained model
        self.model = YOLO("weights/tennis_ball_detector.pt")

        self.H = None
        from ai.utils import CalibrationManager
        self.calib_mgr = CalibrationManager()
        _, _, self.H = self.calib_mgr.load_calibration()
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
        batsman_hand="RIGHT",
        calibration_profile=None
    ):
        from ai.tracker import ByteTracker
        from ai.speed import SpeedEstimator, pixel_to_ground
        from ai.alarm import AlarmSystem
        from ai.track_cleaning import clean_track
        from ai.delivery_analysis import analyze_delivery
        from config import ENABLE_BALL_ANALYSIS, LOST_FRAMES_N, MIN_TRACK_POINTS

        cap = cv2.VideoCapture(input_video)

        if not cap.isOpened():
            print("ERROR : Cannot open video")
            return {"speed": 0.0, "status": "ERROR", "delivery_analysis": None}

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 1:
            fps = 30

        print(f"Video FPS : {fps}")

        active_H = self.H
        if calibration_profile:
            _, _, profile_H = self.calib_mgr.load_calibration(profile=calibration_profile)
            if profile_H is not None:
                active_H = profile_H

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
            return {"speed": 0.0, "status": "ERROR", "delivery_analysis": None}

        # Initialize tracking, speed, and alarm modules
        tracker = ByteTracker(dt=1.0/fps, high_threshold=0.40, low_threshold=0.15)
        estimator = SpeedEstimator(fps=fps, max_speed_limit=max_speed)
        alarm = AlarmSystem(speed_limit=max_speed)

        detected_speed = 0.0
        maximum_speed = 0.0
        status = "SAFE"
        frame_number = 0

        # Trajectory buffer and delivery tracking state
        trajectory_buffer = []
        consecutive_tracked = 0
        lost_frames = 0
        delivery_active = False
        last_delivery_analysis = None
        deliveries_analyzed = []

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_number += 1
            annotated = frame.copy()

            # ---------------- YOLO BALL DETECTION ----------------
            results = self.model.predict(
                source=frame,
                imgsz=640,
                conf=0.15,  # Fetch lower-confidence items for ByteTrack
                iou=0.40,
                verbose=False
            )

            detections = []
            scores = []

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
                # Track the first active object (assuming primary cricket ball)
                primary_track = active_tracks[0]
                # Get the smoothed tracking coordinate from Kalman Filter history
                raw_center = primary_track.history[-1]
                smoothed_center = primary_track.smoothed_history[-1]
                
                current_center = (int(smoothed_center[0]), int(smoothed_center[1]))
                ball_found = True

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
                    
                    # Compute instantaneous speed (meters using H matrix ↔️ pixels fallback)
                    instant_speed, pixel_dist = estimator.calculate_speed(p1, p2, self.H)
                    
                    # Validate and smooth speed using moving average
                    detected_speed, valid = estimator.validate_and_smooth(
                        instant_speed, pixel_dist, detected_speed
                    )

                print(
                    f"Frame {frame_number} | "
                    f"Tracked Ball {current_center} | "
                    f"Smoothed Speed {detected_speed:.1f} km/h"
                )

            # ---------------- TRAJECTORY BUFFERING & DELIVERY ANALYSIS ----------------
            if ball_found and current_center is not None:
                gx, gy = pixel_to_ground(current_center[0], current_center[1], H=active_H, frame_width=width, frame_height=height)
                t_sec = float(frame_number) / float(fps)
                point_data = {
                    "x": gx,
                    "y": gy,
                    "px": float(current_center[0]),
                    "py": float(current_center[1]),
                    "t": t_sec
                }
                consecutive_tracked += 1
                lost_frames = 0
                if not delivery_active and consecutive_tracked >= 3:
                    delivery_active = True
                if delivery_active:
                    trajectory_buffer.append(point_data)
            else:
                consecutive_tracked = 0
                if delivery_active:
                    lost_frames += 1

            # Check delivery completion trigger
            if delivery_active:
                passed_crease = (len(trajectory_buffer) > 0 and trajectory_buffer[-1]["y"] >= 19.0)
                lost_too_long = (lost_frames >= LOST_FRAMES_N)
                if passed_crease or lost_too_long:
                    delivery_active = False
                    if ENABLE_BALL_ANALYSIS and len(trajectory_buffer) >= MIN_TRACK_POINTS:
                        cleaned = clean_track(trajectory_buffer)
                        if cleaned:
                            try:
                                analysis = analyze_delivery(cleaned, batsman_hand=batsman_hand, speed_kmh=maximum_speed)
                                last_delivery_analysis = analysis
                                deliveries_analyzed.append(analysis)
                            except Exception as err:
                                print(f"Delivery analysis error: {err}")
                    trajectory_buffer = []
                    lost_frames = 0

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

        # Apple hardware H264 encoder
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

        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        # Fallback encoder
        if result.returncode != 0:
            print("VideoToolbox failed. Switching to libx264...")
            command = [
                "ffmpeg",
                "-y",
                "-i", temp_output,
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "22",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                "-an",
                output_video
            ]
            subprocess.run(command)

        if os.path.exists(temp_output):
            os.remove(temp_output)

        # Final check if an active delivery completed at video end
        if delivery_active and ENABLE_BALL_ANALYSIS and len(trajectory_buffer) >= MIN_TRACK_POINTS:
            cleaned = clean_track(trajectory_buffer)
            if cleaned:
                try:
                    analysis = analyze_delivery(cleaned, batsman_hand=batsman_hand, speed_kmh=maximum_speed)
                    last_delivery_analysis = analysis
                    deliveries_analyzed.append(analysis)
                except Exception as err:
                    print(f"Final delivery analysis error: {err}")

        print()
        print("=" * 50)
        print("CRICSPEED AI RESULTS")
        print("=" * 50)

        print(f"Frames Processed : {frame_number}")
        print(f"FPS              : {fps:.2f}")
        print(f"Maximum Speed    : {maximum_speed:.1f} km/h")
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

        return {
            "speed": round(maximum_speed, 1),
            "status": status,
            "delivery_analysis": last_delivery_analysis,
            "deliveries": deliveries_analyzed
        }
