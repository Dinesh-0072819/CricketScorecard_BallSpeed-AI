import React, { useState } from 'react';
import { UploadCloud, CheckCircle2, Film, Gauge, AlertTriangle, ShieldCheck, Volume2, VolumeX, Zap, User } from 'lucide-react';
import DeliveryAnalysisCard from './DeliveryAnalysisCard';

export default function VideoUpload() {
  const [file, setFile] = useState(null);
  const [maxSpeedLimit, setMaxSpeedLimit] = useState(70.0);
  const [batsmanHand, setBatsmanHand] = useState('RIGHT');
  const [calibrationProfile, setCalibrationProfile] = useState('behind_bowler');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isMuted, setIsMuted] = useState(false);

  const playNoBallAudio = () => {
    if (isMuted) return;
    try {
      const audio = new Audio('/sounds/no-ball-sound-cricket.mp3');
      audio.play().catch((err) => console.log('Audio autoplay restricted:', err));
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    setIsProcessing(true);
    setError('');
    setResult(null);

    const formData = new FormData();
    formData.append('video', file);
    formData.append('max_speed', maxSpeedLimit);
    formData.append('batsman_hand', batsmanHand);
    formData.append('calibration_profile', calibrationProfile);

    try {
      const res = await fetch('/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      setIsProcessing(false);

      if (res.ok && data.status === 'success') {
        setResult(data);
        if (data.ball_status === 'NO-BALL' || data.detected_speed > maxSpeedLimit) {
          playNoBallAudio();
        }
      } else {
        setError(data.message || 'Failed to process video delivery.');
      }
    } catch (err) {
      setIsProcessing(false);
      setError('Failed to process video delivery: ' + (err.message || 'Server error'));
      console.error(err);
    }
  };

  const isNoBall = result && (result.ball_status === 'NO-BALL' || result.detected_speed > maxSpeedLimit);

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '32px 24px' }}>
      <div className="glass-panel" style={{ padding: '32px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <UploadCloud size={32} className="gradient-text-cyan" />
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: '900' }}>AI Bowling Delivery Video Analyzer</h2>
              <p style={{ fontSize: '13px', color: '#94a3b8' }}>Upload match bowling footage for frame-by-frame velocity & ball movement analysis</p>
            </div>
          </div>

          <button
            onClick={() => setIsMuted(!isMuted)}
            className="btn-action"
            style={{
              padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px',
              borderColor: isMuted ? 'rgba(255, 23, 68, 0.4)' : 'rgba(0, 242, 254, 0.4)',
              color: isMuted ? '#ff1744' : '#00f2fe'
            }}
          >
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            {isMuted ? 'Sound Muted' : 'No-Ball Audio ON'}
          </button>
        </div>

        <form onSubmit={handleUpload}>
          <div style={{
            border: '2px dashed rgba(255, 255, 255, 0.15)',
            borderRadius: '16px',
            padding: '40px',
            textAlign: 'center',
            marginBottom: '20px',
            background: 'rgba(8, 12, 24, 0.5)'
          }}>
            <Film size={48} color="#64748b" style={{ marginBottom: '12px' }} />
            <p style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px' }}>
              {file ? file.name : 'Select or Drop Cricket Delivery Video'}
            </p>
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files[0])}
              style={{ display: 'none' }}
              id="video-input"
            />
            <label
              htmlFor="video-input"
              className="btn-action"
              style={{
                display: 'inline-block',
                padding: '10px 24px',
                fontSize: '13px',
                borderColor: 'rgba(0, 242, 254, 0.4)',
                color: '#00f2fe',
                background: 'rgba(0, 242, 254, 0.12)',
                cursor: 'pointer'
              }}
            >
              Browse Video File
            </label>
          </div>

          {/* Controls: Batsman Hand, Calibration & Speed Threshold */}
          <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            {/* Batsman Hand Toggle */}
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: '700' }}>
                Batsman Handedness
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setBatsmanHand('RIGHT')}
                  className="btn-action"
                  style={{
                    flex: 1, padding: '10px', fontSize: '13px', fontWeight: '800',
                    background: batsmanHand === 'RIGHT' ? 'rgba(0, 242, 254, 0.2)' : 'transparent',
                    borderColor: batsmanHand === 'RIGHT' ? '#00f2fe' : 'rgba(255, 255, 255, 0.15)',
                    color: batsmanHand === 'RIGHT' ? '#00f2fe' : '#94a3b8'
                  }}
                >
                  Right Hand (RHB)
                </button>
                <button
                  type="button"
                  onClick={() => setBatsmanHand('LEFT')}
                  className="btn-action"
                  style={{
                    flex: 1, padding: '10px', fontSize: '13px', fontWeight: '800',
                    background: batsmanHand === 'LEFT' ? 'rgba(0, 242, 254, 0.2)' : 'transparent',
                    borderColor: batsmanHand === 'LEFT' ? '#00f2fe' : 'rgba(255, 255, 255, 0.15)',
                    color: batsmanHand === 'LEFT' ? '#00f2fe' : '#94a3b8'
                  }}
                >
                  Left Hand (LHB)
                </button>
              </div>
            </div>

            {/* Calibration Profile */}
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: '700' }}>
                Camera Perspective Profile
              </label>
              <select
                value={calibrationProfile}
                onChange={(e) => setCalibrationProfile(e.target.value)}
                className="input-premium"
                style={{ width: '100%', padding: '10px 12px' }}
              >
                <option value="behind_bowler">Behind Bowler (Recommended)</option>
                <option value="default">Default Homography</option>
              </select>
            </div>

            {/* Speed Limit */}
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: '700' }}>
                Speed Threshold Limit (km/h)
              </label>
              <input
                type="number"
                value={maxSpeedLimit}
                onChange={(e) => setMaxSpeedLimit(e.target.value)}
                className="input-premium"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!file || isProcessing}
            className={`btn-action ${file && !isProcessing ? 'btn-gradient' : ''}`}
            style={{
              width: '100%',
              padding: '16px',
              fontSize: '15px'
            }}
          >
            {isProcessing ? 'Analyzing YOLO Velocity & Ball Movement Trajectory...' : 'Analyze Video Trajectory'}
          </button>
        </form>

        {error && (
          <div className="glass-panel" style={{ padding: '16px 20px', background: 'rgba(255, 23, 68, 0.15)', borderColor: '#ff1744', marginTop: '20px', textAlign: 'center' }}>
            <p style={{ color: '#ff1744', fontSize: '14px', fontWeight: '700', margin: 0 }}>
              ⚠️ {error}
            </p>
          </div>
        )}

        {/* Video Processing Results & Alert Banner */}
        {result && (
          <div style={{ marginTop: '28px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '24px' }}>
            {/* NO-BALL Alert Banner */}
            {isNoBall ? (
              <div className="glass-panel" style={{
                padding: '20px 24px', marginBottom: '20px',
                background: 'rgba(255, 23, 68, 0.25)', borderColor: '#ff1744',
                boxShadow: '0 0 30px rgba(255, 23, 68, 0.5)',
                display: 'flex', alignItems: 'center', gap: '16px'
              }}>
                <AlertTriangle size={36} color="#ff1744" className="live-dot" />
                <div>
                  <span style={{ fontSize: '11px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '900' }}>
                    ANALYSIS RESULT: OVER SPEED
                  </span>
                  <h3 style={{ fontSize: '20px', fontWeight: '900', color: '#ff1744', margin: '4px 0 0 0' }}>
                    🚨 NO-BALL DETECTED! Velocity: {result.detected_speed.toFixed(1)} km/h (Limit: {maxSpeedLimit} km/h)
                  </h3>
                </div>
              </div>
            ) : (
              <div className="glass-panel" style={{
                padding: '20px 24px', marginBottom: '20px',
                background: 'rgba(0, 230, 118, 0.15)', borderColor: '#00e676',
                display: 'flex', alignItems: 'center', gap: '16px'
              }}>
                <ShieldCheck size={36} color="#00e676" />
                <div>
                  <span style={{ fontSize: '11px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '900' }}>
                    ANALYSIS RESULT: LEGAL DELIVERY
                  </span>
                  <h3 style={{ fontSize: '20px', fontWeight: '900', color: '#00e676', margin: '4px 0 0 0' }}>
                    ✓ Legal Delivery: {result.detected_speed.toFixed(1)} km/h (Limit: {maxSpeedLimit} km/h)
                  </h3>
                </div>
              </div>
            )}

            {/* Delivery Movement Analysis Card */}
            {result.delivery_analysis && (
              <div style={{ marginBottom: '20px' }}>
                <DeliveryAnalysisCard
                  analysis={result.delivery_analysis}
                  speedKmh={result.detected_speed}
                />
              </div>
            )}

            {/* Video Player Display */}
            <div style={{ borderRadius: '16px', overflow: 'hidden', border: isNoBall ? '2px solid #ff1744' : '1px solid rgba(255,255,255,0.15)' }}>
              <video controls src={result.video_url} style={{ width: '100%', maxHeight: '520px', background: '#000' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

