import React, { useState, useEffect } from 'react';
import { Target, Info, Filter, RefreshCw } from 'lucide-react';

const DELIVERY_COLORS = {
  OFF_SPIN: '#ffab00',
  LEG_SPIN: '#ff1744',
  INSWING: '#00f2fe',
  OUTSWING: '#00e676',
  STRAIGHT: '#ffffff'
};

export default function PitchMap({ matchId = null, deliveries: propDeliveries = null }) {
  const [deliveries, setDeliveries] = useState(propDeliveries || []);
  const [selectedBall, setSelectedBall] = useState(null);
  const [filterBowler, setFilterBowler] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (propDeliveries) {
      setDeliveries(propDeliveries);
      return;
    }
    fetchDeliveries();
  }, [matchId, propDeliveries]);

  const fetchDeliveries = async () => {
    setLoading(true);
    try {
      const url = matchId ? `/api/match/deliveries?match_id=${matchId}` : '/api/match/deliveries';
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) {
        setDeliveries(data);
      }
    } catch (e) {
      console.error('Error fetching match deliveries for pitch map:', e);
    } finally {
      setLoading(false);
    }
  };

  // Unique bowlers for filter
  const bowlers = ['ALL', ...Array.from(new Set(deliveries.map(d => d.bowler).filter(Boolean)))];

  // Filter deliveries with valid bounce points
  const validBalls = deliveries.filter(d => {
    if (d.bounce_x == null || d.bounce_y == null) return false;
    if (filterBowler !== 'ALL' && d.bowler !== filterBowler) return false;
    if (filterType !== 'ALL' && (d.delivery_type || 'STRAIGHT') !== filterType) return false;
    return true;
  });

  // SVG dimensions
  const svgWidth = 260;
  const svgHeight = 560;
  const pitchLeft = 40;
  const pitchRight = 220;
  const pitchTop = 40;     // Bowler end (y=0)
  const pitchBottom = 520; // Batsman stumps (y=20.12)

  // Coordinate mapping
  // Real world: x in [-1.525, +1.525], y in [0, 20.12]
  const mapX = (x) => {
    const clamped = Math.max(-1.525, Math.min(1.525, Number(x) || 0));
    const norm = (clamped + 1.525) / 3.05;
    return pitchLeft + norm * (pitchRight - pitchLeft);
  };

  const mapY = (y) => {
    const clamped = Math.max(0, Math.min(20.12, Number(y) || 0));
    const norm = clamped / 20.12;
    return pitchTop + norm * (pitchBottom - pitchTop);
  };

  // Length zones coordinates (from batsman end y=20.12m)
  // Short: y < 13.12m (dist > 7m)
  // Good: 13.12m <= y < 16.12m (dist 4-7m)
  // Full: 16.12m <= y < 18.12m (dist 2-4m)
  // Yorker: 18.12m <= y < 20.12m (dist < 2m)
  const yShort = mapY(13.12);
  const yGood = mapY(16.12);
  const yFull = mapY(18.12);
  const yBatPopping = mapY(18.89);

  return (
    <div
      className="glass-panel"
      style={{
        background: 'rgba(13, 20, 36, 0.85)',
        border: '1px solid rgba(0, 242, 254, 0.2)',
        borderRadius: '16px',
        padding: '24px',
        color: '#f1f5f9'
      }}
    >
      {/* Title & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Target size={24} color="#00f2fe" />
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '900', margin: 0 }}>Pitch Bounce Map</h3>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              {validBalls.length} ball{validBalls.length === 1 ? '' : 's'} plotted (top-down pitch view)
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Bowler Filter */}
          {bowlers.length > 2 && (
            <select
              value={filterBowler}
              onChange={(e) => setFilterBowler(e.target.value)}
              style={{
                background: 'rgba(5, 8, 17, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#fff',
                fontSize: '11px',
                borderRadius: '8px',
                padding: '4px 8px'
              }}
            >
              {bowlers.map(b => (
                <option key={b} value={b}>{b === 'ALL' ? 'All Bowlers' : b}</option>
              ))}
            </select>
          )}

          <button
            onClick={fetchDeliveries}
            className="btn-action"
            style={{ padding: '6px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)' }}
            title="Refresh Pitch Deliveries"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* SVG Canvas & Details Container */}
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* SVG Graphic */}
        <div style={{ maxWidth: '280px', width: '100%', position: 'relative' }}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            style={{
              width: '100%',
              height: 'auto',
              background: '#09111e',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: 'inset 0 0 40px rgba(0, 0, 0, 0.8)'
            }}
          >
            {/* Pitch Turf Surface */}
            <rect
              x={pitchLeft}
              y={pitchTop}
              width={pitchRight - pitchLeft}
              height={pitchBottom - pitchTop}
              fill="#18271e"
              stroke="#2e4c3a"
              strokeWidth="2"
            />

            {/* Length Zones Bands & Labels */}
            {/* Short Zone */}
            <rect
              x={pitchLeft}
              y={pitchTop}
              width={pitchRight - pitchLeft}
              height={yShort - pitchTop}
              fill="rgba(255, 23, 68, 0.05)"
            />
            <line x1={pitchLeft} y1={yShort} x2={pitchRight} y2={yShort} stroke="rgba(255, 255, 255, 0.2)" strokeDasharray="4 4" />
            <text x={pitchLeft + 6} y={yShort - 6} fill="#94a3b8" fontSize="9" fontWeight="600">SHORT</text>

            {/* Good Length Zone */}
            <rect
              x={pitchLeft}
              y={yShort}
              width={pitchRight - pitchLeft}
              height={yGood - yShort}
              fill="rgba(0, 230, 118, 0.08)"
            />
            <line x1={pitchLeft} y1={yGood} x2={pitchRight} y2={yGood} stroke="rgba(255, 255, 255, 0.2)" strokeDasharray="4 4" />
            <text x={pitchLeft + 6} y={yGood - 6} fill="#00e676" fontSize="9" fontWeight="700">GOOD LENGTH</text>

            {/* Full Zone */}
            <rect
              x={pitchLeft}
              y={yGood}
              width={pitchRight - pitchLeft}
              height={yFull - yGood}
              fill="rgba(0, 242, 254, 0.08)"
            />
            <line x1={pitchLeft} y1={yFull} x2={pitchRight} y2={yFull} stroke="rgba(255, 255, 255, 0.2)" strokeDasharray="4 4" />
            <text x={pitchLeft + 6} y={yFull - 6} fill="#00f2fe" fontSize="9" fontWeight="700">FULL</text>

            {/* Yorker Zone */}
            <rect
              x={pitchLeft}
              y={yFull}
              width={pitchRight - pitchLeft}
              height={pitchBottom - yFull}
              fill="rgba(255, 171, 0, 0.08)"
            />
            <text x={pitchLeft + 6} y={pitchBottom - 6} fill="#ffab00" fontSize="9" fontWeight="700">YORKER</text>

            {/* Creases */}
            {/* Bowler crease at pitchTop */}
            <line x1={pitchLeft - 10} y1={pitchTop} x2={pitchRight + 10} y2={pitchTop} stroke="#ffffff" strokeWidth="2" />
            {/* Batsman popping crease */}
            <line x1={pitchLeft - 12} y1={yBatPopping} x2={pitchRight + 12} y2={yBatPopping} stroke="#ffffff" strokeWidth="2" />
            {/* Batsman bowling/stumps crease */}
            <line x1={pitchLeft - 10} y1={pitchBottom} x2={pitchRight + 10} y2={pitchBottom} stroke="#ffffff" strokeWidth="2" />

            {/* Stumps (Bowler End) */}
            <circle cx={130} cy={pitchTop} r={3} fill="#ffffff" />
            <circle cx={124} cy={pitchTop} r={3} fill="#ffffff" />
            <circle cx={136} cy={pitchTop} r={3} fill="#ffffff" />

            {/* Stumps (Batsman End) */}
            <circle cx={130} cy={pitchBottom} r={3} fill="#ffffff" />
            <circle cx={124} cy={pitchBottom} r={3} fill="#ffffff" />
            <circle cx={136} cy={pitchBottom} r={3} fill="#ffffff" />

            {/* Central Pitch Axis Guide */}
            <line x1={130} y1={pitchTop} x2={130} y2={pitchBottom} stroke="rgba(255, 255, 255, 0.1)" strokeDasharray="2 4" />

            {/* Plotted Delivery Bounce Points */}
            {validBalls.map((b, idx) => {
              const cx = mapX(b.bounce_x);
              const cy = mapY(b.bounce_y);
              const color = DELIVERY_COLORS[b.delivery_type] || DELIVERY_COLORS.STRAIGHT;
              const isSelected = selectedBall && selectedBall.id === b.id;

              return (
                <g key={b.id || idx} onClick={() => setSelectedBall(b)} style={{ cursor: 'pointer' }}>
                  {isSelected && (
                    <circle cx={cx} cy={cy} r={10} fill="none" stroke={color} strokeWidth={2} opacity={0.8} />
                  )}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 6 : 4.5}
                    fill={color}
                    stroke="#000"
                    strokeWidth={1}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend & Selected Ball Details */}
        <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Legend */}
          <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
              Delivery Types
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
              {Object.entries(DELIVERY_COLORS).map(([type, color]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: color }} />
                  <span style={{ color: '#cbd5e1' }}>{type.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Selected Ball Inspector */}
          {selectedBall ? (
            <div style={{ background: 'rgba(5, 8, 17, 0.75)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(0, 242, 254, 0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '900', color: DELIVERY_COLORS[selectedBall.delivery_type] || '#fff' }}>
                  {selectedBall.delivery_type || 'STRAIGHT'}
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Over {selectedBall.over_no}.{selectedBall.ball_no}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: '1.6' }}>
                <div>Bowler: <strong style={{ color: '#fff' }}>{selectedBall.bowler}</strong></div>
                <div>Speed: <strong style={{ color: '#00f2fe' }}>{selectedBall.speed_kmh ? `${selectedBall.speed_kmh} km/h` : 'N/A'}</strong></div>
                {selectedBall.turn_angle_deg > 0 && <div>Turn: <strong style={{ color: '#ffab00' }}>{selectedBall.turn_angle_deg}°</strong></div>}
                {selectedBall.swing_cm > 0 && <div>Swing: <strong style={{ color: '#00e676' }}>{selectedBall.swing_cm} cm</strong></div>}
                <div>Length: <strong>{selectedBall.length || 'Good Length'}</strong></div>
                <div>Line: <strong>{selectedBall.line || 'Middle Stump'}</strong></div>
              </div>
            </div>
          ) : (
            <div style={{ background: 'rgba(5, 8, 17, 0.4)', padding: '14px', borderRadius: '12px', border: '1px dashed rgba(255, 255, 255, 0.08)', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
              <Info size={16} style={{ margin: '0 auto 6px auto', display: 'block' }} />
              Click any dot on the pitch map to inspect ball trajectory & velocity.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
