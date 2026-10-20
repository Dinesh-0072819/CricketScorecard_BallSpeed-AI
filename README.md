# CricSpeed AI 🏏⚡

**CricSpeed AI** is a professional, full-stack cricket delivery tracking, speed measurement, and movement analytics platform powered by YOLOv8, ByteTracker, OpenCV homography mapping, and a reactive React 18 / Vite dark glassmorphic dashboard.

---

## 🚀 Key Features

- **Live Speed Radar**: Real-time ball detection and speed estimation in km/h.
- **Ball Movement Analysis (New)**: Detects bounce position, measures turn angle off the pitch (°), calculates in-air swing deviation (cm), and categorizes length (Yorker, Full, Good, Short) and line (Outside Off, Off Stump, Middle, Leg, Down Leg).
- **Explainable AI (XAI)**: Understand why a ball was classified as Off Spin, Leg Spin, Inswing, Outswing, or Straight with pre/post bounce angles, physics reasons, and confidence scoring.
- **Interactive Pitch Map**: Responsive SVG representation of the pitch marking bounce locations color-coded by delivery type.
- **Dynamic Scorecard Integration**: Automatically links fresh delivery movement metrics to the live scorecard ball-by-ball log.
- **Calibration Profiles**: Supports multiple camera configurations (e.g., `behind_bowler`, `default`) with 4-point homography projection.

---

## 🔬 Ball Analysis: How It Works

### 1. Overview
The Ball Movement Analysis engine analyzes deliveries using single-camera monocular computer vision positioned behind the bowler looking down the pitch towards the batsman ($20.12\text{ m}$ pitch length):

1. **Trajectory Buffering**: Balls tracked for $\ge 3$ consecutive frames are captured into an active trajectory buffer storing $(x, y, p_x, p_y, t)$.
2. **Track Cleaning (`ai/track_cleaning.py`)**:
   - Deduplicates and chronologically sorts detections.
   - Rejects velocity/kinematic outliers ($> 85\text{ m/s}$ or $> 1.2\text{ m}$ lateral jumps) using Median Absolute Deviation (MAD).
   - Linearly interpolates short detection dropouts ($\le 2$ frames).
   - Validates directional advancement ($y \approx 0 \to 20\text{ m}$) and rejects return throws.
   - Automatically truncates batting rebounds at peak $y$.
3. **Kinematic Bounce Detection**: Finds the trajectory inflection point where downward image motion $p_y$ inverts as the ball rebounds upward from the pitch surface.
4. **Turn Angle & Swing Calculation**:
   - Fits linear polynomials to pre-bounce and post-bounce ground paths ($x = m \cdot y + c$).
   - Computes angular deflection: $\theta_{\text{turn}} = |\theta_{\text{post}} - \theta_{\text{pre}}|$.
   - Computes maximum lateral swing deviation from chord line during airborne flight.
5. **Batsman-Centric Handedness**:
   - Spin labels are defined relative to the batsman's perspective.
   - Turn towards the leg side = `OFF_SPIN`; turn towards the off side = `LEG_SPIN`.
   - Selecting **Left-Handed Batsman (LHB)** automatically flips lateral labels to preserve cricket correctness.

---

## 📷 Camera Setup Guidelines

For optimal trajectory capture and movement accuracy:
1. **Mount Position**: Directly behind the bowler's stumps looking straight down the pitch toward the batsman's stumps.
2. **Elevation**: Mount the camera as high as safely feasible ($1.8\text{--}2.5\text{ m}$ tripod recommended) angled slightly downward to provide a clear view of the pitch surface and crease lines.
3. **Framing**: Keep both the bowling crease and the popping crease visible within the frame.
4. **Frame Rate**: **60 fps** is strongly recommended for bowling speeds above $90\text{ km/h}$; 30 fps is supported for spin bowling.
5. **Lighting**: Ensure even pitch illumination to minimize ball motion blur and shadows.

---

## 📐 Calibration Steps

CricSpeed AI maps 2D image coordinates to ground-plane metres ($x \in [-1.5, 1.5]\text{ m}$, $y \in [0.0, 20.12]\text{ m}$) using a planar homography matrix ($H$):

1. Run the interactive calibration utility:
   ```bash
   python tools/calibrate_pitch.py --profile behind_bowler
   ```
2. Click the 4 reference corners of the pitch in order:
   - **Point 1**: Bowler crease - Left edge ($x = -1.52\text{ m}, y = 0.0\text{ m}$)
   - **Point 2**: Bowler crease - Right edge ($x = +1.52\text{ m}, y = 0.0\text{ m}$)
   - **Point 3**: Batsman popping crease - Right edge ($x = +1.52\text{ m}, y = 20.12\text{ m}$)
   - **Point 4**: Batsman popping crease - Left edge ($x = -1.52\text{ m}, y = 20.12\text{ m}$)
3. Calibration is saved to `config_calibration.json` under profile `"behind_bowler"`.

---

## ⚙️ Tunable Constants (`config.py`)

All movement analysis tunables are centralized in [config.py](file:///Users/dinesh/Documents/CricSpeedAI/config.py):

| Constant | Default | Description |
| :--- | :--- | :--- |
| `ENABLE_BALL_ANALYSIS` | `True` | Master feature flag. When `False`, reverts to legacy speed-only mode. |
| `TURN_MIN_DEG` | `1.5` | Minimum off-pitch turn angle (degrees) required to classify as spin. |
| `SWING_MIN_M` | `0.05` | Minimum in-air lateral deviation (metres / 5 cm) to classify as swing. |
| `SPIN_SPEED_MAX` | `110.0` | Bowling speed ceiling (km/h) differentiating spinners from seamers. |
| `LOST_FRAMES_N` | `8` | Number of consecutive missing frames before completing a delivery track. |
| `OVERLAY_HOLD_SECONDS`| `4.0` | Duration (seconds) to display post-delivery analysis HUD overlay on video. |
| `ANALYSIS_MAX_AGE_SECONDS` | `60.0` | Maximum age (seconds) to auto-attach delivery analysis to scorecard balls. |
| `MIN_TRACK_POINTS` | `6` | Minimum clean tracking observations required to accept a delivery. |
| `MIN_PITCH_SPAN_M` | `3.0` | Minimum longitudinal distance (metres) ball must travel down the pitch. |

---

## 🔌 API Endpoints & Fields

### Core Endpoints
- **`POST /upload`**: Process an uploaded cricket video. Accepts `batsman_hand` (`"RIGHT"` or `"LEFT"`) and `profile`. Returns `delivery_analysis` alongside speed metrics.
- **`POST /process_frame`**: Process live camera stream frame. Accepts base64 image and `batsman_hand`.
- **`POST /api/match/ball`**: Record a ball in the match scorecard with optional delivery movement parameters (`delivery_type`, `spin_type`, `turn_angle_deg`, `swing_cm`, `bounce_x`, `bounce_y`, `length`, `line`, `analysis_confidence`).
- **`GET /api/match/deliveries?match_id=<id>`**: Returns list of all analysed deliveries with bounce coordinates for pitch map visualization.
- **`GET /api/bowler/analysis?match_id=<id>&bowler=<name>`**: Aggregates bowler performance (total balls analysed, avg turn angle, spin vs. swing breakdown, length distributions, avg speed).
- **`GET /api/analysis/latest`**: Returns the most recent delivery analysis cached in the session with timestamp and age.
- **`POST /api/analysis/discard`**: Manually discards cached analysis before scoring.
- **`GET /api/calibration/profiles`**: Returns list of all available homography profiles.
- **`POST /api/calibration/select`**: Switch active calibration profile.

---

## 💻 Offline Demo & Testing

Run offline delivery analysis on a recorded video or synthetic trajectory without launching the full web server:

```bash
# Run on sample video for a right-handed batsman
python tools/demo_offline.py --video uploads/VID20260924191005.mp4 --batsman-hand RIGHT

# Run for a left-handed batsman (inverts spin labels)
python tools/demo_offline.py --video uploads/VID20260924191005.mp4 --batsman-hand LEFT

# Run offline synthetic verification demo
python tools/demo_offline.py --synthetic --batsman-hand RIGHT

# Run automated pytest test suite
pytest tests/test_delivery_analysis.py
```

---

## 🏗️ Project Architecture

```
CricSpeedAI/
├── ai/
│   ├── delivery_analysis.py   # Kinematic bounce, turn angle, swing & XAI engine
│   ├── track_cleaning.py      # MAD outlier rejection, interpolation, validation
│   ├── overlay_hud.py         # OpenCV HUD (fading trail, bounce marker, banner)
│   ├── speed.py               # Homography perspective projection & speed estimator
│   ├── tracker.py             # ByteTracker multi-object tracking
│   └── video_processor.py     # End-to-end video processing pipeline
├── config.py                  # Central configuration & tunable constants
├── database/
│   └── scorecard_db.py        # SQLite scorecard engine with migration
├── frontend/                  # React 18 + Vite dark glassmorphic UI
│   └── src/components/
│       ├── DeliveryAnalysisCard.jsx # Movement badge, metrics, XAI accordion
│       ├── PitchMap.jsx             # Responsive SVG pitch map with bounce dots
│       ├── LiveCameraRadar.jsx      # Live stream radar with RHB/LHB toggle
│       ├── LiveScorecard.jsx        # Ball-by-ball score recording with auto-link
│       └── AnalyticsDashboard.jsx   # Match & Bowler movement analytics
├── tools/
│   ├── calibrate_pitch.py     # 4-point homography calibration utility
│   ├── demo_offline.py        # Offline CLI demo runner
│   └── evaluate_analysis.py   # Phase 5 validation & evaluation harness
└── tests/
    └── test_delivery_analysis.py # Pytest test suite (15 tests)
```
