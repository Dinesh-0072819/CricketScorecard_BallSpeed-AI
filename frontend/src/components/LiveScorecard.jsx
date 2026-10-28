import React, { useState } from 'react';
import { Trophy, RotateCcw, Zap, AlertTriangle, ShieldCheck, UserCheck, Play, ArrowRightLeft, FileText, X } from 'lucide-react';

export default function LiveScorecard({ matchState, onRefresh, onOpenNewMatch }) {
  const [mode, setMode] = useState('NORMAL');
  const [wicketMode, setWicketMode] = useState(false);
  
  const [showWicketModal, setShowWicketModal] = useState(false);
  const [pendingRunForWicket, setPendingRunForWicket] = useState(0);
  const [wicketDetails, setWicketDetails] = useState({
    who_out: '',
    new_batsman: '',
    wicket_desc: 'Catch out',
    fielder: ''
  });

  const [showBowlerModal, setShowBowlerModal] = useState(false);
  const [nextBowlerName, setNextBowlerName] = useState('');

  const [showFullScorecardModal, setShowFullScorecardModal] = useState(false);
  const [fullDetails, setFullDetails] = useState(null);

  if (!matchState || !matchState.match_id) {
    return (
      <div style={{ padding: '80px 24px', textAlign: 'center' }}>
        <div className="glass-panel" style={{ maxWidth: '540px', margin: '0 auto', padding: '48px 36px' }}>
          <div style={{
            width: '72px', height: '72px', borderRadius: '24px',
            background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.2) 0%, rgba(127, 0, 255, 0.2) 100%)',
            border: '1px solid rgba(0, 242, 254, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px auto', boxShadow: '0 0 30px rgba(0, 242, 254, 0.25)'
          }}>
            <Trophy size={36} className="gradient-text-cyan" />
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: '900', marginBottom: '12px' }}>No Active Match Session</h2>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: '1.6', marginBottom: '28px' }}>
            Start a live cricket match session to enable ball-by-ball scoring, strike rotation, and automated velocity radar logging.
          </p>
          <button onClick={onOpenNewMatch} className="btn-action btn-gradient" style={{ padding: '16px 36px', fontSize: '16px' }}>
            Launch New Match
          </button>
        </div>
      </div>
    );
  }

  const {
    match_id, team1, team2, total_overs, current_innings, runs, wickets, overs,
    crr, rrr, target, remaining_runs, remaining_balls, striker, non_striker, bowler,
    batting, bowling, over_deliveries, over_completed, status, winner
  } = matchState;

  const handleRunPress = (r) => {
    if (wicketMode) {
      setPendingRunForWicket(r);
      setWicketDetails(prev => ({ ...prev, who_out: striker, fielder: '' }));
      setShowWicketModal(true);
      return;
    }
    submitBall(mode, r);
  };

  const formatCricketDismissal = (type, fielder, currentBowler) => {
    const f = (fielder || '').trim();
    const b = (currentBowler || '').trim();

    if (type === 'Bowled') {
      return `b ${b}`;
    } else if (type === 'LBW') {
      return `lbw b ${b}`;
    } else if (type === 'Run out') {
      return f ? `run out (${f})` : 'run out';
    } else if (type === 'Stumped') {
      return f ? `st ${f} b ${b}` : `st † b ${b}`;
    } else {
      // Catch out
      if (f && f.toLowerCase() !== b.toLowerCase()) {
        return `c ${f} b ${b}`;
      }
      return `c & b ${b}`;
    }
  };

  const submitBall = async (ballMode, r, extraWicketDetails = {}) => {
    try {
      const payload = { mode: ballMode, runs: r, ...extraWicketDetails };
      const res = await fetch('/api/match/ball', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.over_completed) {
        setShowBowlerModal(true);
      }
      onRefresh();
      if (wicketMode) setWicketMode(false);
      if (mode !== 'NORMAL') setMode('NORMAL');
    } catch (e) {
      console.error(e);
    }
  };

  const handleWicketSubmit = () => {
    if (!wicketDetails.new_batsman) return;
    const formattedDesc = formatCricketDismissal(wicketDetails.wicket_desc, wicketDetails.fielder, bowler);
    
    submitBall('WICKET', pendingRunForWicket, {
      who_out: wicketDetails.who_out,
      new_batsman: wicketDetails.new_batsman,
      wicket_desc: formattedDesc
    });
    
    setShowWicketModal(false);
    setWicketMode(false);
  };

  const handleSwapStrike = async () => {
    try {
      await fetch('/api/match/swap_strike', { method: 'POST' });
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleUndo = async () => {
    try {
      await fetch('/api/match/undo', { method: 'POST' });
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleBowlerSubmit = async () => {
    if (!nextBowlerName) return;
    try {
      await fetch('/api/match/next_bowler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bowler: nextBowlerName })
      });
      setShowBowlerModal(false);
      setNextBowlerName('');
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenFullScorecard = async () => {
    try {
      const res = await fetch(`/api/match/details/${match_id}`);
      const data = await res.json();
      setFullDetails(data);
      setShowFullScorecardModal(true);
    } catch (e) {
      console.error(e);
    }
  };

  const strikerStat = batting[striker] || { runs: 0, balls: 0, fours: 0, sixes: 0, out_desc: 'not out' };
  const nonStrikerStat = batting[non_striker] || { runs: 0, balls: 0, fours: 0, sixes: 0, out_desc: 'not out' };
  const bowlerStat = bowling[bowler] || { balls: 0, maidens: 0, runs: 0, wickets: 0, max_speed: 0 };

  return (
    <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '32px 24px' }}>
      {/* Completed Match Banner */}
      {status === 'COMPLETED' && (
        <div className="glass-panel" style={{
          padding: '24px 32px', marginBottom: '28px',
          background: 'rgba(0, 230, 118, 0.12)', borderColor: 'rgba(0, 230, 118, 0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <Trophy size={40} color="#00e676" />
            <div>
              <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '800' }}>Match Result</span>
              <h2 style={{ fontSize: '24px', fontWeight: '900', color: '#00e676' }}>{winner}</h2>
            </div>
          </div>
          <button onClick={onOpenNewMatch} className="btn-action btn-gradient" style={{ padding: '12px 24px', fontSize: '14px' }}>
            Start Next Match
          </button>
        </div>
      )}

      {/* Broadcast Score Display Banner */}
      <div className="glass-panel glass-panel-neon" style={{ padding: '32px', marginBottom: '28px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '32px', alignItems: 'center' }}>
          {/* Team 1 Score Info */}
          <div>
            <span style={{
              fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1.5px',
              padding: '4px 10px', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.08)', color: '#94a3b8'
            }}>
              Innings {current_innings} • {total_overs} Overs Match
            </span>
            <h2 style={{ fontSize: '28px', fontWeight: '900', marginTop: '10px' }}>
              {current_innings === 1 ? team1 : team2}
            </h2>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginTop: '4px' }}>
              <span style={{ fontSize: '56px', fontWeight: '900', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                {runs} <span style={{ fontSize: '36px', color: '#94a3b8' }}>/ {wickets}</span>
              </span>
              <span style={{ fontSize: '22px', fontWeight: '800', color: '#00f2fe', fontFamily: 'var(--font-mono)' }}>
                ({overs} overs)
              </span>
            </div>
          </div>

          {/* Verses & Match Equation Center */}
          <div style={{ textAlign: 'center', padding: '0 24px', borderLeft: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(0, 242, 254, 0.15)',
              border: '1px solid rgba(0, 242, 254, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 12px auto', fontSize: '14px', fontWeight: '900', color: '#00f2fe'
            }}>
              VS
            </div>
            {current_innings === 2 ? (
              <div>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Target: {target}</span>
                <div style={{ fontSize: '20px', fontWeight: '900', color: '#00e676', marginTop: '4px' }}>
                  Need {remaining_runs} in {remaining_balls}b
                </div>
              </div>
            ) : (
              <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '600' }}>1st Innings in Progress</span>
            )}
          </div>

          {/* Run Rate Indicators & Full Scorecard Button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '24px' }}>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>Current RR</span>
                <div style={{ fontSize: '28px', fontWeight: '900', fontFamily: 'var(--font-mono)', color: '#ffffff' }}>{crr}</div>
              </div>
              {current_innings === 2 && (
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>Required RR</span>
                  <div style={{ fontSize: '28px', fontWeight: '900', fontFamily: 'var(--font-mono)', color: '#ffab00' }}>{rrr}</div>
                </div>
              )}
            </div>

            {/* View Full Scorecard Option Button */}
            <button
              onClick={handleOpenFullScorecard}
              className="btn-action"
              style={{
                padding: '8px 18px',
                fontSize: '13px',
                borderColor: 'rgba(0, 242, 254, 0.4)',
                background: 'rgba(0, 242, 254, 0.15)',
                color: '#00f2fe',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <FileText size={16} /> View Full Scorecard
            </button>
          </div>
        </div>

        {/* Current Over Deliveries Ticker Strip */}
        <div style={{
          marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Over Timeline:
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {over_deliveries && over_deliveries.length > 0 ? (
                over_deliveries.map((b, i) => {
                  const isBoundary = b === '4' || b === '6';
                  const isWicket = b.includes('W');
                  return (
                    <span key={i} className="ball-pop" style={{
                      width: '38px', height: '38px', borderRadius: '10px',
                      background: isWicket ? 'rgba(255, 23, 68, 0.25)' : isBoundary ? 'rgba(0, 242, 254, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                      border: isWicket ? '1px solid #ff1744' : isBoundary ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.15)',
                      color: isWicket ? '#ff1744' : isBoundary ? '#00f2fe' : '#ffffff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: '800', fontSize: '14px', fontFamily: 'var(--font-mono)'
                    }}>
                      {b}
                    </span>
                  );
                })
              ) : (
                <span style={{ fontSize: '13px', color: '#64748b', fontStyle: 'italic' }}>Waiting for first delivery...</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Players Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', marginBottom: '28px' }}>
        {/* Batting Card */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#00f2fe' }}>Batting Performers</h3>
            <button
              onClick={handleSwapStrike}
              className="btn-action"
              style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', borderColor: 'rgba(0, 242, 254, 0.3)', color: '#00f2fe' }}
            >
              <ArrowRightLeft size={14} /> Swap Strike
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8', fontSize: '12px' }}>
                <th style={{ paddingBottom: '10px' }}>Batsman</th>
                <th>Runs</th>
                <th>Balls</th>
                <th>4s</th>
                <th>6s</th>
                <th>S/R</th>
              </tr>
            </thead>
            <tbody>
              {/* Striker Row */}
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#00e676', fontWeight: '800' }}>
                <td style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00e676' }} />
                  {striker} *
                </td>
                <td style={{ fontSize: '16px', fontFamily: 'var(--font-mono)' }}>{strikerStat.runs}</td>
                <td>{strikerStat.balls}</td>
                <td>{strikerStat.fours}</td>
                <td>{strikerStat.sixes}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>
                  {strikerStat.balls > 0 ? ((strikerStat.runs / strikerStat.balls) * 100).toFixed(1) : '0.0'}
                </td>
              </tr>
              {/* Non-Striker Row */}
              <tr style={{ color: '#ffffff' }}>
                <td style={{ padding: '12px 0', color: '#94a3b8' }}>{non_striker}</td>
                <td style={{ fontSize: '16px', fontFamily: 'var(--font-mono)' }}>{nonStrikerStat.runs}</td>
                <td>{nonStrikerStat.balls}</td>
                <td>{nonStrikerStat.fours}</td>
                <td>{nonStrikerStat.sixes}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>
                  {nonStrikerStat.balls > 0 ? ((nonStrikerStat.runs / nonStrikerStat.balls) * 100).toFixed(1) : '0.0'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Bowling Card */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#ffab00' }}>Active Bowler</h3>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>⚡ Velocity Radar Active</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8', fontSize: '12px' }}>
                <th style={{ paddingBottom: '10px' }}>Bowler</th>
                <th>Overs</th>
                <th>M</th>
                <th>Runs</th>
                <th>Wkts</th>
                <th>Max Speed</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ color: '#ffffff', fontWeight: '800' }}>
                <td style={{ padding: '12px 0', color: '#ffab00' }}>{bowler} ⚾</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{`${Math.floor(bowlerStat.balls / 6)}.${bowlerStat.balls % 6}`}</td>
                <td>{bowlerStat.maidens}</td>
                <td>{bowlerStat.runs}</td>
                <td style={{ color: '#ff1744', fontSize: '16px' }}>{bowlerStat.wickets}</td>
                <td style={{ color: '#00f2fe', fontFamily: 'var(--font-mono)' }}>
                  {bowlerStat.max_speed > 0 ? `${bowlerStat.max_speed.toFixed(1)} km/h` : '--'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Interactive Ball Scoring Controller */}
      <div className="glass-panel" style={{ padding: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#ffffff' }}>Scoring Controller Console</h3>
          
          {/* Mode Toggles */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setMode(mode === 'WIDE' ? 'NORMAL' : 'WIDE')}
              className="btn-action"
              style={{
                padding: '8px 14px', fontSize: '12px',
                borderColor: mode === 'WIDE' ? '#00f2fe' : 'rgba(255,255,255,0.12)',
                background: mode === 'WIDE' ? 'rgba(0, 242, 254, 0.2)' : 'rgba(255,255,255,0.06)',
                color: mode === 'WIDE' ? '#00f2fe' : '#ffffff'
              }}
            >
              WIDE (+1)
            </button>
            <button
              onClick={() => setMode(mode === 'NOBALL' ? 'NORMAL' : 'NOBALL')}
              className="btn-action"
              style={{
                padding: '8px 14px', fontSize: '12px',
                borderColor: mode === 'NOBALL' ? '#00f2fe' : 'rgba(255,255,255,0.12)',
                background: mode === 'NOBALL' ? 'rgba(0, 242, 254, 0.2)' : 'rgba(255,255,255,0.06)',
                color: mode === 'NOBALL' ? '#00f2fe' : '#ffffff'
              }}
            >
              NO BALL (+1)
            </button>
            <button
              onClick={() => setMode(mode === 'LB' ? 'NORMAL' : 'LB')}
              className="btn-action"
              style={{
                padding: '8px 14px', fontSize: '12px',
                borderColor: mode === 'LB' ? '#ffab00' : 'rgba(255,255,255,0.12)',
                background: mode === 'LB' ? 'rgba(255, 171, 0, 0.2)' : 'rgba(255,255,255,0.06)',
                color: mode === 'LB' ? '#ffab00' : '#ffffff'
              }}
            >
              LEG BYE (LB)
            </button>
            <button
              onClick={() => setMode(mode === 'BYE' ? 'NORMAL' : 'BYE')}
              className="btn-action"
              style={{
                padding: '8px 14px', fontSize: '12px',
                borderColor: mode === 'BYE' ? '#ffab00' : 'rgba(255,255,255,0.12)',
                background: mode === 'BYE' ? 'rgba(255, 171, 0, 0.2)' : 'rgba(255,255,255,0.06)',
                color: mode === 'BYE' ? '#ffab00' : '#ffffff'
              }}
            >
              BYE (B)
            </button>
            <button
              onClick={() => setWicketMode(!wicketMode)}
              className="btn-action"
              style={{
                padding: '8px 14px', fontSize: '12px',
                borderColor: wicketMode ? '#ff1744' : 'rgba(255,255,255,0.12)',
                background: wicketMode ? 'rgba(255, 23, 68, 0.25)' : 'rgba(255,255,255,0.06)',
                color: wicketMode ? '#ff1744' : '#ffffff'
              }}
            >
              WICKET MODE
            </button>
          </div>
        </div>

        {/* Action Run Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '12px' }}>
          {[0, 1, 2, 3, 4, 6].map((r) => {
            const isBoundary = r === 4 || r === 6;
            return (
              <button
                key={r}
                onClick={() => handleRunPress(r)}
                className={`btn-action ${isBoundary ? 'btn-gradient' : ''}`}
                style={{
                  padding: '22px 10px',
                  fontSize: '24px',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: '900'
                }}
              >
                {r}
              </button>
            );
          })}

          {/* Swap Batsmen Button */}
          <button
            onClick={handleSwapStrike}
            className="btn-action"
            style={{
              padding: '22px 6px',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              borderColor: 'rgba(0, 242, 254, 0.4)',
              color: '#00f2fe'
            }}
          >
            <ArrowRightLeft size={18} /> Swap Strike
          </button>

          {/* Undo Button */}
          <button
            onClick={handleUndo}
            className="btn-action btn-danger"
            style={{
              padding: '22px 6px',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}
          >
            <RotateCcw size={18} /> Undo
          </button>
        </div>
      </div>

      {/* Full Scorecard View Modal */}
      {showFullScorecardModal && fullDetails && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="glass-panel" style={{ width: '820px', maxHeight: '85vh', overflowY: 'auto', padding: '36px', position: 'relative' }}>
            <button
              onClick={() => setShowFullScorecardModal(false)}
              style={{ position: 'absolute', top: '24px', right: '24px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            >
              <X size={24} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <FileText size={28} className="gradient-text-cyan" />
              <div>
                <h2 style={{ fontSize: '22px', fontWeight: '900' }}>Full Match Scorecard</h2>
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>{team1} vs {team2} • {total_overs} Overs Match</span>
              </div>
            </div>

            {/* Batting Card Full */}
            <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#00f2fe', marginBottom: '12px' }}>Batting Scorecard</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '28px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8' }}>
                  <th style={{ paddingBottom: '8px' }}>Batsman</th>
                  <th>Runs</th>
                  <th>Balls</th>
                  <th>4s</th>
                  <th>6s</th>
                  <th>Dismissal Details</th>
                </tr>
              </thead>
              <tbody>
                {fullDetails.batting && fullDetails.batting.map((b) => (
                  <tr key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#ffffff' }}>
                    <td style={{ padding: '10px 0', fontWeight: '700' }}>{b.player}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{b.runs}</td>
                    <td>{b.balls}</td>
                    <td>{b.fours}</td>
                    <td>{b.sixes}</td>
                    <td style={{ color: b.out_desc === 'not out' ? '#00e676' : '#94a3b8', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                      {b.out_desc}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Bowling Card Full */}
            <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#ffab00', marginBottom: '12px' }}>Bowling Scorecard</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8' }}>
                  <th style={{ paddingBottom: '8px' }}>Bowler</th>
                  <th>Overs</th>
                  <th>Maidens</th>
                  <th>Runs</th>
                  <th>Wickets</th>
                  <th>Peak Speed</th>
                </tr>
              </thead>
              <tbody>
                {fullDetails.bowling && fullDetails.bowling.map((bw) => (
                  <tr key={bw.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#ffffff' }}>
                    <td style={{ padding: '10px 0', fontWeight: '700' }}>{bw.bowler}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{`${Math.floor(bw.balls / 6)}.${bw.balls % 6}`}</td>
                    <td>{bw.maidens}</td>
                    <td>{bw.runs}</td>
                    <td style={{ color: '#ff1744', fontWeight: '800' }}>{bw.wickets}</td>
                    <td style={{ color: '#00f2fe', fontFamily: 'var(--font-mono)' }}>{bw.max_speed ? `${bw.max_speed.toFixed(1)} km/h` : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Wicket Dismissal Modal */}
      {showWicketModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="glass-panel" style={{ width: '460px', padding: '32px', borderColor: 'rgba(255,23,68,0.5)' }}>
            <h3 style={{ fontSize: '20px', fontWeight: '900', color: '#ff1744', marginBottom: '16px' }}>Wicket & Dismissal Details</h3>
            
            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Dismissed Batter</label>
            <select
              value={wicketDetails.who_out}
              onChange={(e) => setWicketDetails({ ...wicketDetails, who_out: e.target.value })}
              className="input-premium" style={{ width: '100%', marginBottom: '14px' }}
            >
              <option value={striker}>{striker} (Striker)</option>
              <option value={non_striker}>{non_striker} (Non-Striker)</option>
            </select>

            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Dismissal Type</label>
            <select
              value={wicketDetails.wicket_desc}
              onChange={(e) => setWicketDetails({ ...wicketDetails, wicket_desc: e.target.value })}
              className="input-premium" style={{ width: '100%', marginBottom: '14px' }}
            >
              <option value="Catch out">Catch out (c Fielder b Bowler)</option>
              <option value="Bowled">Bowled (b Bowler)</option>
              <option value="LBW">LBW (lbw b Bowler)</option>
              <option value="Stumped">Stumped (st Fielder b Bowler)</option>
              <option value="Run out">Run out (run out Fielder)</option>
            </select>

            {(wicketDetails.wicket_desc === 'Catch out' || wicketDetails.wicket_desc === 'Stumped' || wicketDetails.wicket_desc === 'Run out') && (
              <>
                <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                  Fielder / Catcher / Wicketkeeper Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Alex Carey"
                  value={wicketDetails.fielder}
                  onChange={(e) => setWicketDetails({ ...wicketDetails, fielder: e.target.value })}
                  className="input-premium" style={{ width: '100%', marginBottom: '14px' }}
                />
              </>
            )}

            <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>New Incoming Batter Name</label>
            <input
              type="text"
              placeholder="e.g. KL Rahul"
              value={wicketDetails.new_batsman}
              onChange={(e) => setWicketDetails({ ...wicketDetails, new_batsman: e.target.value })}
              className="input-premium" style={{ width: '100%', marginBottom: '24px' }}
            />

            <div style={{ display: 'flex', gap: '14px' }}>
              <button onClick={() => setShowWicketModal(false)} className="btn-action" style={{ flex: 1, padding: '14px' }}>Cancel</button>
              <button onClick={handleWicketSubmit} className="btn-action btn-danger" style={{ flex: 1, padding: '14px' }}>Confirm Wicket</button>
            </div>
          </div>
        </div>
      )}

      {/* Bowler Switch Modal */}
      {showBowlerModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="glass-panel" style={{ width: '420px', padding: '32px' }}>
            <h3 style={{ fontSize: '20px', fontWeight: '900', color: '#00f2fe', marginBottom: '12px' }}>Over Completed!</h3>
            <p style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '20px' }}>Enter bowler for the next over:</p>
            <input
              type="text"
              placeholder="e.g. Jasprit Bumrah"
              value={nextBowlerName}
              onChange={(e) => setNextBowlerName(e.target.value)}
              className="input-premium" style={{ width: '100%', marginBottom: '24px' }}
            />
            <button onClick={handleBowlerSubmit} className="btn-action btn-gradient" style={{ width: '100%', padding: '14px' }}>
              Start Next Over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
