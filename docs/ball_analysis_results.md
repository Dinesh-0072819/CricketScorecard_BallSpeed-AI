# CricSpeed AI: Ball Movement Analysis – Validation & Evaluation Report

## 1. Executive Summary
- **Total Deliveries Evaluated**: 13
- **Overall Classification Accuracy**: **100.0%** (13/13)
- **Turn Angle Mean Absolute Error (MAE)**: **0.18°**
- **Turn Angle Root Mean Square Error (RMSE)**: **0.23°**

## 2. Confusion Matrix

Rows represent **Ground Truth** classes; columns represent **Predicted** classes.

| Actual \ Predicted | OFF_SPIN | LEG_SPIN | INSWING | OUTSWING | STRAIGHT | Total |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **OFF_SPIN** | 3 | 0 | 0 | 0 | 0 | **3** |
| **LEG_SPIN** | 0 | 3 | 0 | 0 | 0 | **3** |
| **INSWING** | 0 | 0 | 2 | 0 | 0 | **2** |
| **OUTSWING** | 0 | 0 | 0 | 2 | 0 | **2** |
| **STRAIGHT** | 0 | 0 | 0 | 0 | 3 | **3** |

## 3. Per-Class Precision & Recall

| Delivery Type | Precision | Recall | F1-Score |
| :--- | :---: | :---: | :---: |
| **OFF_SPIN** | 100.0% | 100.0% | 100.0% |
| **LEG_SPIN** | 100.0% | 100.0% | 100.0% |
| **INSWING** | 100.0% | 100.0% | 100.0% |
| **OUTSWING** | 100.0% | 100.0% | 100.0% |
| **STRAIGHT** | 100.0% | 100.0% | 100.0% |

## 4. Detailed Sample Predictions

| Clip / Test Case | Batsman Hand | True Class | Pred Class | True Turn (°) | Pred Turn (°) | Error (°) | Status |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `clip_offspin_rhb_01.mp4` | RIGHT | `OFF_SPIN` | `OFF_SPIN` | 3.8° | 3.8° | 0.04° | ✅ PASS |
| `clip_offspin_rhb_02.mp4` | RIGHT | `OFF_SPIN` | `OFF_SPIN` | 4.5° | 4.5° | 0.05° | ✅ PASS |
| `clip_offspin_lhb_01.mp4` | LEFT | `OFF_SPIN` | `OFF_SPIN` | 3.2° | 3.1° | 0.08° | ✅ PASS |
| `clip_legspin_rhb_01.mp4` | RIGHT | `LEG_SPIN` | `LEG_SPIN` | 4.2° | 4.0° | 0.15° | ✅ PASS |
| `clip_legspin_rhb_02.mp4` | RIGHT | `LEG_SPIN` | `LEG_SPIN` | 5.1° | 5.0° | 0.05° | ✅ PASS |
| `clip_legspin_lhb_01.mp4` | LEFT | `LEG_SPIN` | `LEG_SPIN` | 3.9° | 3.8° | 0.06° | ✅ PASS |
| `clip_inswing_rhb_01.mp4` | RIGHT | `INSWING` | `INSWING` | 0.4° | 0.1° | 0.33° | ✅ PASS |
| `clip_inswing_lhb_01.mp4` | LEFT | `INSWING` | `INSWING` | 0.3° | 0.2° | 0.09° | ✅ PASS |
| `clip_outswing_rhb_01.mp4` | RIGHT | `OUTSWING` | `OUTSWING` | 0.5° | 0.1° | 0.41° | ✅ PASS |
| `clip_outswing_lhb_01.mp4` | LEFT | `OUTSWING` | `OUTSWING` | 0.4° | 0.1° | 0.28° | ✅ PASS |
| `clip_straight_seam_01.mp4` | RIGHT | `STRAIGHT` | `STRAIGHT` | 0.2° | 0.1° | 0.15° | ✅ PASS |
| `clip_straight_spin_01.mp4` | RIGHT | `STRAIGHT` | `STRAIGHT` | 0.6° | 0.1° | 0.50° | ✅ PASS |
| `clip_straight_lhb_01.mp4` | LEFT | `STRAIGHT` | `STRAIGHT` | 0.3° | 0.2° | 0.10° | ✅ PASS |

## 5. Identified Failure Modes
1. **Borderline Spin Thresholds (1.3° – 1.6°)**: Deliveries with turn near `TURN_MIN_DEG` (1.5°) can occasionally be categorized as `STRAIGHT` due to sub-pixel tracking jitter.
2. **Late Inswing vs. Off-Cutter**: Fast deliveries that deviate both in the air and off the pitch require strict speed thresholding (`SPIN_SPEED_MAX` = 110.0 km/h) to avoid misclassifying fast off-cutters as spin.
3. **Short Pitch Tracks (< 4m pre-bounce)**: If the bowler's release is occluded or out-of-frame until near the bounce point, pre-bounce linear regression degrees of freedom decrease, lowering confidence.

## 6. Recommendations & Best Practices
1. **Elevated Centered Tripod**: Position the camera at least 1.8m high directly behind the bowler to reduce perspective foreshortening parallax.
2. **60 FPS Video Recording**: At higher delivery speeds (>110 km/h), 60 fps yields twice the trajectory points, improving turn angle precision by ~40%.
3. **Custom Pitch Calibration**: Run `tools/calibrate_pitch.py --profile behind_bowler` on the actual match pitch rather than relying on default coordinates.