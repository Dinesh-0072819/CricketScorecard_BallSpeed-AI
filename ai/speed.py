import math
import numpy as np

class SpeedEstimator:
    """
    Handles speed calculations, coordinate mapping, and validation.
    Restores the exact previous proven speed calculation.
    """
    def __init__(self, fps=30.0, pixel_to_meter=0.025, max_speed_limit=70.0):
        self.fps = fps
        self.pixel_to_meter = pixel_to_meter
        self.max_speed_limit = max_speed_limit
        self.smoothing_factor = 0.75
        self.max_pixel_jump = 120.0

    def pixel_to_world(self, point, H):
        """Map pixel point to real-world ground coordinate (meters) using Homography matrix H."""
        if H is None:
            return None
        try:
            import cv2
            src = np.array(
                [[float(point[0]), float(point[1])]],
                dtype=np.float32
            ).reshape(-1, 1, 2)
            dst = cv2.perspectiveTransform(src, H)
            return (float(dst[0, 0, 0]), float(dst[0, 0, 1]))
        except Exception as e:
            print(f"Homography mapping error: {e}")
            return None

    def calculate_speed(self, p1, p2, H=None):
        """
        Calculates instantaneous speed in km/h between two points.
        p1, p2: (x, y) tuples representing consecutive positions.
        H: Optional perspective Homography matrix.
        Strict rule: calculate only forward delivery movement towards batsman, not backward.
        """
        dy = p2[1] - p1[1]
        dx = p2[0] - p1[0]

        # Ignore sharp backward movement towards bowler (rebound off bat or bowler walkback)
        if dy < -15.0 and abs(dx) < 15.0:
            return 0.0, 0.0

        pixel_distance = math.sqrt(dx * dx + dy * dy)

        if H is not None:
            world_p1 = self.pixel_to_world(p1, H)
            world_p2 = self.pixel_to_world(p2, H)
            if world_p1 is not None and world_p2 is not None:
                w_dx = world_p2[0] - world_p1[0]
                w_dy = world_p2[1] - world_p1[1]
                distance = math.sqrt(w_dx * w_dx + w_dy * w_dy)
            else:
                distance = pixel_distance * self.pixel_to_meter
        else:
            distance = pixel_distance * self.pixel_to_meter

        # instant speed = distance (m) * fps * 3.6 (conversion to km/h)
        instant_speed = distance * self.fps * 3.6
        return instant_speed, pixel_distance

    def validate_and_smooth(self, instant_speed, pixel_distance, current_smoothed_speed):
        """
        Validate and smooth speed to prevent single-frame noise spikes.
        Calculates purely based on genuine physical ball velocity for all delivery types
        (e.g. spin at 60 km/h, medium pace at 84 km/h, fast bowling at 100-140 km/h).
        """
        if pixel_distance < self.max_pixel_jump and 10.0 <= instant_speed <= 180.0:
            if current_smoothed_speed <= 0.0 or current_smoothed_speed < 10.0:
                smoothed_speed = instant_speed
            else:
                smoothed_speed = (
                    current_smoothed_speed * self.smoothing_factor +
                    instant_speed * (1.0 - self.smoothing_factor)
                )
            return smoothed_speed, True
        return current_smoothed_speed, False
