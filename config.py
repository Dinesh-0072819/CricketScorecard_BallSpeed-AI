import os

class Config:
    """
    Central Configuration class for CricSpeedAI.
    """
    # Server configuration
    HOST = "0.0.0.0"
    PORT = 5050
    DEBUG = True

    # Paths
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
    WEIGHTS_DIR = os.path.join(BASE_DIR, "weights")
    DATABASE_DIR = os.path.join(BASE_DIR, "database")
    LOGS_DIR = os.path.join(BASE_DIR, "logs")

    # File locations
    MODEL_PATH = os.path.join(WEIGHTS_DIR, "tennis_ball_detector.pt")
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
    MONGO_DB_NAME = "cricspeed"
    ALARM_LOG_PATH = os.path.join(LOGS_DIR, "alarms.log")
    CALIBRATION_PATH = os.path.join(BASE_DIR, "config_calibration.json")

    # Defaults
    DEFAULT_MAX_SPEED = 70.0
    DEFAULT_PITCH_LENGTH = 20.12  # Standard length in meters
    DEFAULT_PITCH_WIDTH = 3.05    # Standard width in meters
    FALLBACK_PIXEL_TO_METER = 0.025

    # YOLO Confidence Thresholds
    YOLO_CONF_HIGH = 0.40
    YOLO_CONF_LOW = 0.15
    YOLO_IOU = 0.40
    YOLO_IMGSZ = 640

    # Ball Movement Analysis Tunables
    ENABLE_BALL_ANALYSIS = True
    TURN_MIN_DEG = 1.5          # Minimum degrees to classify as spin turn
    SWING_MIN_M = 0.05          # Minimum lateral swing deviation in metres (5 cm)
    SPIN_SPEED_MAX = 110.0      # Maximum speed (km/h) for typical spin bowler
    LOST_FRAMES_N = 8           # Number of lost frames to declare delivery finished
    OVERLAY_HOLD_SECONDS = 4.0  # Duration to hold post-delivery analysis HUD overlay
    ANALYSIS_MAX_AGE_SECONDS = 60.0 # Maximum age (seconds) to link delivery to scorecard ball
    MIN_TRACK_POINTS = 6        # Minimum track points required for valid analysis
    MIN_PITCH_SPAN_M = 3.0      # Minimum pitch distance (metres) traversed by delivery


# Module-level exports for convenient imports across ai and backend modules
ENABLE_BALL_ANALYSIS = Config.ENABLE_BALL_ANALYSIS
TURN_MIN_DEG = Config.TURN_MIN_DEG
SWING_MIN_M = Config.SWING_MIN_M
SPIN_SPEED_MAX = Config.SPIN_SPEED_MAX
LOST_FRAMES_N = Config.LOST_FRAMES_N
OVERLAY_HOLD_SECONDS = Config.OVERLAY_HOLD_SECONDS
ANALYSIS_MAX_AGE_SECONDS = Config.ANALYSIS_MAX_AGE_SECONDS
MIN_TRACK_POINTS = Config.MIN_TRACK_POINTS
MIN_PITCH_SPAN_M = Config.MIN_PITCH_SPAN_M

