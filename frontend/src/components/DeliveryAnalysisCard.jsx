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
  Zap,
  ArrowRight,
  CornerDownRight,
  CornerDownLeft,
  ArrowUp
} from 'lucide-react';
import DeliveryTypeBadge, { getDeliveryColor } from './DeliveryTypeBadge';

export default function DeliveryAnalysisCard({ analysis, speedKmh = null, compact = false }) {
  const [isWhyOpen, setIsWhyOpen] = useState(false);

  if (!analysis) {
    return (
      <div
        className="glass-panel"
        style={{
          background: 'rgba(13, 20, 36, 0.7)',
          border: '1px solid rgba(0, 242, 254, 0.15)',
          borderRadius: '16px',
          padding: compact ? '12px 16px' : '20px',
          textAlign: 'center',
          color: '#94a3b8'
        }}
      >
        <Activity size={compact ? 18 : 24} color="#00f2fe" style={{ margin: '0 auto 6px auto', opacity: 0.6 }} />
        <p style={{ fontSize: compact ? '12px' : '13px', margin: 0 }}>Waiting for delivery trajectory...</p>
      </div>
    );
  }

  const status = analysis.status || 'ok';
  const deliveryType = analysis.delivery_type || 'STRAIGHT';
  const spinType = analysis.spin_type || 'NONE';
  const turnAngle = analysis.turn_angle_deg != null ? Number(analysis.turn_angle_deg).toFixed(1) : '0.0';
  const swingCm = analysis.swing_cm != null ? Number(analysis.swing_cm).toFixed(1) : '0.0';
  const length = analysis.length || 'Good Length';
  const line = analysis.line || 'Middle Stump';
  const confidence = analysis.confidence != null ? Math.round(Number(analysis.confidence) * 100) : 80;
  const explain = analysis.explain || {};
  const bowlerStyle = analysis.bowler_style || 'PACER';
  const displaySpeed = speedKmh != null && speedKmh > 0 ? Number(speedKmh).toFixed(1) : null;
  const batsmanHand = explain.batsman_hand || 'RIGHT';

  const badgeStyle = getDeliveryColor(deliveryType);

  // Direction arrow and text for turn
  const getTurnDirection = () => {
    const angleNum = Number(turnAngle);
    if (angleNum <= 0.3 || spinType === 'NONE') {
      return {
        label: 'Straight',
        icon: <ArrowUp size={14} color="#94a3b8" />,
        color: '#94a3b8'
      };
    }
    if (spinType === 'OFF_SPIN') {
      return {
        label: 'Leg Side',
        icon: <CornerDownRight size={15} color="#ffab00" />,
        color: '#ffab00'
      };
    }
    if (spinType === 'LEG_SPIN') {
      return {
        label: 'Off Side',
        icon: <CornerDownLeft size={15} color="#ff1744" />,
        color: '#ff1744'
      };
    }
    return {
      label: 'Straight',
      icon: <ArrowUp size={14} color="#94a3b8" />,
      color: '#94a3b8'
    };
  };

  const turnDir = getTurnDirection();

  // Non-ok friendly states (never crash)
  if (status === 'insufficient_data') {
    return (
      <div
        className="glass-panel"
        style={{
          background: 'rgba(13, 20, 36, 0.85)',
          border: '1px solid rgba(148, 163, 184, 0.25)',
          borderRadius: '16px',
          padding: compact ? '12px 16px' : '18px',
          color: '#cbd5e1'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8' }}>
          <AlertCircle size={18} color="#94a3b8" />
          <span style={{ fontSize: '13px', fontWeight: '700' }}>Analysis: Insufficient Track Points</span>
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
          padding: compact ? '12px 16px' : '18px',
          color: '#ffab00'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={18} color="#ffab00" />
          <span style={{ fontSize: '13px', fontWeight: '700' }}>No Pitch Bounce Detected (Full Toss)</span>
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
          padding: compact ? '12px 16px' : '18px',
          color: '#ff1744'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={18} color="#ff1744" />
          <span style={{ fontSize: '13px', fontWeight: '700' }}>Analysis Error</span>
        </div>
        <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px', marginBottom: 0 }}>
          {explain.reason || 'Could not compute delivery metrics.'}
        </p>
      </div>
    );
  }

  // Compact Mode Render
  if (compact) {
    return (
      <div
        className="glass-panel"
        style={{
          background: 'rgba(13, 20, 36, 0.90)',
          border: `1px solid ${badgeStyle.border}44`,
          borderRadius: '12px',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          boxShadow: `0 4px 15px rgba(0, 0, 0, 0.3)`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <DeliveryTypeBadge type={deliveryType} size="sm" />
          {displaySpeed && (
            <span style={{ color: '#00f2fe', fontSize: '12px', fontWeight: '800' }}>
              {displaySpeed} km/h
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: turnDir.color, fontWeight: '700' }}>
            {turnDir.icon}
            <span>{turnAngle}° {turnDir.label}</span>
          </div>
          <span style={{ color: '#cbd5e1', fontWeight: '600' }}>{length}</span>
        </div>
      </div>
    );
  }

  // Full Desktop & Mobile View
  return (
    <div
      className="glass-panel"
      style={{
        background: 'rgba(13, 20, 36, 0.92)',
        border: `1px solid ${badgeStyle.border}44`,
        borderRadius: '16px',
        padding: '18px',
        boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 15px ${badgeStyle.border}22`
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <DeliveryTypeBadge type={deliveryType} size="md" />
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '10px',
          marginBottom: '14px'
        }}
      >
        {/* Turn Angle with Arrow */}
        <div style={{ background: 'rgba(5, 8, 17, 0.65)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Turn Off Pitch</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
            {turnDir.icon}
            <span style={{ fontSize: '17px', fontWeight: '900', color: turnDir.color }}>
              {turnAngle}°
            </span>
            <span style={{ fontSize: '11px', color: turnDir.color, fontWeight: '700' }}>
              {turnDir.label}
            </span>
          </div>
        </div>

        {/* Swing in cm */}
        <div style={{ background: 'rgba(5, 8, 17, 0.65)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Air Swing</span>
          <span style={{ fontSize: '17px', fontWeight: '900', color: Number(swingCm) > 0 ? '#00f2fe' : '#f1f5f9' }}>
            {swingCm} cm
          </span>
        </div>

        {/* Pitch Length */}
        <div style={{ background: 'rgba(5, 8, 17, 0.65)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Pitch Length</span>
          <span style={{ fontSize: '14px', fontWeight: '800', color: '#f1f5f9', lineHeight: '24px' }}>
            {length}
          </span>
        </div>

        {/* Stump Line */}
        <div style={{ background: 'rgba(5, 8, 17, 0.65)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Stump Line</span>
          <span style={{ fontSize: '14px', fontWeight: '800', color: '#f1f5f9', lineHeight: '24px' }}>
            {line}
          </span>
        </div>
      </div>

      {/* Confidence Bar */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
          <span>AI Detection Confidence</span>
          <span style={{ color: confidence >= 70 ? '#00e676' : '#ffab00', fontWeight: '700' }}>{confidence}%</span>
        </div>
        <div style={{ width: '100%', height: '5px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', overflow: 'hidden' }}>
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
          type="button"
          onClick={() => setIsWhyOpen(!isWhyOpen)}
          style={{
            background: 'none',
            border: 'none',
            color: '#00f2fe',
            fontSize: '12px',
            fontWeight: '700',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            outline: 'none'
          }}
        >
          <HelpCircle size={14} />
          <span>Why this delivery classification?</span>
          {isWhyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {isWhyOpen && (
          <div
            style={{
              marginTop: '10px',
              padding: '12px',
              background: 'rgba(5, 8, 17, 0.85)',
              borderRadius: '10px',
              border: '1px solid rgba(0, 242, 254, 0.15)',
              fontSize: '12px',
              lineHeight: '1.5'
            }}
          >
            <p style={{ margin: '0 0 8px 0', color: '#f1f5f9', fontWeight: '600' }}>
              {explain.reason || 'Calculated via trajectory pre- and post-bounce regression vectors.'}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', color: '#94a3b8' }}>
              <div>
                <span style={{ color: '#64748b' }}>Pre-bounce path:</span>{' '}
                <strong style={{ color: '#cbd5e1' }}>{explain.pre_angle_deg != null ? `${Number(explain.pre_angle_deg).toFixed(1)}°` : 'N/A'}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Post-bounce path:</span>{' '}
                <strong style={{ color: '#cbd5e1' }}>{explain.post_angle_deg != null ? `${Number(explain.post_angle_deg).toFixed(1)}°` : 'N/A'}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Turn threshold:</span>{' '}
                <strong style={{ color: '#cbd5e1' }}>{explain.threshold_turn_deg || 1.5}°</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Swing threshold:</span>{' '}
                <strong style={{ color: '#cbd5e1' }}>{explain.threshold_swing_cm || 5.0} cm</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Batsman Stance:</span>{' '}
                <strong style={{ color: '#00f2fe' }}>{batsmanHand === 'RIGHT' ? 'Right-Hand (RHB)' : 'Left-Hand (LHB)'}</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
