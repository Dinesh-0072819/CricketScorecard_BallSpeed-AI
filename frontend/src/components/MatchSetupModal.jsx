import React, { useState, useEffect } from 'react';
import { Trophy, X, Minus, Plus, Users, Coins, Timer, Play } from 'lucide-react';

const OVER_PRESETS = [1, 2, 5, 10, 20, 50];

const labelStyle = {
  fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '8px',
  fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px'
};

const sectionTitle = (icon, text, color = '#00f2fe') => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
    {icon}
    <h4 style={{ fontSize: '13px', fontWeight: '800', color, textTransform: 'uppercase', letterSpacing: '1.2px' }}>{text}</h4>
  </div>
);

function Segmented({ options, value, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: '6px', padding: '5px', borderRadius: '14px',
      background: 'rgba(8, 12, 24, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)'
    }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              flex: 1, padding: '10px 8px', borderRadius: '10px', cursor: 'pointer',
              fontSize: '13px', fontWeight: '800', transition: 'all 0.2s',
              border: active ? '1px solid rgba(0, 242, 254, 0.6)' : '1px solid transparent',
              background: active ? 'linear-gradient(135deg, rgba(0,242,254,0.25) 0%, rgba(79,172,254,0.25) 100%)' : 'transparent',
              color: active ? '#00f2fe' : '#94a3b8',
              boxShadow: active ? '0 0 14px rgba(0, 242, 254, 0.25)' : 'none',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function MatchSetupModal({ isOpen, onClose, onMatchCreated }) {
  const [team1, setTeam1] = useState('India');
  const [team2, setTeam2] = useState('Australia');
  const [totalOvers, setTotalOvers] = useState(20);
  const [tossWinnerSide, setTossWinnerSide] = useState('team1');   // follows renamed teams
  const [tossDecision, setTossDecision] = useState('BAT');

  const [striker, setStriker] = useState('Rohit Sharma');
  const [nonStriker, setNonStriker] = useState('Shubman Gill');
  const [bowler, setBowler] = useState('Mitchell Starc');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (isOpen) setError(''); }, [isOpen]);

  if (!isOpen) return null;

  const tossWinner = tossWinnerSide === 'team1' ? team1 : team2;
  const battingFirst = tossDecision === 'BAT' ? tossWinner : (tossWinnerSide === 'team1' ? team2 : team1);
  const bowlingFirst = battingFirst === team1 ? team2 : team1;
  const oversNum = parseInt(totalOvers, 10);
  const oversValid = Number.isFinite(oversNum) && oversNum >= 1;

  const setOvers = (v) => {
    if (v === '') { setTotalOvers(''); return; }
    const n = Math.max(1, Math.min(999, parseInt(v, 10) || 1));
    setTotalOvers(n);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!oversValid) { setError('Enter the number of overs (1 or more).'); return; }
    if (team1.trim().toLowerCase() === team2.trim().toLowerCase()) { setError('Team names must be different.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await fetch('/api/match/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team1, team2, total_overs: oversNum, toss_winner: tossWinner, toss_decision: tossDecision })
      });
      await fetch('/api/match/setup_innings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ striker, non_striker: nonStriker, bowler, current_innings: 1 })
      });
      onMatchCreated();
      onClose();
    } catch (err) {
      console.error(err);
      setError('Could not start the match. Is the server running?');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(14px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px'
    }}>
      <div className="glass-panel glass-panel-neon" style={{
        width: '600px', maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', padding: '32px', position: 'relative'
      }}>
        <button onClick={onClose} type="button" style={{ position: 'absolute', top: '22px', right: '22px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
          <X size={22} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '26px' }}>
          <div style={{
            width: '52px', height: '52px', borderRadius: '16px',
            background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.2) 0%, rgba(127, 0, 255, 0.2) 100%)',
            border: '1px solid rgba(0, 242, 254, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 24px rgba(0, 242, 254, 0.25)'
          }}>
            <Trophy size={26} color="#00f2fe" />
          </div>
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: '900' }}>New Cricket Match</h2>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>Set up teams, overs and toss to start live scoring</span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Teams */}
          {sectionTitle(<Users size={16} color="#00f2fe" />, 'Teams')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '12px', alignItems: 'end', marginBottom: '24px' }}>
            <div>
              <label style={labelStyle}>Team 1</label>
              <input type="text" value={team1} onChange={(e) => setTeam1(e.target.value)} className="input-premium" style={{ width: '100%' }} required />
            </div>
            <div style={{
              width: '38px', height: '38px', borderRadius: '50%', marginBottom: '4px',
              background: 'rgba(0, 242, 254, 0.15)', border: '1px solid rgba(0, 242, 254, 0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '900', color: '#00f2fe'
            }}>VS</div>
            <div>
              <label style={labelStyle}>Team 2</label>
              <input type="text" value={team2} onChange={(e) => setTeam2(e.target.value)} className="input-premium" style={{ width: '100%' }} required />
            </div>
          </div>

          {/* Overs */}
          {sectionTitle(<Timer size={16} color="#00f2fe" />, 'Overs per Innings')}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <button type="button" className="btn-action" onClick={() => setOvers((oversNum || 1) - 1)}
              style={{ width: '48px', height: '48px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Minus size={18} />
            </button>
            <input
              type="number" min={1} step={1} value={totalOvers}
              onChange={(e) => setOvers(e.target.value)}
              onBlur={() => { if (!oversValid) setTotalOvers(1); }}
              className="input-premium"
              style={{ width: '120px', textAlign: 'center', fontSize: '24px', fontWeight: '900', fontFamily: 'var(--font-mono)', color: '#00f2fe', padding: '8px' }}
            />
            <button type="button" className="btn-action" onClick={() => setOvers((oversNum || 0) + 1)}
              style={{ width: '48px', height: '48px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={18} />
            </button>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>
              {oversValid ? `${oversNum * 6} balls per innings` : 'min 1 over'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px' }}>
            {OVER_PRESETS.map((o) => (
              <button key={o} type="button" onClick={() => setTotalOvers(o)} className="btn-action"
                style={{
                  padding: '6px 14px', fontSize: '12px', fontWeight: '800',
                  borderColor: oversNum === o ? '#00f2fe' : 'rgba(255,255,255,0.12)',
                  background: oversNum === o ? 'rgba(0, 242, 254, 0.2)' : 'rgba(255,255,255,0.06)',
                  color: oversNum === o ? '#00f2fe' : '#ffffff'
                }}>
                {o === 20 ? '20 (T20)' : o === 50 ? '50 (ODI)' : `${o} over${o > 1 ? 's' : ''}`}
              </button>
            ))}
          </div>

          {/* Toss */}
          {sectionTitle(<Coins size={16} color="#ffab00" />, 'Toss', '#ffab00')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>Toss Won By</label>
              <Segmented
                value={tossWinnerSide}
                onChange={setTossWinnerSide}
                options={[{ value: 'team1', label: team1 || 'Team 1' }, { value: 'team2', label: team2 || 'Team 2' }]}
              />
            </div>
            <div>
              <label style={labelStyle}>Elected To</label>
              <Segmented
                value={tossDecision}
                onChange={setTossDecision}
                options={[{ value: 'BAT', label: 'Bat First' }, { value: 'BOWL', label: 'Bowl First' }]}
              />
            </div>
          </div>
          <div style={{
            fontSize: '13px', color: '#cbd5e1', padding: '10px 14px', borderRadius: '12px', marginBottom: '24px',
            background: 'rgba(255, 171, 0, 0.08)', border: '1px solid rgba(255, 171, 0, 0.25)'
          }}>
            <b style={{ color: '#ffab00' }}>{tossWinner || '—'}</b> won the toss and chose to {tossDecision === 'BAT' ? 'bat' : 'bowl'} •{' '}
            <b style={{ color: '#00f2fe' }}>{battingFirst || '—'}</b> bat first
          </div>

          {/* Opening players */}
          {sectionTitle(<Play size={16} color="#00e676" />, `Opening Players`, '#00e676')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={labelStyle}>Striker ({battingFirst || 'batting'})</label>
              <input type="text" value={striker} onChange={(e) => setStriker(e.target.value)} className="input-premium" style={{ width: '100%' }} required />
            </div>
            <div>
              <label style={labelStyle}>Non-Striker</label>
              <input type="text" value={nonStriker} onChange={(e) => setNonStriker(e.target.value)} className="input-premium" style={{ width: '100%' }} required />
            </div>
          </div>
          <div style={{ marginBottom: '26px' }}>
            <label style={labelStyle}>Opening Bowler ({bowlingFirst || 'bowling'})</label>
            <input type="text" value={bowler} onChange={(e) => setBowler(e.target.value)} className="input-premium" style={{ width: '100%' }} required />
          </div>

          {error && (
            <div style={{ color: '#ff1744', fontSize: '13px', fontWeight: '700', marginBottom: '14px' }}>{error}</div>
          )}

          <button type="submit" disabled={submitting} className="btn-action btn-gradient"
            style={{ width: '100%', padding: '16px', fontSize: '15px', fontWeight: '900', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Starting…' : `Launch ${oversValid ? oversNum : ''}-Over Match & Live Scoring`}
          </button>
        </form>
      </div>
    </div>
  );
}
