import json
import os
import numpy as np

class CalibrationManager:
    """
    Manages loading, saving, and applying perspective calibration parameters.
    """
    def __init__(self, config_path="config_calibration.json"):
        self.config_path = config_path

    def save_calibration(self, image_points, real_world_points, H):
        """Save point mappings and homography matrix to file."""
        data = {
            "image_points": image_points,
            "real_world_points": real_world_points,
            "H": H.tolist() if H is not None else None
        }
        try:
            # Ensure config parent directories exist if needed
            parent = os.path.dirname(self.config_path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(self.config_path, "w") as f:
                json.dump(data, f, indent=4)
            return True
        except Exception as e:
            print(f"Error saving calibration config: {e}")
            return False

    def load_calibration(self):
        """Load point mappings and homography matrix from file."""
        if not os.path.exists(self.config_path):
            return None, None, None
        try:
            with open(self.config_path, "r") as f:
                data = json.load(f)
            image_points = data.get("image_points")
            real_world_points = data.get("real_world_points")
            H_list = data.get("H")
            H = np.array(H_list, dtype=np.float32) if H_list is not None else None
            return image_points, real_world_points, H
        except Exception as e:
            print(f"Error loading calibration config: {e}")
            return None, None, None
