"""
Physics-based synthetic deliveries projected through a pinhole phone camera.
Used by tests to validate speed / bounce / swing / spin recovery end-to-end.
World frame: X = lateral (+ = right as seen from the bowler = RHB leg side),
             Y = along pitch from release towards batsman, Z = up.
"""
import math
import numpy as np


def simulate(
    speed_kmh=90.0, turn_deg=0.0, swing_m=0.0, bounce_y=12.0, release_x=0.0,
    release_h=2.0, distance=17.68, fps=60.0,
    cam_end="batsman", cam_offset_x=1.5, cam_back=3.0, cam_h=1.4,
    f_true=1050.0, W=1280, H=720, ball_d=0.067, bbox_bias=1.25,
    pos_noise=0.6, size_noise=0.8, seed=0, restitution=0.55,
):
    rng = np.random.default_rng(seed)
    v = speed_kmh / 3.6
    # time to bounce, vertical speed so the ball lands at bounce_y
    tb = bounce_y / v
    vz0 = (0.0 - release_h + 0.5 * 9.81 * tb ** 2) / tb
    # swing: constant lateral acceleration giving `swing_m` max bulge vs chord before bounce
    a_s = 8.0 * swing_m / tb ** 2  # bulge of x = a t^2/2 over [0,tb] is a tb^2/8
    t_end = distance / v
    ts = np.arange(0.0, t_end + 1e-9, 1.0 / fps)
    P = []
    vx_b = a_s * tb
    x_b = release_x + 0.5 * a_s * tb ** 2
    vz_b = -(vz0 - 9.81 * tb) * restitution
    for t in ts:
        if t <= tb:
            x = release_x + 0.5 * a_s * t ** 2
            y = v * t
            z = release_h + vz0 * t - 0.5 * 9.81 * t ** 2
        else:
            dt = t - tb
            v2 = v * 0.9  # speed loss at bounce
            # turn: rotate horizontal direction by turn_deg
            ang = math.atan2(vx_b, v) + math.radians(turn_deg)
            x = x_b + v2 * math.sin(ang) * dt
            y = bounce_y + v2 * math.cos(ang) * dt
            z = max(0.0, vz_b * dt - 0.5 * 9.81 * dt ** 2)
        P.append((x, y, z))
    P = np.array(P)

    if cam_end == "batsman":
        C = np.array([cam_offset_x, distance + 1.22 + cam_back, cam_h])
        target = np.array([0.0, 0.0, 1.0])
    else:
        C = np.array([cam_offset_x, -1.22 - cam_back, cam_h])
        target = np.array([0.0, distance, 0.5])
    fwd = target - C; fwd /= np.linalg.norm(fwd)
    up = np.array([0.0, 0.0, 1.0])
    right = np.cross(fwd, up); right /= np.linalg.norm(right)
    cam_up = np.cross(right, fwd)
    track = []
    for i, p in enumerate(P):
        d = p - C
        depth = d @ fwd
        x_img = W / 2 + f_true * (d @ right) / depth + rng.normal(0, pos_noise)
        y_img = H / 2 - f_true * (d @ cam_up) / depth + rng.normal(0, pos_noise)
        size = f_true * ball_d / depth * bbox_bias + rng.normal(0, size_noise)
        track.append({"frame": 100 + i, "x": float(x_img), "y": float(y_img),
                      "size": float(max(2.0, size)), "conf": 0.6})
    return track, W, H, fps
