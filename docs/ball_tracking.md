# Ball detection, speed and deviation (v3)

## Why detection was failing
1. **Wrong input scale.** `tennis_ball_detector` was trained at `imgsz=1280`, but the ONNX
   export is 640x640 and the whole frame was squeezed into it. The ball shrank to 4-7 px and
   was missed (max confidence ~0.2 during flight).
   *Fix:* `ai/ball_detector.py` resizes the frame to the training scale (long side 1280) and
   runs the model on 640x640 tiles / crops. Flight confidence is now 0.5-0.8.
2. **Roboflow errors were swallowed.** With `USE_ROBOFLOW_CLOUD=true`, any API failure (key,
   credits, workflow name) produced empty detections for every frame and the local model was
   never used. *Fix:* `ai/roboflow_client.py` reports errors; `ai/ball_search.py` falls back to
   the local model automatically. `ROBOFLOW_WORKFLOW` is now actually used.
3. **Live camera crashed** (`video_processor.model` is `None` when the ONNX engine loads).
   *Fix:* `VideoProcessor.detect_live()`.

## Pipeline
| Step | File | What it does |
|---|---|---|
| Search | `ai/ball_search.py` | tiled search every 2-4 frames, ROI crop on the moving ball every frame, zoomed backfill to recover the release frames |
| Track | `ai/trajectory.py` | links detections, drops static balls on the grass, picks the delivery (not the shot), trims release -> bat |
| Analyse | `ai/delivery_analysis.py` | speed, bounce, swing, spin |
| Render | `ai/video_processor.py` | overlay video (trail, bounce marker, HUD) |

## Speed
`speed = (pitch_length - 2 x 1.22 m) / flight_time`

Flight time = release frame -> bat/stumps frame, using the real frame timestamps
(phone videos are variable-fps). **Set the pitch length (stump to stump) for your ground** in
the upload form, or with the `PITCH_LENGTH_M` env var (default 20.12 m = 22 yards). The result
is the average speed over the flight; a speed gun shows release speed (~8-12% higher).
Accuracy: +/-1 frame at each end, so about +/-5% at 60 fps.

## Swing / spin
The ball's apparent size gives metres-per-pixel at its depth, so sideways movement is measured
in metres. The along-pitch distance comes from time. Deviation is measured relative to the
delivery line, so camera offset and angle cancel out.
* **Swing** = sideways curve in the air before the bounce (threshold `SWING_MIN_M`, 8 cm)
* **Spin** = change of direction at the bounce (threshold `TURN_MIN_DEG`, 2.0 deg)
* Right-handed batsman: towards leg = INSWING / OFF_SPIN, away = OUTSWING / LEG_SPIN; mirrored for left-handers.

Best camera position: behind the batsman's stumps, in line with the pitch, phone upright, 60 fps.

Validated with `tests/test_ball_analysis.py` (physics simulation projected through a phone
camera, including camera offset, bowler-end camera and focal-length error).
