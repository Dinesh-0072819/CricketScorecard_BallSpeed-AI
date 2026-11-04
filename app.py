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
    Response,
    session
)
import secrets
import datetime as _dt

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
from database.user_db import (
    init_user_db, create_user, create_guest_user, verify_user, get_user, add_speed_run, get_speed_runs,
    set_match_owner, match_owned_by, get_user_matches, get_latest_live_match_id, clear_user_matches
)

# Initialize Database
USE_MONGO = bool(os.getenv("MONGO_URI"))   # legacy global run log (optional)
if USE_MONGO:
    init_db()
init_scorecard_db()
init_user_db()

app = Flask(__name__, static_folder="frontend/dist", static_url_path="")


# ----------------------------------
# Accounts & sessions
# ----------------------------------

def _load_secret_key():
    key = os.getenv("SECRET_KEY")
    if key:
        return key
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database", ".secret_key")
    try:
        if os.path.exists(path):
            with open(path) as f:
                return f.read().strip()
        key = secrets.token_hex(32)
        with open(path, "w") as f:
            f.write(key)
        return key
    except Exception:
        return secrets.token_hex(32)


app.config.update(
    SECRET_KEY=_load_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
    PERMANENT_SESSION_LIFETIME=_dt.timedelta(days=30),
)

# Everything that reads or writes a user's data needs a login
PROTECTED_PREFIXES = (
    "/api/match", "/upload", "/analytics_data", "/save_live_run", "/save_config", "/process_frame",
)


def current_user_id():
    return session.get("user_id")


@app.before_request
def require_login():
    path = request.path
    if path.startswith("/api/auth/"):
        return None
    if any(path.startswith(p) for p in PROTECTED_PREFIXES):
        if not current_user_id():
            return jsonify({"status": "error", "message": "Please log in", "auth_required": True}), 401
    return None


def _login(user):
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["username"] = user["username"]


@app.route("/api/auth/register", methods=["POST"])
def api_register():
    data = request.json or {}
    user, err = create_user(data.get("username", ""), data.get("password", ""))
    if err:
        return jsonify({"status": "error", "message": err}), 400
    _login(user)
    return jsonify({"status": "success", "user": user})


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.json or {}
    user = verify_user(data.get("username", ""), data.get("password", ""))
    if not user:
        return jsonify({"status": "error", "message": "Wrong username or password"}), 401
    _login(user)
    return jsonify({"status": "success", "user": user})


@app.route("/api/auth/guest", methods=["POST"])
def api_guest():
    user = create_guest_user()
    if not user:
        return jsonify({"status": "error", "message": "Could not start a guest session, try again"}), 500
    _login(user)
    session["is_guest"] = True
    return jsonify({"status": "success", "user": user})


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"status": "success"})


@app.route("/api/auth/me", methods=["GET"])
def api_me():
    user = get_user(current_user_id())
    if not user:
        session.clear()
        return jsonify({"logged_in": False})
    return jsonify({"logged_in": True, "user": {"id": user["id"], "username": user["username"],
                                                "is_guest": user["username"].lower().startswith("guest_")}})


# One live match engine per user
_engines = {}


def _engine():
    uid = current_user_id()
    eng = _engines.get(uid)
    if eng is None:
        eng = MatchEngine()   # live state is in memory; finished/old matches stay in the user's history
        _engines[uid] = eng
    return eng


def _record_speed(uid, speed, status, source, delivery_type=None):
    if not uid or not speed:
        return None
    rid = add_speed_run(uid, speed, status, source=source, delivery_type=delivery_type)
    if USE_MONGO:
        try:
            add_run(speed=speed, status=status)
        except Exception:
            pass
    return rid


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


def _live_detect(frame, tracker):
    """Ball detections for one live frame using the shared detector (ONNX / PT / tiled)."""
    last_pos = None
    try:
        if tracker is not None and tracker.tracks:
            t = max(tracker.tracks, key=lambda tr: len(tr.history))
            if t.time_since_update <= 3:
                last_pos = (float(t.kf.x[0, 0]), float(t.kf.x[1, 0]))
    except Exception:
        last_pos = None
    dets = video_processor.detect_live(frame, last_pos=last_pos)
    return [(int(d[0]), int(d[1])) for d in dets], [float(d[4]) for d in dets]

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "version": "3.0-tiled-detection-tof-speed",
        "detector_backend": getattr(getattr(video_processor, "detector", None), "backend", None),
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
                detections, scores = _live_detect(frame, live_tracker)

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
        run_id = _record_speed(current_user_id(), round(live_maximum_speed, 1), status, "live_camera")
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

IDLE_PROGRESS = {"status": "idle", "percent": 0, "frame": 0, "total_frames": 0, "message": ""}
USER_PROGRESS = {}   # user_id -> progress dict (each user sees only their own upload)


def _progress_file(uid):
    return f"/tmp/cricspeed_progress_u{uid}.json"


def write_progress(state, uid=None):
    uid = uid if uid is not None else current_user_id()
    USER_PROGRESS[uid] = dict(state)
    try:
        with open(_progress_file(uid), "w") as f:
            import json as _json
            _json.dump(state, f)
    except Exception:
        pass


def read_progress(uid=None):
    uid = uid if uid is not None else current_user_id()
    data = USER_PROGRESS.get(uid)
    if data and data.get("status") != "idle":
        return data
    try:
        if os.path.exists(_progress_file(uid)):
            with open(_progress_file(uid), "r") as f:
                import json as _json
                data = _json.load(f)
                USER_PROGRESS[uid] = data
                return data
    except Exception:
        pass
    return dict(IDLE_PROGRESS)

@app.route("/upload_progress", methods=["GET"])
def get_upload_progress():
    return jsonify(read_progress())

@app.route("/upload", methods=["POST"])
def upload_video():
    uid = current_user_id()
    user_folder = os.path.join(app.config["UPLOAD_FOLDER"], f"u{uid}")
    try:
        # Clear this user's previous uploads to save space
        os.makedirs(user_folder, exist_ok=True)
        if os.path.exists(user_folder):
            for f in os.listdir(user_folder):
                file_path = os.path.join(user_folder, f)
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
        batsman_hand = (request.form.get("batsman_hand") or os.getenv("BATSMAN_HAND", "RIGHT")).upper()
        try:
            pitch_length_m = float(request.form.get("pitch_length_m") or app.config.get("PITCH_LENGTH_M") or 0) or None
        except ValueError:
            pitch_length_m = None

        import re, time as _time
        base, ext = os.path.splitext(os.path.basename(file.filename))
        safe = re.sub(r"[^A-Za-z0-9_-]+", "_", base).strip("_") or "video"
        safe_name = f"{safe}_{int(_time.time())}{ext.lower() or '.mp4'}"
        input_path = os.path.join(user_folder, safe_name)

        output_filename = "processed_" + os.path.splitext(safe_name)[0] + ".mp4"
        output_path = os.path.join(user_folder, output_filename)

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
                write_progress(uid=uid, state={
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
                    progress_callback=on_processing_progress,
                    batsman_hand=batsman_hand,
                    pitch_length_m=pitch_length_m
                )

                # Save tracking record to database (fail-safe)
                try:
                    _record_speed(uid, result["speed"], result["status"], "video",
                                  result.get("delivery_type"))
                except Exception as db_err:
                    print(f"Database save notice: {db_err}")

                final_data = {
                    "status": "success",
                    # fast cloud mode: no server-rendered video, the browser draws the overlay
                    "video_url": (f"/uploads/u{uid}/{safe_name}" if result.get("overlay_mode") == "client"
                                  else f"/uploads/u{uid}/{output_filename}"),
                    "overlay_mode": result.get("overlay_mode", "server"),
                    "overlay": result.get("overlay"),
                    "original_video_url": f"/uploads/u{uid}/{safe_name}",
                    "detected_speed": float(result["speed"]),
                    "max_speed": max_speed,
                    "ball_status": result["status"],
                    "deviation_angle": float(result.get("deviation_angle", 0.0)),
                    "turn_angle": float(result.get("turn_angle", 0.0)),
                    "turn_direction": result.get("turn_direction", "Straight"),
                    "swing_cm": float(result.get("swing_cm", 0.0)),
                    "delivery_type": result.get("delivery_type", "STRAIGHT"),
                    "analysis": result.get("analysis", {}),
                    "engine": result.get("engine"),
                    "flight_time_s": result.get("analysis", {}).get("flight_time_s"),
                    "bounce_frame": result.get("analysis", {}).get("bounce_frame"),
                    "pitch_length_m": result.get("analysis", {}).get("pitch_length_m"),
                    "batsman_hand": batsman_hand,
                    "ball_found": result.get("analysis", {}).get("status") == "ok"
                }

                write_progress(uid=uid, state={
                    "status": "done",
                    "percent": 100,
                    "frame": 0,
                    "total_frames": 0,
                    "message": "Delivery processing complete!",
                    "result": final_data
                })
                print("Background video processing completed successfully.")
            except Exception as bg_err:
                import traceback
                traceback.print_exc()
                print(f"Background video processing error: {bg_err}")
                write_progress(uid=uid, state={
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
        import traceback
        traceback.print_exc()
        print(f"Video upload error: {type(e).__name__}: {e}")
        return jsonify({"status": "error", "message": f"Upload failed: {type(e).__name__}: {e}"}), 500

# ----------------------------------
# Serve Uploaded & Sample Videos
# ----------------------------------

@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    if not filename.startswith(f"u{current_user_id()}/"):
        return jsonify({"status": "error", "message": "Not found"}), 404
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
    runs = get_speed_runs(current_user_id())
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
    data = request.json or {}
    if data.get("max_speed") is not None:
        app.config["MAX_SPEED"] = float(data.get("max_speed"))
    if data.get("pitch_length_m"):
        app.config["PITCH_LENGTH_M"] = float(data.get("pitch_length_m"))
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
    detections, scores = _live_detect(frame, live_tracker)

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
    
    match_id = _engine().start_new_match(team1, team2, overs, toss_winner, toss_decision)
    set_match_owner(match_id, current_user_id())
    return jsonify({"status": "success", "match_id": match_id, "state": _engine().get_state()})

@app.route("/api/match/setup_innings", methods=["POST"])
def api_setup_innings():
    data = request.json or {}
    striker = data.get("striker", "Batter 1")
    non_striker = data.get("non_striker", "Batter 2")
    bowler = data.get("bowler", "Bowler 1")
    target = int(data.get("target", 0))
    current_innings = int(data.get("current_innings", 1))
    
    _engine().setup_innings(striker, non_striker, bowler, target=target, current_innings=current_innings)
    return jsonify({"status": "success", "state": _engine().get_state()})

@app.route("/api/match/state", methods=["GET"])
def api_match_state():
    return jsonify(_engine().get_state())

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
    
    res = _engine().record_delivery(
        mode=mode, runs=runs, wicket_desc=wicket_desc,
        new_batsman=new_batsman, who_out=who_out, speed_kmh=speed_kmh
    )
    return jsonify(res)

@app.route("/api/match/end_innings", methods=["POST"])
def api_end_innings():
    return jsonify(_engine().end_innings())

@app.route("/api/match/undo", methods=["POST"])
def api_match_undo():
    res = _engine().undo()
    return jsonify(res)

@app.route("/api/match/swap_strike", methods=["POST"])
def api_swap_strike():
    _engine().swap_batsmen()
    return jsonify({"status": "success", "state": _engine().get_state()})

@app.route("/api/match/next_bowler", methods=["POST"])
def api_next_bowler():
    data = request.json or {}
    bowler = data.get("bowler", "New Bowler")
    _engine().set_next_bowler(bowler)
    return jsonify({"status": "success", "state": _engine().get_state()})

@app.route("/api/match/details/<int:match_id>", methods=["GET"])
def api_match_details(match_id):
    if not match_owned_by(match_id, current_user_id()):
        return jsonify({"status": "error", "message": "Match not found"}), 404
    details = get_scorecard_details(match_id)
    return jsonify(details)

@app.route("/api/matches", methods=["GET"])
def api_matches_list():
    matches = get_user_matches(current_user_id())
    return jsonify(matches)

@app.route("/api/match/delete/<int:match_id>", methods=["POST", "DELETE"])
@app.route("/api/match/<int:match_id>", methods=["DELETE"])
def api_delete_match(match_id):
    if not match_owned_by(match_id, current_user_id()):
        return jsonify({"status": "error", "message": "Match not found"}), 404
    delete_match(match_id)
    eng = _engines.get(current_user_id())
    if eng is not None and eng.match_id == match_id:
        _engines.pop(current_user_id(), None)
    return jsonify({"status": "success", "message": f"Match {match_id} deleted."})

@app.route("/api/matches/clear", methods=["POST"])
def api_clear_matches():
    clear_user_matches(current_user_id())
    _engines.pop(current_user_id(), None)
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