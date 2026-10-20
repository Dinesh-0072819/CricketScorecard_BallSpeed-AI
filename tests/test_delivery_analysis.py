import os
import sys
import json
import sqlite3
import pytest

# Ensure root directory is on sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from ai.delivery_analysis import analyze_delivery
from ai.track_cleaning import clean_track
from database.scorecard_db import (
    init_scorecard_db,
    get_connection,
    log_ball,
    get_match_deliveries,
    get_bowler_analysis,
    create_match,
    get_scorecard_details,
    delete_last_ball
)
from ai.scorecard_engine import MatchEngine
from config import TURN_MIN_DEG, SWING_MIN_M


# ---------------------------------------------------------------------------
# 1. Synthetic Delivery Analysis Tests
# ---------------------------------------------------------------------------

def test_off_spin_rhb():
    """
    RHB facing bowler:
    Pitch centerline is x=0. Ball turns toward image right (+x / batsman leg side) after bounce.
    Must be classified as OFF_SPIN.
    """
    track = [
        {"x": 0.0, "y": 5.0, "py": 80},
        {"x": 0.0, "y": 8.0, "py": 140},
        {"x": 0.0, "y": 11.0, "py": 210},
        {"x": 0.0, "y": 14.0, "py": 290},  # Bounce point
        {"x": 0.25, "y": 16.0, "py": 260},
        {"x": 0.50, "y": 18.0, "py": 230},
        {"x": 0.75, "y": 20.0, "py": 200},
    ]
    res = analyze_delivery(track, batsman_hand="RIGHT", speed_kmh=85.0)
    assert res["status"] == "ok"
    assert res["spin_type"] == "OFF_SPIN"
    assert res["delivery_type"] == "OFF_SPIN"
    assert res["turn_angle_deg"] >= TURN_MIN_DEG
    assert res["bowler_style"] == "SPINNER"


def test_leg_spin_rhb():
    """
    RHB facing bowler:
    Ball turns toward image left (-x / batsman off side) after bounce.
    Must be classified as LEG_SPIN.
    """
    track = [
        {"x": 0.0, "y": 5.0, "py": 80},
        {"x": 0.0, "y": 8.0, "py": 140},
        {"x": 0.0, "y": 11.0, "py": 210},
        {"x": 0.0, "y": 14.0, "py": 290},  # Bounce
        {"x": -0.25, "y": 16.0, "py": 260},
        {"x": -0.50, "y": 18.0, "py": 230},
        {"x": -0.75, "y": 20.0, "py": 200},
    ]
    res = analyze_delivery(track, batsman_hand="RIGHT", speed_kmh=82.0)
    assert res["status"] == "ok"
    assert res["spin_type"] == "LEG_SPIN"
    assert res["delivery_type"] == "LEG_SPIN"
    assert res["turn_angle_deg"] >= TURN_MIN_DEG
    assert res["bowler_style"] == "SPINNER"


def test_handedness_flip_lhb():
    """
    Left-handed batsman:
    The exact same track turning toward +x is now turning toward the LHB off side -> LEG_SPIN.
    A track turning toward -x is turning toward the LHB leg side -> OFF_SPIN.
    """
    track_turning_right = [
        {"x": 0.0, "y": 5.0, "py": 80},
        {"x": 0.0, "y": 8.0, "py": 140},
        {"x": 0.0, "y": 11.0, "py": 210},
        {"x": 0.0, "y": 14.0, "py": 290},
        {"x": 0.25, "y": 16.0, "py": 260},
        {"x": 0.50, "y": 18.0, "py": 230},
        {"x": 0.75, "y": 20.0, "py": 200},
    ]
    res_lhb_right = analyze_delivery(track_turning_right, batsman_hand="LEFT", speed_kmh=84.0)
    assert res_lhb_right["spin_type"] == "LEG_SPIN"

    track_turning_left = [
        {"x": 0.0, "y": 5.0, "py": 80},
        {"x": 0.0, "y": 8.0, "py": 140},
        {"x": 0.0, "y": 11.0, "py": 210},
        {"x": 0.0, "y": 14.0, "py": 290},
        {"x": -0.25, "y": 16.0, "py": 260},
        {"x": -0.50, "y": 18.0, "py": 230},
        {"x": -0.75, "y": 20.0, "py": 200},
    ]
    res_lhb_left = analyze_delivery(track_turning_left, batsman_hand="LEFT", speed_kmh=84.0)
    assert res_lhb_left["spin_type"] == "OFF_SPIN"


def test_outswing_rhb():
    """
    Airborne swing: ball curves in flight away from RHB (-x / off side) before bounce,
    with no significant turn off the pitch.
    Must be classified as OUTSWING.
    """
    track = [
        {"x": 0.00, "y": 5.0, "py": 70},
        {"x": -0.06, "y": 8.0, "py": 120},
        {"x": -0.12, "y": 11.0, "py": 180},
        {"x": -0.10, "y": 14.0, "py": 260},  # Bounce
        {"x": -0.10, "y": 16.5, "py": 230},
        {"x": -0.10, "y": 19.0, "py": 200},
    ]
    res = analyze_delivery(track, batsman_hand="RIGHT", speed_kmh=132.0)
    assert res["status"] == "ok"
    assert res["swing_type"] == "OUTSWING"
    assert res["delivery_type"] == "OUTSWING"
    assert res["swing_cm"] >= (SWING_MIN_M * 100.0)
    assert res["bowler_style"] == "PACER"


def test_straight_delivery():
    """
    Ball stays on a straight line (< turn threshold, < swing threshold).
    Must be classified as STRAIGHT.
    """
    track = [
        {"x": 0.0, "y": 5.0, "py": 80},
        {"x": 0.0, "y": 8.0, "py": 140},
        {"x": 0.0, "y": 11.0, "py": 210},
        {"x": 0.0, "y": 14.0, "py": 290},  # Bounce
        {"x": 0.0, "y": 16.5, "py": 250},
        {"x": 0.0, "y": 19.0, "py": 210},
    ]
    res = analyze_delivery(track, batsman_hand="RIGHT", speed_kmh=135.0)
    assert res["status"] == "ok"
    assert res["delivery_type"] == "STRAIGHT"
    assert res["turn_angle_deg"] < TURN_MIN_DEG


def test_too_short_track():
    """
    Track with fewer points than MIN_TRACK_POINTS must return status 'insufficient_data'.
    """
    track = [
        {"x": 0.0, "y": 5.0, "py": 80},
        {"x": 0.0, "y": 8.0, "py": 140},
        {"x": 0.0, "y": 11.0, "py": 210},
    ]
    res = analyze_delivery(track)
    assert res["status"] == "insufficient_data"


# ---------------------------------------------------------------------------
# 2. Track Cleaning & Validity Filter Tests
# ---------------------------------------------------------------------------

def test_clean_track_noisy():
    """
    Trajectory with a wild single-frame spatial teleport should have the outlier removed.
    """
    pts = [
        {"x": 0.0, "y": 4.0, "px": 320, "py": 70, "t": 0.000},
        {"x": 0.0, "y": 5.2, "px": 320, "py": 100, "t": 0.033},
        {"x": 1.8, "y": 6.3, "px": 550, "py": 120, "t": 0.066},  # Noisy false YOLO detection
        {"x": 0.0, "y": 7.4, "px": 320, "py": 150, "t": 0.100},
        {"x": 0.0, "y": 8.6, "px": 320, "py": 180, "t": 0.133},
        {"x": 0.0, "y": 9.8, "px": 320, "py": 210, "t": 0.166},
        {"x": 0.0, "y": 11.0, "px": 320, "py": 240, "t": 0.200},
        {"x": 0.0, "y": 12.2, "px": 320, "py": 270, "t": 0.233},
    ]
    cleaned = clean_track(pts)
    assert cleaned is not None
    # Verify the outlier at x=1.8 was rejected
    assert all(p["x"] < 1.0 for p in cleaned)


def test_clean_track_reversed_return_throw():
    """
    Ball traveling from batsman end to bowler end (decreasing y) must be rejected.
    """
    pts = [
        {"x": 0.0, "y": 19.0 - i * 1.5, "px": 320, "py": 300 - i * 20, "t": i * 0.033}
        for i in range(10)
    ]
    assert clean_track(pts) is None


def test_clean_track_gap_interpolation():
    """
    A gap of 1 frame missing should be interpolated.
    """
    pts = [
        {"x": 0.0, "y": 4.0, "px": 300, "py": 70, "t": 0.00},
        {"x": 0.0, "y": 6.0, "px": 300, "py": 100, "t": 0.033},
        # Missing t=0.066
        {"x": 0.0, "y": 10.0, "px": 300, "py": 160, "t": 0.100},
        {"x": 0.0, "y": 12.0, "px": 300, "py": 190, "t": 0.133},
        {"x": 0.0, "y": 14.0, "px": 300, "py": 220, "t": 0.166},
        {"x": 0.0, "y": 16.0, "px": 300, "py": 250, "t": 0.200},
        {"x": 0.0, "y": 18.0, "px": 300, "py": 280, "t": 0.233},
    ]
    cleaned = clean_track(pts)
    assert cleaned is not None
    # 7 original points + 1 interpolated point = 8 points
    assert len(cleaned) == 8


# ---------------------------------------------------------------------------
# 3. Database Migration & Scorecard Engine Tests
# ---------------------------------------------------------------------------

def test_migration_idempotent():
    """
    Running init_scorecard_db() multiple times must succeed without errors.
    All new columns must be present.
    """
    init_scorecard_db()
    init_scorecard_db()

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(ball_by_ball)")
    cols = {row["name"] for row in cursor.fetchall()}
    conn.close()

    expected_cols = [
        "delivery_type", "spin_type", "swing_type", "turn_angle_deg",
        "swing_cm", "bounce_x", "bounce_y", "length", "line",
        "analysis_confidence", "analysis_json"
    ]
    for c in expected_cols:
        assert c in cols


def test_scorecard_flow_with_analysis_and_undo():
    """
    Test full lifecycle:
    1. Create match
    2. Record deliveries with analysis fields
    3. Query match deliveries and bowler analysis
    4. Perform undo and confirm state and DB are restored
    """
    engine = MatchEngine()
    match_id = engine.start_new_match("Warriors", "Strikers", total_overs=2, toss_winner="Warriors", toss_decision="BAT")
    engine.setup_innings("Batter A", "Batter B", "Bowler X")

    # Record Ball 1: 0 runs, OFF_SPIN
    st1 = engine.record_delivery(
        mode="NORMAL", runs=0, speed_kmh=88.5,
        delivery_type="OFF_SPIN", spin_type="OFF_SPIN", turn_angle_deg=4.2,
        length="Good Length", line="Off Stump", bounce_x=0.15, bounce_y=15.2
    )
    assert st1["runs"] == 0
    assert st1["balls"] == 1

    # Record Ball 2: 4 runs, INSWING
    st2 = engine.record_delivery(
        mode="NORMAL", runs=4, speed_kmh=134.0,
        delivery_type="INSWING", swing_type="INSWING", swing_cm=6.5,
        length="Full", line="Middle Stump", bounce_x=-0.05, bounce_y=17.1
    )
    assert st2["runs"] == 4
    assert st2["balls"] == 2

    # Verify get_match_deliveries
    deliveries = get_match_deliveries(match_id)
    assert len(deliveries) >= 2
    last_d = deliveries[-1]
    assert last_d["delivery_type"] == "INSWING"
    assert last_d["swing_cm"] == 6.5

    # Verify get_bowler_analysis
    bowler_stats = get_bowler_analysis(match_id)
    assert bowler_stats["balls_analysed"] >= 2
    assert bowler_stats["spin_count"] >= 1
    assert bowler_stats["swing_count"] >= 1

    # Test UNDO: removes Ball 2
    undo_state = engine.undo()
    assert undo_state["runs"] == 0
    assert undo_state["balls"] == 1

    # Verify DB after undo
    deliveries_after_undo = get_match_deliveries(match_id)
    assert len(deliveries_after_undo) == 1
    assert deliveries_after_undo[0]["delivery_type"] == "OFF_SPIN"


def test_api_endpoints_and_auto_linking():
    """
    Test Flask API endpoints:
    - POST /api/match/ball with auto-linking
    - GET /api/match/deliveries
    - GET /api/bowler/analysis
    - GET /api/analysis/latest & POST /api/analysis/discard
    - GET /api/calibration/profiles & POST /api/calibration/select
    """
    from app import app
    client = app.test_client()

    # Create match via API
    res = client.post("/api/match/create", json={
        "team1": "Tigers", "team2": "Lions", "total_overs": 1,
        "toss_winner": "Tigers", "toss_decision": "BAT"
    })
    assert res.status_code == 200
    data = res.get_json()
    match_id = data["match_id"]

    # Setup innings
    res = client.post("/api/setup_innings" if False else "/api/match/setup_innings", json={
        "striker": "Tiger 1", "non_striker": "Tiger 2", "bowler": "Lion 1"
    })
    assert res.status_code == 200

    # Test calibration endpoints
    res = client.get("/api/calibration/profiles")
    assert res.status_code == 200
    assert "profiles" in res.get_json()

    res = client.post("/api/calibration/select", json={"profile": "behind_bowler"})
    assert res.status_code == 200
    assert res.get_json()["active_profile"] == "behind_bowler"

    # Simulate fresh delivery analysis stored in app
    import app as app_module
    app_module.latest_delivery_analysis = {
        "status": "ok",
        "delivery_type": "OFF_SPIN",
        "spin_type": "OFF_SPIN",
        "swing_type": "NONE",
        "turn_angle_deg": 3.8,
        "swing_cm": 0.0,
        "bounce_xy_m": [0.1, 14.5],
        "length": "Good Length",
        "line": "Off Stump",
        "bowler_style": "SPINNER",
        "confidence": 0.88,
        "explain": {"reason": "Turned 3.8°"}
    }
    import time
    app_module.latest_delivery_timestamp = time.time()

    # Query latest analysis endpoint
    res = client.get("/api/analysis/latest")
    assert res.status_code == 200
    assert res.get_json()["is_fresh"] is True

    # Record ball via API without explicit delivery_type -> auto-attaches!
    res = client.post("/api/match/ball", json={
        "mode": "NORMAL", "runs": 1, "speed_kmh": 87.0
    })
    assert res.status_code == 200

    # Verify auto-linked analysis is present in match deliveries
    res = client.get(f"/api/match/deliveries?match_id={match_id}")
    assert res.status_code == 200
    delivs = res.get_json()
    assert len(delivs) >= 1
    assert delivs[-1]["delivery_type"] == "OFF_SPIN"
    assert delivs[-1]["turn_angle_deg"] == 3.8

    # Query bowler analysis
    res = client.get(f"/api/bowler/analysis?match_id={match_id}")
    assert res.status_code == 200
    b_stats = res.get_json()
    assert b_stats["balls_analysed"] >= 1
    assert b_stats["spin_count"] >= 1


def test_full_innings_completion_flow():
    """
    Test full match flow (6 balls in 1-over match) finishes innings properly.
    """
    from app import app
    client = app.test_client()

    # Create 1-over match
    res = client.post("/api/match/create", json={
        "team1": "Red", "team2": "Blue", "total_overs": 1,
        "toss_winner": "Red", "toss_decision": "BAT"
    })
    match_id = res.get_json()["match_id"]
    client.post("/api/match/setup_innings", json={
        "striker": "R1", "non_striker": "R2", "bowler": "B1"
    })

    for ball in range(5):
        res = client.post("/api/match/ball", json={"mode": "NORMAL", "runs": 1})
        assert res.get_json()["balls"] == ball + 1

    # 6th ball finishes innings 1
    res = client.post("/api/match/ball", json={"mode": "NORMAL", "runs": 1})
    st = res.get_json()
    assert st["balls"] == 6
    assert st["status"] == "INNINGS_BREAK"

