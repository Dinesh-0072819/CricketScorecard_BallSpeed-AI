import json
import os
import logging
from typing import Tuple, Optional, List, Dict, Any
import numpy as np

logger = logging.getLogger(__name__)


class CalibrationManager:
    """
    Manages loading, saving, and applying perspective calibration parameters
    with multi-profile support (e.g. 'default', 'behind_bowler').
    Backward compatible with single-profile config_calibration.json.
    """
    def __init__(self, config_path: str = "config_calibration.json"):
        self.config_path = config_path

    def _read_data(self) -> Dict[str, Any]:
        if not os.path.exists(self.config_path):
            return {}
        try:
            with open(self.config_path, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error reading calibration file {self.config_path}: {e}")
            return {}

    def _write_data(self, data: Dict[str, Any]) -> bool:
        try:
            parent = os.path.dirname(self.config_path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(self.config_path, "w") as f:
                json.dump(data, f, indent=4)
            return True
        except Exception as e:
            logger.error(f"Error writing calibration file {self.config_path}: {e}")
            return False

    def list_profiles(self) -> List[str]:
        """Returns list of all available calibration profiles."""
        data = self._read_data()
        profiles = list(data.get("profiles", {}).keys())
        if "H" in data and "default" not in profiles:
            profiles.insert(0, "default")
        return profiles if profiles else ["default"]

    def load_calibration(self, profile: str = "default") -> Tuple[Optional[List], Optional[List], Optional[np.ndarray]]:
        """
        Load point mappings and homography matrix from the specified profile.
        Falls back gracefully if profile is missing.
        """
        data = self._read_data()
        if not data:
            return None, None, None

        profile_data = None
        if "profiles" in data and profile in data["profiles"]:
            profile_data = data["profiles"][profile]
        elif profile == "default" or "profiles" not in data:
            # Top-level legacy format
            profile_data = data
        elif "profiles" in data and "default" in data["profiles"]:
            profile_data = data["profiles"]["default"]
        else:
            profile_data = data

        if not profile_data:
            return None, None, None

        image_points = profile_data.get("image_points")
        real_world_points = profile_data.get("real_world_points")
        H_list = profile_data.get("H")
        H = np.array(H_list, dtype=np.float32) if H_list is not None else None
        return image_points, real_world_points, H

    def save_calibration(self, image_points: List, real_world_points: List, H: Optional[np.ndarray], profile: str = "default") -> bool:
        """
        Save point mappings and homography matrix to file under the specified profile.
        Preserves other profiles and updates top-level for backwards compatibility when default.
        """
        data = self._read_data()
        if "profiles" not in data:
            data["profiles"] = {}
            if "H" in data:
                data["profiles"]["default"] = {
                    "image_points": data.get("image_points"),
                    "real_world_points": data.get("real_world_points"),
                    "H": data.get("H")
                }

        profile_entry = {
            "image_points": image_points,
            "real_world_points": real_world_points,
            "H": H.tolist() if H is not None else None
        }

        data["profiles"][profile] = profile_entry
        data["active_profile"] = profile

        # For backwards compatibility, update top-level keys if default profile
        if profile == "default":
            data["image_points"] = image_points
            data["real_world_points"] = real_world_points
            data["H"] = profile_entry["H"]

        return self._write_data(data)
