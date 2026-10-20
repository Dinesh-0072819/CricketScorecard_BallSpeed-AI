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
import os
import base64
import time
import json
import logging

from ai.camera import Camera
from ai.video_processor import VideoProcessor
from ai.tracker import ByteTracker
from ai.speed import SpeedEstimator, pixel_to_ground
from ai.alarm import AlarmSystem
from ai.track_cleaning import clean_track
from ai.delivery_analysis import analyze_delivery
from ai.utils import CalibrationManager
from config import (
    ENABLE_BALL_ANALYSIS,
    TURN_MIN_DEG,
    SWING_MIN_M,
    LOST_FRAMES_N,
    OVERLAY_HOLD_SECONDS,
    ANALYSIS_MAX_AGE_SECONDS,
    MIN_TRACK_POINTS,
    MIN_PITCH_SPAN_M
)
from database.db_helper import init_db, add_run, get_runs
from database.scorecard_db import (
    init_scorecard_db,
    get_all_matches,
    get_scorecard_details,
    clear_all_matches,
    get_match_deliveries,
    get_bowler_analysis
)
from ai.scorecard_engine import MatchEngine

logger = logging.getLogger(__name__)

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
video_processor = VideoProcessor()

# Live Camera Tracking States
live_tracker = None
live_estimator = None
live_alarm = None
live_detected_speed = 0.0
live_maximum_speed = 0.0

# Live Delivery Analysis States
live_delivery_buffer = []
live_consecutive_tracked = 0
live_lost_frames = 0
live_delivery_active = False
live_batsman_hand = "RIGHT"
live_calibration_profile = "default"

latest_delivery_analysis = None
latest_delivery_timestamp = 0.0

# ----------------------------------
# Generate Camera Frames
# ----------------------------------

def generate_frames():
    global live_tracker, live_estimator, live_alarm, live_detected_speed, live_maximum_speed

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

                    # Compute live speed using calibration
                    if len(primary_track.smoothed_history) >= 2:
                        p1 = primary_track.smoothed_history[-2]
                        p2 = primary_track.smoothed_history[-1]
                        
                        instant_speed, pixel_dist = live_estimator.calculate_speed(
                            p1, p2, video_processor.H
                        )
                        live_detected_speed, valid = live_estimator.validate_and_smooth(
                            instant_speed, pixel_dist, live_detected_speed
                        )

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
    global live_tracker, live_estimator, live_alarm, live_detected_speed, live_maximum_speed
    camera.start()
    
    fps = 30.0
    max_limit = app.config.get("MAX_SPEED", 70.0)
    
    live_tracker = ByteTracker(dt=1.0/fps, high_threshold=0.40, low_threshold=0.15)
    live_estimator = SpeedEstimator(fps=fps, max_speed_limit=max_limit)
    live_alarm = AlarmSystem(speed_limit=max_limit)
    live_detected_speed = 0.0
    live_maximum_speed = 0.0

    return "Camera Started"

@app.route("/save_live_run", methods=["POST"])
def save_live_run():
    global live_maximum_speed, live_alarm
    status = "SAFE"
    if live_alarm is not None and live_maximum_speed > live_alarm.speed_limit:
        status = "NO-BALL"
    
    if live_maximum_speed > 0:
        run_id = add_run(speed=round(live_maximum_speed, 1), status=status)
        # Reset live maximum speed for the next run
        live_maximum_speed = 0.0
        return jsonify({"status": "success", "run_id": run_id})
    return jsonify({"status": "error", "message": "No speed to save"}), 400

@app.route("/stop_camera")
def stop_camera():
    global live_tracker
    camera.stop()
    live_tracker = None
    return "Camera Stopped"

@app.route("/camera_stats")
def camera_stats():
    global live_detected_speed, live_maximum_speed, live_alarm
    status = "SAFE"
    if live_alarm is not None and live_maximum_speed > live_alarm.speed_limit:
        status = "NO-BALL"
    return jsonify({
        "current_speed": round(live_detected_speed, 1),
        "max_speed": round(live_maximum_speed, 1),
        "status": status
    })



# ----------------------------------
# Upload Video
# ----------------------------------

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

        file.save(input_path)

        print(f"Video Saved : {input_path}")

        batsman_hand = request.form.get("batsman_hand", "RIGHT").upper().strip()
        if batsman_hand not in ("RIGHT", "LEFT"):
            batsman_hand = "RIGHT"

        calibration_profile = request.form.get("calibration_profile", "default")

        result = video_processor.process(
            input_video=input_path,
            output_video=output_path,
            max_speed=max_speed,
            batsman_hand=batsman_hand,
            calibration_profile=calibration_profile
        )

        # Store latest delivery analysis in memory for scorecard auto-linking
        global latest_delivery_analysis, latest_delivery_timestamp
        delivery_analysis = result.get("delivery_analysis")
        if delivery_analysis:
            latest_delivery_analysis = delivery_analysis
            latest_delivery_timestamp = time.time()

        # Save tracking record to database
        add_run(
            speed=result["speed"],
            status=result["status"]
        )

        print("Video Processed Successfully")

        return jsonify({
            "status": "success",
            "video_url": f"/uploads/{output_filename}",
            "detected_speed": float(result["speed"]),
            "max_speed": max_speed,
            "ball_status": result["status"],
            "delivery_analysis": delivery_analysis
        })
    except Exception as e:
        print(f"Video processing error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# ----------------------------------
# Serve Uploaded Videos
# ----------------------------------

@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(
        app.config["UPLOAD_FOLDER"],
        filename
    )



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
    global live_delivery_buffer, live_consecutive_tracked, live_lost_frames, live_delivery_active
    global live_batsman_hand, live_calibration_profile, latest_delivery_analysis, latest_delivery_timestamp
    
    data = request.json or {}
    
    # Initialize trackers if not active or if reset is requested
    if live_tracker is None or data.get("reset"):
        fps = 15.0 # Assume 15 FPS for browser upload streaming
        max_limit = app.config.get("MAX_SPEED", 70.0)
        live_tracker = ByteTracker(dt=1.0/fps, high_threshold=0.40, low_threshold=0.15)
        live_estimator = SpeedEstimator(fps=fps, max_speed_limit=max_limit)
        live_alarm = AlarmSystem(speed_limit=max_limit)
        live_detected_speed = 0.0
        live_maximum_speed = 0.0
        live_delivery_buffer = []
        live_consecutive_tracked = 0
        live_lost_frames = 0
        live_delivery_active = False

    batsman_hand = data.get("batsman_hand", live_batsman_hand)
    if batsman_hand:
        batsman_hand = str(batsman_hand).upper().strip()
        if batsman_hand in ("RIGHT", "LEFT"):
            live_batsman_hand = batsman_hand

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
            live_detected_speed, valid = live_estimator.validate_and_smooth(
                instant_speed, pixel_dist, live_detected_speed
            )

    if live_detected_speed > live_maximum_speed:
        live_maximum_speed = live_detected_speed

    status = "SAFE"
    if live_alarm is not None and live_maximum_speed > live_alarm.speed_limit:
        status = "NO-BALL"
    status_color = (0, 255, 0) if status == "SAFE" else (0, 0, 255)

    # ---------------- Trajectory Buffering & Live Delivery Analysis ----------------
    current_delivery_analysis = None
    if ball_found and current_center is not None:
        gx, gy = pixel_to_ground(current_center[0], current_center[1], H=video_processor.H, frame_width=w, frame_height=h)
        live_consecutive_tracked += 1
        live_lost_frames = 0
        if not live_delivery_active and live_consecutive_tracked >= 3:
            live_delivery_active = True
        if live_delivery_active:
            live_delivery_buffer.append({
                "x": gx,
                "y": gy,
                "px": float(current_center[0]),
                "py": float(current_center[1]),
                "t": time.time()
            })
    else:
        live_consecutive_tracked = 0
        if live_delivery_active:
            live_lost_frames += 1

    # Check delivery completion trigger
    if live_delivery_active:
        passed_batsman = (len(live_delivery_buffer) > 0 and live_delivery_buffer[-1]["y"] >= 19.0)
        lost_track = (live_lost_frames >= LOST_FRAMES_N)
        if passed_batsman or lost_track:
            live_delivery_active = False
            if ENABLE_BALL_ANALYSIS and len(live_delivery_buffer) >= MIN_TRACK_POINTS:
                cleaned = clean_track(live_delivery_buffer)
                if cleaned:
                    try:
                        an = analyze_delivery(cleaned, batsman_hand=live_batsman_hand, speed_kmh=live_maximum_speed)
                        latest_delivery_analysis = an
                        latest_delivery_timestamp = time.time()
                        current_delivery_analysis = an
                    except Exception as err:
                        logger.error(f"Error in live analyze_delivery: {err}")
            live_delivery_buffer = []
            live_lost_frames = 0

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

    is_fresh = False
    if latest_delivery_timestamp > 0 and (time.time() - latest_delivery_timestamp) <= ANALYSIS_MAX_AGE_SECONDS:
        is_fresh = True

    return jsonify({
        "current_speed": round(live_detected_speed, 1),
        "max_speed": round(live_maximum_speed, 1),
        "status": status,
        "image": processed_base64,
        "delivery_analysis": current_delivery_analysis or (latest_delivery_analysis if is_fresh else None),
        "has_fresh_analysis": is_fresh
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
    if target == 0:
        target = active_match_engine.target
    current_innings = int(data.get("current_innings", 1))
    
    active_match_engine.setup_innings(striker, non_striker, bowler, target=target, current_innings=current_innings)
    return jsonify({"status": "success", "state": active_match_engine.get_state()})

@app.route("/api/match/state", methods=["GET"])
def api_match_state():
    return jsonify(active_match_engine.get_state())

@app.route("/api/match/ball", methods=["POST"])
def api_record_ball():
    global latest_delivery_analysis, latest_delivery_timestamp
    data = request.json or {}
    mode = data.get("mode", "NORMAL")
    runs = int(data.get("runs", 0))
    wicket_desc = data.get("wicket_desc")
    new_batsman = data.get("new_batsman")
    who_out = data.get("who_out")
    
    # Check if live camera speed is available to link
    speed_kmh = float(data.get("speed_kmh", live_maximum_speed if live_maximum_speed > 0 else 0.0))
    
    # Optional delivery analysis fields
    delivery_type = data.get("delivery_type")
    spin_type = data.get("spin_type")
    swing_type = data.get("swing_type")
    turn_angle_deg = data.get("turn_angle_deg")
    swing_cm = data.get("swing_cm")
    bounce_x = data.get("bounce_x")
    bounce_y = data.get("bounce_y")
    length = data.get("length")
    line = data.get("line")
    analysis_confidence = data.get("analysis_confidence")
    analysis_json = data.get("analysis_json")

    # Auto-linking if not explicitly provided and not discarded
    discard = data.get("discard_analysis", False)
    if not discard and delivery_type is None and latest_delivery_analysis is not None:
        age = time.time() - latest_delivery_timestamp
        if age <= ANALYSIS_MAX_AGE_SECONDS:
            an = latest_delivery_analysis
            delivery_type = an.get("delivery_type")
            spin_type = an.get("spin_type")
            swing_type = an.get("swing_type")
            turn_angle_deg = an.get("turn_angle_deg")
            swing_cm = an.get("swing_cm")
            b_xy = an.get("bounce_xy_m")
            if b_xy and len(b_xy) == 2:
                bounce_x = b_xy[0]
                bounce_y = b_xy[1]
            length = an.get("length")
            line = an.get("line")
            analysis_confidence = an.get("confidence")
            analysis_json = json.dumps(an)

            # Consume so it doesn't attach to another delivery
            latest_delivery_analysis = None
            latest_delivery_timestamp = 0.0
    elif discard:
        latest_delivery_analysis = None
        latest_delivery_timestamp = 0.0

    res = active_match_engine.record_delivery(
        mode=mode, runs=runs, wicket_desc=wicket_desc,
        new_batsman=new_batsman, who_out=who_out, speed_kmh=speed_kmh,
        delivery_type=delivery_type, spin_type=spin_type, swing_type=swing_type,
        turn_angle_deg=turn_angle_deg, swing_cm=swing_cm,
        bounce_x=bounce_x, bounce_y=bounce_y, length=length, line=line,
        analysis_confidence=analysis_confidence, analysis_json=analysis_json
    )
    return jsonify(res)

@app.route("/api/match/deliveries", methods=["GET"])
def api_match_deliveries():
    match_id = request.args.get("match_id", type=int)
    if not match_id and active_match_engine.match_id:
        match_id = active_match_engine.match_id
    if not match_id:
        return jsonify([])
    deliveries = get_match_deliveries(match_id)
    return jsonify(deliveries)

@app.route("/api/bowler/analysis", methods=["GET"])
def api_bowler_analysis():
    match_id = request.args.get("match_id", type=int)
    if not match_id and active_match_engine.match_id:
        match_id = active_match_engine.match_id
    bowler_name = request.args.get("bowler")
    analysis = get_bowler_analysis(match_id=match_id, bowler_name=bowler_name)
    return jsonify(analysis)

@app.route("/api/analysis/latest", methods=["GET"])
def api_latest_analysis():
    global latest_delivery_analysis, latest_delivery_timestamp
    if latest_delivery_analysis is None:
        return jsonify({"analysis": None, "is_fresh": False, "age_seconds": None})
    age = time.time() - latest_delivery_timestamp
    is_fresh = age <= ANALYSIS_MAX_AGE_SECONDS
    return jsonify({
        "analysis": latest_delivery_analysis if is_fresh else None,
        "is_fresh": is_fresh,
        "age_seconds": round(age, 1)
    })

@app.route("/api/analysis/discard", methods=["POST"])
def api_discard_analysis():
    global latest_delivery_analysis, latest_delivery_timestamp
    latest_delivery_analysis = None
    latest_delivery_timestamp = 0.0
    return jsonify({"status": "success", "message": "Latest delivery analysis discarded"})

@app.route("/api/calibration/profiles", methods=["GET"])
def api_calibration_profiles():
    mgr = CalibrationManager()
    profiles = mgr.list_profiles()
    return jsonify({"profiles": profiles, "active": live_calibration_profile})

@app.route("/api/calibration/select", methods=["POST"])
def api_select_calibration():
    global live_calibration_profile
    data = request.json or {}
    profile = data.get("profile", "default")
    mgr = CalibrationManager()
    image_points, real_world_points, H = mgr.load_calibration(profile=profile)
    if H is not None:
        video_processor.H = H
        live_calibration_profile = profile
        return jsonify({"status": "success", "active_profile": profile})
    return jsonify({"status": "error", "message": f"Profile '{profile}' not found"}), 404

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

@app.route("/api/matches/clear", methods=["POST"])
def api_clear_matches():
    clear_all_matches()
    active_match_engine.match_id = None
    active_match_engine.status = "IDLE"
    active_match_engine.runs = 0
    active_match_engine.wickets = 0
    active_match_engine.balls = 0
    active_match_engine.batting = {}
    active_match_engine.bowling = {}
    active_match_engine.history = []
    active_match_engine.over_deliveries = []
    return jsonify({"status": "success", "message": "All match history deleted successfully."})

# Fallback route for React Single Page Application (SPA)
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_spa(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, 'index.html')

# ----------------------------------
# Run
# ----------------------------------

if __name__ == "__main__":
    print("\n" + "="*60)
    print("⚡ CricSpeed AI RUNNING ON HTTP")
    print("👉 Open Mobile Link: http://10.62.35.100:5050")
    print("="*60 + "\n")

    app.run(
        host="0.0.0.0",
        port=5050,
        debug=True
    )