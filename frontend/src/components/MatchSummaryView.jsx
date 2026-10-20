import React, { useState, useEffect } from 'react';
import { Trophy, Calendar, Eye, Users, ChevronRight, Zap, Target, Activity, FileText, X, Trash2, Clock } from 'lucide-react';
import PitchMap from './PitchMap';
import DeliveryTypeBadge from './DeliveryTypeBadge';

export default function MatchSummaryView() {
  const [matches, setMatches] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [scorecardDetails, setScorecardDetails] = useState(null);
  const [activeTab, setActiveTab] = useState('innings1');
  const [isFullScreenModalOpen, setIsFullScreenModalOpen] = useState(false);

  useEffect(() => {
    fetchMatches();
  }, []);

  const fetchMatches = () => {
    fetch('/api/matches')
      .then((res) => res.json())
      .then((data) => {
        setMatches(data);
      })
      .catch((err) => console.error(err));
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Are you sure you want to delete all match history? This action cannot be undone.')) return;
    try {
      await fetch('/api/matches/clear', { method: 'POST' });
      setMatches([]);
      setSelectedMatch(null);
      setScorecardDetails(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectMatch = async (match, openModal = true) => {
    setSelectedMatch(match);
    try {
      const res = await fetch(`/api/match/details/${match.id}`);
      const data = await res.json();
      setScorecardDetails(data);
      if (openModal) {
        setIsFullScreenModalOpen(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getInningsData = (innNo) => {
    if (!scorecardDetails) return { batting: [], bowling: [], balls: [] };
    const batting = (scorecardDetails.batting || []).filter((b) => b.innings_no === innNo);
    const bowling = (scorecardDetails.bowling || []).filter((bw) => bw.innings_no === innNo);
    const balls = (scorecardDetails.balls || []).filter((bl) => bl.innings_no === innNo);
    return { batting, bowling, balls };
  };

  const computeInningsSummary = (innNo) => {
    const { batting, bowling, balls } = getInningsData(innNo);
    
    let totalRuns = 0;
    let totalWickets = 0;
    let totalLegalBalls = 0;
    let extras = 0;

    balls.forEach((bl) => {
      totalRuns += bl.runs || 0;
      if (bl.wicket) totalWickets += 1;
      if (bl.extra_type) extras += bl.runs || 1;
      if (bl.extra_type !== 'Wide' && bl.extra_type !== 'No Ball') {
        totalLegalBalls += 1;
      }
    });

    if (balls.length === 0) {
      bowling.forEach((bw) => {
        totalRuns += bw.runs || 0;
        totalWickets += bw.wickets || 0;
        totalLegalBalls += bw.balls || 0;
      });
    }

    const overs = `${Math.floor(totalLegalBalls / 6)}.${totalLegalBalls % 6}`;
    const oversFloat = totalLegalBalls / 6.0;
    const crr = oversFloat > 0 ? (totalRuns / oversFloat).toFixed(2) : '0.00';

    return { totalRuns, totalWickets, overs, totalLegalBalls, extras, crr };
  };

  const inn1 = computeInningsSummary(1);
  const inn2 = computeInningsSummary(2);

  // Determine Team Names per Innings based on Toss
  let inn1Team = selectedMatch ? selectedMatch.team1 : 'Team 1';
  let inn2Team = selectedMatch ? selectedMatch.team2 : 'Team 2';

  if (selectedMatch && selectedMatch.toss_winner) {
    if (selectedMatch.toss_winner === selectedMatch.team1) {
      inn1Team = selectedMatch.toss_decision === 'BAT' ? selectedMatch.team1 : selectedMatch.team2;
    } else {
      inn1Team = selectedMatch.toss_decision === 'BAT' ? selectedMatch.team2 : selectedMatch.team1;
    }
    inn2Team = inn1Team === selectedMatch.team1 ? selectedMatch.team2 : selectedMatch.team1;
  }

  const currentInnData = activeTab === 'innings1' ? getInningsData(1) : getInningsData(2);
  const currentInnSummary = activeTab === 'innings1' ? inn1 : inn2;
  const currentTeamName = activeTab === 'innings1' ? inn1Team : inn2Team;

  // Calculate RRR for Innings 2
  let rrrInnings2 = '0.00';
  if (selectedMatch && selectedMatch.target > 0) {
    const remRuns = Math.max(0, selectedMatch.target - inn2.totalRuns);
    const totalBalls = selectedMatch.total_overs * 6;
    const remBalls = Math.max(0, totalBalls - inn2.totalLegalBalls);
    if (remBalls > 0 && remRuns > 0) {
      rrrInnings2 = (remRuns / (remBalls / 6.0)).toFixed(2);
    }
  }

  return (
    <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '24px 16px' }}>
      
      {/* Header Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Calendar size={32} className="gradient-text-cyan" />
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: '900', color: '#ffffff' }}>Match History Archives</h1>
            <p style={{ fontSize: '14px', color: '#94a3b8', marginTop: '2px' }}>
              Select any match card to view full scorecard details, bowling analytics, and strike rates
            </p>
          </div>
        </div>

        {matches.length > 0 && (
          <button
            onClick={handleClearHistory}
            className="btn-action btn-danger"
            style={{
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: '800',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '12px'
            }}
          >
            <Trash2 size={16} /> Clear All History
          </button>
        )}
      </div>

      {/* Match Cards List View */}
      {matches.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
          <Trophy size={48} color="#64748b" style={{ margin: '0 auto 16px auto' }} />
          <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#94a3b8' }}>No Completed Match Records</h3>
          <p style={{ color: '#64748b', fontSize: '13px', marginTop: '6px' }}>
            Start a new match in the Scorecard tab to record ball-by-ball history.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
          {matches.map((m) => {
            // Determine Team 1 and Team 2 names & scores
            let teamA = m.team1;
            let teamB = m.team2;
            let scoreA = `${m.inn1_runs}/${m.inn1_wickets} (${m.inn1_overs} ov)`;
            let scoreB = `${m.inn2_runs}/${m.inn2_wickets} (${m.inn2_overs} ov)`;

            if (m.toss_winner) {
              if (m.toss_winner === m.team1) {
                teamA = m.toss_decision === 'BAT' ? m.team1 : m.team2;
                teamB = teamA === m.team1 ? m.team2 : m.team1;
              } else {
                teamA = m.toss_decision === 'BAT' ? m.team2 : m.team1;
                teamB = teamA === m.team1 ? m.team2 : m.team1;
              }
            }

            return (
              <div
                key={m.id}
                onClick={() => handleSelectMatch(m, true)}
                className="glass-panel"
                style={{
                  padding: '20px',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                  borderColor: 'rgba(0, 242, 254, 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  justify: 'space-between',
                  gap: '16px'
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Match #{m.id} • {m.total_overs} Overs
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: '800', color: '#00f2fe', padding: '3px 8px', borderRadius: '6px', background: 'rgba(0, 242, 254, 0.15)' }}>
                      Scorecard ➔
                    </span>
                  </div>

                  {/* Both Teams' Score Breakdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* Team 1 Score */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px' }}>
                      <span style={{ fontSize: '16px', fontWeight: '800', color: '#ffffff' }}>{teamA}</span>
                      <span style={{ fontSize: '18px', fontWeight: '900', color: '#00f2fe', fontFamily: 'var(--font-mono)' }}>
                        {scoreA}
                      </span>
                    </div>

                    {/* Team 2 Score */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px' }}>
                      <span style={{ fontSize: '16px', fontWeight: '800', color: '#ffffff' }}>{teamB}</span>
                      <span style={{ fontSize: '18px', fontWeight: '900', color: '#ffab00', fontFamily: 'var(--font-mono)' }}>
                        {scoreB}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Match Result Banner */}
                <div style={{ paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Trophy size={16} color="#00e676" />
                    <span style={{ fontSize: '13px', fontWeight: '800', color: '#00e676' }}>
                      {m.winner || 'Match In Progress'}
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', color: '#00f2fe', fontWeight: '800' }}>View Full Scorecard</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* FULL SCREEN MATCH SCORECARD MODAL */}
      {isFullScreenModalOpen && selectedMatch && scorecardDetails && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(5, 8, 17, 0.98)', backdropFilter: 'blur(20px)',
          zIndex: 2000, overflowY: 'auto', padding: '24px 16px'
        }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative' }}>
            
            {/* Header with Close Button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '14px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <FileText size={34} className="gradient-text-cyan" />
                <div>
                  <h2 style={{ fontSize: '28px', fontWeight: '900', color: '#ffffff' }}>Full Match Scorecard</h2>
                  <span style={{ fontSize: '16px', color: '#00f2fe', fontWeight: '800' }}>
                    {selectedMatch.team1} vs {selectedMatch.team2} • Match #{selectedMatch.id} ({selectedMatch.total_overs} Overs)
                  </span>
                </div>
              </div>

              <button
                onClick={() => setIsFullScreenModalOpen(false)}
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

            {/* Winner Banner */}
            {selectedMatch.winner && (
              <div style={{
                background: 'rgba(0, 230, 118, 0.12)', border: '1px solid rgba(0, 230, 118, 0.4)',
                padding: '16px 20px', borderRadius: '14px', marginBottom: '24px',
                display: 'flex', alignItems: 'center', gap: '12px'
              }}>
                <Trophy size={28} color="#00e676" />
                <div>
                  <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '800' }}>Match Result</span>
                  <h3 style={{ fontSize: '22px', fontWeight: '900', color: '#00e676' }}>{selectedMatch.winner}</h3>
                </div>
              </div>
            )}

            {/* Innings Tabs */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
              <button
                onClick={() => setActiveTab('innings1')}
                className="btn-action"
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: '800',
                  borderColor: activeTab === 'innings1' ? '#00f2fe' : 'rgba(255,255,255,0.1)',
                  background: activeTab === 'innings1' ? 'rgba(0, 242, 254, 0.2)' : 'rgba(255,255,255,0.04)',
                  color: activeTab === 'innings1' ? '#00f2fe' : '#94a3b8'
                }}
              >
                1st Innings ({inn1Team})
              </button>
              <button
                onClick={() => setActiveTab('innings2')}
                className="btn-action"
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: '800',
                  borderColor: activeTab === 'innings2' ? '#ffab00' : 'rgba(255,255,255,0.1)',
                  background: activeTab === 'innings2' ? 'rgba(255, 171, 0, 0.2)' : 'rgba(255,255,255,0.04)',
                  color: activeTab === 'innings2' ? '#ffab00' : '#94a3b8'
                }}
              >
                2nd Innings ({inn2Team})
              </button>
            </div>

            {/* Innings Overview Banner */}
            <div style={{
              background: 'rgba(13, 18, 38, 0.7)', border: '1px solid rgba(0, 242, 254, 0.3)',
              padding: '20px 24px', borderRadius: '16px', marginBottom: '28px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px'
            }}>
              <div>
                <span style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '800' }}>
                  {activeTab === 'innings1' ? '1st Innings Total' : '2nd Innings Total'}
                </span>
                <div style={{ fontSize: '32px', fontWeight: '900', color: '#ffffff', fontFamily: 'var(--font-mono)' }}>
                  {currentTeamName}: <span style={{ color: '#00f2fe' }}>{currentInnSummary.totalRuns}/{currentInnSummary.totalWickets}</span>
                  <span style={{ fontSize: '18px', color: '#94a3b8', marginLeft: '12px' }}>({currentInnSummary.overs} ov)</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>Current Run Rate</span>
                  <div style={{ fontSize: '22px', fontWeight: '900', color: '#00e676', fontFamily: 'var(--font-mono)' }}>
                    {currentInnSummary.crr}
                  </div>
                </div>
                {activeTab === 'innings2' && selectedMatch.target > 0 && (
                  <div>
                    <span style={{ fontSize: '11px', color: '#ffab00', textTransform: 'uppercase', fontWeight: '800' }}>Target / RRR</span>
                    <div style={{ fontSize: '22px', fontWeight: '900', color: '#ffab00', fontFamily: 'var(--font-mono)' }}>
                      {selectedMatch.target} <span style={{ fontSize: '13px', color: '#cbd5e1' }}>(RRR: {rrrInnings2})</span>
                    </div>
                  </div>
                )}
                <div>
                  <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '800' }}>Extras</span>
                  <div style={{ fontSize: '20px', fontWeight: '900', color: '#ffffff', fontFamily: 'var(--font-mono)' }}>
                    {currentInnSummary.extras}
                  </div>
                </div>
              </div>
            </div>

            {/* Batting Breakdown Table */}
            <div className="glass-panel" style={{ padding: '24px', marginBottom: '28px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: '900', color: '#00f2fe', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={22} /> Batting Breakdown ({currentTeamName})
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '580px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)', textAlign: 'left', color: '#00f2fe', fontSize: '15px' }}>
                      <th style={{ padding: '12px 8px' }}>Batter</th>
                      <th style={{ padding: '12px 8px' }}>Runs</th>
                      <th style={{ padding: '12px 8px' }}>Balls</th>
                      <th style={{ padding: '12px 8px' }}>4s</th>
                      <th style={{ padding: '12px 8px' }}>6s</th>
                      <th style={{ padding: '12px 8px' }}>Strike Rate (SR)</th>
                      <th style={{ padding: '12px 8px' }}>Dismissal Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentInnData.batting.length === 0 ? (
                      <tr>
                        <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '16px' }}>
                          No batting records recorded for this innings.
                        </td>
                      </tr>
                    ) : (
                      currentInnData.batting.map((b) => {
                        const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : '0.0';
                        return (
                          <tr key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#ffffff' }}>
                            <td style={{ padding: '14px 8px', fontWeight: '800', fontSize: '17px' }}>{b.player}</td>
                            <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontWeight: '900', fontSize: '18px' }}>{b.runs}</td>
                            <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontSize: '17px' }}>{b.balls}</td>
                            <td style={{ padding: '14px 8px', color: '#00f2fe', fontWeight: '800', fontSize: '17px' }}>{b.fours}</td>
                            <td style={{ padding: '14px 8px', color: '#ffab00', fontWeight: '800', fontSize: '17px' }}>{b.sixes}</td>
                            <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', color: '#00e676', fontWeight: '900', fontSize: '18px' }}>{sr}</td>
                            <td style={{ padding: '14px 8px', color: b.out_desc === 'not out' ? '#00e676' : '#cbd5e1', fontSize: '15px', fontWeight: '700' }}>{b.out_desc}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bowling Breakdown Table */}
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: '900', color: '#ffab00', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity size={22} /> Bowling Analytics
              </h3>
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
                    {currentInnData.bowling.length === 0 ? (
                      <tr>
                        <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '16px' }}>
                          No bowling records recorded for this innings.
                        </td>
                      </tr>
                    ) : (
                      currentInnData.bowling.map((bw) => {
                        const oversFmt = `${Math.floor(bw.balls / 6)}.${bw.balls % 6}`;
                        const econ = bw.balls > 0 ? (bw.runs / (bw.balls / 6.0)).toFixed(2) : '0.00';
                        return (
                          <tr key={bw.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#ffffff' }}>
                            <td style={{ padding: '14px 8px', fontWeight: '800', fontSize: '17px' }}>{bw.bowler}</td>
                            <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontSize: '17px' }}>{oversFmt}</td>
                            <td style={{ padding: '14px 8px', fontSize: '17px' }}>{bw.maidens}</td>
                            <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', fontSize: '17px' }}>{bw.runs}</td>
                            <td style={{ padding: '14px 8px', color: '#ff1744', fontWeight: '900', fontSize: '19px' }}>{bw.wickets}</td>
                            <td style={{ padding: '14px 8px', fontFamily: 'var(--font-mono)', color: '#ffab00', fontWeight: '900', fontSize: '18px' }}>{econ}</td>
                            <td style={{ padding: '14px 8px', color: '#00f2fe', fontFamily: 'var(--font-mono)', fontWeight: '800', fontSize: '17px' }}>
                              {bw.max_speed > 0 ? `${bw.max_speed.toFixed(1)} km/h` : '--'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Ball-by-Ball Trajectory & Movement Analysis Table */}
            <div className="glass-panel" style={{ padding: '24px', marginTop: '24px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: '900', color: '#00f2fe', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={22} /> Ball-by-Ball Delivery Log & Movement Analytics
              </h3>

              {currentInnData.balls.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0, textAlign: 'center', padding: '16px' }}>
                  No ball-by-ball delivery records logged for this innings.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)', textAlign: 'left', color: '#00f2fe', fontSize: '13px' }}>
                        <th style={{ padding: '10px 8px' }}>Over</th>
                        <th style={{ padding: '10px 8px' }}>Bowler</th>
                        <th style={{ padding: '10px 8px' }}>Batter</th>
                        <th style={{ padding: '10px 8px' }}>Runs</th>
                        <th style={{ padding: '10px 8px' }}>Speed</th>
                        <th style={{ padding: '10px 8px' }}>Delivery Type</th>
                        <th style={{ padding: '10px 8px' }}>Turn Off Pitch</th>
                        <th style={{ padding: '10px 8px' }}>Air Swing</th>
                        <th style={{ padding: '10px 8px' }}>Length & Line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentInnData.balls.map((bl, bIdx) => {
                        const overBall = `${bl.over_no}.${bl.ball_no}`;
                        const isWicket = Boolean(bl.wicket);
                        const hasAnalysis = Boolean(bl.delivery_type);

                        return (
                          <tr
                            key={bl.id || bIdx}
                            style={{
                              borderBottom: '1px solid rgba(255,255,255,0.06)',
                              background: isWicket ? 'rgba(255, 23, 68, 0.08)' : 'transparent'
                            }}
                          >
                            <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)', fontWeight: '800', color: '#f1f5f9' }}>
                              {overBall}
                            </td>
                            <td style={{ padding: '10px 8px', color: '#cbd5e1', fontWeight: '700' }}>
                              {bl.bowler}
                            </td>
                            <td style={{ padding: '10px 8px', color: '#cbd5e1' }}>
                              {bl.batsman}
                            </td>
                            <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)', fontWeight: '800', color: isWicket ? '#ff1744' : '#00e676' }}>
                              {isWicket ? 'W' : (bl.extra_type ? `${bl.runs} (${bl.extra_type})` : bl.runs)}
                            </td>
                            <td style={{ padding: '10px 8px', color: '#00f2fe', fontFamily: 'var(--font-mono)', fontWeight: '800' }}>
                              {bl.speed_kmh ? `${Number(bl.speed_kmh).toFixed(1)} km/h` : '--'}
                            </td>
                            <td style={{ padding: '10px 8px' }}>
                              {hasAnalysis ? (
                                <DeliveryTypeBadge type={bl.delivery_type} size="sm" />
                              ) : (
                                <span style={{ color: '#64748b' }}>--</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 8px', color: '#ffab00', fontWeight: '700' }}>
                              {bl.turn_angle_deg != null && bl.turn_angle_deg > 0 ? `${Number(bl.turn_angle_deg).toFixed(1)}°` : '--'}
                            </td>
                            <td style={{ padding: '10px 8px', color: '#00e676', fontWeight: '700' }}>
                              {bl.swing_cm != null && bl.swing_cm > 0 ? `${Number(bl.swing_cm).toFixed(1)} cm` : '--'}
                            </td>
                            <td style={{ padding: '10px 8px', color: '#94a3b8' }}>
                              {bl.length ? `${bl.length}${bl.line ? ` (${bl.line})` : ''}` : '--'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Pitch Map for the Match */}
            <div style={{ marginTop: '24px' }}>
              <PitchMap matchId={selectedMatch.id} />
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
