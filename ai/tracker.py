import numpy as np

class KalmanFilter:
    """
    A standard 2D Kalman Filter tracking position and velocity.
    State: [x, y, vx, vy]
    """
    def __init__(self, dt=1.0/30.0, process_noise=1e-2, measurement_noise=1e-1):
        self.dt = dt
        
        # State vector [x, y, vx, vy]
        self.x = np.zeros((4, 1), dtype=np.float32)
        
        # State transition matrix F
        self.F = np.array([
            [1, 0, self.dt, 0],
            [0, 1, 0, self.dt],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
        ], dtype=np.float32)
        
        # Measurement matrix H (we measure x and y)
        self.H = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0]
        ], dtype=np.float32)
        
        # Covariance matrices
        self.P = np.eye(4, dtype=np.float32) * 1000.0  # Initial high uncertainty
        self.Q = np.eye(4, dtype=np.float32) * process_noise
        self.R = np.eye(2, dtype=np.float32) * measurement_noise
        
        self.initialized = False

    def initiate(self, position):
        """Initialize state with first measurement."""
        self.x[0, 0] = position[0]
        self.x[1, 0] = position[1]
        self.x[2, 0] = 0.0
        self.x[3, 0] = 0.0
        self.P = np.eye(4, dtype=np.float32) * 10.0
        self.initialized = True

    def predict(self):
        """Predict the next state."""
        self.x = np.dot(self.F, self.x)
        self.P = np.dot(np.dot(self.F, self.P), self.F.T) + self.Q
        return (self.x[0, 0], self.x[1, 0])

    def update(self, measurement):
        """Update state estimate with a new measurement."""
        z = np.array([[measurement[0]], [measurement[1]]], dtype=np.float32)
        
        # Innovation
        y = z - np.dot(self.H, self.x)
        
        # Innovation covariance
        S = np.dot(np.dot(self.H, self.P), self.H.T) + self.R
        
        # Kalman Gain
        K = np.dot(np.dot(self.P, self.H.T), np.linalg.inv(S))
        
        # Update state and covariance
        self.x = self.x + np.dot(K, y)
        self.P = self.P - np.dot(np.dot(K, self.H), self.P)
        
        return (self.x[0, 0], self.x[1, 0])

    def get_velocity(self):
        """Return estimated velocity in units per second."""
        return (self.x[2, 0], self.x[3, 0])


class Track:
    """
    Represents a single tracked object (tennis ball).
    """
    count = 0

    def __init__(self, position, score, dt=1.0/30.0):
        Track.count += 1
        self.track_id = Track.count
        self.kf = KalmanFilter(dt=dt)
        self.kf.initiate(position)
        
        self.score = score
        self.history = [position]
        self.smoothed_history = [position]
        
        self.time_since_update = 0
        self.state = 1  # 1 = Active, 2 = Lost
        
    def predict(self):
        """Predict using Kalman filter and return predicted position."""
        pos = self.kf.predict()
        self.time_since_update += 1
        return pos

    def update(self, position, score):
        """Update with a new detection."""
        updated_pos = self.kf.update(position)
        self.score = score
        self.history.append(position)
        
        # Simple moving average smoothing for trajectory
        alpha = 0.6
        smoothed_pos = (
            alpha * updated_pos[0] + (1 - alpha) * self.smoothed_history[-1][0],
            alpha * updated_pos[1] + (1 - alpha) * self.smoothed_history[-1][1]
        )
        self.smoothed_history.append(smoothed_pos)
        
        self.time_since_update = 0
        self.state = 1  # Active

    def mark_lost(self):
        self.state = 2


class ByteTracker:
    """
    ByteTrack logic tailored for tracking a cricket ball.
    """
    def __init__(self, dt=1.0/30.0, high_threshold=0.35, low_threshold=0.15, max_lost_frames=15):
        self.dt = dt
        self.high_threshold = high_threshold
        self.low_threshold = low_threshold
        self.max_lost_frames = max_lost_frames
        self.tracks = []

    def update(self, detections, scores):
        """
        Perform association step of ByteTrack.
        detections: list of (x, y) coordinates of centers.
        scores: list of detection confidence scores.
        """
        # Split detections based on thresholds
        high_dets = []
        high_scores = []
        low_dets = []
        low_scores = []
        
        for det, score in zip(detections, scores):
            if score >= self.high_threshold:
                high_dets.append(det)
                high_scores.append(score)
            elif score >= self.low_threshold:
                low_dets.append(det)
                low_scores.append(score)

        # 1. Predict state of existing tracks
        for track in self.tracks:
            track.predict()

        # 2. First association: Match active tracks with high-confidence detections
        unmatched_tracks = []
        unmatched_high_dets = list(high_dets)
        unmatched_high_scores = list(high_scores)
        
        matched_tracks = []
        
        # For a cricket ball, tracking the closest prediction by distance is highly effective
        # Since it's usually a single ball, we match based on Euclidean distance
        for track in self.tracks:
            if track.state == 1: # Active
                predicted_pos = (track.kf.x[0, 0], track.kf.x[1, 0])
                best_idx = -1
                best_dist = float('inf')
                
                for idx, det in enumerate(unmatched_high_dets):
                    dist = np.sqrt((predicted_pos[0] - det[0])**2 + (predicted_pos[1] - det[1])**2)
                    # Limit association distance to avoid matching unrelated objects (e.g. 150 pixels)
                    if dist < best_dist and dist < 150:
                        best_dist = dist
                        best_idx = idx
                
                if best_idx != -1:
                    det = unmatched_high_dets.pop(best_idx)
                    score = unmatched_high_scores.pop(best_idx)
                    track.update(det, score)
                    matched_tracks.append(track)
                else:
                    unmatched_tracks.append(track)
            else:
                unmatched_tracks.append(track)

        # 3. Second association: Match unmatched tracks with low-confidence detections
        still_unmatched = []
        for track in unmatched_tracks:
            predicted_pos = (track.kf.x[0, 0], track.kf.x[1, 0])
            best_idx = -1
            best_dist = float('inf')
            
            for idx, det in enumerate(low_dets):
                dist = np.sqrt((predicted_pos[0] - det[0])**2 + (predicted_pos[1] - det[1])**2)
                # Stricter distance limit for low-confidence detections
                if dist < best_dist and dist < 100:
                    best_dist = dist
                    best_idx = idx
            
            if best_idx != -1:
                det = low_dets.pop(best_idx)
                score = low_scores.pop(best_idx)
                track.update(det, score)
                matched_tracks.append(track)
            else:
                still_unmatched.append(track)

        # 4. Handle remaining unmatched tracks
        for track in still_unmatched:
            if track.time_since_update > self.max_lost_frames:
                track.mark_lost()
            else:
                # If recently lost, we can extrapolate using the Kalman Filter prediction
                predicted_pos = (track.kf.x[0, 0], track.kf.x[1, 0])
                # We update the Kalman Filter with its own prediction to keep covariance updated
                track.kf.update(predicted_pos)
                track.history.append(predicted_pos)
                track.smoothed_history.append(predicted_pos)

        # 5. Initialize new tracks from unmatched high-confidence detections
        for det, score in zip(unmatched_high_dets, unmatched_high_scores):
            new_track = Track(det, score, dt=self.dt)
            self.tracks.append(new_track)

        # Filter out completely dead tracks
        self.tracks = [t for t in self.tracks if t.time_since_update <= self.max_lost_frames]
        
        # Suppress stationary noise tracks (e.g. grass patch or shoe mark: < 8px displacement over 10 frames)
        valid_tracks = []
        for t in self.tracks:
            if t.state == 1:
                if len(t.smoothed_history) >= 10:
                    p_old = t.smoothed_history[-10]
                    p_cur = t.smoothed_history[-1]
                    disp = ((p_cur[0] - p_old[0])**2 + (p_cur[1] - p_old[1])**2)**0.5
                    if disp < 8.0:
                        continue # Skip static background false positive
                valid_tracks.append(t)
        
        return valid_tracks
