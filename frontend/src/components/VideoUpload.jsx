import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, CheckCircle2, Film, Gauge, AlertTriangle, ShieldCheck, Volume2, VolumeX, Zap, Loader2, Sparkles, Activity, Cpu } from 'lucide-react';

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

      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch('/upload_progress');
          const data = await res.json();
          if (data && data.status === 'processing') {
            setProcessingProgress(data.percent || 0);
            if (data.message) {
              setStatusDetails(data.message);
            }
          }
        } catch (err) {
          console.error('Error polling processing progress:', err);
        }
      }, 250);
    };

    // Track live upload progress percentage
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
        const loadedMB = (event.loaded / (1024 * 1024)).toFixed(1);
        const totalMB = (event.total / (1024 * 1024)).toFixed(1);

        if (percent < 100) {
          setStatusDetails(`Uploading video payload: ${loadedMB} MB / ${totalMB} MB (${percent}%)`);
        } else {
          startProcessingPoll();
        }
      }
    };

    xhr.onload = () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsProcessing(false);
      setProcessingProgress(100);

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.status === 'success') {
            setUploadPhase('done');
            setResult(data);
            if (data.ball_status === 'NO-BALL' || data.detected_speed > maxSpeedLimit) {
              playNoBallAudio();
            }
          } else {
            setUploadPhase('error');
            setError(data.message || 'Failed to analyze video delivery.');
          }
        } catch (err) {
          setUploadPhase('error');
          setError('Invalid response received from server.');
        }
      } else {
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
