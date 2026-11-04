"""
Ball detector for CricSpeedAI.

Why this exists
---------------
The tennis-ball YOLOv8n model was trained at imgsz=1280 but exported to ONNX at
640x640. Feeding a whole 1280x720 frame into 640 shrinks the ball to 4-7 px, so
the model mostly missed it (max confidence ~0.2 during flight). Here the frame
is resized to the training scale (long side 1280) and the model runs on
640x640 tiles / crops of that, so the ball has the same pixel size the model
was trained on. Confidence during flight goes up to ~0.6-0.8 and the delivery
is tracked almost frame-by-frame.

Backends, in order of preference:
  1. onnxruntime     (fastest on CPU)
  2. OpenCV DNN      (no extra dependency)
  3. Ultralytics .pt (heavy, last resort)
Roboflow hosted inference is handled separately in roboflow_client.py.

A detection is [cx, cy, w, h, conf] in original-frame pixels.
"""
import json
import os
from typing import List, Optional, Sequence

import cv2
import numpy as np

TILE = 640


def _default_threads() -> int:
    """Use the CPU cores (capped at 4 - more gives little for one 640 tile)."""
    env = os.getenv("ORT_THREADS")
    if env:
        return max(1, int(env))
    return max(1, min(4, os.cpu_count() or 1))


def _nms(dets: List[List[float]], iou: float = 0.4, conf: float = 0.0) -> List[List[float]]:
    if not dets:
        return []
    arr = np.asarray(dets, dtype=np.float32)
    boxes = np.c_[arr[:, 0] - arr[:, 2] / 2, arr[:, 1] - arr[:, 3] / 2, arr[:, 2], arr[:, 3]]
    keep = cv2.dnn.NMSBoxes(boxes.tolist(), arr[:, 4].tolist(), conf, iou)
    keep = np.array(keep).flatten() if len(keep) else []
    return [arr[i].tolist() for i in keep]


def _tile_starts(length: int, tile: int = TILE) -> List[int]:
    """Fewest tiles that cover `length` (evenly spread, overlap whatever is left over)."""
    if length <= tile:
        return [0]
    n = int(np.ceil(length / float(tile)))
    n = max(2, n)
    return [int(round(i * (length - tile) / (n - 1))) for i in range(n)]


class BallDetector:
    def __init__(self, weights_dir: str = "weights", train_long_side: Optional[int] = None):
        self.backend = None
        self.session = None
        self.net = None
        self.model = None
        self.input_name = "images"

        onnx_path = os.path.join(weights_dir, "tennis_ball_detector.onnx")
        pt_path = os.path.join(weights_dir, "tennis_ball_detector.pt")

        # Scale the frame so the ball has the size it had during training
        self.train_long_side = train_long_side or self._read_train_imgsz(weights_dir) or 1280
        self.train_long_side = int(os.getenv("BALL_DETECT_LONG_SIDE", self.train_long_side))

        if os.path.exists(onnx_path) and os.path.getsize(onnx_path) > 100_000:
            try:
                import onnxruntime as ort

                so = ort.SessionOptions()
                so.intra_op_num_threads = _default_threads()
                so.inter_op_num_threads = 1
                so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                providers = ["CPUExecutionProvider"]
                avail = ort.get_available_providers()
                # Apple Silicon / Mac: CoreML runs the model on the GPU / Neural Engine
                if "CoreMLExecutionProvider" in avail and os.getenv("USE_COREML", "false").lower() == "true":
                    providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
                if "CUDAExecutionProvider" in avail:
                    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
                try:
                    self.session = ort.InferenceSession(onnx_path, so, providers=providers)
                    self.session.run(None, {self.session.get_inputs()[0].name:
                                            np.zeros((1, 3, TILE, TILE), np.float32)})
                except Exception as e:
                    print(f"[BallDetector] {providers[0]} failed ({e}); using CPU")
                    self.session = ort.InferenceSession(onnx_path, so, providers=["CPUExecutionProvider"])
                self.input_name = self.session.get_inputs()[0].name
                self.providers = self.session.get_providers()
                self.backend = "onnxruntime"
            except Exception as e:  # onnxruntime missing or failed
                print(f"[BallDetector] onnxruntime unavailable ({e}); trying OpenCV DNN")
            if self.backend is None:
                try:
                    self.net = cv2.dnn.readNetFromONNX(onnx_path)
                    self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
                    self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
                    self.backend = "opencv-dnn"
                except Exception as e:
                    print(f"[BallDetector] OpenCV DNN failed to load ONNX ({e})")

        if self.backend is None and os.path.exists(pt_path):
            from ultralytics import YOLO

            self.model = YOLO(pt_path)
            self.backend = "ultralytics"

        if self.backend is None:
            raise RuntimeError("No ball detection model found in weights/ (need tennis_ball_detector.onnx or .pt)")
        print(f"[BallDetector] backend={self.backend} providers={getattr(self, 'providers', '-')} "
              f"threads={_default_threads()} train_long_side={self.train_long_side}")

    @staticmethod
    def _read_train_imgsz(weights_dir: str) -> Optional[int]:
        try:
            with open(os.path.join(weights_dir, "model_artifacts.json")) as f:
                return int(json.load(f)["args"]["imgsz"])
        except Exception:
            return None

    # ------------------------------------------------------------------ core
    def _infer_tile(self, tile_bgr: np.ndarray, conf: float) -> np.ndarray:
        """Run the model on one 640x640 BGR tile. Returns Nx5 (cx, cy, w, h, conf) in tile pixels."""
        if self.backend == "ultralytics":
            res = self.model.predict(source=tile_bgr, imgsz=TILE, conf=conf, iou=0.4, verbose=False)
            out = []
            for r in res:
                if r.boxes is None:
                    continue
                for b in r.boxes:
                    x1, y1, x2, y2 = b.xyxy[0].tolist()
                    out.append([(x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1, float(b.conf[0])])
            return np.asarray(out, dtype=np.float32).reshape(-1, 5)

        blob = cv2.dnn.blobFromImage(tile_bgr, 1 / 255.0, (TILE, TILE), swapRB=True, crop=False)
        if self.backend == "onnxruntime":
            pred = self.session.run(None, {self.input_name: blob})[0]
        else:
            self.net.setInput(blob)
            pred = self.net.forward()
        pred = pred[0].T  # (8400, 4 + nc)
        scores = pred[:, 4:].max(axis=1)
        keep = scores >= conf
        p = pred[keep]
        return np.c_[p[:, :4], scores[keep]].astype(np.float32)

    def _scale(self, frame: np.ndarray) -> float:
        h, w = frame.shape[:2]
        return self.train_long_side / float(max(h, w))

    def _resized(self, frame: np.ndarray, zoom: float = 1.0):
        s = self._scale(frame) * zoom
        h, w = frame.shape[:2]
        interp = cv2.INTER_LINEAR if s > 1 else cv2.INTER_AREA
        img = cv2.resize(frame, (int(round(w * s)), int(round(h * s))), interpolation=interp)
        return img, s

    @staticmethod
    def _filter(dets: List[List[float]], frame_shape) -> List[List[float]]:
        """Drop boxes that cannot be a ball (too big / too elongated)."""
        h, w = frame_shape[:2]
        max_size = 0.06 * max(h, w)
        out = []
        for d in dets:
            bw, bh = d[2], d[3]
            if bw <= 1 or bh <= 1 or max(bw, bh) > max_size:
                continue
            if max(bw, bh) / min(bw, bh) > 2.2:
                continue
            out.append(d)
        return out

    # --------------------------------------------------------------- public
    def detect_tiled(self, frame: np.ndarray, conf: float = 0.15) -> List[List[float]]:
        """Full-frame search at training scale using overlapping 640 tiles."""
        img, s = self._resized(frame)
        H, W = img.shape[:2]
        pad = cv2.copyMakeBorder(img, 0, max(0, TILE - H), 0, max(0, TILE - W),
                                 cv2.BORDER_CONSTANT, value=(114, 114, 114))
        dets = []
        for y0 in _tile_starts(max(H, TILE)):
            for x0 in _tile_starts(max(W, TILE)):
                for cx, cy, bw, bh, c in self._infer_tile(pad[y0:y0 + TILE, x0:x0 + TILE], conf):
                    dets.append([(cx + x0) / s, (cy + y0) / s, bw / s, bh / s, float(c)])
        return self._filter(_nms(dets), frame.shape)

    def detect_roi(self, frame: np.ndarray, center: Sequence[float], conf: float = 0.10,
                   zoom: float = 1.0) -> List[List[float]]:
        """
        Run one 640 crop centred on an expected ball position. zoom > 1 enlarges
        the image beyond training scale, which recovers tiny far-away balls
        (e.g. just after release).
        """
        img, s = self._resized(frame, zoom)
        H, W = img.shape[:2]
        cx, cy = center[0] * s, center[1] * s
        x0 = int(np.clip(cx - TILE / 2, 0, max(0, W - TILE)))
        y0 = int(np.clip(cy - TILE / 2, 0, max(0, H - TILE)))
        crop = img[y0:y0 + TILE, x0:x0 + TILE]
        if crop.shape[0] < TILE or crop.shape[1] < TILE:
            crop = cv2.copyMakeBorder(crop, 0, TILE - crop.shape[0], 0, TILE - crop.shape[1],
                                      cv2.BORDER_CONSTANT, value=(114, 114, 114))
        dets = [[(a + x0) / s, (b + y0) / s, bw / s, bh / s, float(c)]
                for a, b, bw, bh, c in self._infer_tile(crop, conf)]
        return self._filter(_nms(dets), frame.shape)

    def detect_fast(self, frame: np.ndarray, conf: float = 0.15, last_pos=None) -> List[List[float]]:
        """
        Low-latency detection for the live camera: a single crop around the last
        known ball position if we have one, otherwise a full tiled search.
        """
        if last_pos is not None:
            d = self.detect_roi(frame, last_pos, conf)
            if d:
                return d
        return self.detect_tiled(frame, conf)
