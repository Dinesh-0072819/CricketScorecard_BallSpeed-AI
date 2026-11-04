#!/usr/bin/env bash
# Exit immediately if a command exits with a non-zero status
set -o errexit

echo "========================================="
echo " Starting CricSpeed AI Render Build Process "
echo "========================================="

# 1. Upgrade pip
python -m pip install --upgrade pip

# 2. (PyTorch not needed: ball detection runs on ONNX via onnxruntime)

# 3. Install remaining Python backend dependencies
echo "Installing Python dependencies..."
pip install --no-cache-dir -r requirements.txt

# 4. Build Vite React frontend
echo "Building React SPA frontend..."
cd frontend
npm install
npm run build
cd ..

# 5. Ensure runtime directories exist
mkdir -p uploads database

echo "========================================="
echo " CricSpeed AI Build Completed Successfully! "
echo "========================================="
