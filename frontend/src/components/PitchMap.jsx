import React, { useState, useEffect } from 'react';
import { Target, Info, Filter, RefreshCw } from 'lucide-react';
import { DELIVERY_COLORS, getDeliveryColor } from './DeliveryTypeBadge';

export default function PitchMap({
  deliveries: propDeliveries = null,
  highlightedIndex = null,
  onSelectDelivery = null,
  matchId = null,
  compact = false
}) {
  const [deliveries, setDeliveries] = useState(propDeliveries || []);
  const [selectedBall, setSelectedBall] = useState(null);
  const [filterType, setFilterType] = useState('ALL');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (propDeliveries) {
      setDeliveries(propDeliveries);
      return;
    }
    if (matchId) {
      fetchDeliveries();
    }
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

  // Helper to extract bounce coordinates from heterogeneous data structures
  const getCoords = (d) => {
    if (d.bounce_x != null && d.bounce_y != null) {
      return [Number(d.bounce_x), Number(d.bounce_y)];
    }
    if (d.bounce_xy_m && Array.isArray(d.bounce_xy_m)) {
      return [Number(d.bounce_xy_m[0]), Number(d.bounce_xy_m[1])];
    }
    if (d.analysis && d.analysis.bounce_xy_m && Array.isArray(d.analysis.bounce_xy_m)) {
      return [Number(d.analysis.bounce_xy_m[0]), Number(d.analysis.bounce_xy_m[1])];
    }
    return null;
  };

  const getDelivType = (d) => {
    if (d.delivery_type) return d.delivery_type;
    if (d.analysis && d.analysis.delivery_type) return d.analysis.delivery_type;
    return 'STRAIGHT';
  };

  const validBalls = (deliveries || []).map((d, idx) => {
    const coords = getCoords(d);
    if (!coords) return null;
    return {
      ...d,
      _idx: d.index != null ? d.index : idx + 1,
      _rawIdx: idx,
      _bx: coords[0],
      _by: coords[1],
      _type: getDelivType(d)
    };
  }).filter(Boolean).filter(d => {
    if (filterType !== 'ALL' && d._type !== filterType) return false;
    return true;
  });

  // SVG dimensions (22 yards = 20.12m pitch length, 3.05m width)
  const svgWidth = 280;
  const svgHeight = 580;
  const pitchLeft = 50;
  const pitchRight = 230;
  const pitchTop = 50;      // Bowler end (y=0)
  const pitchBottom = 530;  // Batsman stumps (y=20.12)

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

  // Length zones from batsman crease (y=18.9m)
  const yShort = mapY(13.12);
  const yGood = mapY(16.12);
  const yFull = mapY(18.12);
  const yBatsmanCrease = mapY(18.90);
  const yBowlerCrease = mapY(1.22);

  const handleBallClick = (ball) => {
    setSelectedBall(ball);
    if (onSelectDelivery) {
      onSelectDelivery(ball, ball._rawIdx);
    }
  };

  return (
    <div
      className="glass-panel"
      style={{
        background: 'rgba(13, 20, 36, 0.90)',
        border: '1px solid rgba(0, 242, 254, 0.2)',
        borderRadius: '16px',
        padding: compact ? '14px' : '20px',
        color: '#f1f5f9',
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      {/* Header & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Target size={compact ? 18 : 22} color="#00f2fe" />
          <h3 style={{ margin: 0, fontSize: compact ? '14px' : '16px', fontWeight: '800', letterSpacing: '0.5px' }}>
            Pitch Map <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '500' }}>({validBalls.length} balls)</span>
          </h3>
        </div>

        {/* Filter Dropdown */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{
            background: 'rgba(5, 8, 17, 0.8)',
            border: '1px solid rgba(0, 242, 254, 0.3)',
            borderRadius: '8px',
            color: '#f1f5f9',
            padding: '4px 8px',
            fontSize: '11px',
            fontWeight: '700',
            cursor: 'pointer',
            outline: 'none'
          }}
        >
          <option value="ALL">All Deliveries</option>
          <option value="OFF_SPIN">Off Spin</option>
          <option value="LEG_SPIN">Leg Spin</option>
          <option value="INSWING">Inswing</option>
          <option value="OUTSWING">Outswing</option>
          <option value="STRAIGHT">Straight</option>
        </select>
      </div>

      {/* SVG Container */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'rgba(5, 8, 17, 0.6)',
          borderRadius: '12px',
          padding: '12px 6px',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          position: 'relative'
        }}
      >
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{
            width: '100%',
            maxWidth: compact ? '240px' : '300px',
            height: 'auto',
            display: 'block'
          }}
        >
          <defs>
            <linearGradient id="pitchGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1e293b" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#0f172a" stopOpacity="0.9" />
            </linearGradient>
            <filter id="glowEffect" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Outer Pitch Turf */}
          <rect
            x={pitchLeft}
            y={pitchTop}
            width={pitchRight - pitchLeft}
            height={pitchBottom - pitchTop}
            fill="url(#pitchGrad)"
            stroke="rgba(0, 242, 254, 0.3)"
            strokeWidth="2"
            rx="6"
          />

          {/* Length Zone Bands */}
          {/* Yorker Zone */}
          <rect
            x={pitchLeft}
            y={yFull}
            width={pitchRight - pitchLeft}
            height={pitchBottom - yFull}
            fill="rgba(255, 23, 68, 0.06)"
          />
          {/* Full Zone */}
          <rect
            x={pitchLeft}
            y={yGood}
            width={pitchRight - pitchLeft}
            height={yFull - yGood}
            fill="rgba(0, 242, 254, 0.05)"
          />
          {/* Good Length Zone */}
          <rect
            x={pitchLeft}
            y={yShort}
            width={pitchRight - pitchLeft}
            height={yGood - yShort}
            fill="rgba(0, 230, 118, 0.08)"
          />

          {/* Zone Divider Dashed Lines */}
          <line x1={pitchLeft} y1={yShort} x2={pitchRight} y2={yShort} stroke="rgba(255,255,255,0.15)" strokeDasharray="3,3" />
          <line x1={pitchLeft} y1={yGood} x2={pitchRight} y2={yGood} stroke="rgba(255,255,255,0.15)" strokeDasharray="3,3" />
          <line x1={pitchLeft} y1={yFull} x2={pitchRight} y2={yFull} stroke="rgba(255,255,255,0.15)" strokeDasharray="3,3" />

          {/* Zone Labels */}
          <text x={pitchLeft + 8} y={yShort - 6} fill="#64748b" fontSize="9" fontWeight="700">SHORT</text>
          <text x={pitchLeft + 8} y={yGood - 6} fill="#00e676" fontSize="9" fontWeight="700">GOOD LENGTH</text>
          <text x={pitchLeft + 8} y={yFull - 6} fill="#00f2fe" fontSize="9" fontWeight="700">FULL</text>
          <text x={pitchLeft + 8} y={pitchBottom - 6} fill="#ff1744" fontSize="9" fontWeight="700">YORKER</text>

          {/* Bowler End Creases & Stumps */}
          <line x1={pitchLeft - 10} y1={yBowlerCrease} x2={pitchRight + 10} y2={yBowlerCrease} stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
          <line x1={pitchLeft + 30} y1={pitchTop} x2={pitchRight - 30} y2={pitchTop} stroke="#ffab00" strokeWidth="3" />
          <text x={140} y={pitchTop - 12} fill="#94a3b8" fontSize="10" fontWeight="700" textAnchor="middle">BOWLER END (0m)</text>

          {/* Batsman End Creases & Stumps */}
          <line x1={pitchLeft - 10} y1={yBatsmanCrease} x2={pitchRight + 10} y2={yBatsmanCrease} stroke="#00f2fe" strokeWidth="2" />
          <line x1={pitchLeft + 30} y1={pitchBottom} x2={pitchRight - 30} y2={pitchBottom} stroke="#ffab00" strokeWidth="3" />
          <text x={140} y={pitchBottom + 22} fill="#00f2fe" fontSize="10" fontWeight="800" textAnchor="middle">BATSMAN END (20.12m)</text>

          {/* Middle Stumps Alignment Guideline */}
          <line x1={140} y1={pitchTop} x2={140} y2={pitchBottom} stroke="rgba(0, 242, 254, 0.15)" strokeDasharray="4,4" />

          {/* Bounce Points */}
          {validBalls.map((ball) => {
            const cx = mapX(ball._bx);
            const cy = mapY(ball._by);
            const colorCfg = getDeliveryColor(ball._type);
            const isHighlighted = (highlightedIndex != null && (ball._idx === highlightedIndex || ball._rawIdx === highlightedIndex));
            const isSelected = selectedBall && (selectedBall._idx === ball._idx);

            return (
              <g
                key={ball._idx}
                onClick={() => handleBallClick(ball)}
                style={{ cursor: 'pointer' }}
              >
                {/* Pulsing ring for highlighted/selected balls */}
                {(isHighlighted || isSelected) && (
                  <>
                    <circle
                      cx={cx}
                      cy={cy}
                      r="14"
                      fill="none"
                      stroke={colorCfg.border}
                      strokeWidth="2"
                      opacity="0.8"
                      filter="url(#glowEffect)"
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r="9"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                  </>
                )}

                {/* Main bounce circle */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHighlighted || isSelected ? 6.5 : 5}
                  fill={colorCfg.accent}
                  stroke="#050811"
                  strokeWidth="1.5"
                />

                {/* Delivery index number on ball */}
                <text
                  x={cx}
                  y={cy + 3}
                  fill="#050811"
                  fontSize="7"
                  fontWeight="900"
                  textAnchor="middle"
                >
                  {ball._idx}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Ball Tooltip/Details */}
      {selectedBall && (
        <div
          style={{
            marginTop: '10px',
            padding: '10px 14px',
            background: 'rgba(5, 8, 17, 0.85)',
            border: '1px solid rgba(0, 242, 254, 0.25)',
            borderRadius: '10px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px'
          }}
        >
          <div>
            <span style={{ color: '#00f2fe', fontWeight: '800', marginRight: '6px' }}>
              Ball #{selectedBall._idx}:
            </span>
            <span style={{ color: getDeliveryColor(selectedBall._type).text, fontWeight: '700' }}>
              {selectedBall._type}
            </span>
            <span style={{ color: '#94a3b8', marginLeft: '8px' }}>
              {selectedBall.length || 'Good Length'}
            </span>
          </div>

          <div style={{ color: '#cbd5e1', fontWeight: '700' }}>
            {selectedBall.turn_angle_deg != null && `${Number(selectedBall.turn_angle_deg).toFixed(1)}° turn`}
            {selectedBall.speed_kmh != null && ` • ${Number(selectedBall.speed_kmh).toFixed(1)} km/h`}
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          marginTop: '12px',
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          fontSize: '11px',
          color: '#94a3b8'
        }}
      >
        {Object.entries(DELIVERY_COLORS).map(([key, cfg]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: cfg.accent,
                boxShadow: `0 0 4px ${cfg.accent}`
              }}
            />
            <span style={{ color: '#cbd5e1', fontWeight: '600' }}>{cfg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
