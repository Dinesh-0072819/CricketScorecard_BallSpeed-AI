import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Save, AlertTriangle, ShieldCheck, Zap, Gauge, Radio, Crosshair, Volume2, VolumeX } from 'lucide-react';

export default function LiveCameraRadar({ activeMatch, onSyncDelivery }) {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ current_speed: 0.0, max_speed: 0.0, status: 'SAFE' });
  const [saveStatus, setSaveStatus] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const prevStatusRef = useRef('SAFE');

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
        console.log('HTML5 Audio autoplay restricted, falling back to Web Audio synth:', err);
        playSynthSiren();
      });
    } catch (e) {
      playSynthSiren();
    }
  };

  useEffect(() => {
    let interval;
    if (isRunning) {
      interval = setInterval(() => {
        fetch('/camera_stats')
          .then(res => res.json())
          .then(data => {
            setStats(data);
            // Trigger MP3 No-Ball sound when status becomes NO-BALL
            if (data.status === 'NO-BALL' && prevStatusRef.current !== 'NO-BALL') {
              playNoBallAudio();
            }
            prevStatusRef.current = data.status;
          })
          .catch(err => console.error('Error fetching camera stats:', err));
      }, 400);
    }
    return () => clearInterval(interval);
  }, [isRunning, isMuted]);

  const handleStart = async () => {
    try {
      await fetch('/start_camera');
      setIsRunning(true);
    } catch (e) {
      console.error(e);
    }
  };

  const handleStop = async () => {
    try {
      await fetch('/stop_camera');
      setIsRunning(false);
    } catch (e) {
      console.error(e);
    }
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

  const isNoBall = stats.status === 'NO-BALL';

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px 24px' }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '28px' }}>
        {/* Video Feed & Radar Window */}
        <div className={`glass-panel ${isNoBall ? '' : 'glass-panel-neon'}`} style={{
          padding: '24px',
          borderColor: isNoBall ? '#ff1744' : undefined,
          boxShadow: isNoBall ? '0 0 30px rgba(255, 23, 68, 0.4)' : undefined
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Zap size={24} className="gradient-text-cyan" />
              <h2 style={{ fontSize: '20px', fontWeight: '900' }}>Live AI Ball Speed Stream</h2>
            </div>
            
            {/* Audio Mute/Silence Toggle Button */}
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
              {isMuted ? 'Sound Muted' : 'Audio ON (no-ball-sound-cricket.mp3)'}
            </button>
          </div>

          {/* Video Screen Container */}
          <div style={{
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
              <img
                src="/video_feed"
                alt="Live Ball Speed Telemetry Stream"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ textAlign: 'center', color: '#64748b' }}>
                <div style={{
                  width: '80px', height: '80px', borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto'
                }}>
                  <Crosshair size={40} strokeWidth={1.5} color="#475569" />
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#ffffff', marginBottom: '6px' }}>AI Camera Standby</h3>
                <p style={{ fontSize: '13px', color: '#94a3b8' }}>Click "Start AI Radar" below to begin tracking delivery speed</p>
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
                  <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '800' }}>Radar HUD</div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: isNoBall ? '#ff1744' : '#ffffff' }}>
                    {isNoBall ? '🚨 NO-BALL OVER SPEED' : 'YOLOv8 Delivery Tracker'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Controls */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '24px' }}>
            {!isRunning ? (
              <button onClick={handleStart} className="btn-action btn-gradient" style={{ flex: 1, padding: '16px', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <Play size={18} fill="#050811" /> Start AI Radar Stream
              </button>
            ) : (
              <button onClick={handleStop} className="btn-action btn-danger" style={{ flex: 1, padding: '16px', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <Square size={18} fill="#ff1744" /> Stop Stream
              </button>
            )}

            <button
              onClick={handleSaveRun}
              disabled={stats.max_speed === 0}
              className="btn-action"
              style={{
                padding: '16px 28px',
                borderColor: stats.max_speed > 0 ? 'rgba(0, 230, 118, 0.4)' : 'rgba(255,255,255,0.1)',
                background: stats.max_speed > 0 ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255,255,255,0.04)',
                color: stats.max_speed > 0 ? '#00e676' : '#64748b',
                cursor: stats.max_speed > 0 ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: '8px'
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

          {/* Ball Movement Analytics Panel */}
          <div className="glass-panel" style={{ padding: '20px', background: 'rgba(13, 20, 36, 0.7)' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '800', display: 'block', marginBottom: '12px' }}>
              Movement Analytics
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block' }}>Dev Angle (Turn)</span>
                <span style={{ fontSize: '18px', fontWeight: '900', color: '#ffab00' }}>
                  {stats.deviation_angle != null ? Number(stats.deviation_angle).toFixed(1) : '0.0'}°
                </span>
                <span style={{ fontSize: '10px', color: '#cbd5e1', display: 'block' }}>
                  {stats.turn_direction || 'Straight'}
                </span>
              </div>
              <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block' }}>Air Swing</span>
                <span style={{ fontSize: '18px', fontWeight: '900', color: '#00e676' }}>
                  {stats.swing_cm != null ? Number(stats.swing_cm).toFixed(1) : '0.0'} cm
                </span>
                <span style={{ fontSize: '10px', color: '#cbd5e1', display: 'block' }}>Lateral Drift</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Delivery Type:</span>
              <span style={{
                padding: '3px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: '800',
                background: stats.delivery_type === 'OFF_SPIN' ? 'rgba(0, 242, 254, 0.2)' :
                            stats.delivery_type === 'LEG_SPIN' ? 'rgba(255, 171, 0, 0.2)' :
                            stats.delivery_type === 'INSWING' ? 'rgba(0, 230, 118, 0.2)' :
                            stats.delivery_type === 'OUTSWING' ? 'rgba(255, 23, 68, 0.2)' : 'rgba(255,255,255,0.1)',
                color: stats.delivery_type === 'OFF_SPIN' ? '#00f2fe' :
                       stats.delivery_type === 'LEG_SPIN' ? '#ffab00' :
                       stats.delivery_type === 'INSWING' ? '#00e676' :
                       stats.delivery_type === 'OUTSWING' ? '#ff1744' : '#cbd5e1'
              }}>
                {stats.delivery_type || 'STRAIGHT'}
              </span>
            </div>
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
        </div>
      </div>
    </div>
  );
}
