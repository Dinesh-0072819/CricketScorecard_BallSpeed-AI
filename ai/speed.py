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
        Calculates instantaneous speed in km/h between two consecutive tracking coordinates.
        Uses full 2D displacement (dx, dy) supporting all camera angles:
        - Bowler's end (towards batsman / camera)
        - Batsman's end (towards bowler / away from camera)
        - Side-on / square-pitch angles
        """
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]

        pixel_distance = math.sqrt(dx * dx + dy * dy)
        if pixel_distance < 1.0:
            return 0.0, 0.0

        # Primary reliable distance calculation (pixel-to-meter scaling)
        distance = pixel_distance * self.pixel_to_meter

        if H is not None:
            world_p1 = self.pixel_to_world(p1, H)
            world_p2 = self.pixel_to_world(p2, H)
            if world_p1 is not None and world_p2 is not None:
                w_dx = world_p2[0] - world_p1[0]
                w_dy = world_p2[1] - world_p1[1]
                w_dist = math.sqrt(w_dx * w_dx + w_dy * w_dy)
                w_speed = w_dist * self.fps * 3.6
                if 15.0 <= w_speed <= 165.0:
                    distance = w_dist

        # instant speed = distance (m) * fps * 3.6 (conversion to km/h)
        instant_speed = distance * self.fps * 3.6
        return instant_speed, pixel_distance

    def validate_and_smooth(self, instant_speed, pixel_distance, current_smoothed_speed):
        """
        Validate and smooth speed to prevent spikes.
        """
        if instant_speed <= 0.0:
            return current_smoothed_speed, False

        if pixel_distance < self.max_pixel_jump and instant_speed < 180.0:
            smoothed_speed = (
                current_smoothed_speed * self.smoothing_factor +
                instant_speed * (1.0 - self.smoothing_factor)
            )
            return smoothed_speed, True
        return current_smoothed_speed, False
