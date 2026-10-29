---
title: CricSpeed AI Radar Microservice
emoji: 🏏
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# CricSpeed AI High-Performance Ball Radar Microservice

Dedicated AI backend for real-time cricket/tennis ball speed calculation, trajectory tracking, and delivery movement analysis powered by YOLOv8.

### Endpoints
- `GET /`: Healthcheck and service status
- `POST /analyze`: Video bowling delivery analyzer (returns speed, deviation angle, swing, turn direction)
- `GET /download/{filename}`: Download processed video overlay
