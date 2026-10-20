import math
import numpy as np

class SpeedEstimator:
    """
    Handles speed calculations, coordinate mapping, and validation.
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

    def pixel_to_ground(
        self,
        point: tuple,
        H: np.ndarray = None,
        frame_width: int = 640,
        frame_height: int = 480
    ) -> tuple[float, float]:
        """
        Adapter converting image pixel coordinates (px, py) to ground coordinates (x_m, y_m)
        expected by delivery analysis:
          - x_m: lateral metres relative to pitch center (+ = image right, - = image left)
          - y_m: metres down the pitch from bowler's stumps (0..20.12)
        Does not alter existing speed calculations or pixel_to_world behavior.
        """
        return pixel_to_ground(point[0], point[1], H=H, frame_width=frame_width, frame_height=frame_height)

    def calculate_speed(self, p1, p2, H=None):
        """
        Calculates instantaneous speed in km/h between two points.
        p1, p2: (x, y) tuples representing consecutive positions.
        H: Optional perspective Homography matrix.
        """
        dy = p2[1] - p1[1]
        
        # If the ball is moving away from the camera (dy <= 0), do not calculate speed
        if dy <= 0:
            return 0.0, 0.0

        dx = p2[0] - p1[0]
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
        Validate and smooth speed to prevent spikes.
        """
        if pixel_distance < self.max_pixel_jump and instant_speed < 180.0:
            smoothed_speed = (
                current_smoothed_speed * self.smoothing_factor +
                instant_speed * (1.0 - self.smoothing_factor)
            )
            return smoothed_speed, True
        return current_smoothed_speed, False


def pixel_to_ground(
    px: float,
    py: float,
    H: np.ndarray = None,
    frame_width: int = 640,
    frame_height: int = 480
) -> tuple[float, float]:
    """
    Adapter converting pixel coordinates (px, py) to ground coordinates (x_m, y_m).
    Convention:
      - x_m: lateral metres relative to pitch center (+ = image right, - = image left)
      - y_m: metres down the pitch from bowler's stumps (0.0 .. 20.12)
    When H is provided, applies homography and normalizes lateral x to be centered (+ = right).
    When H is None, uses geometric projection assuming bowler-behind camera perspective.
    """
    if H is not None:
        try:
            import cv2
            src = np.array([[[float(px), float(py)]]], dtype=np.float32)
            dst = cv2.perspectiveTransform(src, H)
            raw_x = float(dst[0, 0, 0])
            raw_y = float(dst[0, 0, 1])

            # In standard pitch coordinates:
            # If width was mapped 0..3.05m, center is at 1.525m:
            if 0.0 <= raw_x <= 3.05:
                x_m = raw_x - 1.525
            else:
                x_m = raw_x

            # Clamp y to realistic pitch span
            y_m = max(0.0, min(20.12, raw_y))
            return (round(x_m, 3), round(y_m, 3))
        except Exception:
            pass

    # Fallback without homography: camera behind bowler looking down pitch
    # py increases from bowler's end (top) to batsman end (bottom)
    norm_y = max(0.0, min(1.0, float(py) / max(1.0, float(frame_height))))
    y_m = norm_y * 20.12

    # Lateral x centered at frame center (3.05m pitch width)
    norm_x = (float(px) - (float(frame_width) / 2.0)) / max(1.0, float(frame_width))
    x_m = norm_x * 3.05

    return (round(x_m, 3), round(y_m, 3))

