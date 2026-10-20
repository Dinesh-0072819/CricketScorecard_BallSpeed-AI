import React, { useState, useEffect } from 'react';
import { BarChart3, Zap, ShieldAlert, Award, Activity, Compass, TrendingUp, Target, RefreshCw } from 'lucide-react';
import PitchMap from './PitchMap';

export default function AnalyticsDashboard() {
  const [data, setData] = useState(null);
  const [bowlerData, setBowlerData] = useState(null);
  const [selectedBowler, setSelectedBowler] = useState('ALL');
  const [loadingBowler, setLoadingBowler] = useState(false);

  useEffect(() => {
    fetch('/analytics_data')
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch((err) => console.error(err));

    fetchBowlerAnalysis('ALL');
  }, []);

  const fetchBowlerAnalysis = (bowler = selectedBowler) => {
    setLoadingBowler(true);
    const url = bowler && bowler !== 'ALL'
      ? `/api/bowler/analysis?bowler=${encodeURIComponent(bowler)}`
      : '/api/bowler/analysis';

    fetch(url)
      .then((res) => res.json())
      .then((d) => setBowlerData(d))
      .catch((err) => console.error(err))
      .finally(() => setLoadingBowler(false));
  };

  const handleBowlerChange = (bowler) => {
    setSelectedBowler(bowler);
    fetchBowlerAnalysis(bowler);
  };

  if (!data) {
    return <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading Speed Analytics...</div>;
  }

  const { total_runs, peak_speed, avg_speed, alarm_rate, recent_runs } = data;

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
      {/* Metric Cards Grid */}
      <div className="mobile-metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        <div className="glass-card" style={{ padding: '20px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Total Deliveries</span>
          <div style={{ fontSize: '32px', fontWeight: '800', fontFamily: 'var(--font-mono)', margin: '6px 0', color: '#f8fafc' }}>
            {total_runs}
          </div>
          <span style={{ fontSize: '12px', color: '#64748b' }}>Analyzed in radar system</span>
        </div>

        <div className="glass-card" style={{ padding: '20px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Fastest Ball Peak</span>
          <div style={{ fontSize: '32px', fontWeight: '800', fontFamily: 'var(--font-mono)', margin: '6px 0', color: '#00f2fe' }}>
            {peak_speed.toFixed(1)} <span style={{ fontSize: '14px', color: '#64748b' }}>km/h</span>
          </div>
          <span style={{ fontSize: '12px', color: '#00e676' }}>All-time top velocity</span>
        </div>

        <div className="glass-card" style={{ padding: '20px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Average Speed</span>
          <div style={{ fontSize: '32px', fontWeight: '800', fontFamily: 'var(--font-mono)', margin: '6px 0', color: '#ffab00' }}>
            {avg_speed.toFixed(1)} <span style={{ fontSize: '14px', color: '#64748b' }}>km/h</span>
          </div>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Mean delivery speed</span>
        </div>

        <div className="glass-card" style={{ padding: '20px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Alarm Rate</span>
          <div style={{ fontSize: '32px', fontWeight: '800', fontFamily: 'var(--font-mono)', margin: '6px 0', color: '#ff1744' }}>
            {alarm_rate.toFixed(1)}%
          </div>
          <span style={{ fontSize: '12px', color: '#64748b' }}>Over-speed & No-Ball %</span>
        </div>
      </div>

      {/* Bowler Analysis Panel */}
      {bowlerData && (
        <div className="glass-card" style={{ padding: '24px', marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Compass size={24} color="#00f2fe" />
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: '900', color: '#f1f5f9', margin: 0 }}>
                  Bowler Movement & Trajectory Analysis
                </h3>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  {bowlerData.balls_analysed} deliveries analysed with AI turn & swing detection
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Bowler Selector */}
              {bowlerData.bowlers && Object.keys(bowlerData.bowlers).length > 0 && (
                <select
                  value={selectedBowler}
                  onChange={(e) => handleBowlerChange(e.target.value)}
                  className="input-premium"
                  style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '8px' }}
                >
                  <option value="ALL">All Bowlers</option>
                  {Object.keys(bowlerData.bowlers).map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              )}

              <button
                onClick={() => fetchBowlerAnalysis()}
                className="btn-action"
                style={{ padding: '6px', borderRadius: '8px' }}
                title="Refresh Bowler Analysis"
              >
                <RefreshCw size={14} className={loadingBowler ? 'spin' : ''} />
              </button>
            </div>
          </div>

          {/* Quick Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '14px', marginBottom: '24px' }}>
            <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Avg Speed</span>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#00f2fe', marginTop: '4px' }}>
                {bowlerData.avg_speed_kmh != null ? bowlerData.avg_speed_kmh.toFixed(1) : '0.0'} <span style={{ fontSize: '12px', color: '#64748b' }}>km/h</span>
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Release velocity</span>
            </div>

            <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Avg Turn Angle</span>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#ffab00', marginTop: '4px' }}>
                {bowlerData.avg_turn_deg != null ? bowlerData.avg_turn_deg.toFixed(1) : '0.0'}°
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Pitch deflection</span>
            </div>

            <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Avg Air Swing</span>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#00e676', marginTop: '4px' }}>
                {bowlerData.avg_swing_cm != null ? bowlerData.avg_swing_cm.toFixed(1) : '0.0'} cm
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Lateral air drift</span>
            </div>

            <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Spin Deliveries</span>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#ffab00', marginTop: '4px' }}>
                {bowlerData.spin_count ?? 0}
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Off / Leg Spin</span>
            </div>

            <div style={{ background: 'rgba(5, 8, 17, 0.6)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Swing Deliveries</span>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#00e676', marginTop: '4px' }}>
                {bowlerData.swing_count ?? 0}
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Inswing / Outswing</span>
            </div>
          </div>

          {/* Length Distribution Bars */}
          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', marginBottom: '12px' }}>
              Pitch Length Distribution
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(bowlerData.length_distribution || {}).map(([lenKey, count]) => {
                const total = bowlerData.balls_analysed || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={lenKey} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 45px', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
                    <span style={{ color: '#cbd5e1', fontWeight: '600' }}>{lenKey}</span>
                    <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: lenKey === 'Good Length' ? '#00e676' : lenKey === 'Yorker' ? '#ffab00' : lenKey === 'Full' ? '#00f2fe' : '#94a3b8',
                          transition: 'width 0.4s ease'
                        }}
                      />
                    </div>
                    <span style={{ color: '#94a3b8', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{count} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Top-Down Pitch Bounce Map */}
      <div style={{ marginBottom: '28px' }}>
        <PitchMap />
      </div>

      {/* Recent Delivery Log Table */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '16px', color: '#00f2fe' }}>
          Recent Speed Radar Log History
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8', fontSize: '12px' }}>
              <th style={{ paddingBottom: '10px' }}>Run ID</th>
              <th>Speed (km/h)</th>
              <th>Status</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {recent_runs && recent_runs.length > 0 ? (
              recent_runs.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f8fafc' }}>
                  <td style={{ padding: '12px 0', fontFamily: 'var(--font-mono)', color: '#94a3b8' }}>#{r.id}</td>
                  <td style={{ fontWeight: '700', color: '#00f2fe', fontFamily: 'var(--font-mono)' }}>{r.speed.toFixed(1)} km/h</td>
                  <td>
                    <span style={{
                      padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '700',
                      background: r.status === 'SAFE' ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255, 23, 68, 0.15)',
                      color: r.status === 'SAFE' ? '#00e676' : '#ff1744'
                    }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ color: '#64748b', fontSize: '13px' }}>{r.timestamp}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="4" style={{ padding: '20px 0', textAlign: 'center', color: '#64748b' }}>No speed runs logged yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

