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
import collections
import threading
import concurrent.futures
import os
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import requests


def _find_predictions(obj, img_wh=None) -> List[Tuple[dict, Optional[Tuple[float, float]]]]:
    """
    Recursively collect prediction dicts (x, y, width, height, confidence) from any
    response shape (plain model endpoint or any workflow output layout).
    Each prediction is returned with the (width, height) of the image its
    coordinates refer to, when the response says so (Roboflow puts an
    "image": {"width", "height"} next to every "predictions" list). A workflow
    that resizes or crops the frame returns coordinates in *that* image, so the
    caller needs this to map them back.
    """
    found = []
    if isinstance(obj, dict):
        im = obj.get("image")
        if isinstance(im, dict) and isinstance(im.get("width"), (int, float)) and isinstance(im.get("height"), (int, float)):
            img_wh = (float(im["width"]), float(im["height"]))
        if all(k in obj for k in ("x", "y", "width", "height")) and not isinstance(obj.get("x"), (dict, list)):
            found.append((obj, img_wh))
        else:
            for k, v in obj.items():
                if k == "image":
                    continue
                found += _find_predictions(v, img_wh)
    elif isinstance(obj, list):
        for v in obj:
            found += _find_predictions(v, img_wh)
    return found


def _shape(obj, depth=0):
    """Short description of a JSON response layout, for the logs."""
    if depth > 3:
        return "..."
    if isinstance(obj, dict):
        return "{" + ", ".join(f"{k}: {_shape(v, depth + 1)}" for k, v in list(obj.items())[:8]) + "}"
    if isinstance(obj, list):
        return f"[{len(obj)}x {_shape(obj[0], depth + 1) if obj else ''}]"
    if isinstance(obj, str):
        return "str" if len(obj) > 40 else repr(obj)
    return type(obj).__name__


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
        self._lock = threading.Lock()
        self.reset_stats()

    # ------------------------------------------------------------- diagnostics
    def reset_stats(self):
        with getattr(self, "_lock", threading.Lock()):
            self.class_stats = collections.OrderedDict()   # class -> [count, max_conf, max_box_px]
            self.response_shape = None

    def _note(self, cls, conf, box):
        with self._lock:
            st = self.class_stats.setdefault(cls, [0, 0.0, 0.0])
            st[0] += 1
            st[1] = max(st[1], conf)
            st[2] = max(st[2], box)

    def stats_text(self) -> str:
        if not self.class_stats:
            return "no objects at all"
        return ", ".join(f"'{c}' x{n} (max conf {mc:.2f}, max size {mb:.0f}px)"
                         for c, (n, mc, mb) in self.class_stats.items())

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
        h, w = frame.shape[:2]
        return self.detect_encoded(b64, s, (int(w * s) if s < 1 else w, int(h * s) if s < 1 else h))

    def detect_encoded(self, b64: str, s: float, sent_wh: Optional[Tuple[int, int]] = None
                       ) -> Tuple[Optional[List[List[float]]], Optional[str]]:
        """Same as detect_frame for an image that is already JPEG+base64 encoded at scale s.
        sent_wh = (width, height) of the encoded image, used to undo any resize the workflow does."""
        try:
            r = self._post(b64)
        except Exception as e:
            return None, f"{type(e).__name__}: {e}"
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}: {r.text[:160]}"
        try:
            js = r.json()
            preds = _find_predictions(js)
        except Exception as e:
            return None, f"Bad JSON: {e}"
        if self.response_shape is None:
            self.response_shape = _shape(js)
            print(f"[Roboflow] response layout: {self.response_shape[:600]}")

        # a multi-class model / workflow: keep only the ball class when there is one
        names = [str(p.get("class", p.get("class_name", "")) or "") for p, _ in preds]
        has_ball_class = any("ball" in n.lower() for n in names)

        dets = []
        for (p, img_wh), name in zip(preds, names):
            try:
                x, y, w, h = float(p["x"]), float(p["y"]), float(p["width"]), float(p["height"])
            except (TypeError, ValueError):
                continue
            conf = float(p.get("confidence", 0.5) or 0.0)
            if conf > 1.0:                       # percent
                conf /= 100.0
            # coordinates in a different image than the one we sent -> rescale
            fx = fy = 1.0
            if sent_wh and img_wh and img_wh[0] > 0 and img_wh[1] > 0:
                fx, fy = sent_wh[0] / img_wh[0], sent_wh[1] / img_wh[1]
            elif sent_wh and max(x, y, w, h) <= 1.5:   # normalised 0..1 coordinates
                fx, fy = float(sent_wh[0]), float(sent_wh[1])
            x, w, y, h = x * fx, w * fx, y * fy, h * fy
            self._note(name or "?", conf, max(w, h) / s)
            if has_ball_class and "ball" not in name.lower():
                continue
            dets.append([x / s, y / s, w / s, h / s, conf])
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
