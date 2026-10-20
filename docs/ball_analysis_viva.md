# CricSpeed AI: Ball Movement Analysis – Viva & Technical Defense Guide

This document provides concise, technically rigorous answers to likely viva, interview, and project defense questions regarding the Computer Vision and Physics algorithms behind the CricSpeed AI Ball Movement Analysis engine.

---

### 1. How is the pitch bounce detected?
**Answer:**
Bounce detection relies on the vertical kinematic inversion in camera image space combined with ground-plane progression:
1. **Vertical Pixel Coordinate Dynamics:** In a behind-the-bowler camera perspective (looking down the pitch), the ball travels downward across the image as it drops toward the pitch under gravity, causing its vertical pixel coordinate $p_y$ (row index measured from the top of the frame) to increase.
2. **Inflection Point Identification:** Upon impacting the pitch surface, the normal reaction force of the pitch reverses the ball's vertical velocity $\dot{z}$ upward. In the image plane, this causes $p_y$ to reach a local maximum (the lowest point of the visual trajectory) and then decrease (or plateau) as the ball rebounds upward.
3. **Filtering & Ground Proximity:** The trajectory is smoothed to eliminate YOLO bounding-box center jitter. Candidate bounce points are identified where $\frac{d(p_y)}{dt}$ transitions from positive to negative, constrained to physical pitch lengths between $y = 3.0\text{ m}$ (short length) and $y = 19.0\text{ m}$ (full toss boundary).
4. **Fallback:** If no distinct upward rebound is detected (e.g., in low-angle skidding balls or flat full tosses), the algorithm identifies the point of closest ground approach or marks the delivery as `"no_bounce_found"` (full toss).

---

### 2. How is the turn angle computed?
**Answer:**
Turn angle ($\theta_{\text{turn}}$) represents the angular deflection of the ball's lateral path across the pitch surface at the bounce point:
1. **Trajectory Partitioning:** The filtered ground trajectory $(x_i, y_i)$ in metres is split at the bounce index $k$ into two independent segments:
   - **Pre-bounce trajectory:** $(x_i, y_i)$ for $i \le k$ (flight phase before pitch contact).
   - **Post-bounce trajectory:** $(x_i, y_i)$ for $i \ge k$ (rebound phase off the pitch).
2. **Robust Linear Regression:** First-order linear polynomials $x = m \cdot y + c$ are fitted independently to the pre-bounce and post-bounce points:
   $$\theta_{\text{pre}} = \arctan(m_{\text{pre}}), \quad \theta_{\text{post}} = \arctan(m_{\text{post}})$$
   where $y$ is the longitudinal distance along the pitch ($0\text{--}20.12\text{ m}$) and $x$ is the lateral deviation ($+x$ = image right).
3. **Angular Deflection:**
   $$\Delta \theta = \theta_{\text{post}} - \theta_{\text{pre}}$$
   The turn angle magnitude in degrees is:
   $$\theta_{\text{turn}} = |\Delta \theta| \times \frac{180^\circ}{\pi}$$
4. **Classification Threshold:** If $\theta_{\text{turn}} \ge \text{TURN\_MIN\_DEG}$ ($1.5^\circ$), significant spin deviation is confirmed; otherwise, the delivery is classified as `STRAIGHT`.

---

### 3. Why do delivery labels flip for Left-Handed Batsmen (LHB)?
**Answer:**
Cricket delivery labels are **relative to the batsman's stance**, not fixed in absolute camera or pitch directions:
1. **Definition of Spin Types:**
   - **Off Spin / Finger Spin:** Turns into the batsman's body from the off-side toward the leg-side.
   - **Leg Spin / Wrist Spin:** Turns away from the batsman's body from the leg-side toward the off-side.
2. **Stance Geometry:**
   - A Right-Handed Batsman (RHB) stands with their right shoulder toward the stumps (looking left); the off-side is to the camera's left ($-x$), and the leg-side is to the camera's right ($+x$).
   - A Left-Handed Batsman (LHB) stands facing the opposite direction; their off-side is to the camera's right ($+x$), and their leg-side is to the camera's left ($-x$).
3. **Opposite Classification for Identical Ball Spin:**
   - A ball moving towards $+x$ (image right) turns towards the leg-side for an RHB $\rightarrow$ **Off Spin**.
   - For an LHB, that exact same trajectory turns towards their off-side $\rightarrow$ **Leg Spin**.
   - Similarly, a left-arm orthodox spinner turns the ball towards the off-side for an RHB (leg-spin direction), but turns it into an LHB (off-spin direction).
4. **Software Implementation:** The algorithm computes turn direction laterally ($\Delta x > 0$ vs $\Delta x < 0$) and flips the classification label if `batsman_hand == "LEFT"`.

---

### 4. Why is the computed turn angle an approximation?
**Answer:**
Single-camera monocular computer vision entails intrinsic physical approximations:
1. **Planar Homography Projection:** Homography assumes points lie strictly on the 2D pitch ground plane ($z = 0$). While the ball is airborne ($z > 0$), perspective foreshortening creates a slight visual parallax shift. The linear regression over pre- and post-bounce trajectories minimizes this effect by fitting direction vectors rather than instantaneous heights.
2. **Frame Rate & Inter-frame Impact Timing:** At standard 30 or 60 fps, the exact instant of pitch impact usually occurs between discrete frames. The true bounce point is interpolated to within $\pm 1$ frame ($\approx 16\text{--}33\text{ ms}$).
3. **YOLO Bounding Box Jitter:** YOLO predicts bounding boxes with small sub-pixel centroid variances between frames. Track cleaning and MAD outlier filtering reduce noise, but residual variance introduces an estimated $\pm 0.3^\circ\text{--}0.5^\circ$ angular uncertainty.
4. **Conclusion:** While not replacing a \$100,000 12-camera Hawk-Eye infrared system, the monocular algorithm provides accurate relative classification and actionable coaching feedback at consumer mobile costs.

---

### 5. What does the Confidence Score mean and how is it calculated?
**Answer:**
The confidence score $C \in [0.10, 1.00]$ quantifies the statistical reliability and geometric completeness of the delivery trajectory:
1. **Sample Count Factor ($C_N$):** Scales with the number of valid tracking points $N$. More observations reduce regression variance ($C_N = \min(1.0, N / 15)$).
2. **Pitch Length Coverage ($C_L$):** Measures the physical span $\Delta y = y_{\max} - y_{\min}$ covered down the pitch. A delivery tracked over $12\text{ m}$ of pitch length receives higher confidence than one tracked for only $4\text{ m}$ ($C_L = \min(1.0, \Delta y / 10.0)$).
3. **Goodness of Fit ($R^2$):** Penalizes lateral scattering or erratic paths, rewarding smooth trajectories that fit the pre- and post-bounce linear models.
4. **Combined Metric:**
   $$C = 0.4 \cdot C_N + 0.4 \cdot C_L + 0.2 \cdot R^2_{\text{combined}}$$
   Scores $\ge 0.75$ denote high-confidence deliveries suitable for match analytics; lower scores trigger fallback UI notices.

---

### 6. How does the Track Cleaning Pipeline work?
**Answer:**
Raw YOLO detections at low detection thresholds ($\text{conf} = 0.15$) frequently contain false positives (footwear, umpire hands, ball shadows) and tracking dropouts. `ai/track_cleaning.py` executes a multi-stage cleaning filter:
1. **Temporal Sorting & Deduplication:** Points are sorted chronologically by frame timestamp; duplicate detections in identical frames are eliminated.
2. **Kinematic Velocity & MAD Outlier Rejection:**
   - Frame-to-frame ground displacement velocity is computed: $v = \frac{\Delta d}{\Delta t}$.
   - Any point exceeding physical bowling speed limits ($> 85\text{ m/s} \approx 306\text{ km/h}$) or showing impossible lateral teleportation ($> 1.2\text{ m}$ in a single frame) is rejected.
   - Median Absolute Deviation (MAD) on lateral offsets eliminates spurious detection jumps.
3. **Short Gap Linear Interpolation:** Missing frames where the detector dropped the ball for $\le 2$ consecutive frames are interpolated linearly in ground coordinates $(x, y)$ and pixel coordinates $(p_x, p_y)$.
4. **Directionality & Batting Rebound Truncation:**
   - Only deliveries advancing from the bowler ($y \approx 0$) toward the batsman ($y \approx 20$) are accepted ($\Delta y \ge \text{MIN\_PITCH\_SPAN\_M}$). Return throws from fielders are rejected.
   - If the ball is struck by the bat, $y$ abruptly reverses direction ($y$ decreases). The trajectory is automatically truncated at the peak $y$ point before running delivery analysis.

---

### 7. What are the key limitations of the system?
**Answer:**
1. **Extreme Camera Angles:** Requires the camera to be positioned relatively centered behind the bowler's stumps. Side-on or extreme diagonal views invalidate the homography orientation.
2. **Low-Frame-Rate Motion Blur:** At 30 fps in poor lighting, fast deliveries ($> 120\text{ km/h}$) exhibit significant motion blur, which can reduce YOLO detection confidence and cause track gaps $> 2$ frames.
3. **Severe Pitch Obstruction:** If the bowler's body or the umpire directly occludes the ball's pitch impact point for more than 4 consecutive frames, bounce detection will fall back to trajectory extrapolation.
4. **Camera Movement:** Assumes a static camera (tripod or steady handheld). Extreme shaking during delivery invalidates the calibrated homography matrix.
