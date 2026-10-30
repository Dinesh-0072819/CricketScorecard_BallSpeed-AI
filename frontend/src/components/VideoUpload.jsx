import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, CheckCircle2, Film, Gauge, AlertTriangle, ShieldCheck, Volume2, VolumeX, Zap, Loader2, Sparkles, Activity, Cpu, Play, Pause, RotateCcw, ChevronLeft, ChevronRight, Sliders, Eye } from 'lucide-react';

export default function VideoUpload() {
  const [file, setFile] = useState(null);
  const [maxSpeedLimit, setMaxSpeedLimit] = useState(70.0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState('idle'); // 'idle' | 'uploading' | 'processing' | 'done' | 'error'
  const [statusDetails, setStatusDetails] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isMuted, setIsMuted] = useState(false);

  // Video Player & Coaching Analysis states
  const videoRef = useRef(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [videoSourceMode, setVideoSourceMode] = useState('processed'); // 'processed' | 'original'
  const [isPlaying, setIsPlaying] = useState(false);

  const pollIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const playNoBallAudio = () => {
    if (isMuted) return;
    try {
      const audio = new Audio('/sounds/no-ball-sound-cricket.mp3');
      audio.play().catch((err) => console.log('Audio autoplay restricted:', err));
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpload = (e) => {
    e.preventDefault();
    if (!file) return;

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    setIsProcessing(true);
    setUploadProgress(0);
    setProcessingProgress(0);
    setUploadPhase('uploading');
    setStatusDetails('Starting video transfer...');
    setError('');
    setResult(null);

    const formData = new FormData();
    formData.append('video', file);
    formData.append('max_speed', maxSpeedLimit);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);

    const startProcessingPoll = () => {
      if (pollIntervalRef.current) return;
      setUploadPhase('processing');
      setProcessingProgress(0);
      setStatusDetails('Initializing AI model & reading video frames...');

      let isFetching = false;
      pollIntervalRef.current = setInterval(async () => {
        if (isFetching) return;
        isFetching = true;
        try {
          const res = await fetch('/upload_progress');
          const data = await res.json();
          if (data) {
            if (typeof data.percent === 'number' && data.percent > 0) {
              setProcessingProgress(data.percent);
            }
            if (data.message) {
              setStatusDetails(data.message);
            }
            if (data.status === 'done' && data.result) {
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
              setIsProcessing(false);
              setProcessingProgress(100);
              setUploadPhase('done');
              setResult(data.result);
              if (data.result.ball_status === 'NO-BALL' || data.result.detected_speed > maxSpeedLimit) {
                playNoBallAudio();
              }
            } else if (data.status === 'error') {
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
              setIsProcessing(false);
              setUploadPhase('error');
              setError(data.message || 'AI processing encountered an error.');
            }
          }
        } catch (err) {
          console.error('Error polling processing progress:', err);
        } finally {
          isFetching = false;
        }
      }, 1000);
    };

    const uploadStartTime = Date.now();
    // Track live upload progress percentage, transfer rate and remaining time
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
        const loadedMB = (event.loaded / (1024 * 1024)).toFixed(1);
        const totalMB = (event.total / (1024 * 1024)).toFixed(1);
        const elapsedSec = (Date.now() - uploadStartTime) / 1000;
        const speedMBps = elapsedSec > 0.1 ? ((event.loaded / (1024 * 1024)) / elapsedSec).toFixed(1) : '2.0';
        const remainingMB = Math.max(0, (event.total - event.loaded) / (1024 * 1024));
        const etaSec = parseFloat(speedMBps) > 0 ? Math.ceil(remainingMB / parseFloat(speedMBps)) : 1;

        if (percent < 100) {
          setStatusDetails(`Uploading: ${loadedMB} MB / ${totalMB} MB (${percent}%) • ⚡ ${speedMBps} MB/s • ETA: ${etaSec}s`);
        } else {
          startProcessingPoll();
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.status === 'accepted') {
            // Upload complete! Let polling handle background AI execution
            startProcessingPoll();
          } else if (data.status === 'success') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setIsProcessing(false);
            setProcessingProgress(100);
            setUploadPhase('done');
            setResult(data);
            if (data.ball_status === 'NO-BALL' || data.detected_speed > maxSpeedLimit) {
              playNoBallAudio();
            }
          } else {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setIsProcessing(false);
            setUploadPhase('error');
            setError(data.message || 'Failed to analyze video delivery.');
          }
        } catch (err) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setIsProcessing(false);
          setUploadPhase('error');
          setError('Invalid response received from server.');
        }
      } else {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setIsProcessing(false);
        setUploadPhase('error');
        setError(`Server returned status error ${xhr.status}.`);
      }
    };

    xhr.onerror = () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsProcessing(false);
      setUploadPhase('error');
      setError('Network connection error occurred during upload.');
    };

    xhr.send(formData);
  };

  const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  const handleSpeedChange = (speed) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleRestart = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current.playbackRate = playbackSpeed;
    videoRef.current.play();
    setIsPlaying(true);
  };

  const handleStepFrame = (deltaSec) => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    setIsPlaying(false);
    videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration || 100, videoRef.current.currentTime + deltaSec));
  };

  const handleSwitchSource = (mode) => {
    if (!videoRef.current) return;
    const currentPos = videoRef.current.currentTime;
    const wasPlaying = !videoRef.current.paused;
    setVideoSourceMode(mode);
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = currentPos;
        videoRef.current.playbackRate = playbackSpeed;
        if (wasPlaying) {
          videoRef.current.play();
          setIsPlaying(true);
        }
      }
    }, 60);
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
              <p style={{ fontSize: '13px', color: '#94a3b8' }}>Upload match bowling footage for real-time tracking, velocity radar & no-ball analysis</p>
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
              onChange={(e) => {
                setFile(e.target.files[0]);
                setUploadProgress(0);
                setProcessingProgress(0);
                setUploadPhase('idle');
                setResult(null);
                setError('');
              }}
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

          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: '700' }}>
                Speed Threshold Limit (km/h)
              </label>
              <input
                type="number"
                value={maxSpeedLimit}
                onChange={(e) => setMaxSpeedLimit(e.target.value)}
                className="input-premium"
                style={{ width: '100%' }}
                disabled={isProcessing}
              />
            </div>
            <button
              type="submit"
              disabled={!file || isProcessing}
              className={`btn-action ${file && !isProcessing ? 'btn-gradient' : ''}`}
              style={{
                flex: 1,
                padding: '16px',
                fontSize: '15px',
                marginTop: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={18} className="spin-animation" />
                  {uploadPhase === 'uploading' 
                    ? `Uploading (${uploadProgress}%)` 
                    : `Processing (${processingProgress}%)`}
                </>
              ) : (
                'Analyze Video Trajectory'
              )}
            </button>
          </div>
        </form>

        {/* Live Upload & Processing Progress Cards */}
        {isProcessing && (
          <div style={{
            background: 'rgba(8, 14, 28, 0.85)',
            border: uploadPhase === 'uploading' ? '1px solid rgba(0, 242, 254, 0.35)' : '1px solid rgba(0, 230, 118, 0.4)',
            borderRadius: '16px',
            padding: '24px',
            marginBottom: '24px',
            boxShadow: uploadPhase === 'uploading' ? '0 0 25px rgba(0, 242, 254, 0.15)' : '0 0 25px rgba(0, 230, 118, 0.15)'
          }}>
            {/* Header with Title and Current Percentage */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {uploadPhase === 'uploading' ? (
                  <UploadCloud size={22} color="#00f2fe" className="live-dot" />
                ) : (
                  <Cpu size={22} color="#00e676" className="live-dot" />
                )}
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '800', color: '#f8fafc' }}>
                    {uploadPhase === 'uploading' ? 'Uploading Delivery Video Footage' : 'AI Ball Tracking & Velocity Radar Processing'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                    {uploadPhase === 'uploading' ? 'Transferring video file to server' : 'Running YOLOv8, ByteTrack & Movement Analytics'}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{
                  fontSize: '20px',
                  fontWeight: '900',
                  color: uploadPhase === 'uploading' ? '#00f2fe' : '#00e676',
                  fontFamily: 'var(--font-mono)'
                }}>
                  {uploadPhase === 'uploading' ? `${uploadProgress}%` : `${processingProgress}%`}
                </span>
              </div>
            </div>

            {/* Glowing Linear Loading Progress Bar */}
            <div style={{
              width: '100%',
              height: '12px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.08)',
              overflow: 'hidden',
              marginBottom: '14px',
              position: 'relative'
            }}>
              <div style={{
                width: uploadPhase === 'uploading' ? `${uploadProgress}%` : `${processingProgress}%`,
                height: '100%',
                borderRadius: '8px',
                background: uploadPhase === 'uploading'
                  ? 'linear-gradient(90deg, #00f2fe 0%, #4facfe 100%)'
                  : 'linear-gradient(90deg, #00e676 0%, #00f2fe 100%)',
                boxShadow: uploadPhase === 'uploading'
                  ? '0 0 15px rgba(0, 242, 254, 0.6)'
                  : '0 0 15px rgba(0, 230, 118, 0.6)',
                transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
              }} />
            </div>

            {/* Status Footer Details */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8' }}>
              <span style={{ color: '#cbd5e1', fontWeight: '600' }}>
                {statusDetails}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: uploadPhase === 'uploading' ? '#00f2fe' : '#00e676', fontWeight: '700' }}>
                <Sparkles size={14} />
                {uploadPhase === 'uploading' ? 'Stage 1 of 2: Upload' : 'Stage 2 of 2: AI Processing'}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="glass-panel" style={{ padding: '16px 20px', background: 'rgba(255, 23, 68, 0.15)', borderColor: '#ff1744', marginBottom: '20px', textAlign: 'center' }}>
            <p style={{ color: '#ff1744', fontSize: '14px', fontWeight: '700' }}>
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
                padding: '20px 24px', marginBottom: '24px',
                background: 'rgba(255, 23, 68, 0.25)', borderColor: '#ff1744',
                boxShadow: '0 0 30px rgba(255, 23, 68, 0.5)',
                display: 'flex', alignItems: 'center', gap: '16px'
              }}>
                <AlertTriangle size={36} color="#ff1744" className="live-dot" />
                <div>
                  <span style={{ fontSize: '11px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '900' }}>
                    ANALYSIS RESULT: OVER SPEED
                  </span>
                  <h3 style={{ fontSize: '22px', fontWeight: '900', color: '#ff1744' }}>
                    🚨 NO-BALL DETECTED! Velocity: {result.detected_speed.toFixed(1)} km/h (Limit: {maxSpeedLimit} km/h)
                  </h3>
                </div>
              </div>
            ) : (
              <div className="glass-panel" style={{
                padding: '20px 24px', marginBottom: '24px',
                background: 'rgba(0, 230, 118, 0.15)', borderColor: '#00e676',
                display: 'flex', alignItems: 'center', gap: '16px'
              }}>
                <ShieldCheck size={36} color="#00e676" />
                <div>
                  <span style={{ fontSize: '11px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '900' }}>
                    ANALYSIS RESULT: LEGAL DELIVERY
                  </span>
                  <h3 style={{ fontSize: '22px', fontWeight: '900', color: '#00e676' }}>
                    ✓ Legal Delivery: {result.detected_speed.toFixed(1)} km/h (Limit: {maxSpeedLimit} km/h)
                  </h3>
                </div>
              </div>
            )}

            {/* Movement Analytics Cards Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '14px',
              marginBottom: '20px'
            }}>
              {/* Speed Card */}
              <div style={{
                background: 'rgba(5, 8, 17, 0.75)',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid rgba(0, 242, 254, 0.25)'
              }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>
                  Ball Speed
                </span>
                <div style={{ fontSize: '24px', fontWeight: '900', color: '#00f2fe', marginTop: '4px' }}>
                  {result.detected_speed.toFixed(1)} <span style={{ fontSize: '14px' }}>km/h</span>
                </div>
              </div>

              {/* Angle of Deviation Card */}
              <div style={{
                background: 'rgba(5, 8, 17, 0.75)',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid rgba(255, 171, 0, 0.25)'
              }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>
                  Angle of Deviation (Turn)
                </span>
                <div style={{ fontSize: '24px', fontWeight: '900', color: '#ffab00', marginTop: '4px' }}>
                  {result.deviation_angle != null ? Number(result.deviation_angle).toFixed(1) : '0.0'}°
                </div>
                <span style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: '600' }}>
                  {result.turn_direction || 'Straight'}
                </span>
              </div>

              {/* Air Swing Card */}
              <div style={{
                background: 'rgba(5, 8, 17, 0.75)',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid rgba(0, 230, 118, 0.25)'
              }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>
                  Air Swing
                </span>
                <div style={{ fontSize: '24px', fontWeight: '900', color: '#00e676', marginTop: '4px' }}>
                  {result.swing_cm != null ? Number(result.swing_cm).toFixed(1) : '0.0'} <span style={{ fontSize: '14px' }}>cm</span>
                </div>
              </div>

              {/* Delivery Type Card */}
              <div style={{
                background: 'rgba(5, 8, 17, 0.75)',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>
                  Delivery Type
                </span>
                <div style={{
                  display: 'inline-block',
                  marginTop: '8px',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '800',
                  background: result.delivery_type === 'OFF_SPIN' ? 'rgba(0, 242, 254, 0.2)' :
                              result.delivery_type === 'LEG_SPIN' ? 'rgba(255, 171, 0, 0.2)' :
                              result.delivery_type === 'INSWING' ? 'rgba(0, 230, 118, 0.2)' :
                              result.delivery_type === 'OUTSWING' ? 'rgba(255, 23, 68, 0.2)' : 'rgba(255,255,255,0.1)',
                  color: result.delivery_type === 'OFF_SPIN' ? '#00f2fe' :
                         result.delivery_type === 'LEG_SPIN' ? '#ffab00' :
                         result.delivery_type === 'INSWING' ? '#00e676' :
                         result.delivery_type === 'OUTSWING' ? '#ff1744' : '#cbd5e1'
                }}>
                  {result.delivery_type || 'STRAIGHT'}
                </div>
              </div>
            </div>

            {/* Coach & Player Analysis Breakdown Box */}
            <div style={{
              background: 'rgba(5, 8, 17, 0.85)',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '20px',
              border: '1px solid rgba(255, 171, 0, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <div>
                <span style={{ fontSize: '11px', color: '#ffab00', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  🎯 Spin & Trajectory Breakdown
                </span>
                <p style={{ fontSize: '14px', color: '#f8fafc', fontWeight: '700', marginTop: '4px' }}>
                  {result.turn_direction || 'Straight'}: Off-the-pitch turn measured at{' '}
                  <span style={{ color: '#ffab00', fontWeight: '900' }}>
                    {result.deviation_angle != null ? Number(result.deviation_angle).toFixed(1) : '0.0'}°
                  </span>{' '}
                  with{' '}
                  <span style={{ color: '#00e676', fontWeight: '900' }}>
                    {result.swing_cm != null ? Number(result.swing_cm).toFixed(1) : '0.0'} cm
                  </span>{' '}
                  air swing drift.
                </p>
              </div>

              <div style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '800',
                background: 'rgba(255, 171, 0, 0.15)',
                color: '#ffab00',
                border: '1px solid rgba(255, 171, 0, 0.3)'
              }}>
                Turn: {result.deviation_angle != null ? Number(result.deviation_angle).toFixed(1) : '0.0'}° Deviation
              </div>
            </div>

            {/* Player & Coach Video Analysis Suite */}
            <div style={{
              background: 'rgba(8, 12, 24, 0.95)',
              borderRadius: '16px',
              border: isNoBall ? '2px solid rgba(255, 23, 68, 0.5)' : '1px solid rgba(0, 242, 254, 0.3)',
              padding: '20px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)'
            }}>
              {/* Top Bar: Video Source Switcher & Active Speed Badge */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                marginBottom: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => handleSwitchSource('processed')}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: '800',
                      cursor: 'pointer',
                      border: videoSourceMode === 'processed' ? '1px solid #00f2fe' : '1px solid rgba(255,255,255,0.1)',
                      background: videoSourceMode === 'processed' ? 'rgba(0, 242, 254, 0.2)' : 'rgba(255,255,255,0.05)',
                      color: videoSourceMode === 'processed' ? '#00f2fe' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Eye size={14} /> AI Trajectory & Speed HUD
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSwitchSource('original')}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: '800',
                      cursor: 'pointer',
                      border: videoSourceMode === 'original' ? '1px solid #00e676' : '1px solid rgba(255,255,255,0.1)',
                      background: videoSourceMode === 'original' ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255,255,255,0.05)',
                      color: videoSourceMode === 'original' ? '#00e676' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Film size={14} /> Original Video (Natural Speed)
                  </button>
                </div>

                <div style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: '800',
                  background: playbackSpeed < 1.0 ? 'rgba(255, 171, 0, 0.15)' : playbackSpeed === 1.0 ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 23, 68, 0.15)',
                  border: playbackSpeed < 1.0 ? '1px solid rgba(255, 171, 0, 0.4)' : playbackSpeed === 1.0 ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid rgba(255, 23, 68, 0.4)',
                  color: playbackSpeed < 1.0 ? '#ffab00' : playbackSpeed === 1.0 ? '#00f2fe' : '#ff1744',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <Zap size={14} />
                  Playback: {playbackSpeed}x {playbackSpeed < 1.0 ? '(Slow Motion)' : playbackSpeed === 1.0 ? '(Normal Speed)' : '(Fast)'}
                </div>
              </div>

              {/* Video Element */}
              <div style={{
                borderRadius: '12px',
                overflow: 'hidden',
                background: '#000',
                position: 'relative',
                marginBottom: '16px'
              }}>
                <video
                  ref={videoRef}
                  key={videoSourceMode}
                  controls
                  playsInline
                  src={videoSourceMode === 'original' ? (result.original_video_url || result.video_url) : result.video_url}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onLoadedMetadata={() => {
                    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
                  }}
                  style={{ width: '100%', maxHeight: '480px', display: 'block', margin: '0 auto' }}
                />
              </div>

              {/* Video Controls & Slow Motion Bar */}
              <div style={{
                background: 'rgba(15, 23, 42, 0.8)',
                borderRadius: '12px',
                padding: '16px',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}>
                {/* Slow-Mo & Speed Presets */}
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <Sliders size={14} color="#00f2fe" />
                    <span style={{ fontSize: '12px', fontWeight: '800', color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Player Analysis Playback Speed:
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {SPEED_OPTIONS.map((spd) => {
                      const isActive = playbackSpeed === spd;
                      const isSlow = spd < 1.0;
                      const isNormal = spd === 1.0;
                      return (
                        <button
                          key={spd}
                          type="button"
                          onClick={() => handleSpeedChange(spd)}
                          style={{
                            flex: '1 1 auto',
                            minWidth: '70px',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: '800',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            border: isActive
                              ? (isSlow ? '1px solid #ffab00' : isNormal ? '1px solid #00f2fe' : '1px solid #00e676')
                              : '1px solid rgba(255, 255, 255, 0.12)',
                            background: isActive
                              ? (isSlow ? 'rgba(255, 171, 0, 0.25)' : isNormal ? 'rgba(0, 242, 254, 0.25)' : 'rgba(0, 230, 118, 0.25)')
                              : 'rgba(255, 255, 255, 0.04)',
                            color: isActive
                              ? (isSlow ? '#ffab00' : isNormal ? '#00f2fe' : '#00e676')
                              : '#94a3b8',
                            boxShadow: isActive ? '0 0 12px rgba(0, 242, 254, 0.2)' : 'none'
                          }}
                        >
                          {spd}x {spd === 0.25 ? '🔥 1/4x' : spd === 0.5 ? '⚡ 1/2x' : spd === 1.0 ? '🎯 Normal' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Frame-by-Frame & Action Controls */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                  paddingTop: '12px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => handleStepFrame(-0.033)}
                      className="btn-action"
                      style={{ padding: '8px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      title="Step back 1 frame for release & seam analysis"
                    >
                      <ChevronLeft size={16} /> -1 Frame
                    </button>

                    <button
                      type="button"
                      onClick={handleTogglePlay}
                      className="btn-action"
                      style={{
                        padding: '8px 16px',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        borderColor: '#00f2fe',
                        color: '#00f2fe',
                        background: 'rgba(0, 242, 254, 0.12)'
                      }}
                    >
                      {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleStepFrame(0.033)}
                      className="btn-action"
                      style={{ padding: '8px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      title="Step forward 1 frame for bounce & pitch analysis"
                    >
                      +1 Frame <ChevronRight size={16} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleRestart}
                    className="btn-action"
                    style={{ padding: '8px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <RotateCcw size={14} /> Replay Delivery
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
