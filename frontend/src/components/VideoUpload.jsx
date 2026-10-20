import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  CheckCircle2,
  Film,
  Gauge,
  AlertTriangle,
  ShieldCheck,
  Volume2,
  VolumeX,
  Zap,
  Download,
  FileJson,
  Play,
  RotateCcw,
  Target,
  BarChart3,
  Sparkles
} from 'lucide-react';
import DeliveryAnalysisCard from './DeliveryAnalysisCard';
import PitchMap from './PitchMap';
import BatsmanHandToggle from './BatsmanHandToggle';
import DeliveryTypeBadge, { getDeliveryColor } from './DeliveryTypeBadge';

export default function VideoUpload() {
  const [file, setFile] = useState(null);
  const [maxSpeedLimit, setMaxSpeedLimit] = useState(70.0);
  const [batsmanHand, setBatsmanHand] = useState('RIGHT');
  const [calibrationProfile, setCalibrationProfile] = useState('behind_bowler');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedDeliveryIndex, setSelectedDeliveryIndex] = useState(0);

  const videoRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Clean up polling interval
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
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

  const startProgressPolling = () => {
    setProgress(5);
    setProgressMsg('Uploading video...');
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/upload/status');
        const data = await res.json();
        if (data && data.percent != null) {
          setProgress(data.percent);
          if (data.message) setProgressMsg(data.message);
        }
      } catch (e) {
        // Polling error non-blocking
      }
    }, 350);
  };

  const stopProgressPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    setIsProcessing(true);
    setError('');
    setResult(null);
    setSelectedDeliveryIndex(0);
    startProgressPolling();

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
      stopProgressPolling();
      setIsProcessing(false);
      setProgress(100);

      if (res.ok && data.status === 'success') {
        setResult(data);
        if (data.ball_status === 'NO-BALL' || data.detected_speed > maxSpeedLimit) {
          playNoBallAudio();
        }
      } else {
        setError(data.message || 'Failed to process video delivery.');
      }
    } catch (err) {
      stopProgressPolling();
      setIsProcessing(false);
      setError('Failed to process video delivery: ' + (err.message || 'Server connection error'));
      console.error(err);
    }
  };

  const handleSelectDelivery = (delivery, idx) => {
    setSelectedDeliveryIndex(idx);
    if (videoRef.current && delivery && delivery.start_time_s != null) {
      videoRef.current.currentTime = Math.max(0, delivery.start_time_s - 0.2);
      videoRef.current.play().catch(() => {});
    }
  };

  const handleDownloadJSON = () => {
    if (!result) return;
    const jsonBlob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(jsonBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cricspeed_analysis_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isNoBall = result && (result.ball_status === 'NO-BALL' || result.detected_speed > maxSpeedLimit);

  // Normalize deliveries array
  const rawDeliveries = result?.deliveries || [];
  const deliveries = rawDeliveries.length > 0
    ? rawDeliveries
    : (result?.delivery_analysis ? [{
        index: 1,
        start_time_s: 0.0,
        end_time_s: 2.0,
        speed_kmh: result.detected_speed,
        analysis: result.delivery_analysis,
        bounce_px: null
      }] : []);

  const activeDelivery = deliveries[selectedDeliveryIndex] || deliveries[0] || null;
  const summary = result?.summary || {};

  const formatTime = (secs) => {
    if (secs == null) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ maxWidth: '1060px', margin: '0 auto', padding: '24px 16px' }}>
      <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <UploadCloud size={28} className="gradient-text-cyan" />
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '900', margin: 0 }}>
                Video Bowling Analyzer
              </h2>
              <p style={{ fontSize: '12px', color: '#94a3b8', margin: '2px 0 0 0' }}>
                Frame-by-frame velocity & ball movement analysis with OpenCV HUD overlays
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsMuted(!isMuted)}
            className="btn-action"
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderColor: isMuted ? 'rgba(255, 23, 68, 0.4)' : 'rgba(0, 242, 254, 0.4)',
              color: isMuted ? '#ff1744' : '#00f2fe'
            }}
          >
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            {isMuted ? 'Muted' : 'Audio Alert ON'}
          </button>
        </div>

        {/* Upload Form */}
        <form onSubmit={handleUpload}>
          {/* Drag & Drop Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: isDragging ? '2px dashed #00f2fe' : '2px dashed rgba(255, 255, 255, 0.15)',
              borderRadius: '16px',
              padding: '32px 20px',
              textAlign: 'center',
              marginBottom: '20px',
              background: isDragging ? 'rgba(0, 242, 254, 0.08)' : 'rgba(8, 12, 24, 0.5)',
              transition: 'all 0.2s ease',
              cursor: 'pointer'
            }}
            onClick={() => document.getElementById('video-file-picker')?.click()}
          >
            <Film size={40} color={isDragging ? '#00f2fe' : '#64748b'} style={{ margin: '0 auto 10px auto' }} />
            <p style={{ fontSize: '14px', fontWeight: '700', marginBottom: '6px', color: '#f1f5f9' }}>
              {file ? file.name : 'Drag & drop cricket delivery video here, or click to browse'}
            </p>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Supports MP4, MOV, AVI (60 fps behind bowler recommended)
            </span>

            <input
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ display: 'none' }}
              id="video-file-picker"
            />
          </div>

          {/* Controls Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '14px',
              marginBottom: '20px'
            }}
          >
            {/* Batsman Handedness Toggle */}
            <div>
              <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: '800' }}>
                BATSMAN STANCE
              </label>
              <BatsmanHandToggle
                value={batsmanHand}
                onChange={setBatsmanHand}
                style={{ width: '100%', justifyContent: 'space-between' }}
              />
            </div>

            {/* Calibration Profile */}
            <div>
              <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: '800' }}>
                CAMERA PROFILE
              </label>
              <select
                value={calibrationProfile}
                onChange={(e) => setCalibrationProfile(e.target.value)}
                className="input-premium"
                style={{ width: '100%', padding: '8px 12px', fontSize: '12px' }}
              >
                <option value="behind_bowler">Behind Bowler (Recommended)</option>
                <option value="default">Default Homography</option>
              </select>
            </div>

            {/* Speed Limit */}
            <div>
              <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: '800' }}>
                SPEED LIMIT (KM/H)
              </label>
              <input
                type="number"
                value={maxSpeedLimit}
                onChange={(e) => setMaxSpeedLimit(e.target.value)}
                className="input-premium"
                style={{ width: '100%', padding: '8px 12px', fontSize: '12px' }}
              />
            </div>
          </div>

          {/* Progress Bar (during processing) */}
          {isProcessing && (
            <div style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#00f2fe', fontWeight: '700', marginBottom: '6px' }}>
                <span>{progressMsg || 'Processing delivery trajectory...'}</span>
                <span>{progress}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #00f2fe, #4facfe)',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
            </div>
          )}

          {/* Analyse Button */}
          <button
            type="submit"
            disabled={!file || isProcessing}
            className={`btn-action ${file && !isProcessing ? 'btn-gradient' : ''}`}
            style={{
              width: '100%',
              padding: '14px',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <Sparkles size={16} />
            {isProcessing ? 'Processing Trajectory & Generating Overlays...' : 'Analyse Video'}
          </button>
        </form>

        {/* Error Notice */}
        {error && (
          <div
            className="glass-panel"
            style={{
              padding: '14px 18px',
              background: 'rgba(255, 23, 68, 0.15)',
              borderColor: '#ff1744',
              marginTop: '18px',
              textAlign: 'center'
            }}
          >
            <p style={{ color: '#ff1744', fontSize: '13px', fontWeight: '700', margin: 0 }}>
              ⚠️ {error}
            </p>
          </div>
        )}

        {/* ================= RESULTS SECTION ================= */}
        {result && (
          <div style={{ marginTop: '28px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '24px' }}>
            {/* Speed & Audit Alert Banner */}
            {isNoBall ? (
              <div
                className="glass-panel"
                style={{
                  padding: '16px 20px',
                  marginBottom: '20px',
                  background: 'rgba(255, 23, 68, 0.25)',
                  borderColor: '#ff1744',
                  boxShadow: '0 0 25px rgba(255, 23, 68, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px'
                }}
              >
                <AlertTriangle size={32} color="#ff1744" className="live-dot" />
                <div>
                  <span style={{ fontSize: '10px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: '900' }}>
                    SPEED AUDIT: NO-BALL
                  </span>
                  <h3 style={{ fontSize: '17px', fontWeight: '900', color: '#ff1744', margin: '2px 0 0 0' }}>
                    🚨 NO-BALL OVER SPEED: {result.detected_speed.toFixed(1)} km/h (Limit: {maxSpeedLimit} km/h)
                  </h3>
                </div>
              </div>
            ) : (
              <div
                className="glass-panel"
                style={{
                  padding: '16px 20px',
                  marginBottom: '20px',
                  background: 'rgba(0, 230, 118, 0.15)',
                  borderColor: '#00e676',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px'
                }}
              >
                <ShieldCheck size={32} color="#00e676" />
                <div>
                  <span style={{ fontSize: '10px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: '900' }}>
                    SPEED AUDIT: LEGAL DELIVERY
                  </span>
                  <h3 style={{ fontSize: '17px', fontWeight: '900', color: '#00e676', margin: '2px 0 0 0' }}>
                    ✓ Legal Delivery: {result.detected_speed.toFixed(1)} km/h (Limit: {maxSpeedLimit} km/h)
                  </h3>
                </div>
              </div>
            )}

            {/* Video Player with Download Action */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ borderRadius: '14px', overflow: 'hidden', border: '1px solid rgba(0, 242, 254, 0.25)', background: '#000' }}>
                <video
                  ref={videoRef}
                  controls
                  src={result.processed_video_url || result.video_url}
                  style={{ width: '100%', maxHeight: '460px', display: 'block' }}
                />
              </div>

              {/* Action Buttons: Download Video & Download JSON */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap', gap: '10px' }}>
                <a
                  href={result.processed_video_url || result.video_url}
                  download={`cricspeed_annotated_${Date.now()}.mp4`}
                  className="btn-action"
                  style={{
                    padding: '8px 16px',
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderColor: 'rgba(0, 242, 254, 0.4)',
                    color: '#00f2fe',
                    textDecoration: 'none'
                  }}
                >
                  <Download size={14} /> Download Annotated Video
                </a>

                <button
                  type="button"
                  onClick={handleDownloadJSON}
                  className="btn-action"
                  style={{
                    padding: '8px 16px',
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    color: '#cbd5e1'
                  }}
                >
                  <FileJson size={14} /> Download JSON Results
                </button>
              </div>
            </div>

            {/* Summary Bar */}
            {summary && (
              <div
                className="glass-panel"
                style={{
                  background: 'rgba(13, 20, 36, 0.85)',
                  padding: '16px',
                  borderRadius: '12px',
                  marginBottom: '20px',
                  border: '1px solid rgba(0, 242, 254, 0.15)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <BarChart3 size={16} color="#00f2fe" />
                  <span style={{ fontSize: '13px', fontWeight: '800', color: '#f1f5f9' }}>
                    Deliveries Summary ({summary.total_deliveries || deliveries.length} detected)
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: '12px',
                    marginBottom: '12px'
                  }}
                >
                  <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '10px', borderRadius: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Average Velocity</span>
                    <span style={{ fontSize: '17px', fontWeight: '900', color: '#00f2fe' }}>
                      {summary.avg_speed ? `${summary.avg_speed} km/h` : `${result.detected_speed.toFixed(1)} km/h`}
                    </span>
                  </div>

                  <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '10px', borderRadius: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Spin Deliveries</span>
                    <span style={{ fontSize: '17px', fontWeight: '900', color: '#ffab00' }}>
                      {summary.spin_count ?? 0}
                    </span>
                  </div>

                  <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '10px', borderRadius: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Swing Deliveries</span>
                    <span style={{ fontSize: '17px', fontWeight: '900', color: '#00e676' }}>
                      {summary.swing_count ?? 0}
                    </span>
                  </div>
                </div>

                {/* Length Distribution Mini Chart */}
                {summary.length_distribution && (
                  <div>
                    <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                      Length Distribution:
                    </span>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {Object.entries(summary.length_distribution).map(([lenName, count]) => (
                        <div
                          key={lenName}
                          style={{
                            padding: '4px 8px',
                            background: 'rgba(5, 8, 17, 0.8)',
                            borderRadius: '6px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            fontSize: '11px',
                            display: 'flex',
                            gap: '6px'
                          }}
                        >
                          <span style={{ color: '#cbd5e1' }}>{lenName}:</span>
                          <strong style={{ color: '#00f2fe' }}>{count}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Deliveries List */}
            {deliveries.length > 0 ? (
              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: '800', marginBottom: '10px', color: '#f1f5f9' }}>
                  Detected Deliveries (Tap a row to inspect & seek video)
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {deliveries.map((deliv, idx) => {
                    const isSelected = selectedDeliveryIndex === idx;
                    const dType = deliv.analysis?.delivery_type || 'STRAIGHT';
                    const turn = deliv.analysis?.turn_angle_deg != null ? `${Number(deliv.analysis.turn_angle_deg).toFixed(1)}°` : '0.0°';
                    const len = deliv.analysis?.length || 'Good Length';

                    return (
                      <div
                        key={deliv.index || idx}
                        onClick={() => handleSelectDelivery(deliv, idx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          background: isSelected ? 'rgba(0, 242, 254, 0.12)' : 'rgba(13, 20, 36, 0.75)',
                          border: isSelected ? '1px solid #00f2fe' : '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '10px',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          flexWrap: 'wrap',
                          gap: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '12px', fontWeight: '900', color: isSelected ? '#00f2fe' : '#94a3b8' }}>
                            #{deliv.index || idx + 1}
                          </span>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>
                            {formatTime(deliv.start_time_s)}
                          </span>
                          <DeliveryTypeBadge type={dType} size="sm" />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px' }}>
                          <span style={{ color: '#00f2fe', fontWeight: '800' }}>
                            {deliv.speed_kmh ? `${Number(deliv.speed_kmh).toFixed(1)} km/h` : ''}
                          </span>
                          <span style={{ color: '#ffab00', fontWeight: '700' }}>
                            {turn} turn
                          </span>
                          <span style={{ color: '#cbd5e1' }}>
                            {len}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div
                className="glass-panel"
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  background: 'rgba(13, 20, 36, 0.6)',
                  marginBottom: '20px'
                }}
              >
                <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>
                  No deliveries detected. Try a clip filmed directly behind the bowler at 60 fps.
                </p>
              </div>
            )}

            {/* Active Delivery Detailed Card */}
            {activeDelivery && activeDelivery.analysis && (
              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: '800', marginBottom: '10px', color: '#f1f5f9' }}>
                  Delivery #{activeDelivery.index || selectedDeliveryIndex + 1} Movement Analysis
                </h4>
                <DeliveryAnalysisCard
                  analysis={activeDelivery.analysis}
                  speedKmh={activeDelivery.speed_kmh}
                />
              </div>
            )}

            {/* Video Pitch Map */}
            {deliveries.length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <PitchMap
                  deliveries={deliveries}
                  highlightedIndex={activeDelivery?.index}
                  onSelectDelivery={handleSelectDelivery}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
