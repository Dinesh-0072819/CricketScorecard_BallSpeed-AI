import React, { useState, useEffect } from 'react';
import { Trophy, RotateCcw, Zap, AlertTriangle, ShieldCheck, UserCheck, Play, ArrowRightLeft, FileText, X, Target, Sparkles } from 'lucide-react';
import PitchMap from './PitchMap';

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

  const [showInnings2Modal, setShowInnings2Modal] = useState(false);
  const [innings2Details, setInnings2Details] = useState({
    striker: '',
    non_striker: '',
    bowler: ''
  });

  const [showFullScorecardModal, setShowFullScorecardModal] = useState(false);
  const [fullDetails, setFullDetails] = useState(null);

  // Ball Movement Analysis Auto-Attachment State
  const [attachedAnalysis, setAttachedAnalysis] = useState(null);
  const [discardAttached, setDiscardAttached] = useState(false);
  const [showPitchMapModal, setShowPitchMapModal] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchLatestAnalysis = async () => {
      try {
        const res = await fetch('/api/analysis/latest');
        const data = await res.json();
        if (isMounted) {
          if (data.is_fresh && data.analysis && !discardAttached) {
            setAttachedAnalysis(data.analysis);
          } else if (!data.is_fresh) {
            setAttachedAnalysis(null);
          }
        }
      } catch (err) {
        // silent
      }
    };
    fetchLatestAnalysis();
    const interval = setInterval(fetchLatestAnalysis, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [discardAttached]);

  const handleDiscardAnalysis = async () => {
    setDiscardAttached(true);
    setAttachedAnalysis(null);
    try {
      await fetch('/api/analysis/discard', { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
  };

  if (!matchState || !matchState.match_id) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center' }}>
        <div className="glass-panel" style={{ maxWidth: '540px', margin: '0 auto', padding: '32px 20px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '20px',
            background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.2) 0%, rgba(127, 0, 255, 0.2) 100%)',
            border: '1px solid rgba(0, 242, 254, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px auto', boxShadow: '0 0 30px rgba(0, 242, 254, 0.25)'
          }}>
            <Trophy size={32} className="gradient-text-cyan" />
          </div>
          <h2 style={{ fontSize: '22px', fontWeight: '900', marginBottom: '10px' }}>No Active Match Session</h2>
          <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: '1.6', marginBottom: '24px' }}>
            Start a live cricket match session to enable ball-by-ball scoring, strike rotation, and automated velocity radar logging.
          </p>
          <button onClick={onOpenNewMatch} className="btn-action btn-gradient" style={{ padding: '14px 28px', fontSize: '15px', width: '100%' }}>
            Launch New Match
          </button>
        </div>
      </div>
    );
  }

  const {
    match_id, team1, team2, batting_team, bowling_team, total_overs, current_innings, runs, wickets, overs,
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
      if (f && f.toLowerCase() !== b.toLowerCase()) {
        return `c ${f} b ${b}`;
      }
      return `c & b ${b}`;
    }
  };

  const submitBall = async (ballMode, r, extraWicketDetails = {}) => {
    try {
      const payload = {
        mode: ballMode,
        runs: r,
        discard_analysis: discardAttached,
        ...extraWicketDetails
      };

      if (attachedAnalysis && !discardAttached) {
        payload.delivery_type = attachedAnalysis.delivery_type;
        payload.spin_type = attachedAnalysis.spin_type;
        payload.swing_type = attachedAnalysis.swing_type;
        payload.turn_angle_deg = attachedAnalysis.turn_angle_deg;
        payload.swing_cm = attachedAnalysis.swing_cm;
        payload.length = attachedAnalysis.length;
        payload.line = attachedAnalysis.line;
        if (attachedAnalysis.bounce_xy_m && attachedAnalysis.bounce_xy_m.length === 2) {
          payload.bounce_x = attachedAnalysis.bounce_xy_m[0];
          payload.bounce_y = attachedAnalysis.bounce_xy_m[1];
        }
        payload.analysis_confidence = attachedAnalysis.confidence;
      }

      const res = await fetch('/api/match/ball', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setAttachedAnalysis(null);
      setDiscardAttached(false);

      if (data.over_completed && data.status === 'LIVE') {
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

  const handleInnings2Submit = async () => {
    if (!innings2Details.striker || !innings2Details.non_striker || !innings2Details.bowler) return;
    try {
      await fetch('/api/match/setup_innings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          striker: innings2Details.striker,
          non_striker: innings2Details.non_striker,
          bowler: innings2Details.bowler,
          target: target,
          current_innings: 2
        })
      });
      setShowInnings2Modal(false);
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
    <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '16px' }}>
      {/* Completed Match Banner */}
      {status === 'COMPLETED' && (
        <div className="glass-panel" style={{
          padding: '16px 20px', marginBottom: '16px',
          background: 'rgba(0, 230, 118, 0.12)', borderColor: 'rgba(0, 230, 118, 0.4)',
          display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <Trophy size={28} color="#00e676" />
            <div>
              <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '800' }}>Match Result</span>
              <h2 style={{ fontSize: '20px', fontWeight: '900', color: '#00e676' }}>{winner}</h2>
            </div>
          </div>
          <button onClick={onOpenNewMatch} className="btn-action btn-gradient" style={{ padding: '10px 20px', fontSize: '13px', margin: '0 auto' }}>
            Start Next Match
          </button>
        </div>
      )}

      {/* Innings 1 Break Banner */}
      {status === 'INNINGS_BREAK' && (
        <div className="glass-panel" style={{
          padding: '24px', marginBottom: '16px',
          background: 'rgba(255, 171, 0, 0.15)', borderColor: 'rgba(255, 171, 0, 0.5)',
          display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
            <Zap size={32} color="#ffab00" />
            <div>
              <span style={{ fontSize: '11px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '800' }}>1st Innings Completed</span>
              <h2 style={{ fontSize: '22px', fontWeight: '900', color: '#ffffff', marginTop: '4px' }}>
                {team1} Scored: <span style={{ color: '#00f2fe' }}>{runs}/{wickets}</span> ({overs} ov)
              </h2>
              <div style={{ fontSize: '18px', fontWeight: '900', color: '#ffab00', marginTop: '6px' }}>
                🎯 Target Set for {team2}: {target} Runs ({total_overs} Overs)
              </div>
              <p style={{ fontSize: '13px', color: '#cbd5e1', marginTop: '4px' }}>
                {team2} need {target} runs in {total_overs * 6} balls to win
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setInnings2Details({ striker: '', non_striker: '', bowler: '' });
              setShowInnings2Modal(true);
            }}
            className="btn-action btn-gradient"
            style={{ padding: '14px 28px', fontSize: '15px', margin: '0 auto' }}
          >
            Setup 2nd Innings Chasing ➔
          </button>
        </div>
      )}

      {/* Broadcast Score Display Banner */}
      <div className="glass-panel glass-panel-neon" style={{ padding: '20px', marginBottom: '16px' }}>
        <div className="mobile-header-stack" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '16px', alignItems: 'center' }}>
          {/* Team Score Info */}
          <div>
            <span style={{
              fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px',
              padding: '3px 8px', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.08)', color: '#94a3b8'
            }}>
              Inn {current_innings} • {total_overs} Ov
            </span>
            <h2 style={{ fontSize: '22px', fontWeight: '900', marginTop: '6px' }}>
              {batting_team || (current_innings === 1 ? team1 : team2)}
            </h2>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'inherit', gap: '8px', marginTop: '2px' }}>
              <span style={{ fontSize: '42px', fontWeight: '900', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                {runs} <span style={{ fontSize: '24px', color: '#94a3b8' }}>/ {wickets}</span>
              </span>
              <span style={{ fontSize: '18px', fontWeight: '800', color: '#00f2fe', fontFamily: 'var(--font-mono)' }}>
                ({overs} ov)
              </span>
            </div>
          </div>

          {/* Verses & Match Equation Center (Real Cricket Chase Format) */}
          <div className="mobile-center-border" style={{ textAlign: 'center', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid rgba(255,255,255,0.1)' }}>
            {current_innings === 2 ? (
              <div>
                <span style={{ fontSize: '10px', color: '#ffab00', textTransform: 'uppercase', fontWeight: '800' }}>Target: {target}</span>
                <div style={{ fontSize: '15px', fontWeight: '900', color: '#00e676', marginTop: '4px', lineHeight: '1.3' }}>
                  {batting_team || team2} need <span style={{ color: '#00f2fe', fontSize: '18px' }}>{remaining_runs}</span> runs in <span style={{ color: '#00f2fe', fontSize: '18px' }}>{remaining_balls}</span> balls to win
                </div>
              </div>
            ) : (
              <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '600' }}>1st Innings in Progress</span>
            )}
          </div>

          {/* Run Rate Indicators & Full Scorecard Button */}
          <div className="mobile-align-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '16px' }}>
              <div>
                <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>CRR</span>
                <div style={{ fontSize: '22px', fontWeight: '900', fontFamily: 'var(--font-mono)', color: '#ffffff' }}>{crr}</div>
              </div>
              {current_innings === 2 && (
                <div>
                  <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>RRR</span>
                  <div style={{ fontSize: '22px', fontWeight: '900', fontFamily: 'var(--font-mono)', color: '#ffab00' }}>{rrr}</div>
                </div>
              )}
            </div>

            {/* View Full Scorecard Option Button */}
            <button
              onClick={handleOpenFullScorecard}
              className="btn-action"
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                borderColor: 'rgba(0, 242, 254, 0.4)',
                background: 'rgba(0, 242, 254, 0.15)',
                color: '#00f2fe',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <FileText size={14} /> Full Scorecard
            </button>
          </div>
        </div>

        {/* Current Over Deliveries Ticker Strip */}
        <div style={{
          marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', overflowX: 'auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              This Over:
            </span>
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
              {over_deliveries && over_deliveries.length > 0 ? (
                over_deliveries.map((b, i) => {
                  const isBoundary = b === '4' || b === '6';
                  const isWicket = b.includes('W');
                  return (
                    <span key={i} className="ball-pop" style={{
                      minWidth: '32px', height: '32px', padding: '0 8px', borderRadius: '8px',
                      background: isWicket ? 'rgba(255, 23, 68, 0.25)' : isBoundary ? 'rgba(0, 242, 254, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                      border: isWicket ? '1px solid #ff1744' : isBoundary ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.15)',
                      color: isWicket ? '#ff1744' : isBoundary ? '#00f2fe' : '#ffffff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: '800', fontSize: '13px', fontFamily: 'var(--font-mono)'
                    }}>
                      {b}
                    </span>
                  );
                })
              ) : (
                <span style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>Waiting for first delivery...</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Players Cards Grid */}
      <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {/* Batting Card */}
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#00f2fe' }}>Batting Performers</h3>
            <button
              onClick={handleSwapStrike}
              className="btn-action"
              style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(0, 242, 254, 0.3)', color: '#00f2fe' }}
            >
              <ArrowRightLeft size={12} /> Swap Strike
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '300px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8', fontSize: '11px' }}>
                  <th style={{ paddingBottom: '8px' }}>Batsman</th>
                  <th>R</th>
                  <th>B</th>
                  <th>4s</th>
                  <th>6s</th>
                  <th>SR</th>
                </tr>
              </thead>
              <tbody>
                {/* Striker Row */}
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#00e676', fontWeight: '800' }}>
                  <td style={{ padding: '10px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00e676' }} />
                    {striker} *
                  </td>
                  <td style={{ fontSize: '15px', fontFamily: 'var(--font-mono)' }}>{strikerStat.runs}</td>
                  <td>{strikerStat.balls}</td>
                  <td>{strikerStat.fours}</td>
                  <td>{strikerStat.sixes}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>
                    {strikerStat.balls > 0 ? ((strikerStat.runs / strikerStat.balls) * 100).toFixed(1) : '0.0'}
                  </td>
                </tr>
                {/* Non-Striker Row */}
                <tr style={{ color: '#ffffff' }}>
                  <td style={{ padding: '10px 0', color: '#94a3b8' }}>{non_striker}</td>
                  <td style={{ fontSize: '15px', fontFamily: 'var(--font-mono)' }}>{nonStrikerStat.runs}</td>
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
        </div>

        {/* Bowling Card */}
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#ffab00' }}>Active Bowler</h3>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>⚡ Radar Active</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '320px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8', fontSize: '11px' }}>
                  <th style={{ paddingBottom: '8px' }}>Bowler</th>
                  <th>O</th>
                  <th>M</th>
                  <th>R</th>
                  <th>W</th>
                  <th>Econ</th>
                  <th>Max Speed</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ color: '#ffffff', fontWeight: '800' }}>
                  <td style={{ padding: '10px 0', color: '#ffab00' }}>{bowler} ⚾</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{`${Math.floor(bowlerStat.balls / 6)}.${bowlerStat.balls % 6}`}</td>
                  <td>{bowlerStat.maidens}</td>
                  <td>{bowlerStat.runs}</td>
                  <td style={{ color: '#ff1744', fontSize: '15px' }}>{bowlerStat.wickets}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: '#ffab00' }}>
                    {bowlerStat.balls > 0 ? (bowlerStat.runs / (bowlerStat.balls / 6.0)).toFixed(2) : '0.00'}
                  </td>
                  <td style={{ color: '#00f2fe', fontFamily: 'var(--font-mono)' }}>
                    {bowlerStat.max_speed > 0 ? `${bowlerStat.max_speed.toFixed(1)} km/h` : '--'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Interactive Ball Scoring Controller */}
      <div className="glass-panel" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#ffffff' }}>Scoring Controller Console</h3>
            <button
              onClick={() => setShowPitchMapModal(true)}
              className="btn-action"
              style={{
                padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px',
                borderColor: 'rgba(0, 242, 254, 0.35)', color: '#00f2fe', background: 'rgba(0, 242, 254, 0.1)'
              }}
            >
              <Target size={14} /> Pitch Map
            </button>
          </div>
          
          {status === 'INNINGS_BREAK' ? (
            <div style={{ textAlign: 'center', padding: '20px', background: 'rgba(255, 171, 0, 0.1)', borderRadius: '12px', border: '1px solid rgba(255, 171, 0, 0.3)' }}>
              <h4 style={{ fontSize: '16px', color: '#ffab00', fontWeight: '900', marginBottom: '6px' }}>1st Innings Completed!</h4>
              <p style={{ fontSize: '13px', color: '#cbd5e1' }}>
                Scoring is paused. Click <strong style={{ color: '#00f2fe' }}>"Setup 2nd Innings Chasing"</strong> above to begin the 2nd innings.
              </p>
            </div>
          ) : status === 'COMPLETED' ? (
            <div style={{ textAlign: 'center', padding: '20px', background: 'rgba(0, 230, 118, 0.1)', borderRadius: '12px', border: '1px solid rgba(0, 230, 118, 0.3)' }}>
              <h4 style={{ fontSize: '16px', color: '#00e676', fontWeight: '900', marginBottom: '6px' }}>Match Completed!</h4>
              <p style={{ fontSize: '13px', color: '#cbd5e1' }}>
                {winner}. Click <strong style={{ color: '#00f2fe' }}>"Launch New Match"</strong> at the top to start a new match.
              </p>
            </div>
          ) : (
            <>
              {/* Attached Delivery Movement Analysis Chip */}
              {attachedAnalysis && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(0, 242, 254, 0.12)',
                    border: '1px solid rgba(0, 242, 254, 0.4)',
                    borderRadius: '24px',
                    padding: '8px 16px',
                    color: '#00f2fe',
                    fontSize: '12px',
                    fontWeight: '800',
                    boxShadow: '0 0 15px rgba(0, 242, 254, 0.2)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles size={14} color="#00f2fe" />
                    <span>
                      Attached: <strong>{attachedAnalysis.delivery_type || 'DELIVERY'}</strong>
                      {attachedAnalysis.turn_angle_deg > 0 ? ` ${attachedAnalysis.turn_angle_deg}°` : ''}
                      {attachedAnalysis.swing_cm > 0 ? ` ${attachedAnalysis.swing_cm}cm` : ''}
                      {attachedAnalysis.length ? ` • ${attachedAnalysis.length}` : ''}
                      {attachedAnalysis.line ? ` (${attachedAnalysis.line})` : ''}
                    </span>
                  </div>
                  <button
                    onClick={handleDiscardAnalysis}
                    style={{
                      background: 'rgba(255, 23, 68, 0.2)',
                      border: '1px solid rgba(255, 23, 68, 0.4)',
                      borderRadius: '50%',
                      width: '22px',
                      height: '22px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ff1744',
                      cursor: 'pointer',
                      padding: 0
                    }}
                    title="Discard attached delivery analysis"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* Mode Toggles */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setMode(mode === 'WIDE' ? 'NORMAL' : 'WIDE')}
                  className="btn-action"
                  style={{
                    padding: '6px 10px', fontSize: '11px',
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
                    padding: '6px 10px', fontSize: '11px',
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
                    padding: '6px 10px', fontSize: '11px',
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
                    padding: '6px 10px', fontSize: '11px',
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
                    padding: '6px 10px', fontSize: '11px',
                    borderColor: wicketMode ? '#ff1744' : 'rgba(255,255,255,0.12)',
                    background: wicketMode ? 'rgba(255, 23, 68, 0.25)' : 'rgba(255,255,255,0.06)',
                    color: wicketMode ? '#ff1744' : '#ffffff'
                  }}
                >
                  WICKET MODE
                </button>
              </div>

              {/* Touch-Optimized Mobile Grid */}
              <div className="mobile-score-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '10px' }}>
                {[0, 1, 2, 3, 4, 6].map((r) => {
                  const isBoundary = r === 4 || r === 6;
                  return (
                    <button
                      key={r}
                      onClick={() => handleRunPress(r)}
                      className={`btn-action ${isBoundary ? 'btn-gradient' : ''}`}
                      style={{
                        padding: '18px 6px',
                        fontSize: '22px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: '900'
                      }}
                    >
                      {r}
                    </button>
                  );
                })}

                {/* Swap Strike Button */}
                <button
                  onClick={handleSwapStrike}
                  className="btn-action"
                  style={{
                    padding: '18px 4px',
                    fontSize: '11px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2px',
                    borderColor: 'rgba(0, 242, 254, 0.4)',
                    color: '#00f2fe'
                  }}
                >
                  <ArrowRightLeft size={16} /> Swap
                </button>

                {/* Undo Button */}
                <button
                  onClick={handleUndo}
                  className="btn-action btn-danger"
                  style={{
                    padding: '18px 4px',
                    fontSize: '11px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2px'
                  }}
                >
                  <RotateCcw size={16} /> Undo
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Full Scorecard View Modal */}
      {showFullScorecardModal && fullDetails && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(5, 8, 17, 0.98)', backdropFilter: 'blur(20px)',
          zIndex: 2000, overflowY: 'auto', padding: '24px 16px'
        }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative' }}>
            
            {/* Header with Sticky Close Button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '14px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <FileText size={34} className="gradient-text-cyan" />
                <div>
                  <h2 style={{ fontSize: '28px', fontWeight: '900', color: '#ffffff' }}>Full Match Scorecard</h2>
                  <span style={{ fontSize: '16px', color: '#00f2fe', fontWeight: '800' }}>
                    {team1} vs {team2} • {total_overs} Overs Match
                  </span>
                </div>
              </div>

              <button
                onClick={() => setShowFullScorecardModal(false)}
                className="btn-action btn-danger"
                style={{
                  padding: '10px 20px',
                  fontSize: '16px',
                  fontWeight: '800',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  borderRadius: '12px'
                }}
              >
                <X size={24} /> Close Scorecard
              </button>
            </div>

            {/* Innings Data View */}
            {(() => {
              const inn1Bat = (fullDetails.batting || []).filter(b => b.innings_no === 1);
              const inn2Bat = (fullDetails.batting || []).filter(b => b.innings_no === 2);
              const inn1Bw = (fullDetails.bowling || []).filter(bw => bw.innings_no === 1);
              const inn2Bw = (fullDetails.bowling || []).filter(bw => bw.innings_no === 2);

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                  
                  {/* 1ST INNINGS SECTION */}
                  <div className="glass-panel" style={{ padding: '24px', borderColor: 'rgba(0, 242, 254, 0.4)' }}>
                    <div style={{ borderBottom: '1px solid rgba(0, 242, 254, 0.3)', paddingBottom: '12px', marginBottom: '20px' }}>
                      <h3 style={{ fontSize: '22px', fontWeight: '900', color: '#00f2fe' }}>
                        1st Innings Performance
                      </h3>
                    </div>

                    {/* 1st Innings Batting Scorecard */}
                    <div style={{ marginBottom: '28px' }}>
                      <h4 style={{ fontSize: '18px', fontWeight: '800', color: '#ffffff', marginBottom: '14px' }}>
                        Batting Scorecard
                      </h4>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '580px' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)', textAlign: 'left', color: '#00f2fe', fontSize: '15px' }}>
                              <th style={{ padding: '12px 8px' }}>Batsman</th>
                              <th style={{ padding: '12px 8px' }}>Runs</th>
                              <th style={{ padding: '12px 8px' }}>Balls</th>
                              <th style={{ padding: '12px 8px' }}>4s</th>
                              <th style={{ padding: '12px 8px' }}>6s</th>
                              <th style={{ padding: '12px 8px' }}>Strike Rate (SR)</th>
                              <th style={{ padding: '12px 8px' }}>Dismissal Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inn1Bat.length === 0 ? (
                              <tr>
                                <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '16px' }}>
                                  No 1st innings batting entries found.
                                </td>
                              </tr>
                            ) : (
                              inn1Bat.map((b) => (
                                <tr key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#ffffff' }}>
                                  <td style={{ padding: '14px 8px', fontWeight: '800', fontSize: '17px' }}>{b.player}</td>
                                  <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontWeight: '900', fontSize: '18px' }}>{b.runs}</td>
                                  <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontSize: '17px' }}>{b.balls}</td>
                                  <td style={{ padding: '14px 8px', color: '#00f2fe', fontWeight: '800', fontSize: '17px' }}>{b.fours}</td>
                                  <td style={{ padding: '14px 8px', color: '#ffab00', fontWeight: '800', fontSize: '17px' }}>{b.sixes}</td>
                                  <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', color: '#00e676', fontWeight: '900', fontSize: '18px' }}>
                                    {b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : '0.0'}
                                  </td>
                                  <td style={{ padding: '14px 8px', color: b.out_desc === 'not out' ? '#00e676' : '#cbd5e1', fontSize: '15px', fontWeight: '700' }}>
                                    {b.out_desc}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* 1st Innings Bowling Scorecard */}
                    <div>
                      <h4 style={{ fontSize: '18px', fontWeight: '800', color: '#ffab00', marginBottom: '14px' }}>
                        Bowling Analytics
                      </h4>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)', textAlign: 'left', color: '#ffab00', fontSize: '15px' }}>
                              <th style={{ padding: '12px 8px' }}>Bowler</th>
                              <th style={{ padding: '12px 8px' }}>Overs</th>
                              <th style={{ padding: '12px 8px' }}>Maidens</th>
                              <th style={{ padding: '12px 8px' }}>Runs</th>
                              <th style={{ padding: '12px 8px' }}>Wickets</th>
                              <th style={{ padding: '12px 8px' }}>Economy (Econ)</th>
                              <th style={{ padding: '12px 8px' }}>Peak Speed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inn1Bw.length === 0 ? (
                              <tr>
                                <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '16px' }}>
                                  No 1st innings bowling entries found.
                                </td>
                              </tr>
                            ) : (
                              inn1Bw.map((bw) => (
                                <tr key={bw.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#ffffff' }}>
                                  <td style={{ padding: '14px 8px', fontWeight: '800', fontSize: '17px' }}>{bw.bowler}</td>
                                  <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontSize: '17px' }}>{`${Math.floor(bw.balls / 6)}.${bw.balls % 6}`}</td>
                                  <td style={{ padding: '14px 8px', fontSize: '17px' }}>{bw.maidens}</td>
                                  <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontSize: '17px' }}>{bw.runs}</td>
                                  <td style={{ padding: '14px 8px', color: '#ff1744', fontWeight: '900', fontSize: '19px' }}>{bw.wickets}</td>
                                  <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', color: '#ffab00', fontWeight: '900', fontSize: '18px' }}>
                                    {bw.balls > 0 ? (bw.runs / (bw.balls / 6.0)).toFixed(2) : '0.00'}
                                  </td>
                                  <td style={{ padding: '14px 8px', color: '#00f2fe', fontFamily: 'var(--font-mono)', fontWeight: '800', fontSize: '17px' }}>
                                    {bw.max_speed > 0 ? `${bw.max_speed.toFixed(1)} km/h` : '--'}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* 2ND INNINGS SECTION */}
                  {(inn2Bat.length > 0 || inn2Bw.length > 0 || current_innings === 2) && (
                    <div className="glass-panel" style={{ padding: '24px', borderColor: 'rgba(255, 171, 0, 0.4)' }}>
                      <div style={{ borderBottom: '1px solid rgba(255, 171, 0, 0.3)', paddingBottom: '12px', marginBottom: '20px' }}>
                        <h3 style={{ fontSize: '22px', fontWeight: '900', color: '#ffab00' }}>
                          2nd Innings Chasing Performance
                        </h3>
                      </div>

                      {/* 2nd Innings Batting */}
                      <div style={{ marginBottom: '28px' }}>
                        <h4 style={{ fontSize: '18px', fontWeight: '800', color: '#ffffff', marginBottom: '14px' }}>
                          Batting Scorecard
                        </h4>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '580px' }}>
                            <thead>
                              <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)', textAlign: 'left', color: '#00f2fe', fontSize: '15px' }}>
                                <th style={{ padding: '12px 8px' }}>Batsman</th>
                                <th style={{ padding: '12px 8px' }}>Runs</th>
                                <th style={{ padding: '12px 8px' }}>Balls</th>
                                <th style={{ padding: '12px 8px' }}>4s</th>
                                <th style={{ padding: '12px 8px' }}>6s</th>
                                <th style={{ padding: '12px 8px' }}>Strike Rate (SR)</th>
                                <th style={{ padding: '12px 8px' }}>Dismissal Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {inn2Bat.length === 0 ? (
                                <tr>
                                  <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '16px' }}>
                                    No 2nd innings batting entries recorded yet.
                                  </td>
                                </tr>
                              ) : (
                                inn2Bat.map((b) => (
                                  <tr key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#ffffff' }}>
                                    <td style={{ padding: '14px 8px', fontWeight: '800', fontSize: '17px' }}>{b.player}</td>
                                    <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontWeight: '900', fontSize: '18px' }}>{b.runs}</td>
                                    <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontSize: '17px' }}>{b.balls}</td>
                                    <td style={{ padding: '14px 8px', color: '#00f2fe', fontWeight: '800', fontSize: '17px' }}>{b.fours}</td>
                                    <td style={{ padding: '14px 8px', color: '#ffab00', fontWeight: '800', fontSize: '17px' }}>{b.sixes}</td>
                                    <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', color: '#00e676', fontWeight: '900', fontSize: '18px' }}>
                                      {b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : '0.0'}
                                    </td>
                                    <td style={{ padding: '14px 8px', color: b.out_desc === 'not out' ? '#00e676' : '#cbd5e1', fontSize: '15px', fontWeight: '700' }}>
                                      {b.out_desc}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* 2nd Innings Bowling */}
                      <div>
                        <h4 style={{ fontSize: '18px', fontWeight: '800', color: '#ffab00', marginBottom: '14px' }}>
                          Bowling Analytics
                        </h4>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
                            <thead>
                              <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)', textAlign: 'left', color: '#ffab00', fontSize: '15px' }}>
                                <th style={{ padding: '12px 8px' }}>Bowler</th>
                                <th style={{ padding: '12px 8px' }}>Overs</th>
                                <th style={{ padding: '12px 8px' }}>Maidens</th>
                                <th style={{ padding: '12px 8px' }}>Runs</th>
                                <th style={{ padding: '12px 8px' }}>Wickets</th>
                                <th style={{ padding: '12px 8px' }}>Economy (Econ)</th>
                                <th style={{ padding: '12px 8px' }}>Peak Speed</th>
                              </tr>
                            </thead>
                            <tbody>
                              {inn2Bw.length === 0 ? (
                                <tr>
                                  <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '16px' }}>
                                    No 2nd innings bowling entries recorded yet.
                                  </td>
                                </tr>
                              ) : (
                                inn2Bw.map((bw) => (
                                  <tr key={bw.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#ffffff' }}>
                                    <td style={{ padding: '14px 8px', fontWeight: '800', fontSize: '17px' }}>{bw.bowler}</td>
                                    <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontSize: '17px' }}>{`${Math.floor(bw.balls / 6)}.${bw.balls % 6}`}</td>
                                    <td style={{ padding: '14px 8px', fontSize: '17px' }}>{bw.maidens}</td>
                                    <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontSize: '17px' }}>{bw.runs}</td>
                                    <td style={{ padding: '14px 8px', color: '#ff1744', fontWeight: '900', fontSize: '19px' }}>{bw.wickets}</td>
                                    <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', color: '#ffab00', fontWeight: '900', fontSize: '18px' }}>
                                      {bw.balls > 0 ? (bw.runs / (bw.balls / 6.0)).toFixed(2) : '0.00'}
                                    </td>
                                    <td style={{ padding: '14px 8px', color: '#00f2fe', fontFamily: 'var(--font-mono)', fontWeight: '800', fontSize: '17px' }}>
                                      {bw.max_speed > 0 ? `${bw.max_speed.toFixed(1)} km/h` : '--'}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                    </div>
                  )}

                </div>
              );
            })()}

          </div>
        </div>
      )}

      {/* 2nd Innings Chasing Setup Modal */}
      {showInnings2Modal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px'
        }}>
          <div className="glass-panel mobile-full-modal" style={{ width: '100%', maxWidth: '440px', padding: '24px', borderColor: 'rgba(0, 242, 254, 0.5)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '900', color: '#00f2fe', marginBottom: '6px' }}>Setup 2nd Innings Chasing</h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
              Target: <strong style={{ color: '#ffab00' }}>{target} runs</strong> in {total_overs} overs ({total_overs * 6} balls)
            </p>

            <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Striker Batter Name</label>
            <input
              type="text"
              placeholder="e.g. Virat Kohli"
              value={innings2Details.striker}
              onChange={(e) => setInnings2Details({ ...innings2Details, striker: e.target.value })}
              className="input-premium" style={{ width: '100%', marginBottom: '12px' }}
            />

            <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Non-Striker Batter Name</label>
            <input
              type="text"
              placeholder="e.g. Hardik Pandya"
              value={innings2Details.non_striker}
              onChange={(e) => setInnings2Details({ ...innings2Details, non_striker: e.target.value })}
              className="input-premium" style={{ width: '100%', marginBottom: '12px' }}
            />

            <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Opening Bowler Name</label>
            <input
              type="text"
              placeholder="e.g. Pat Cummins"
              value={innings2Details.bowler}
              onChange={(e) => setInnings2Details({ ...innings2Details, bowler: e.target.value })}
              className="input-premium" style={{ width: '100%', marginBottom: '20px' }}
            />

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowInnings2Modal(false)} className="btn-action" style={{ flex: 1, padding: '12px' }}>Cancel</button>
              <button onClick={handleInnings2Submit} className="btn-action btn-gradient" style={{ flex: 1, padding: '12px' }}>Start 2nd Innings</button>
            </div>
          </div>
        </div>
      )}

      {/* Wicket Dismissal Modal */}
      {showWicketModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '440px', padding: '24px', borderColor: 'rgba(255,23,68,0.5)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '900', color: '#ff1744', marginBottom: '14px' }}>Wicket & Dismissal Details</h3>
            
            <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Dismissed Batter</label>
            <select
              value={wicketDetails.who_out}
              onChange={(e) => setWicketDetails({ ...wicketDetails, who_out: e.target.value })}
              className="input-premium" style={{ width: '100%', marginBottom: '12px' }}
            >
              <option value={striker}>{striker} (Striker)</option>
              <option value={non_striker}>{non_striker} (Non-Striker)</option>
            </select>

            <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Dismissal Type</label>
            <select
              value={wicketDetails.wicket_desc}
              onChange={(e) => setWicketDetails({ ...wicketDetails, wicket_desc: e.target.value })}
              className="input-premium" style={{ width: '100%', marginBottom: '12px' }}
            >
              <option value="Catch out">Catch out (c Fielder b Bowler)</option>
              <option value="Bowled">Bowled (b Bowler)</option>
              <option value="LBW">LBW (lbw b Bowler)</option>
              <option value="Stumped">Stumped (st Fielder b Bowler)</option>
              <option value="Run out">Run out (run out Fielder)</option>
            </select>

            {(wicketDetails.wicket_desc === 'Catch out' || wicketDetails.wicket_desc === 'Stumped' || wicketDetails.wicket_desc === 'Run out') && (
              <>
                <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                  Fielder / Catcher Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Alex Carey"
                  value={wicketDetails.fielder}
                  onChange={(e) => setWicketDetails({ ...wicketDetails, fielder: e.target.value })}
                  className="input-premium" style={{ width: '100%', marginBottom: '12px' }}
                />
              </>
            )}

            <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>New Batter Name</label>
            <input
              type="text"
              placeholder="e.g. KL Rahul"
              value={wicketDetails.new_batsman}
              onChange={(e) => setWicketDetails({ ...wicketDetails, new_batsman: e.target.value })}
              className="input-premium" style={{ width: '100%', marginBottom: '20px' }}
            />

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowWicketModal(false)} className="btn-action" style={{ flex: 1, padding: '12px' }}>Cancel</button>
              <button onClick={handleWicketSubmit} className="btn-action btn-danger" style={{ flex: 1, padding: '12px' }}>Confirm Wicket</button>
            </div>
          </div>
        </div>
      )}

      {/* Bowler Switch Modal */}
      {showBowlerModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '900', color: '#00f2fe', marginBottom: '10px' }}>Over Completed!</h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>Enter bowler for the next over:</p>
            <input
              type="text"
              placeholder="e.g. Jasprit Bumrah"
              value={nextBowlerName}
              onChange={(e) => setNextBowlerName(e.target.value)}
              className="input-premium" style={{ width: '100%', marginBottom: '20px' }}
            />
            <button onClick={handleBowlerSubmit} className="btn-action btn-gradient" style={{ width: '100%', padding: '12px' }}>
              Start Next Over
            </button>
          </div>
        </div>
      )}
      {/* Pitch Map Modal */}
      {showPitchMapModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px'
        }}>
          <div style={{ width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
              <button
                onClick={() => setShowPitchMapModal(false)}
                className="btn-action"
                style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <X size={14} /> Close Map
              </button>
            </div>
            <PitchMap matchId={match_id} />
          </div>
        </div>
      )}
    </div>
  );
}
