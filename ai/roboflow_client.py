"""
Roboflow hosted inference (optional).

Enabled with env vars:
  USE_ROBOFLOW_CLOUD=true
  ROBOFLOW_API_KEY=...
  ROBOFLOW_WORKSPACE=cricspeed-ai
  ROBOFLOW_WORKFLOW=<workflow id>          (workflow endpoint), or
  ROBOFLOW_MODEL=<project>/<version>       (plain model endpoint, e.g. tennis-ball-xyz/3)

The previous implementation swallowed every error: when the key / credits /
workflow name failed, every frame came back with zero detections and the local
model was never used, so "ball detection failed". This client reports health so
the caller can fall back to the local detector.
"""
import base64
import concurrent.futures
import os
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import requests


def _find_predictions(obj) -> List[dict]:
    """Recursively collect prediction dicts (x, y, width, height, confidence) from any response shape."""
    found = []
    if isinstance(obj, dict):
        if all(k in obj for k in ("x", "y", "width", "height")):
            found.append(obj)
        else:
            for v in obj.values():
                found += _find_predictions(v)
    elif isinstance(obj, list):
        for v in obj:
            found += _find_predictions(v)
    return found


class RoboflowClient:
    def __init__(self):
        self.enabled = os.getenv("USE_ROBOFLOW_CLOUD", "false").lower().strip() == "true"
        self.api_key = os.getenv("ROBOFLOW_API_KEY", "").strip()
        self.workspace = os.getenv("ROBOFLOW_WORKSPACE", "").strip() or "cricspeed-ai"
        self.workflow = (os.getenv("ROBOFLOW_WORKFLOW", "").strip()
                         or os.getenv("ROBOFLOW_PROJECT", "").strip()
                         or "cricket-ball-detector-vcricket-ball-detector-logic")
        self.model = os.getenv("ROBOFLOW_MODEL", "").strip()  # "project/version"
        self.long_side = int(os.getenv("ROBOFLOW_IMAGE_LONG_SIDE", "1280"))
        self.jpeg_quality = int(os.getenv("ROBOFLOW_JPEG_QUALITY", "80"))
        self.workers = int(os.getenv("ROBOFLOW_WORKERS", "8"))
        self.session = requests.Session()
        self.last_error: Optional[str] = None
        self.active = self.enabled and bool(self.api_key)

    @property
    def status(self) -> str:
        if not self.enabled:
            return "Disabled (local engine active)"
        if not self.api_key:
            return "Enabled but ROBOFLOW_API_KEY is empty (local engine active)"
        return f"Ready ({'model ' + self.model if self.model else 'workflow ' + self.workflow})" + (
            f" | last error: {self.last_error}" if self.last_error else "")

    def _encode(self, frame: np.ndarray) -> Tuple[str, float]:
        h, w = frame.shape[:2]
        s = min(1.0, self.long_side / float(max(h, w)))
        img = frame if s >= 1.0 else cv2.resize(frame, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
        ok, enc = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
        return base64.b64encode(enc).decode("ascii"), s

    def _post(self, b64: str):
        if self.model:
            url = f"https://detect.roboflow.com/{self.model}"
            r = self.session.post(url, params={"api_key": self.api_key, "confidence": 10, "overlap": 40},
                                  data=b64, headers={"Content-Type": "application/x-www-form-urlencoded"},
                                  timeout=15)
        else:
            url = f"https://serverless.roboflow.com/infer/workflows/{self.workspace}/{self.workflow}"
            r = self.session.post(url, json={"api_key": self.api_key,
                                             "inputs": {"image": {"type": "base64", "value": b64}}},
                                  timeout=15)
        return r

    def detect_frame(self, frame: np.ndarray) -> Tuple[Optional[List[List[float]]], Optional[str]]:
        """Returns (detections, error). detections is None when the request failed."""
        b64, s = self._encode(frame)
        return self.detect_encoded(b64, s)

    def detect_encoded(self, b64: str, s: float) -> Tuple[Optional[List[List[float]]], Optional[str]]:
        """Same as detect_frame for an image that is already JPEG+base64 encoded at scale s."""
        try:
            r = self._post(b64)
        except Exception as e:
            return None, f"{type(e).__name__}: {e}"
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}: {r.text[:160]}"
        try:
            preds = _find_predictions(r.json())
        except Exception as e:
            return None, f"Bad JSON: {e}"
        dets = []
        for p in preds:
            conf = float(p.get("confidence", 0.5))
            dets.append([p["x"] / s, p["y"] / s, p["width"] / s, p["height"] / s, conf])
        return dets, None

    def detect_frames(self, frames: Dict[int, np.ndarray], progress=None) -> Tuple[Dict[int, List[List[float]]], float]:
        """
        Parallel inference over many frames.
        Returns (detections per frame, success_ratio). Failed frames are omitted.
        """
        results: Dict[int, List[List[float]]] = {}
        errors = 0
        done = 0
        total = max(1, len(frames))
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.workers) as ex:
            futs = {ex.submit(self.detect_frame, f): i for i, f in frames.items()}
            for fut in concurrent.futures.as_completed(futs):
                i = futs[fut]
                dets, err = fut.result()
                if dets is None:
                    errors += 1
                    self.last_error = err
                else:
                    results[i] = dets
                done += 1
                if progress:
                    progress(done, total)
        ok_ratio = 1.0 - errors / total
        if errors:
            print(f"[Roboflow] {errors}/{total} requests failed. Last error: {self.last_error}")
        return results, ok_ratio
