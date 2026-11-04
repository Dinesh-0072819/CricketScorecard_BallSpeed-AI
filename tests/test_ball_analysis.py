"""
Tests for the ball pipeline: delivery classification, speed, bounce and
delivery-track selection. Run with:  python -m pytest -q tests/test_ball_analysis.py
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.dirname(__file__))

from ai.delivery_analysis import analyze_delivery, analyze_video_track  # noqa: E402
from ai.trajectory import link_detections, select_delivery, trim_delivery  # noqa: E402
from synthetic_delivery import simulate  # noqa: E402


def run(**kw):
    track, W, H, fps = simulate(**kw)
    return analyze_video_track(track, fps, W, H, pitch_length_m=20.12,
                               batsman_hand=kw.get("hand", "RIGHT") if "hand" in kw else "RIGHT")


# ---------------------------------------------------------------- speed
@pytest.mark.parametrize("kmh", [70, 95, 120, 140])
def test_speed_time_of_flight(kmh):
    r = run(speed_kmh=kmh, seed=1)
    assert abs(r["speed_kmh"] - kmh) / kmh < 0.04


def test_speed_scales_with_pitch_length():
    track, W, H, fps = simulate(speed_kmh=90, distance=14.0, seed=2)
    r = analyze_video_track(track, fps, W, H, pitch_length_m=14.0 + 2.44)
    assert abs(r["speed_kmh"] - 90) < 4


# ---------------------------------------------------------------- classification
@pytest.mark.parametrize("seed", range(4))
def test_off_spin_rhb(seed):
    assert run(turn_deg=4.5, seed=seed)["delivery_type"] == "OFF_SPIN"


@pytest.mark.parametrize("seed", range(4))
def test_leg_spin_rhb(seed):
    assert run(turn_deg=-4.5, seed=seed)["delivery_type"] == "LEG_SPIN"


@pytest.mark.parametrize("seed", range(4))
def test_straight(seed):
    assert run(seed=seed)["delivery_type"] == "STRAIGHT"


@pytest.mark.parametrize("seed", range(3))
def test_inswing_outswing_rhb(seed):
    assert run(swing_m=0.25, bounce_y=15, seed=seed)["delivery_type"] == "INSWING"
    assert run(swing_m=-0.25, bounce_y=15, seed=seed)["delivery_type"] == "OUTSWING"


def test_left_handed_batsman_mirrors():
    track, W, H, fps = simulate(turn_deg=4.5, seed=0)
    assert analyze_video_track(track, fps, W, H, batsman_hand="RIGHT")["delivery_type"] == "OFF_SPIN"
    assert analyze_video_track(track, fps, W, H, batsman_hand="LEFT")["delivery_type"] == "LEG_SPIN"


def test_camera_offset_and_bowler_end():
    assert run(turn_deg=4.5, cam_offset_x=-2.0, seed=0)["delivery_type"] == "OFF_SPIN"
    assert run(turn_deg=-4.5, cam_offset_x=2.5, seed=0)["delivery_type"] == "LEG_SPIN"
    r = run(turn_deg=4.5, cam_end="bowler", seed=0)
    assert r["camera_end"] == "bowler" and r["delivery_type"] == "OFF_SPIN"


def test_bounce_frame_detected():
    track, W, H, fps = simulate(speed_kmh=90, bounce_y=12.0, seed=0)
    r = analyze_video_track(track, fps, W, H)
    expected = 100 + round(12.0 / (90 / 3.6) * 60)
    assert r["bounce_frame"] is not None and abs(r["bounce_frame"] - expected) <= 2


def test_pitch_frame_tracks():
    """Tracks already in pitch coordinates (x lateral m, + = RHB leg side; y along m)."""
    base = [{"x": 0.0, "y": d, "py": 80 + 15 * d} for d in (0, 2, 4, 6, 8, 10)]
    turn_leg = base + [{"x": 0.12 * k, "y": 10 + 1.5 * k, "py": 230 - 8 * k} for k in range(1, 6)]
    turn_off = base + [{"x": -0.12 * k, "y": 10 + 1.5 * k, "py": 230 - 8 * k} for k in range(1, 6)]
    assert analyze_delivery(turn_leg, batsman_hand="RIGHT")["delivery_type"] == "OFF_SPIN"
    assert analyze_delivery(turn_off, batsman_hand="RIGHT")["delivery_type"] == "LEG_SPIN"
    assert analyze_delivery(turn_leg, batsman_hand="LEFT")["delivery_type"] == "LEG_SPIN"


def test_too_short_track():
    assert analyze_delivery([{"x": 0, "y": 1, "py": 1}] * 3)["status"] == "insufficient_data"


# ---------------------------------------------------------------- track selection
def test_selects_delivery_not_static_ball_or_shot():
    W, H = 1280, 720
    dets = {}
    for f in range(0, 120):
        dets[f] = [[400.0, 600.0, 10, 10, 0.5]]                     # ball lying on the grass
    for k in range(25):                                              # delivery, frames 40..64
        f = 40 + k
        dets[f].append([800 - 12 * k, 300 + 7 * k, 10 + 0.4 * k, 10 + 0.4 * k, 0.6])
    for k in range(30):                                              # shot: starts where delivery ended
        f = 68 + k
        dets.setdefault(f, []).append([500 + 20 * k, 470 - 14 * k, 18 - 0.4 * k, 18 - 0.4 * k, 0.6])
    best = select_delivery(link_detections(dets, (W ** 2 + H ** 2) ** 0.5), (W ** 2 + H ** 2) ** 0.5)
    track = trim_delivery(best.as_dicts())
    # ends at the last delivery point or the bat-contact point where the shot starts
    assert track[0]["frame"] <= 41 and 63 <= track[-1]["frame"] <= 68
