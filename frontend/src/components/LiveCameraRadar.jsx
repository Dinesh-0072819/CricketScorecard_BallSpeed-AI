import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Save, AlertTriangle, ShieldCheck, Zap, Gauge, Radio, Crosshair, Volume2, VolumeX, Smartphone, Camera, Target, User } from 'lucide-react';
import DeliveryAnalysisCard from './DeliveryAnalysisCard';
import PitchMap from './PitchMap';

export default function LiveCameraRadar({ activeMatch, onSyncDelivery }) {
  const [cameraSource, setCameraSource] = useState('mobile'); // 'mobile' (phone camera) or 'server' (PC webcam)
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ current_speed: 0.0, max_speed: 0.0, status: 'SAFE' });
  const [saveStatus, setSaveStatus] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [batsmanHand, setBatsmanHand] = useState('RIGHT');
  const [deliveryAnalysis, setDeliveryAnalysis] = useState(null);
  const [showPitchMap, setShowPitchMap] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const processedImgRef = useRef(null);
  const animFrameRef = useRef(null);
  const prevStatusRef = useRef('SAFE');

  const [cameraError, setCameraError] = useState('');

  // Web Audio Synth Fallback Siren
  const playSynthSiren = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(900, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(450, audioCtx.currentTime + 0.4);

      gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.error('Synth siren error:', e);
    }
  };

  // Play MP3 Cricket No-Ball Sound
  const playNoBallAudio = () => {
    if (isMuted) return;
    try {
      const audio = new Audio('/sounds/no-ball-sound-cricket.mp3');
      audio.play().catch((err) => {
        console.log('HTML5 Audio autoplay restricted:', err);
        playSynthSiren();
      });
    } catch (e) {
      playSynthSiren();
    }
  };

  // Mobile Camera Stream Processing
  useEffect(() => {
    let streamTrack = null;
    let isProcessingFrame = false;

    if (isRunning && cameraSource === 'mobile') {
      const startMobileCamera = async () => {
        try {
          setCameraError('');
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('SECURE_CONTEXT_REQUIRED');
          }
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
          });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
          }
          streamTrack = stream.getVideoTracks()[0];

          const processMobileLoop = async () => {
            if (!isRunning) return;
            if (!isProcessingFrame && videoRef.current && canvasRef.current) {
              isProcessingFrame = true;
              const video = videoRef.current;
              const canvas = canvasRef.current;
              const ctx = canvas.getContext('2d');

              canvas.width = 640;
              canvas.height = 480;
              ctx.drawImage(video, 0, 0, 640, 480);

              const base64Image = canvas.toDataURL('image/jpeg', 0.6);

              try {
                const res = await fetch('/process_frame', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ image: base64Image, batsman_hand: batsmanHand })
                });
                const data = await res.json();
                if (data.status !== 'error') {
                  setStats({
                    current_speed: data.current_speed,
                    max_speed: data.max_speed,
                    status: data.status
                  });
                  if (data.delivery_analysis) {
                    setDeliveryAnalysis(data.delivery_analysis);
                  }
                  if (processedImgRef.current && data.image) {
                    processedImgRef.current.src = data.image;
                  }
                  if (data.status === 'NO-BALL' && prevStatusRef.current !== 'NO-BALL') {
                    playNoBallAudio();
                  }
                  prevStatusRef.current = data.status;
                }
              } catch (e) {
                console.error('Error processing mobile frame:', e);
              }
              isProcessingFrame = false;
            }
            if (isRunning) {
              setTimeout(processMobileLoop, 100);
            }
          };
          processMobileLoop();
        } catch (e) {
          console.error('Failed to access mobile camera:', e);
          setIsRunning(false);
          if (window.location.protocol === 'http:') {
            setCameraError('HTTP_SECURITY_BLOCK');
          } else {
            setCameraError('PERMISSIONS_DENIED');
          }
        }
      };
      startMobileCamera();
    }

    return () => {
      if (streamTrack) {
        streamTrack.stop();
      }
    };
  }, [isRunning, cameraSource, isMuted]);

  // Server Stream Polling
  useEffect(() => {
    let interval;
    if (isRunning && cameraSource === 'server') {
      interval = setInterval(() => {
        fetch('/camera_stats')
          .then(res => res.json())
          .then(data => {
            setStats(data);
            if (data.status === 'NO-BALL' && prevStatusRef.current !== 'NO-BALL') {
              playNoBallAudio();
            }
            prevStatusRef.current = data.status;
          })
          .catch(err => console.error(err));
      }, 400);
    }
    return () => clearInterval(interval);
  }, [isRunning, cameraSource, isMuted]);

  const handleStart = async () => {
    if (cameraSource === 'server') {
      try {
        await fetch('/start_camera');
      } catch (e) {
        console.error(e);
      }
    }
    setIsRunning(true);
  };

  const handleStop = async () => {
    if (cameraSource === 'server') {
      try {
        await fetch('/stop_camera');
      } catch (e) {
        console.error(e);
      }
    }
    setIsRunning(false);
  };

  const handleSaveRun = async () => {
    try {
      const res = await fetch('/save_live_run', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') {
        setSaveStatus(`Saved Run #${data.run_id}!`);
        setTimeout(() => setSaveStatus(''), 3000);
        if (activeMatch && onSyncDelivery) {
          onSyncDelivery(stats.max_speed);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const [isCapturingMobile, setIsCapturingMobile] = useState(false);

  const handleDirectMobileCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsCapturingMobile(true);
    const formData = new FormData();
    formData.append('video', file);
    formData.append('max_speed', 70.0);
    formData.append('batsman_hand', batsmanHand);

    try {
      const res = await fetch('/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      setIsCapturingMobile(false);

      if (res.ok && data.status === 'success') {
        const speed = parseFloat(data.detected_speed);
        setStats({
          current_speed: speed,
          max_speed: speed,
          status: data.ball_status
        });
        if (data.delivery_analysis) {
          setDeliveryAnalysis(data.delivery_analysis);
        }
        if (data.ball_status === 'NO-BALL') {
          playNoBallAudio();
        }
        if (activeMatch && onSyncDelivery) {
          onSyncDelivery(speed);
        }
        setSaveStatus(`Recorded Delivery Speed: ${speed.toFixed(1)} km/h`);
        setTimeout(() => setSaveStatus(''), 4000);
      }
    } catch (err) {
      setIsCapturingMobile(false);
      console.error(err);
    }
  };

  const isNoBall = stats.status === 'NO-BALL';

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px 24px' }}>
      {/* Hidden Video & Canvas for Mobile Camera Processing */}
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* NO-BALL Siren Alert Banner Overlay */}
      {isNoBall && (
        <div className="glass-panel" style={{
          padding: '20px 28px', marginBottom: '24px',
          background: 'rgba(255, 23, 68, 0.25)', borderColor: '#ff1744',
          boxShadow: '0 0 35px rgba(255, 23, 68, 0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          animation: 'pulse 1s infinite'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <AlertTriangle size={36} color="#ff1744" className="live-dot" />
            <div>
              <span style={{ fontSize: '11px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '900' }}>
                SPEED LIMIT EXCEEDED
              </span>
              <h2 style={{ fontSize: '26px', fontWeight: '900', color: '#ff1744', letterSpacing: '1px' }}>
                🚨 NO-BALL ALERT! VELOCITY EXCEEDED LIMIT
              </h2>
            </div>
          </div>
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="btn-action btn-danger"
            style={{ padding: '10px 18px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            {isMuted ? 'SOUND MUTED' : 'SILENCE SOUND'}
          </button>
        </div>
      )}

      {/* Camera Security / Permission Notice Banner */}
      {cameraError && (
        <div className="glass-panel" style={{
          padding: '20px', marginBottom: '24px',
          background: 'rgba(255, 171, 0, 0.15)', borderColor: '#ffab00',
          display: 'flex', flexDirection: 'column', gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <AlertTriangle size={28} color="#ffab00" />
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '900', color: '#ffab00' }}>
                Mobile Camera Stream Notice
              </h3>
              <p style={{ fontSize: '13px', color: '#cbd5e1', marginTop: '4px', lineHeight: '1.5' }}>
                Live browser streaming over plain <code style={{ color: '#00f2fe' }}>http://</code> IP is restricted by phone browsers.
                Use the <strong style={{ color: '#00e676' }}>📷 Record Delivery (Phone Cam)</strong> button below to open your phone camera directly!
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px' }}>
        {/* Video Feed & Radar Window */}
        <div className={`glass-panel ${isNoBall ? '' : 'glass-panel-neon'}`} style={{
          padding: '24px',
          borderColor: isNoBall ? '#ff1744' : undefined,
          boxShadow: isNoBall ? '0 0 30px rgba(255, 23, 68, 0.4)' : undefined
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Zap size={24} className="gradient-text-cyan" />
              <h2 style={{ fontSize: '18px', fontWeight: '900' }}>Live AI Ball Speed Stream</h2>
            </div>

            {/* Controls Bar: Handedness Toggle + Pitch Map + Camera Mode */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Batsman Hand Toggle (RHB / LHB) */}
              <div style={{
                display: 'flex',
                background: 'rgba(5, 8, 17, 0.7)',
                padding: '2px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.12)'
              }}>
                <button
                  type="button"
                  onClick={() => setBatsmanHand('RIGHT')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: '800',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: batsmanHand === 'RIGHT' ? 'rgba(0, 242, 254, 0.25)' : 'transparent',
                    color: batsmanHand === 'RIGHT' ? '#00f2fe' : '#94a3b8'
                  }}
                  title="Right-Handed Batsman"
                >
                  RHB
                </button>
                <button
                  type="button"
                  onClick={() => setBatsmanHand('LEFT')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: '800',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: batsmanHand === 'LEFT' ? 'rgba(0, 242, 254, 0.25)' : 'transparent',
                    color: batsmanHand === 'LEFT' ? '#00f2fe' : '#94a3b8'
                  }}
                  title="Left-Handed Batsman"
                >
                  LHB
                </button>
              </div>

              {/* Pitch Map Toggle */}
              <button
                type="button"
                onClick={() => setShowPitchMap(!showPitchMap)}
                className="btn-action"
                style={{
                  padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px',
                  borderColor: showPitchMap ? '#00f2fe' : 'rgba(255,255,255,0.1)',
                  background: showPitchMap ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
                  color: showPitchMap ? '#00f2fe' : '#94a3b8'
                }}
              >
                <Target size={14} /> Pitch Map
              </button>

              {/* Camera Source Mode Switcher */}
              <button
                onClick={() => { setCameraSource('mobile'); setIsRunning(false); }}
                className="btn-action"
                style={{
                  padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px',
                  borderColor: cameraSource === 'mobile' ? '#00f2fe' : 'rgba(255,255,255,0.1)',
                  background: cameraSource === 'mobile' ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
                  color: cameraSource === 'mobile' ? '#00f2fe' : '#94a3b8'
                }}
              >
                <Smartphone size={14} /> Phone Cam
              </button>
              <button
                onClick={() => { setCameraSource('server'); setIsRunning(false); }}
                className="btn-action"
                style={{
                  padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px',
                  borderColor: cameraSource === 'server' ? '#00f2fe' : 'rgba(255,255,255,0.1)',
                  background: cameraSource === 'server' ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
                  color: cameraSource === 'server' ? '#00f2fe' : '#94a3b8'
                }}
              >
                <Camera size={14} /> Server WebCam
              </button>
            </div>
          </div>

          {/* Video Screen Container */}
          <div className="mobile-video-height" style={{
            width: '100%',
            height: '520px',
            background: '#04060d',
            borderRadius: '16px',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: isNoBall ? '2px solid #ff1744' : '1px solid rgba(255, 255, 255, 0.08)',
            position: 'relative'
          }}>
            {isRunning ? (
              cameraSource === 'mobile' ? (
                <img
                  ref={processedImgRef}
                  alt="Mobile Phone Camera Stream"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <img
                  src="/video_feed"
                  alt="Server Webcam Stream"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              )
            ) : (
              <div style={{ textAlign: 'center', color: '#64748b' }}>
                <div style={{
                  width: '80px', height: '80px', borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto'
                }}>
                  <Crosshair size={40} strokeWidth={1.5} color="#475569" />
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#ffffff', marginBottom: '6px' }}>
                  {cameraSource === 'mobile' ? 'Mobile Phone Camera Ready' : 'Server Webcam Ready'}
                </h3>
                <p style={{ fontSize: '13px', color: '#94a3b8' }}>
                  Tap "📷 Record Delivery (Phone Cam)" below to open mobile camera directly
                </p>
              </div>
            )}

            {/* HUD Overlay Badge */}
            {isRunning && (
              <div style={{
                position: 'absolute', top: '20px', left: '20px',
                background: 'rgba(5, 8, 17, 0.85)', backdropFilter: 'blur(12px)',
                border: isNoBall ? '1px solid #ff1744' : '1px solid rgba(0, 242, 254, 0.4)',
                padding: '12px 18px', borderRadius: '14px',
                display: 'flex', alignItems: 'center', gap: '12px'
              }}>
                <Radio size={16} className="live-dot" color={isNoBall ? '#ff1744' : '#00e676'} />
                <div>
                  <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '800' }}>
                    {cameraSource === 'mobile' ? 'Mobile Camera Radar' : 'Server Webcam Radar'}
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: isNoBall ? '#ff1744' : '#ffffff' }}>
                    {isNoBall ? '🚨 NO-BALL OVER SPEED' : 'YOLOv8 Delivery Tracker'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '24px' }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {!isRunning ? (
                <button onClick={handleStart} className="btn-action btn-gradient" style={{ flex: 1, padding: '16px', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Play size={18} fill="#050811" /> Start AI Radar Stream
                </button>
              ) : (
                <button onClick={handleStop} className="btn-action btn-danger" style={{ flex: 1, padding: '16px', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Square size={18} fill="#ff1744" /> Stop Stream
                </button>
              )}

              {/* Native Phone Camera Direct Record Button (Works 100% on HTTP) */}
              <input
                type="file"
                accept="video/*"
                capture="environment"
                id="native-phone-cam-input"
                onChange={handleDirectMobileCapture}
                style={{ display: 'none' }}
              />
              <label
                htmlFor="native-phone-cam-input"
                className="btn-action"
                style={{
                  flex: 1,
                  padding: '16px',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  borderColor: 'rgba(0, 242, 254, 0.4)',
                  color: '#00f2fe',
                  background: 'rgba(0, 242, 254, 0.12)',
                  cursor: 'pointer'
                }}
              >
                <Camera size={18} /> {isCapturingMobile ? 'Analyzing Speed...' : '📷 Record Delivery (Phone Cam)'}
              </label>
            </div>

            <button
              onClick={handleSaveRun}
              disabled={stats.max_speed === 0}
              className="btn-action"
              style={{
                width: '100%',
                padding: '14px',
                borderColor: stats.max_speed > 0 ? 'rgba(0, 230, 118, 0.4)' : 'rgba(255,255,255,0.1)',
                background: stats.max_speed > 0 ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255,255,255,0.04)',
                color: stats.max_speed > 0 ? '#00e676' : '#64748b',
                cursor: stats.max_speed > 0 ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
              }}
            >
              <Save size={18} /> Log Speed Run
            </button>
          </div>
          {saveStatus && (
            <p style={{ marginTop: '12px', fontSize: '13px', color: '#00e676', textAlign: 'center', fontWeight: '700' }}>
              {saveStatus}
            </p>
          )}
        </div>

        {/* Speedometer Telemetry Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Instant Speed Gauge */}
          <div className="glass-panel" style={{ padding: '28px', textAlign: 'center' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '800' }}>
              Instant Velocity Radar
            </span>
            <div style={{
              fontSize: '64px', fontWeight: '900', fontFamily: 'var(--font-mono)',
              margin: '12px 0', color: isNoBall ? '#ff1744' : '#00f2fe', lineHeight: 1
            }}>
              {stats.current_speed.toFixed(1)}
              <span style={{ fontSize: '20px', color: '#64748b', marginLeft: '6px' }}>km/h</span>
            </div>
            <p style={{ fontSize: '13px', color: '#94a3b8' }}>Real-time trajectory frame velocity</p>
          </div>

          {/* Peak Velocity Card */}
          <div className="glass-panel" style={{
            padding: '28px', textAlign: 'center',
            background: 'rgba(255, 171, 0, 0.05)', borderColor: 'rgba(255, 171, 0, 0.25)'
          }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '800' }}>
              Delivery Peak Velocity
            </span>
            <div style={{
              fontSize: '64px', fontWeight: '900', fontFamily: 'var(--font-mono)',
              margin: '12px 0', color: '#ffab00', lineHeight: 1
            }}>
              {stats.max_speed.toFixed(1)}
              <span style={{ fontSize: '20px', color: '#64748b', marginLeft: '6px' }}>km/h</span>
            </div>
            <p style={{ fontSize: '13px', color: '#94a3b8' }}>Maximum velocity recorded in run</p>
          </div>

          {/* Delivery Audit Safety Card */}
          <div className="glass-panel" style={{
            padding: '22px 24px',
            background: isNoBall ? 'rgba(255, 23, 68, 0.2)' : 'rgba(0, 230, 118, 0.12)',
            borderColor: isNoBall ? '#ff1744' : 'rgba(0, 230, 118, 0.35)',
            display: 'flex', alignItems: 'center', gap: '18px'
          }}>
            {isNoBall ? (
              <AlertTriangle size={36} color="#ff1744" className="live-dot" />
            ) : (
              <ShieldCheck size={36} color="#00e676" />
            )}
            <div>
              <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>Delivery Audit</div>
              <div style={{ fontSize: '18px', fontWeight: '900', color: isNoBall ? '#ff1744' : '#00e676' }}>
                {isNoBall ? '🚨 NO-BALL ALERT' : 'LEGAL DELIVERY'}
              </div>
            </div>
          </div>

          {/* Real-Time Delivery Movement Analysis Card */}
          <DeliveryAnalysisCard
            analysis={deliveryAnalysis}
            speedKmh={stats.max_speed}
          />
        </div>
      </div>

      {/* Collapsible Pitch Map View */}
      {showPitchMap && (
        <div style={{ marginTop: '24px' }}>
          <PitchMap matchId={activeMatch ? activeMatch.match_id : null} />
        </div>
      )}
    </div>
  );
}
