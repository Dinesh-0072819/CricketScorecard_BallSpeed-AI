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
