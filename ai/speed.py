import math
import numpy as np

class SpeedEstimator:
    """
    Handles speed calculations, coordinate mapping, and validation.
    Implements Section 6 Speed Calculation Principle:
    1. Directional Velocity Filtering: dy <= 0 -> V = 0; dy > 0 -> Calculate speed
    2. 2D Pixel Displacement: d_px = sqrt((x_t - x_{t-1})^2 + (y_t - y_{t-1})^2)
    3. Meters Conversion (Fallback Scaling): d_meters = d_px * 0.025
    4. Velocity Conversion (km/h): Instant Velocity (V_km/h) = d_meters * FPS * 3.6
    5. Peak Selection: Final Delivery Speed = max(V_1, V_2, ..., V_N)
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
        
        Section 6 Mathematical Formulation:
        1. Directional Velocity Filtering: dy = y_t - y_{t-1}
           If dy <= 0, ball moving away from camera (bat hit) -> Velocity is set to 0.
           If dy > 0, ball coming towards camera -> Calculate speed.
        2. 2D Pixel Displacement: d_px = sqrt((x_t - x_{t-1})^2 + (y_t - y_{t-1})^2)
        3. Meters Conversion: d_meters = d_px * 0.025
        4. Velocity Conversion: Instant Velocity (V_km/h) = d_meters * FPS * 3.6
        """
        dy = p2[1] - p1[1]

        # Step 1: Directional Velocity Filtering
        # If the ball is moving away from the camera (dy <= 0), velocity is set to 0
        if dy <= 0:
            return 0.0, 0.0

        # Step 2: 2D Pixel Displacement
        dx = p2[0] - p1[0]
        pixel_distance = math.sqrt(dx * dx + dy * dy)

        # Filter out tracking teleport spikes or microscopic jitter
        if pixel_distance > self.max_pixel_jump or pixel_distance < 1.0:
            return 0.0, pixel_distance

        # Step 3: Meters Conversion (Perspective matrix H or 0.025 fallback)
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

        # Step 4: Velocity Conversion (km/h)
        # Instant Velocity (V_km/h) = d_meters * FPS * 3.6
        instant_speed = distance * self.fps * 3.6
        return instant_speed, pixel_distance

    def validate_and_smooth(self, instant_speed, pixel_distance, current_smoothed_speed):
        """
        Validate and smooth speed to prevent spikes for video HUD display.
        """
        if pixel_distance < self.max_pixel_jump and instant_speed < 180.0:
            smoothed_speed = (
                current_smoothed_speed * self.smoothing_factor +
                instant_speed * (1.0 - self.smoothing_factor)
            )
            return smoothed_speed, True
        return current_smoothed_speed, False

