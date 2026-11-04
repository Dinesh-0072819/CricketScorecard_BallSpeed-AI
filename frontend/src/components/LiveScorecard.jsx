import React, { useState } from 'react';
import { Trophy, RotateCcw, Zap, AlertTriangle, ShieldCheck, UserCheck, Play, ArrowRightLeft, FileText, X, Flag, Target } from 'lucide-react';

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
  const [showEndInningsModal, setShowEndInningsModal] = useState(false);
  const [secondInnings, setSecondInnings] = useState({ striker: '', non_striker: '', bowler: '' });
  const [startingSecond, setStartingSecond] = useState(false);
  const [fullDetails, setFullDetails] = useState(null);
  const [scorecardInnings, setScorecardInnings] = useState(1);

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
    batting, bowling, over_deliveries, over_completed, status, winner,
    innings_break, first_innings, batting_team, bowling_team
  } = matchState;

  const battingTeamName = batting_team || (current_innings === 1 ? team1 : team2);
  const bowlingTeamName = bowling_team || (current_innings === 1 ? team2 : team1);
  const isLive = status !== 'COMPLETED' && !innings_break;
  const isChasing = current_innings === 2 && !innings_break;
  const wicketsLeft = Math.max(0, 10 - (wickets || 0));

  const handleEndInnings = async () => {
    try {
      await fetch('/api/match/end_innings', { method: 'POST' });
      setShowEndInningsModal(false);
      setShowBowlerModal(false);
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleStartSecondInnings = async (e) => {
    e.preventDefault();
    const { striker: s1, non_striker: s2, bowler: b1 } = secondInnings;
    if (!s1.trim() || !s2.trim() || !b1.trim()) return;
    setStartingSecond(true);
    try {
      await fetch('/api/match/setup_innings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ striker: s1.trim(), non_striker: s2.trim(), bowler: b1.trim(), current_innings: 2 })
      });
      setSecondInnings({ striker: '', non_striker: '', bowler: '' });
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setStartingSecond(false);
    }
  };

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
      if (data.over_completed && !data.innings_break && data.status !== 'COMPLETED') {
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
      setScorecardInnings(matchState && matchState.current_innings === 2 && !matchState.innings_break ? 2 : 1);
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
              {battingTeamName}
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
            {innings_break ? (
              <span style={{ fontSize: '13px', color: '#ffab00', fontWeight: '800' }}>Innings Break</span>
            ) : current_innings === 2 ? (
              <div>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700' }}>Target: {target}</span>
                <div style={{ fontSize: '20px', fontWeight: '900', color: '#00e676', marginTop: '4px' }}>
                  {status === 'COMPLETED' ? 'Chase over' : `Need ${remaining_runs} in ${remaining_balls}b`}
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

            {isLive && (
              <button
                onClick={() => setShowEndInningsModal(true)}
                className="btn-action"
                style={{
                  padding: '8px 18px', fontSize: '13px',
                  borderColor: 'rgba(255, 171, 0, 0.5)', background: 'rgba(255, 171, 0, 0.12)', color: '#ffab00',
                  display: 'flex', alignItems: 'center', gap: '8px'
                }}
              >
                <Flag size={16} /> End Innings
              </button>
            )}
          </div>
        </div>

        {/* Target & Chase Equation Strip */}
        {(current_innings === 2 || innings_break) && first_innings && (
          <div style={{
            marginTop: '24px', padding: '16px 20px', borderRadius: '14px',
            background: 'linear-gradient(90deg, rgba(0, 230, 118, 0.12) 0%, rgba(0, 242, 254, 0.08) 100%)',
            border: '1px solid rgba(0, 230, 118, 0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Target size={22} color="#00e676" />
              <div>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800', letterSpacing: '1px' }}>
                  {first_innings.team} {first_innings.runs}/{first_innings.wickets} ({first_innings.overs} ov) • Target {target}
                </div>
                <div style={{ fontSize: '18px', fontWeight: '900', color: '#ffffff', marginTop: '2px' }}>
                  {innings_break
                    ? <>{bowlingTeamName === first_innings.team ? battingTeamName : (first_innings.team === team1 ? team2 : team1)} need <span style={{ color: '#00e676' }}>{target}</span> runs from <span style={{ color: '#00f2fe' }}>{total_overs * 6}</span> balls</>
                    : status === 'COMPLETED'
                      ? <span style={{ color: '#00e676' }}>{winner}</span>
                      : <>{battingTeamName} need <span style={{ color: '#00e676' }}>{remaining_runs}</span> run{remaining_runs === 1 ? '' : 's'} from <span style={{ color: '#00f2fe' }}>{remaining_balls}</span> ball{remaining_balls === 1 ? '' : 's'}</>}
                </div>
              </div>
            </div>
            {isChasing && status !== 'COMPLETED' && (
              <div style={{ display: 'flex', gap: '20px', fontFamily: 'var(--font-mono)' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800' }}>REQ. RR</div>
                  <div style={{ fontSize: '18px', fontWeight: '900', color: '#ffab00' }}>{rrr}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800' }}>WKTS LEFT</div>
                  <div style={{ fontSize: '18px', fontWeight: '900', color: '#ff1744' }}>{wicketsLeft}</div>
                </div>
              </div>
            )}
          </div>
        )}

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

      {/* Innings Break: set up the chase */}
      {innings_break && status !== 'COMPLETED' && (
        <div className="glass-panel glass-panel-neon" style={{ padding: '32px', marginBottom: '28px', borderColor: 'rgba(255, 171, 0, 0.45)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '6px' }}>
            <Flag size={26} color="#ffab00" />
            <h3 style={{ fontSize: '20px', fontWeight: '900', color: '#ffab00' }}>Innings Break</h3>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '22px' }}>
            {first_innings ? `${first_innings.team} finished on ${first_innings.runs}/${first_innings.wickets} in ${first_innings.overs} overs. ` : ''}
            Target <b style={{ color: '#00e676' }}>{target}</b> from <b style={{ color: '#00f2fe' }}>{total_overs * 6}</b> balls.
            Enter the openers for the chase:
          </p>
          <form onSubmit={handleStartSecondInnings}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '20px' }}>
              {[
                ['striker', 'Striker Batter', 'e.g. David Warner'],
                ['non_striker', 'Non-Striker Batter', 'e.g. Travis Head'],
                ['bowler', 'Opening Bowler', 'e.g. Jasprit Bumrah']
              ].map(([key, label, ph]) => (
                <div key={key}>
                  <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '8px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</label>
                  <input
                    type="text" required placeholder={ph}
                    value={secondInnings[key]}
                    onChange={(e) => setSecondInnings({ ...secondInnings, [key]: e.target.value })}
                    className="input-premium" style={{ width: '100%' }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '14px' }}>
              <button type="button" onClick={handleUndo} className="btn-action btn-danger"
                style={{ padding: '16px 20px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}
                title="The innings ended on the last ball by mistake? Undo it.">
                <RotateCcw size={16} /> Undo last ball
              </button>
              <button type="submit" disabled={startingSecond} className="btn-action btn-gradient" style={{ flex: 1, padding: '16px', fontSize: '15px', fontWeight: '900' }}>
                {startingSecond ? 'Starting…' : 'Start 2nd Innings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Interactive Ball Scoring Controller */}
      {isLive && (
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
      )}

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

            {(() => {
              // ---- split the scorecard by innings: each team bats once, the other team bowls ----
              const m = fullDetails.match || {};
              const tossWinner = m.toss_winner || team1;
              const firstBat = m.toss_decision === 'BOWL' ? (tossWinner === team1 ? team2 : team1) : tossWinner;
              const secondBat = firstBat === team1 ? team2 : team1;
              const inningsList = [
                { no: 1, bat: firstBat, bowl: secondBat },
                { no: 2, bat: secondBat, bowl: firstBat }
              ];
              const summary = (no) => {
                const balls = (fullDetails.balls || []).filter((b) => b.innings_no === no);
                const runsT = balls.reduce((a, b) => a + (b.runs || 0), 0);
                const wk = balls.filter((b) => b.wicket).length;
                const legal = balls.filter((b) => b.extra_type !== 'Wide' && b.extra_type !== 'No Ball').length;
                const extras = balls.filter((b) => b.extra_type).reduce((a, b) => {
                  if (b.extra_type === 'Wide' || b.extra_type === 'No Ball') return a + 1 + (b.extra_type === 'Wide' ? Math.max(0, (b.runs || 0) - 1) : 0);
                  return a + (b.runs || 0);
                }, 0);
                return { runs: runsT, wickets: wk, overs: `${Math.floor(legal / 6)}.${legal % 6}`, extras, played: balls.length > 0 };
              };
              const inn = inningsList.find((i) => i.no === scorecardInnings) || inningsList[0];
              const bat = (fullDetails.batting || []).filter((b) => b.innings_no === inn.no);
              const bowl = (fullDetails.bowling || []).filter((b) => b.innings_no === inn.no);
              const sum = summary(inn.no);

              return (
                <>
                  {/* Team tabs */}
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '22px', flexWrap: 'wrap' }}>
                    {inningsList.map((i) => {
                      const sm = summary(i.no);
                      const active = i.no === inn.no;
                      return (
                        <button key={i.no} onClick={() => setScorecardInnings(i.no)} className="btn-action"
                          style={{
                            flex: 1, minWidth: '200px', padding: '12px 16px', textAlign: 'left',
                            borderColor: active ? '#00f2fe' : 'rgba(255,255,255,0.12)',
                            background: active ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255,255,255,0.04)',
                            color: active ? '#00f2fe' : '#cbd5e1'
                          }}>
                          <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px', color: '#94a3b8' }}>
                            {i.no === 1 ? '1st' : '2nd'} Innings
                          </div>
                          <div style={{ fontSize: '16px', fontWeight: '900', marginTop: '2px' }}>
                            {i.bat}{' '}
                            <span style={{ fontFamily: 'var(--font-mono)', color: '#ffffff' }}>
                              {sm.played ? `${sm.runs}/${sm.wickets}` : 'Yet to bat'}
                            </span>
                            {sm.played && <span style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}> ({sm.overs} ov)</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Batting of the selected team */}
                  <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#00f2fe', marginBottom: '12px' }}>
                    {inn.bat} Batting
                  </h3>
                  {bat.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: '13px', fontStyle: 'italic', marginBottom: '28px' }}>{inn.bat} have not batted yet.</p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '10px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8' }}>
                          <th style={{ paddingBottom: '8px' }}>Batsman</th>
                          <th>Runs</th>
                          <th>Balls</th>
                          <th>4s</th>
                          <th>6s</th>
                          <th>S/R</th>
                          <th>Dismissal Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bat.map((b) => (
                          <tr key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#ffffff' }}>
                            <td style={{ padding: '10px 0', fontWeight: '700' }}>{b.player}</td>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{b.runs}</td>
                            <td>{b.balls}</td>
                            <td>{b.fours}</td>
                            <td>{b.sixes}</td>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : '0.0'}</td>
                            <td style={{ color: b.out_desc === 'not out' ? '#00e676' : '#94a3b8', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                              {b.out_desc}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {bat.length > 0 && (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', padding: '10px 0', marginBottom: '28px',
                      borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '13px'
                    }}>
                      <span style={{ color: '#94a3b8' }}>Extras: <b style={{ color: '#fff' }}>{sum.extras}</b></span>
                      <span style={{ fontWeight: '900', fontFamily: 'var(--font-mono)' }}>
                        Total: {sum.runs}/{sum.wickets} <span style={{ color: '#94a3b8' }}>({sum.overs} ov)</span>
                      </span>
                    </div>
                  )}

                  {/* Bowling of the other team */}
                  <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#ffab00', marginBottom: '12px' }}>
                    {inn.bowl} Bowling
                  </h3>
                  {bowl.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: '13px', fontStyle: 'italic' }}>{inn.bowl} have not bowled yet.</p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8' }}>
                          <th style={{ paddingBottom: '8px' }}>Bowler</th>
                          <th>Overs</th>
                          <th>Maidens</th>
                          <th>Runs</th>
                          <th>Wickets</th>
                          <th>Econ</th>
                          <th>Peak Speed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bowl.map((bw) => (
                          <tr key={bw.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#ffffff' }}>
                            <td style={{ padding: '10px 0', fontWeight: '700' }}>{bw.bowler}</td>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{`${Math.floor(bw.balls / 6)}.${bw.balls % 6}`}</td>
                            <td>{bw.maidens}</td>
                            <td>{bw.runs}</td>
                            <td style={{ color: '#ff1744', fontWeight: '800' }}>{bw.wickets}</td>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{bw.balls > 0 ? (bw.runs / (bw.balls / 6)).toFixed(2) : '0.00'}</td>
                            <td style={{ color: '#00f2fe', fontFamily: 'var(--font-mono)' }}>{bw.max_speed ? `${bw.max_speed.toFixed(1)} km/h` : '--'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              );
            })()}
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

      {/* End Innings Confirmation Modal */}
      {showEndInningsModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="glass-panel" style={{ width: '440px', padding: '32px', borderColor: 'rgba(255, 171, 0, 0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <Flag size={24} color="#ffab00" />
              <h3 style={{ fontSize: '20px', fontWeight: '900', color: '#ffab00' }}>
                End {current_innings === 1 ? '1st' : '2nd'} Innings?
              </h3>
            </div>
            <p style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '24px', lineHeight: 1.6 }}>
              {current_innings === 1
                ? <>{battingTeamName} finish on <b style={{ color: '#fff' }}>{runs}/{wickets}</b> ({overs} ov). {bowlingTeamName} will need <b style={{ color: '#00e676' }}>{runs + 1}</b> to win.</>
                : <>The match will end now with {battingTeamName} on <b style={{ color: '#fff' }}>{runs}/{wickets}</b> chasing {target}.</>}
            </p>
            <div style={{ display: 'flex', gap: '14px' }}>
              <button onClick={() => setShowEndInningsModal(false)} className="btn-action" style={{ flex: 1, padding: '14px' }}>Cancel</button>
              <button onClick={handleEndInnings} className="btn-action"
                style={{ flex: 1, padding: '14px', borderColor: '#ffab00', background: 'rgba(255, 171, 0, 0.2)', color: '#ffab00', fontWeight: '900' }}>
                End Innings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bowler Switch Modal */}
      {showBowlerModal && isLive && (
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
