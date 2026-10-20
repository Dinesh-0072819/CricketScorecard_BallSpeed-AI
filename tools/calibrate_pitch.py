import argparse
import sys
import json
import os
import cv2
import numpy as np

# Add project root to sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from ai.utils import CalibrationManager

clicked_points = []


def mouse_callback(event, x, y, flags, param):
    global clicked_points
    if event == cv2.EVENT_LBUTTONDOWN:
        clicked_points.append([float(x), float(y)])
        print(f"Point {len(clicked_points)}/4 captured: ({x}, {y})")


def run_calibration(
    image_path: str = None,
    video_path: str = None,
    profile: str = "behind_bowler",
    pts: list = None
):
    """
    Computes homography for 'behind_bowler' profile and saves to config_calibration.json.
    Standard pitch reference points (camera behind bowler, +x = right, y = down pitch):
      Point 1: Bowler bowling crease left  (-1.32m, 0.0m)
      Point 2: Bowler bowling crease right (+1.32m, 0.0m)
      Point 3: Batsman popping crease right (+1.83m, 17.68m)
      Point 4: Batsman popping crease left  (-1.83m, 17.68m)
    """
    global clicked_points
    clicked_points = []

    real_world_points = [
        [-1.32, 0.0],
        [1.32, 0.0],
        [1.83, 17.68],
        [-1.83, 17.68]
    ]

    if pts and len(pts) == 4:
        image_points = pts
    else:
        frame = None
        if image_path and os.path.exists(image_path):
            frame = cv2.imread(image_path)
        elif video_path and os.path.exists(video_path):
            cap = cv2.VideoCapture(video_path)
            ret, frame = cap.read()
            cap.release()

        if frame is None:
            # Fallback 640x480 realistic behind-the-bowler pitch perspective
            print("No image/video provided or opened. Using default behind-the-bowler pitch template.")
            image_points = [
                [240.0, 100.0],  # Bowler crease left
                [400.0, 100.0],  # Bowler crease right
                [520.0, 420.0],  # Batsman crease right
                [120.0, 420.0]   # Batsman crease left
            ]
        else:
            window_name = "Click 4 Pitch Points: [1] Bowler L, [2] Bowler R, [3] Batsman R, [4] Batsman L"
            cv2.namedWindow(window_name)
            cv2.setMouseCallback(window_name, mouse_callback)

            print("\nInstructions:")
            print("Click 4 pitch corners in this order:")
            print("  1. Bowler bowling crease LEFT")
            print("  2. Bowler bowling crease RIGHT")
            print("  3. Batsman popping crease RIGHT")
            print("  4. Batsman popping crease LEFT")
            print("Press 'q' or ESC when done.\n")

            while len(clicked_points) < 4:
                disp = frame.copy()
                for idx, pt in enumerate(clicked_points):
                    cv2.circle(disp, (int(pt[0]), int(pt[1])), 5, (0, 255, 0), -1)
                    cv2.putText(disp, f"{idx+1}", (int(pt[0])+8, int(pt[1])-8), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                cv2.imshow(window_name, disp)
                key = cv2.waitKey(20) & 0xFF
                if key in (27, ord('q')):
                    break

            cv2.destroyAllWindows()
            if len(clicked_points) != 4:
                print("Error: Calibration cancelled or fewer than 4 points clicked.")
                return False
            image_points = clicked_points

    src = np.array(image_points, dtype=np.float32)
    dst = np.array(real_world_points, dtype=np.float32)
    H, status = cv2.findHomography(src, dst)

    if H is None:
        print("Error: cv2.findHomography failed to compute homography.")
        return False

    mgr = CalibrationManager()
    success = mgr.save_calibration(image_points, real_world_points, H, profile=profile)
    if success:
        print(f"Successfully calibrated and saved profile '{profile}'!")
        print("Image points:", image_points)
        print("Real world points:", real_world_points)
        print("Homography H:\n", H)
        return True
    else:
        print("Error saving calibration profile.")
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pitch calibration tool for behind_bowler profile.")
    parser.add_argument("--image", type=str, help="Path to pitch frame image")
    parser.add_argument("--video", type=str, help="Path to sample video file")
    parser.add_argument("--profile", type=str, default="behind_bowler", help="Calibration profile name")
    parser.add_argument("--default-template", action="store_true", help="Apply default template without GUI")
    args = parser.parse_args()

    run_calibration(image_path=args.image, video_path=args.video, profile=args.profile)
