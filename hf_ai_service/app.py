from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil
import uuid
from ai.video_processor import VideoProcessor

app = FastAPI(title="CricSpeed AI Microservice", version="1.0.0")

# Enable CORS for all origins (so Render frontend can call it directly)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "/tmp/cricspeed_hf_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Initialize YOLO model once at startup on high-performance CPU
print("=" * 50)
print("Initializing CricSpeed AI Engine on Hugging Face Spaces...")
video_processor = VideoProcessor()
print("AI Engine ready to accept deliveries!")
print("=" * 50)

@app.get("/")
def home():
    return {
        "status": "healthy",
        "service": "CricSpeed AI Radar Engine",
        "model": "YOLOv8 Tennis Ball Detector",
        "environment": "Hugging Face Spaces (2 vCPU / 16GB RAM)"
    }

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/analyze")
async def analyze_delivery(
    video: UploadFile = File(...),
    max_speed: float = Form(70.0)
):
    req_id = str(uuid.uuid4())[:8]
    input_filename = f"{req_id}_{video.filename}"
    input_path = os.path.join(UPLOAD_DIR, input_filename)
    output_filename = f"processed_{input_filename}"
    output_path = os.path.join(UPLOAD_DIR, output_filename)

    try:
        # Save uploaded video
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(video.file, buffer)

        # Run ball tracking, velocity radar, and deviation analysis
        result = video_processor.process(
            input_video=input_path,
            output_video=output_path,
            max_speed=max_speed
        )

        return JSONResponse({
            "status": "success",
            "video_url": f"/download/{output_filename}",
            "detected_speed": float(result["speed"]),
            "max_speed": float(max_speed),
            "ball_status": result["status"],
            "deviation_angle": float(result.get("deviation_angle", 0.0)),
            "turn_angle": float(result.get("turn_angle", 0.0)),
            "turn_direction": result.get("turn_direction", "Straight"),
            "swing_cm": float(result.get("swing_cm", 0.0)),
            "delivery_type": result.get("delivery_type", "STRAIGHT")
        })

    except Exception as e:
        print(f"Analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/download/{filename}")
def download_processed_video(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Processed video not found.")
    return FileResponse(file_path, media_type="video/mp4", filename=filename)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
