import React, { useState } from 'react';
import {
  Compass,
  Activity,
  TrendingUp,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Sparkles,
  Zap
} from 'lucide-react';

export default function DeliveryAnalysisCard({ analysis, speedKmh = null }) {
  const [isWhyOpen, setIsWhyOpen] = useState(false);

  if (!analysis) {
    return (
      <div
        className="glass-panel"
        style={{
          background: 'rgba(13, 20, 36, 0.7)',
          border: '1px solid rgba(0, 242, 254, 0.15)',
          borderRadius: '16px',
          padding: '20px',
          textAlign: 'center',
          color: '#94a3b8'
        }}
      >
        <Activity size={24} color="#00f2fe" style={{ margin: '0 auto 8px auto', opacity: 0.6 }} />
        <p style={{ fontSize: '13px', margin: 0 }}>Waiting for delivery trajectory...</p>
      </div>
    );
  }

  const status = analysis.status || 'ok';
  const deliveryType = analysis.delivery_type || 'STRAIGHT';
  const turnAngle = analysis.turn_angle_deg != null ? Number(analysis.turn_angle_deg).toFixed(1) : '0.0';
  const swingCm = analysis.swing_cm != null ? Number(analysis.swing_cm).toFixed(1) : '0.0';
  const length = analysis.length || 'Good Length';
  const line = analysis.line || 'Middle Stump';
  const confidence = analysis.confidence != null ? Math.round(Number(analysis.confidence) * 100) : 80;
  const explain = analysis.explain || {};
  const bowlerStyle = analysis.bowler_style || 'PACER';
  const displaySpeed = speedKmh != null && speedKmh > 0 ? Number(speedKmh).toFixed(1) : null;

  // Badge styling based on delivery type
  const getBadgeStyle = () => {
    switch (deliveryType) {
      case 'OFF_SPIN':
        return { bg: 'rgba(255, 171, 0, 0.15)', border: '#ffab00', text: '#ffab00', label: 'OFF SPIN' };
      case 'LEG_SPIN':
        return { bg: 'rgba(255, 23, 68, 0.15)', border: '#ff1744', text: '#ff1744', label: 'LEG SPIN' };
      case 'INSWING':
        return { bg: 'rgba(0, 242, 254, 0.15)', border: '#00f2fe', text: '#00f2fe', label: 'INSWING' };
      case 'OUTSWING':
        return { bg: 'rgba(0, 230, 118, 0.15)', border: '#00e676', text: '#00e676', label: 'OUTSWING' };
      default:
        return { bg: 'rgba(148, 163, 184, 0.15)', border: '#94a3b8', text: '#f1f5f9', label: 'STRAIGHT' };
    }
  };

  const badge = getBadgeStyle();

  // Non-ok friendly states
  if (status === 'insufficient_data') {
    return (
      <div
        className="glass-panel"
        style={{
          background: 'rgba(13, 20, 36, 0.85)',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: '16px',
          padding: '20px',
          color: '#cbd5e1'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#94a3b8' }}>
          <AlertCircle size={20} color="#94a3b8" />
          <span style={{ fontSize: '14px', fontWeight: '700' }}>Analysis: Insufficient Track Points</span>
        </div>
        <p style={{ fontSize: '12px', color: '#64748b', marginTop: '6px', marginBottom: 0 }}>
          {explain.reason || 'The camera lost track of the ball before completion. Hold camera steady behind bowler.'}
        </p>
      </div>
    );
  }

  if (status === 'no_bounce_found') {
    return (
      <div
        className="glass-panel"
        style={{
          background: 'rgba(13, 20, 36, 0.85)',
          border: '1px solid rgba(255, 171, 0, 0.3)',
          borderRadius: '16px',
          padding: '20px',
          color: '#ffab00'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertCircle size={20} color="#ffab00" />
          <span style={{ fontSize: '14px', fontWeight: '700' }}>No Pitch Bounce Detected (Full Toss)</span>
        </div>
        <p style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '6px', marginBottom: 0 }}>
          {explain.reason || 'The ball did not bounce on the pitch surface before reaching the batsman.'}
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        className="glass-panel"
        style={{
          background: 'rgba(13, 20, 36, 0.85)',
          border: '1px solid rgba(255, 23, 68, 0.3)',
          borderRadius: '16px',
          padding: '20px',
          color: '#ff1744'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertCircle size={20} color="#ff1744" />
          <span style={{ fontSize: '14px', fontWeight: '700' }}>Analysis Error</span>
        </div>
        <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px', marginBottom: 0 }}>
          {explain.reason || 'Could not compute delivery metrics.'}
        </p>
      </div>
    );
  }

  return (
    <div
      className="glass-panel"
      style={{
        background: 'rgba(13, 20, 36, 0.90)',
        border: `1px solid ${badge.border}44`,
        borderRadius: '16px',
        padding: '20px',
        boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 15px ${badge.border}22`
      }}
    >
      {/* Header with Delivery Type Badge & Style */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              background: badge.bg,
              border: `1px solid ${badge.border}`,
              color: badge.text,
              fontSize: '13px',
              fontWeight: '900',
              letterSpacing: '0.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Sparkles size={14} color={badge.border} />
            {badge.label}
          </div>
          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>
            {bowlerStyle}
          </span>
        </div>

        {displaySpeed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#00f2fe', fontSize: '15px', fontWeight: '900' }}>
            <Zap size={16} />
            {displaySpeed} km/h
          </div>
        )}
      </div>

      {/* Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          gap: '10px',
          marginBottom: '16px'
        }}
      >
        <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Turn Off Pitch</span>
          <span style={{ fontSize: '18px', fontWeight: '900', color: Number(turnAngle) > 0 ? '#ffab00' : '#f1f5f9' }}>
            {turnAngle}°
          </span>
        </div>

        <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Air Swing</span>
          <span style={{ fontSize: '18px', fontWeight: '900', color: Number(swingCm) > 0 ? '#00f2fe' : '#f1f5f9' }}>
            {swingCm} cm
          </span>
        </div>

        <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Pitch Length</span>
          <span style={{ fontSize: '14px', fontWeight: '800', color: '#f1f5f9', lineHeight: '24px' }}>
            {length}
          </span>
        </div>

        <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Stump Line</span>
          <span style={{ fontSize: '14px', fontWeight: '800', color: '#f1f5f9', lineHeight: '24px' }}>
            {line}
          </span>
        </div>
      </div>

      {/* Confidence Bar */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
          <span>AI Detection Confidence</span>
          <span style={{ color: confidence >= 70 ? '#00e676' : '#ffab00', fontWeight: '700' }}>{confidence}%</span>
        </div>
        <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${confidence}%`,
              height: '100%',
              background: confidence >= 70 ? 'linear-gradient(90deg, #00f2fe, #00e676)' : '#ffab00',
              transition: 'width 0.4s ease'
            }}
          />
        </div>
      </div>

      {/* Expandable "Why?" Explainable AI Section */}
      <div
        style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          paddingTop: '10px'
        }}
      >
        <button
          onClick={() => setIsWhyOpen(!isWhyOpen)}
          style={{
            background: 'none',
            border: 'none',
            color: '#00f2fe',
            fontSize: '12px',
            fontWeight: '700',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '4px 0'
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <HelpCircle size={14} />
            Why {badge.label}? (AI Reasoning)
          </span>
          {isWhyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {isWhyOpen && (
          <div
            style={{
              marginTop: '10px',
              padding: '12px',
              background: 'rgba(5, 8, 17, 0.8)',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#cbd5e1',
              lineHeight: '1.6'
            }}
          >
            <p style={{ margin: '0 0 8px 0', color: '#f1f5f9', fontWeight: '600' }}>
              {explain.reason || 'Trajectory classified by tracking trajectory vectors.'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', fontSize: '11px', color: '#94a3b8' }}>
              <div>Approach Angle: <span style={{ color: '#fff' }}>{explain.pre_angle_deg != null ? `${explain.pre_angle_deg}°` : 'N/A'}</span></div>
              <div>Exit Angle: <span style={{ color: '#fff' }}>{explain.post_angle_deg != null ? `${explain.post_angle_deg}°` : 'N/A'}</span></div>
              <div>Turn Threshold: <span style={{ color: '#fff' }}>{explain.threshold_turn_deg || 1.5}°</span></div>
              <div>Swing Threshold: <span style={{ color: '#fff' }}>{explain.threshold_swing_cm || 5.0} cm</span></div>
              <div>Batsman Hand: <span style={{ color: '#00f2fe', fontWeight: '700' }}>{explain.batsman_hand || 'RIGHT'}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
