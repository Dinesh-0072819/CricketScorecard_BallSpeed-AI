import os
# Prevent OpenMP and threading deadlocks under Gunicorn
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"

try:
    import torch
    torch.set_num_threads(1)
    try:
        torch.set_num_interop_threads(1)
    except Exception:
        pass
except Exception:
    pass

from flask import (
    Flask,
    render_template,
    send_from_directory,
    jsonify,
    request,
    Response
)

import cv2
import numpy as np
import base64

from ai.camera import Camera
from ai.tracker import ByteTracker
from ai.speed import SpeedEstimator
from ai.alarm import AlarmSystem
from database.db_helper import init_db, add_run, get_runs
from database.scorecard_db import init_scorecard_db, get_all_matches, get_scorecard_details, delete_match, clear_all_matches
from ai.scorecard_engine import MatchEngine

# Initialize Database
init_db()
init_scorecard_db()

active_match_engine = MatchEngine()

app = Flask(__name__, static_folder="frontend/dist", static_url_path="")


# ----------------------------------
# Configuration
# ----------------------------------

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_SPEED"] = 70.0

# ----------------------------------
# Initialize Objects
# ----------------------------------

camera = Camera()

class VideoProcessorProxy:
    """Lazy-loads VideoProcessor inside the worker to prevent C++ OpenMP fork deadlocks."""
    def __init__(self):
        self._vp = None

    def _ensure(self):
        if self._vp is None:
            from ai.video_processor import VideoProcessor
            self._vp = VideoProcessor()
        return self._vp

    def __getattr__(self, name):
        return getattr(self._ensure(), name)

video_processor = VideoProcessorProxy()

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "version": "2.3-rf-fixed",
        "custom_weights": getattr(video_processor, "is_custom_model", False),
        "roboflow_gpu": getattr(video_processor, "use_roboflow", False),
        "roboflow_status": getattr(video_processor, "roboflow_status_msg", "N/A")
    }), 200

@app.route("/api/engine_status", methods=["GET"])
def engine_status():
    use_rf = os.getenv("USE_ROBOFLOW_CLOUD", "").lower().strip() == "true"
    api_key = os.getenv("ROBOFLOW_API_KEY", "").strip()
    project = os.getenv("ROBOFLOW_PROJECT", "").strip()
    workspace = os.getenv("ROBOFLOW_WORKSPACE", "").strip() or "cricspeed-ai"
    workflow = os.getenv("ROBOFLOW_WORKFLOW", "").strip() or "cricket-ball-detector-vcricket-ball-detector-logic"
    
    test_result = "not tested"
    if api_key:
        try:
            import requests
            ep = f"https://serverless.roboflow.com/infer/workflows/{workspace}/{workflow}"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            b64_tiny = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
            payload = {
                "api_key": api_key,
                "inputs": {"image": {"type": "base64", "value": b64_tiny}}
            }
            r = requests.post(ep, json=payload, headers=headers, timeout=5)
            if r.status_code == 200:
                test_result = "HTTP 200 OK: Roboflow Cloud GPU Connected & Active!"
            else:
                test_result = f"HTTP {r.status_code}: {r.text[:100]}"
        except Exception as e:
            test_result = str(e)
            
    return jsonify({
        "roboflow_enabled": use_rf,
        "has_api_key": bool(api_key),
        "api_key_masked": (api_key[:4] + "..." + api_key[-4:]) if len(api_key) > 8 else ("SET" if api_key else "EMPTY"),
        "workspace": workspace,
        "workflow": workflow,
        "processor_roboflow_active": getattr(video_processor, "use_roboflow", False),
        "processor_status": getattr(video_processor, "roboflow_status_msg", "N/A"),
        "roboflow_connection_test": test_result
    })

# Live Camera Tracking States
live_tracker = None
live_estimator = None
live_alarm = None
live_detected_speed = 0.0
live_maximum_speed = 0.0
live_trajectory_points = []
live_analysis = {
    "deviation_angle": 0.0,
    "turn_angle": 0.0,
    "turn_direction": "Straight",
    "swing_cm": 0.0,
    "delivery_type": "STRAIGHT"
}

# ----------------------------------
# Generate Camera Frames
# ----------------------------------

def generate_frames():
    global live_tracker, live_estimator, live_alarm, live_detected_speed, live_maximum_speed, live_trajectory_points, live_analysis

    while True:
        frame = camera.get_frame()

        if frame is None:
            blank = np.ones((480, 640, 3), dtype=np.uint8) * 40
            cv2.putText(
                blank,
                "Camera Stopped",
                (150, 220),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.2,
                (0, 0, 255),
                3
            )
            cv2.putText(
                blank,
                "Click Start Detection",
                (120, 270),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (255, 255, 255),
                2
            )
            ret, buffer = cv2.imencode(".jpg", blank)
        else:
            annotated = frame.copy()

            # Perform live ball detection and Kalman tracking if active
            if live_tracker is not None:
                results = video_processor.model.predict(
                    source=frame,
                    imgsz=640,
                    conf=0.15,
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

                active_tracks = live_tracker.update(detections, scores)
                
                ball_found = False
                current_center = None

                if active_tracks:
                    primary_track = active_tracks[0]
                    smoothed_center = primary_track.smoothed_history[-1]
                    current_center = (int(smoothed_center[0]), int(smoothed_center[1]))
                    ball_found = True
                    live_trajectory_points.append(current_center)

                    # Update real-time movement analysis
                    if len(live_trajectory_points) >= 6:
                        try:
                            from ai.delivery_analysis import analyze_delivery
                            mv = analyze_delivery(live_trajectory_points, speed_kmh=live_maximum_speed)
                            live_analysis["deviation_angle"] = mv["deviation_angle_deg"]
                            live_analysis["turn_angle"] = mv["turn_angle_deg"]
                            live_analysis["turn_direction"] = mv["turn_direction"]
                            live_analysis["swing_cm"] = mv["swing_cm"]
                            live_analysis["delivery_type"] = mv["delivery_type"]
                        except Exception:
                            pass

                    # Draw live target markers
                    cv2.circle(annotated, current_center, 8, (0, 255, 0), 2)
                    cv2.circle(annotated, current_center, 2, (0, 0, 255), -1)
                    
                    r = 15
                    cv2.rectangle(
                        annotated,
                        (current_center[0] - r, current_center[1] - r),
                        (current_center[0] + r, current_center[1] + r),
                        (0, 255, 0),
                        1
                    )

                    # Compute live speed using 5-step principle (strictly towards camera)
                    if len(primary_track.smoothed_history) >= 2:
                        p1 = primary_track.smoothed_history[-2]
                        p2 = primary_track.smoothed_history[-1]
                        
                        instant_speed, pixel_dist = live_estimator.calculate_speed(
                            p1, p2, video_processor.H
                        )
                        if instant_speed > 0.0:
                            live_detected_speed = instant_speed
                            if live_detected_speed > live_maximum_speed:
                                live_maximum_speed = live_detected_speed

                status, status_color = live_alarm.check(live_detected_speed)

                # Draw Live Trail
                if ball_found and len(primary_track.smoothed_history) > 1:
                    trail = primary_track.smoothed_history[-25:]
                    for i in range(1, len(trail)):
                        thickness = max(1, int(i / 4))
                        pt1 = (int(trail[i-1][0]), int(trail[i-1][1]))
                        pt2 = (int(trail[i][0]), int(trail[i][1]))
                        cv2.line(annotated, pt1, pt2, (255, 255, 0), thickness)

                # Overlay HUD panel in the top-right
                h, w, c = annotated.shape
                box_width = 210
                box_height = 145
                x1 = w - box_width - 15
                y1 = 15
                x2 = w - 15
                y2 = 15 + box_height

                cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 0), -1)
                cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 255, 255), 2)
                cv2.putText(annotated, "SPEED RADAR", (x1 + 10, y1 + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
                cv2.putText(annotated, f"MAX: {live_maximum_speed:.1f} km/h", (x1 + 10, y1 + 50), cv2.FONT_HERSHEY_SIMPLEX, 0.5, status_color, 2)
                cv2.putText(annotated, f"CUR: {live_detected_speed:.1f} km/h", (x1 + 10, y1 + 75), cv2.FONT_HERSHEY_SIMPLEX, 0.5, status_color, 2)
                cv2.putText(annotated, f"LIMIT: {int(live_alarm.speed_limit)} km/h", (x1 + 10, y1 + 100), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
                
                detect_text = "TRACKED" if ball_found else "LOST"
                detect_color = (0, 255, 0) if ball_found else (0, 0, 255)
                cv2.putText(annotated, detect_text, (x1 + 10, y1 + 125), cv2.FONT_HERSHEY_SIMPLEX, 0.45, detect_color, 2)

            ret, buffer = cv2.imencode(".jpg", annotated)

        frame = buffer.tobytes()
        yield (
            b'--frame\r\n'
            b'Content-Type:image/jpeg\r\n\r\n' +
            frame +
            b'\r\n'
        )

# ----------------------------------
# Video Feed Route
# ----------------------------------


@app.route("/video_feed")
def video_feed():
    return Response(
        generate_frames(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )

# ----------------------------------
# Camera Controls & Stats
# ----------------------------------

@app.route("/start_camera")
def start_camera():
    global live_tracker, live_estimator, live_alarm, live_detected_speed, live_maximum_speed, live_trajectory_points, live_analysis
    camera.start()
    
    fps = 60.0
    max_limit = app.config.get("MAX_SPEED", 70.0)
    
    live_tracker = ByteTracker(dt=1.0/fps, high_threshold=0.40, low_threshold=0.15)
    live_estimator = SpeedEstimator(fps=fps, max_speed_limit=max_limit)
    live_alarm = AlarmSystem(speed_limit=max_limit)
    live_detected_speed = 0.0
    live_maximum_speed = 0.0
    live_trajectory_points = []
    live_analysis = {
        "deviation_angle": 0.0,
        "turn_angle": 0.0,
        "turn_direction": "Straight",
        "swing_cm": 0.0,
        "delivery_type": "STRAIGHT"
    }

    return "Camera Started"

@app.route("/save_live_run", methods=["POST"])
def save_live_run():
    global live_maximum_speed, live_alarm, live_trajectory_points, live_analysis
    status = "SAFE"
    if live_alarm is not None and live_maximum_speed > live_alarm.speed_limit:
        status = "NO-BALL"
    
    if live_maximum_speed > 0:
        run_id = add_run(speed=round(live_maximum_speed, 1), status=status)
        # Reset live maximum speed for the next run
        live_maximum_speed = 0.0
        live_trajectory_points = []
        return jsonify({"status": "success", "run_id": run_id})
    return jsonify({"status": "error", "message": "No speed to save"}), 400

@app.route("/stop_camera")
def stop_camera():
    global live_tracker, live_trajectory_points
    camera.stop()
    live_tracker = None
    live_trajectory_points = []
    return "Camera Stopped"

@app.route("/camera_stats")
def camera_stats():
    global live_detected_speed, live_maximum_speed, live_alarm, live_analysis
    status = "SAFE"
    if live_alarm is not None and live_maximum_speed > live_alarm.speed_limit:
        status = "NO-BALL"
    return jsonify({
        "current_speed": round(live_detected_speed, 1),
        "max_speed": round(live_maximum_speed, 1),
        "status": status,
        "deviation_angle": live_analysis.get("deviation_angle", 0.0),
        "turn_angle": live_analysis.get("turn_angle", 0.0),
        "turn_direction": live_analysis.get("turn_direction", "Straight"),
        "swing_cm": live_analysis.get("swing_cm", 0.0),
        "delivery_type": live_analysis.get("delivery_type", "STRAIGHT")
    })



# ----------------------------------
# Upload Video & Progress Tracking
# ----------------------------------

PROGRESS_FILE = "/tmp/cricspeed_progress.json"
GLOBAL_PROGRESS = {
    "status": "idle",
    "percent": 0,
    "frame": 0,
    "total_frames": 0,
    "message": ""
}

def write_progress(state):
    global GLOBAL_PROGRESS
    GLOBAL_PROGRESS = dict(state)
    try:
        with open(PROGRESS_FILE, "w") as f:
            import json as _json
            _json.dump(state, f)
    except Exception:
        pass

def read_progress():
    global GLOBAL_PROGRESS
    if GLOBAL_PROGRESS.get("status") != "idle":
        return GLOBAL_PROGRESS
    try:
        if os.path.exists(PROGRESS_FILE):
            with open(PROGRESS_FILE, "r") as f:
                import json as _json
                data = _json.load(f)
                GLOBAL_PROGRESS = data
                return data
    except Exception:
        pass
    return GLOBAL_PROGRESS

@app.route("/upload_progress", methods=["GET"])
def get_upload_progress():
    return jsonify(read_progress())

@app.route("/upload", methods=["POST"])
def upload_video():
    try:
        # Clear previous uploads to save space
        if os.path.exists(app.config["UPLOAD_FOLDER"]):
            for f in os.listdir(app.config["UPLOAD_FOLDER"]):
                file_path = os.path.join(app.config["UPLOAD_FOLDER"], f)
                try:
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                except Exception as e:
                    print(f"Error deleting file {file_path}: {e}")

        if "video" not in request.files:
            return jsonify({"status": "error", "message": "No Video Selected"}), 400

        file = request.files["video"]

        if file.filename == "":
            return jsonify({"status": "error", "message": "No Video Selected"}), 400

        max_speed = float(
            request.form.get("max_speed", app.config.get("MAX_SPEED", 70.0))
        )

        input_path = os.path.join(
            app.config["UPLOAD_FOLDER"],
            file.filename
        )

        output_filename = "processed_" + file.filename
        output_path = os.path.join(
            app.config["UPLOAD_FOLDER"],
            output_filename
        )

        write_progress({
            "status": "uploading",
            "percent": 0,
            "frame": 0,
            "total_frames": 0,
            "message": "Saving uploaded video footage..."
        })

        file.save(input_path)
        print(f"Video Saved : {input_path}")

        write_progress({
            "status": "processing",
            "percent": 0,
            "frame": 0,
            "total_frames": 0,
            "message": "Initializing AI model & reading video frames..."
        })

        def run_analysis_in_background():
            def on_processing_progress(percent, frame, total_frames, message=""):
                write_progress({
                    "status": "processing",
                    "percent": percent,
                    "frame": frame,
                    "total_frames": total_frames,
                    "message": message or f"AI Tracking Delivery: Frame {frame} of {total_frames} ({percent}%)"
                })

            try:
                result = video_processor.process(
                    input_video=input_path,
                    output_video=output_path,
                    max_speed=max_speed,
                    progress_callback=on_processing_progress
                )

                # Save tracking record to database
                add_run(
                    speed=result["speed"],
                    status=result["status"]
                )

                final_data = {
                    "status": "success",
                    "video_url": f"/uploads/{output_filename}",
                    "original_video_url": f"/uploads/{file.filename}",
                    "detected_speed": float(result["speed"]),
                    "max_speed": max_speed,
                    "ball_status": result["status"],
                    "deviation_angle": float(result.get("deviation_angle", 0.0)),
                    "turn_angle": float(result.get("turn_angle", 0.0)),
                    "turn_direction": result.get("turn_direction", "Straight"),
                    "swing_cm": float(result.get("swing_cm", 0.0)),
                    "delivery_type": result.get("delivery_type", "STRAIGHT")
                }

                write_progress({
                    "status": "done",
                    "percent": 100,
                    "frame": 0,
                    "total_frames": 0,
                    "message": "Delivery processing complete!",
                    "result": final_data
                })
                print("Background video processing completed successfully.")
            except Exception as bg_err:
                print(f"Background video processing error: {bg_err}")
                write_progress({
                    "status": "error",
                    "percent": 0,
                    "frame": 0,
                    "total_frames": 0,
                    "message": f"Processing error: {str(bg_err)}"
                })

        # Launch analysis in asynchronous daemon thread (prevents HTTP 504 timeout)
        import threading
        thread = threading.Thread(target=run_analysis_in_background, daemon=True)
        thread.start()

        # Respond immediately to client (< 1 second)
        return jsonify({
            "status": "accepted",
            "message": "Video uploaded successfully. AI processing in progress."
        }), 202

    except Exception as e:
        print(f"Video upload error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# ----------------------------------
# Serve Uploaded & Sample Videos
# ----------------------------------

@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(
        app.config["UPLOAD_FOLDER"],
        filename
    )

@app.route("/static/samples/<path:filename>")
def serve_sample(filename):
    return send_from_directory("static/samples", filename)

@app.route("/api/sample_videos", methods=["GET"])
def get_sample_videos():
    drive_link = "https://drive.google.com/drive/folders/1sEeM3oCp54qZ87t7_K_36-fSRxWE6vc5?usp=share_link"
    samples = [
        {
            "id": "day_pace",
            "name": "Daytime Pace Delivery",
            "filename": "WhatsApp Video 2026-08-15 at 11.45.15.mp4",
            "url": "/static/samples/WhatsApp%20Video%202026-08-15%20at%2011.45.15.mp4",
            "speed": "94.6 km/h",
            "type": "FAST PACE",
            "description": "Daylight bowling footage. Ball tracked from hand to pitch at 94.6 km/h with 1.5 cm swing.",
            "status": "NO-BALL"
        },
        {
            "id": "night_spin",
            "name": "Nighttime Spin Delivery",
            "filename": "WhatsApp Video 2026-07-21 at 00.00.46.mp4",
            "url": "/static/samples/WhatsApp%20Video%202026-07-21%20at%2000.00.46.mp4",
            "speed": "81.1 km/h",
            "type": "LEG_SPIN",
            "description": "Floodlight spin delivery. High drift & spin deviation with 16.1 cm swing.",
            "status": "NO-BALL"
        }
    ]
    return jsonify({
        "status": "success",
        "drive_url": drive_link,
        "samples": samples
    })



@app.route("/analytics_data")
def analytics_data():
    runs = get_runs()
    total_runs = len(runs)
    
    if total_runs > 0:
        speeds = [r["speed"] for r in runs]
        peak_speed = max(speeds)
        avg_speed = sum(speeds) / total_runs
        alarms = sum(1 for r in runs if r["status"] in ("NO-BALL", "IPL NO-BALL", "ALARM"))
        alarm_rate = (alarms / total_runs) * 100
    else:
        peak_speed = 0.0
        avg_speed = 0.0
        alarm_rate = 0.0

    return jsonify({
        "total_runs": total_runs,
        "peak_speed": peak_speed,
        "avg_speed": avg_speed,
        "alarm_rate": alarm_rate,
        "recent_runs": list(reversed(runs[:15])),  # Chronological order
        "all_runs": runs
    })

# ----------------------------------


@app.route("/save_config", methods=["POST"])
def save_config():
    data = request.json
    max_speed = data.get("max_speed")
    app.config["MAX_SPEED"] = float(max_speed)
    return jsonify({"status": "success"})

@app.route("/process_frame", methods=["POST"])
def process_frame():
    global live_tracker, live_estimator, live_alarm, live_detected_speed, live_maximum_speed
    
    data = request.json
    
    # Initialize trackers if not active or if reset is requested
    if live_tracker is None or data.get("reset"):
        fps = 15.0 # Assume 15 FPS for browser upload streaming
        max_limit = app.config.get("MAX_SPEED", 70.0)
        live_tracker = ByteTracker(dt=1.0/fps, high_threshold=0.40, low_threshold=0.15)
        live_estimator = SpeedEstimator(fps=fps, max_speed_limit=max_limit)
        live_alarm = AlarmSystem(speed_limit=max_limit)
        live_detected_speed = 0.0
        live_maximum_speed = 0.0
    image_data = data.get("image")
    if not image_data:
        return jsonify({"status": "error", "message": "No image data"}), 400
        
    # Decode base64 image
    try:
        header, encoded = image_data.split(",", 1)
        nparr = np.frombuffer(base64.b64decode(encoded), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to decode base64 image: {e}"}), 400
    
    if frame is None:
        return jsonify({"status": "error", "message": "Failed to decode frame"}), 400
        
    annotated = frame.copy()
    h, w, c = annotated.shape
    
    # Run ball detection & tracking
    results = video_processor.model.predict(
        source=frame,
        imgsz=640,
        conf=0.15,
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

    active_tracks = live_tracker.update(detections, scores)
    
    ball_found = False
    current_center = None

    if active_tracks:
        primary_track = active_tracks[0]
        smoothed_center = primary_track.smoothed_history[-1]
        current_center = (int(smoothed_center[0]), int(smoothed_center[1]))
        ball_found = True

        cv2.circle(annotated, current_center, 8, (0, 255, 0), 2)
        cv2.circle(annotated, current_center, 2, (0, 0, 255), -1)
        
        r = 15
        cv2.rectangle(
            annotated,
            (current_center[0] - r, current_center[1] - r),
            (current_center[0] + r, current_center[1] + r),
            (0, 255, 0),
            1
        )

        if len(primary_track.smoothed_history) >= 2:
            p1 = primary_track.smoothed_history[-2]
            p2 = primary_track.smoothed_history[-1]
            
            instant_speed, pixel_dist = live_estimator.calculate_speed(
                p1, p2, video_processor.H
            )
            if instant_speed > 0.0:
                live_detected_speed = instant_speed
                if live_detected_speed > live_maximum_speed:
                    live_maximum_speed = live_detected_speed

    status = "SAFE"
    if live_alarm is not None and live_maximum_speed > live_alarm.speed_limit:
        status = "NO-BALL"
    status_color = (0, 255, 0) if status == "SAFE" else (0, 0, 255)

    # Draw live trail
    if ball_found and len(primary_track.smoothed_history) > 1:
        trail = primary_track.smoothed_history[-25:]
        for i in range(1, len(trail)):
            thickness = max(1, int(i / 4))
            pt1 = (int(trail[i-1][0]), int(trail[i-1][1]))
            pt2 = (int(trail[i][0]), int(trail[i][1]))
            cv2.line(annotated, pt1, pt2, (255, 255, 0), thickness)

    # Overlay HUD panel in the top-right
    box_width = 210
    box_height = 145
    x1 = w - box_width - 15
    y1 = 15
    x2 = w - 15
    y2 = 15 + box_height

    cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 0), -1)
    cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 255, 255), 2)
    cv2.putText(annotated, "SPEED RADAR", (x1 + 10, y1 + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    cv2.putText(annotated, f"MAX: {live_maximum_speed:.1f} km/h", (x1 + 10, y1 + 50), cv2.FONT_HERSHEY_SIMPLEX, 0.5, status_color, 2)
    cv2.putText(annotated, f"CUR: {live_detected_speed:.1f} km/h", (x1 + 10, y1 + 75), cv2.FONT_HERSHEY_SIMPLEX, 0.5, status_color, 2)
    cv2.putText(annotated, f"LIMIT: {int(live_alarm.speed_limit)} km/h", (x1 + 10, y1 + 100), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    
    detect_text = "TRACKED" if ball_found else "LOST"
    detect_color = (0, 255, 0) if ball_found else (0, 0, 255)
    cv2.putText(annotated, detect_text, (x1 + 10, y1 + 125), cv2.FONT_HERSHEY_SIMPLEX, 0.45, detect_color, 2)

    # Encode back to base64
    ret, jpeg = cv2.imencode(".jpg", annotated)
    processed_base64 = "data:image/jpeg;base64," + base64.b64encode(jpeg.tobytes()).decode("utf-8")
    
    # Save the run to MongoDB on peak speed update
    if ball_found and live_maximum_speed > 0:
        # We can add run records to MongoDB periodically or at the end.
        # Let's save on status change or periodically.
        # But to be safe, we just save each run to DB.
        pass

    return jsonify({
        "current_speed": round(live_detected_speed, 1),
        "max_speed": round(live_maximum_speed, 1),
        "status": status,
        "image": processed_base64
    })

# ----------------------------------
# Scorecard REST API Endpoints
# ----------------------------------

@app.route("/api/match/create", methods=["POST"])
def api_create_match():
    data = request.json or {}
    team1 = data.get("team1", "Team A")
    team2 = data.get("team2", "Team B")
    overs = int(data.get("total_overs", 20))
    toss_winner = data.get("toss_winner", team1)
    toss_decision = data.get("toss_decision", "BAT")
    
    match_id = active_match_engine.start_new_match(team1, team2, overs, toss_winner, toss_decision)
    return jsonify({"status": "success", "match_id": match_id, "state": active_match_engine.get_state()})

@app.route("/api/match/setup_innings", methods=["POST"])
def api_setup_innings():
    data = request.json or {}
    striker = data.get("striker", "Batter 1")
    non_striker = data.get("non_striker", "Batter 2")
    bowler = data.get("bowler", "Bowler 1")
    target = int(data.get("target", 0))
    current_innings = int(data.get("current_innings", 1))
    
    active_match_engine.setup_innings(striker, non_striker, bowler, target=target, current_innings=current_innings)
    return jsonify({"status": "success", "state": active_match_engine.get_state()})

@app.route("/api/match/state", methods=["GET"])
def api_match_state():
    return jsonify(active_match_engine.get_state())

@app.route("/api/match/ball", methods=["POST"])
def api_record_ball():
    data = request.json or {}
    mode = data.get("mode", "NORMAL")
    runs = int(data.get("runs", 0))
    wicket_desc = data.get("wicket_desc")
    new_batsman = data.get("new_batsman")
    who_out = data.get("who_out")
    
    # Check if live camera speed is available to link
    speed_kmh = float(data.get("speed_kmh", live_maximum_speed if live_maximum_speed > 0 else 0.0))
    
    res = active_match_engine.record_delivery(
        mode=mode, runs=runs, wicket_desc=wicket_desc,
        new_batsman=new_batsman, who_out=who_out, speed_kmh=speed_kmh
    )
    return jsonify(res)

@app.route("/api/match/undo", methods=["POST"])
def api_match_undo():
    res = active_match_engine.undo()
    return jsonify(res)

@app.route("/api/match/swap_strike", methods=["POST"])
def api_swap_strike():
    active_match_engine.swap_batsmen()
    return jsonify({"status": "success", "state": active_match_engine.get_state()})

@app.route("/api/match/next_bowler", methods=["POST"])
def api_next_bowler():
    data = request.json or {}
    bowler = data.get("bowler", "New Bowler")
    active_match_engine.set_next_bowler(bowler)
    return jsonify({"status": "success", "state": active_match_engine.get_state()})

@app.route("/api/match/details/<int:match_id>", methods=["GET"])
def api_match_details(match_id):
    details = get_scorecard_details(match_id)
    return jsonify(details)

@app.route("/api/matches", methods=["GET"])
def api_matches_list():
    matches = get_all_matches()
    return jsonify(matches)

@app.route("/api/match/delete/<int:match_id>", methods=["POST", "DELETE"])
@app.route("/api/match/<int:match_id>", methods=["DELETE"])
def api_delete_match(match_id):
    delete_match(match_id)
    return jsonify({"status": "success", "message": f"Match {match_id} deleted."})

@app.route("/api/matches/clear", methods=["POST"])
def api_clear_matches():
    clear_all_matches()
    return jsonify({"status": "success", "message": "All matches cleared."})

# Fallback route for React Single Page Application (SPA)
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_spa(path):
    if app.static_folder and os.path.exists(os.path.join(app.static_folder, path)) and path != "":
        return send_from_directory(app.static_folder, path)
    if app.static_folder and os.path.exists(os.path.join(app.static_folder, 'index.html')):
        return send_from_directory(app.static_folder, 'index.html')
    return "CricSpeed AI is running.", 200

# ----------------------------------
# Run
# ----------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    debug_mode = os.environ.get("FLASK_DEBUG", "False").lower() in ("true", "1")
    app.run(
        host="0.0.0.0",
        port=port,
        debug=debug_mode
    )