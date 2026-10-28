import React, { useState, useEffect } from 'react';
import { BarChart3, Zap, ShieldAlert, Award, Activity } from 'lucide-react';

export default function AnalyticsDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/analytics_data')
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch((err) => console.error(err));
  }, []);

  if (!data) {
    return <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading Speed Analytics...</div>;
  }

  const { total_runs, peak_speed, avg_speed, alarm_rate, recent_runs } = data;

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
      {/* Metric Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
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
