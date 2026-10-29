import os
import datetime

class AlarmSystem:
    """
    Manages alarm state, limits, and logging.
    """
    def __init__(self, speed_limit=70.0, log_dir="logs"):
        self.speed_limit = speed_limit
        self.log_dir = log_dir
        os.makedirs(self.log_dir, exist_ok=True)
        self.log_file = os.path.join(self.log_dir, "alarms.log")

    def set_limit(self, limit):
        self.speed_limit = float(limit)

    def check(self, speed):
        """
        Check if the speed exceeds the limit.
        Returns:
            status: "NO-BALL" or "SAFE"
            color: Tuple representing BGR color (red for NO-BALL, green for SAFE)
        """
        if speed > self.speed_limit:
            status = "NO-BALL"
            color = (0, 0, 255) # Red
            self.log_alarm(speed)
        else:
            status = "SAFE"
            color = (0, 255, 0) # Green
            
        return status, color

    def log_alarm(self, speed):
        """Log a speed violation to a file."""
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = f"[{timestamp}] ALERT: Speed violation detected! Ball Speed: {speed:.1f} km/h (Limit: {self.speed_limit} km/h)\n"
        
        try:
            with open(self.log_file, "a") as f:
                f.write(log_entry)
        except Exception as e:
            print(f"Failed to log alarm: {e}")
