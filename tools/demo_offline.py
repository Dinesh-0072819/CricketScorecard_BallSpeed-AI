#!/usr/bin/env python3
"""
tools/demo_offline.py
Offline Ball Movement Analysis Demo Runner.

Processes a sample or recorded cricket delivery video using the CricSpeed AI
YOLO + ByteTracker + Ball Movement Analysis pipeline and prints the
structured JSON analysis result to stdout.

Usage:
    python tools/demo_offline.py --video uploads/VID20260924191005.mp4
    python tools/demo_offline.py --video uploads/VID20260924191005.mp4 --batsman-hand LEFT
    python tools/demo_offline.py --video uploads/VID20260924191005.mp4 --save-video output.mp4
    python tools/demo_offline.py --synthetic --batsman-hand RIGHT
"""

import os
import sys
import json
import argparse
import logging

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from config import ENABLE_BALL_ANALYSIS, TURN_MIN_DEG, SWING_MIN_M

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("demo_offline")


def run_synthetic_demo(batsman_hand: str = "RIGHT", speed_kmh: float = 88.5) -> dict:
    """Generate a high-fidelity synthetic delivery trajectory and analyze it."""
    from ai.delivery_analysis import analyze_delivery
    import numpy as np

    logger.info("Generating realistic synthetic off-spin delivery for demonstration...")
    # Flight: y 3m to 12.5m, x drifts from -0.3m to -0.1m, py increases
    # Bounce at y=12.5m, py=540
    # Rebound: y 12.5m to 18.5m, x turns sharply towards +x (+0.45m), py decreases
    flight_y = np.linspace(3.0, 12.5, 12)
    flight_x = np.linspace(-0.30, -0.10, 12)
    flight_py = np.linspace(320.0, 540.0, 12)

    rebound_y = np.linspace(13.2, 18.5, 8)
    rebound_x = np.linspace(0.05, 0.45, 8)
    rebound_py = np.linspace(525.0, 460.0, 8)

    track = []
    t = 0.0
    for y, x, py in zip(flight_y, flight_x, flight_py):
        track.append({"x": float(x), "y": float(y), "px": 640.0 + x * 100.0, "py": float(py), "t": t})
        t += 0.033

    for y, x, py in zip(rebound_y, rebound_x, rebound_py):
        track.append({"x": float(x), "y": float(y), "px": 640.0 + x * 100.0, "py": float(py), "t": t})
        t += 0.033

    result = analyze_delivery(track, batsman_hand=batsman_hand, speed_kmh=speed_kmh)
    return {
        "status": "success",
        "mode": "synthetic_trajectory",
        "batsman_hand": batsman_hand,
        "speed_kmh": speed_kmh,
        "track_points_count": len(track),
        "delivery_analysis": result
    }


def main():
    parser = argparse.ArgumentParser(
        description="CricSpeed AI - Offline Ball Movement Analysis Demo Runner"
    )
    parser.add_argument(
        "--video",
        type=str,
        default=None,
        help="Path to input delivery video (.mp4, .mov, .avi)"
    )
    parser.add_argument(
        "--save-video",
        type=str,
        default=None,
        help="Optional path to write processed video with HUD overlay"
    )
    parser.add_argument(
        "--batsman-hand",
        type=str,
        choices=["RIGHT", "LEFT"],
        default="RIGHT",
        help="Batsman stance for relative movement classification (RIGHT or LEFT, default: RIGHT)"
    )
    parser.add_argument(
        "--profile",
        type=str,
        default="behind_bowler",
        help="Calibration profile name (default: behind_bowler)"
    )
    parser.add_argument(
        "--speed-limit",
        type=float,
        default=160.0,
        help="Speed alarm threshold in km/h"
    )
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="Run offline demo with synthetic trajectory (no GPU/video file needed)"
    )

    args = parser.parse_args()

    # If synthetic mode requested or no video file exists
    if args.synthetic or (args.video is None and not os.path.exists("uploads/VID20260924191005.mp4")):
        result = run_synthetic_demo(batsman_hand=args.batsman_hand)
        print("\n" + "=" * 60)
        print("CRICSPEED AI - OFFLINE BALL MOVEMENT ANALYSIS DEMO (SYNTHETIC)")
        print("=" * 60)
        print(json.dumps(result, indent=2))
        print("=" * 60 + "\n")
        return 0

    video_path = args.video or "uploads/VID20260924191005.mp4"
    if not os.path.exists(video_path):
        logger.error(f"Input video not found: {video_path}")
        logger.info("Falling back to synthetic demo...")
        result = run_synthetic_demo(batsman_hand=args.batsman_hand)
        print(json.dumps(result, indent=2))
        return 0

    save_path = args.save_video or os.path.join(
        os.path.dirname(video_path),
        f"analyzed_{os.path.basename(video_path)}"
    )

    logger.info(f"Processing video: {video_path}")
    logger.info(f"Batsman Hand: {args.batsman_hand} | Profile: {args.profile}")

    try:
        from ai.video_processor import VideoProcessor
        processor = VideoProcessor()
        res = processor.process(
            input_video=video_path,
            output_video=save_path,
            max_speed=args.speed_limit,
            batsman_hand=args.batsman_hand,
            calibration_profile=args.profile
        )

        output_payload = {
            "status": "success",
            "video_processed": video_path,
            "output_annotated_video": save_path,
            "maximum_speed_kmh": res.get("speed", 0.0),
            "batsman_hand": args.batsman_hand,
            "delivery_analysis": res.get("delivery_analysis"),
            "all_deliveries": res.get("deliveries", []),
            "summary": res.get("summary", {})
        }

        print("\n" + "=" * 60)
        print("CRICSPEED AI - OFFLINE BALL MOVEMENT ANALYSIS DEMO RESULT")
        print("=" * 60)
        print(json.dumps(output_payload, indent=2))
        print("=" * 60 + "\n")
        return 0

    except Exception as e:
        logger.exception(f"Error during video processing: {e}")
        error_payload = {
            "status": "error",
            "error_message": str(e),
            "video": video_path
        }
        print(json.dumps(error_payload, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())
