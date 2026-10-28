import React, { useState, useEffect } from 'react';
import { Trophy, Calendar, Trash2, ArrowRight, Zap, Target, Shield, Clock, Search, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function MatchSummaryView() {
  const [matches, setMatches] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [scorecardDetails, setScorecardDetails] = useState(null);
  const [selectedInnings, setSelectedInnings] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchMatches = async (autoSelectId = null) => {
    try {
      setLoading(true);
      const res = await fetch('/api/matches');
      const data = await res.json();
      setMatches(data || []);
      
      if (data && data.length > 0) {
        const toSelect = autoSelectId 
          ? data.find(m => m.id === autoSelectId) || data[0]
          : (selectedMatch ? data.find(m => m.id === selectedMatch.id) || data[0] : data[0]);
        handleSelectMatch(toSelect);
      } else {
        setSelectedMatch(null);
        setScorecardDetails(null);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to load match archives.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatches();
  }, []);

  const handleSelectMatch = async (match) => {
    setSelectedMatch(match);
    setSelectedInnings(match.current_innings || 1);
    try {
      const res = await fetch(`/api/match/details/${match.id}`);
      const data = await res.json();
      setScorecardDetails(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteMatch = async (e, matchId) => {
    e.stopPropagation();
    if (!window.confirm(`Delete Match #${matchId} from history? This cannot be undone.`)) {
      return;
    }
    try {
      await fetch(`/api/match/delete/${matchId}`, { method: 'POST' });
      fetchMatches();
    } catch (err) {
      console.error('Failed to delete match:', err);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to delete ALL match history archives?')) {
      return;
    }
    try {
      await fetch('/api/matches/clear', { method: 'POST' });
      setMatches([]);
      setSelectedMatch(null);
      setScorecardDetails(null);
    } catch (err) {
      console.error('Failed to clear matches:', err);
    }
  };

  const filteredMatches = matches.filter(m => {
    const term = searchTerm.toLowerCase();
    return (
      m.team1.toLowerCase().includes(term) ||
      m.team2.toLowerCase().includes(term) ||
      (m.winner && m.winner.toLowerCase().includes(term)) ||
      String(m.id).includes(term)
    );
  });

  // Calculate Innings Totals
  const getInningsStats = (inningsNo) => {
    if (!scorecardDetails) return { runs: 0, wickets: 0, overs: '0.0', balls: 0, extras: 0, runRate: '0.00' };
    
    const batList = (scorecardDetails.batting || []).filter(b => b.innings_no === inningsNo);
    const ballList = (scorecardDetails.balls || []).filter(bl => bl.innings_no === inningsNo);
    
    let totalRuns = 0;
    let wickets = 0;
    let extras = 0;

    batList.forEach(b => {
      totalRuns += b.runs || 0;
      if (b.out_desc && b.out_desc.toLowerCase() !== 'not out') {
        wickets += 1;
      }
    });

    ballList.forEach(bl => {
      if (bl.extra_type) {
        extras += (bl.runs || 1);
        totalRuns += (bl.runs || 1);
      }
    });

    // Count legal balls
    const legalBalls = ballList.filter(bl => bl.extra_type !== 'WD' && bl.extra_type !== 'NB').length;
    const overs = `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
    const oversDecimal = (legalBalls / 6) || 0;
    const runRate = oversDecimal > 0 ? (totalRuns / oversDecimal).toFixed(2) : '0.00';

    return { totalRuns, wickets, overs, legalBalls, extras, runRate };
  };

  const currentBatting = scorecardDetails?.batting?.filter(b => b.innings_no === selectedInnings) || [];
  const currentBowling = scorecardDetails?.bowling?.filter(bw => bw.innings_no === selectedInnings) || [];
  const currentBalls = scorecardDetails?.balls?.filter(bl => bl.innings_no === selectedInnings) || [];
  const currentInningsStats = getInningsStats(selectedInnings);

  // Determine batting team for selected innings
  const getBattingTeamName = (inningsNo) => {
    if (!selectedMatch) return `Innings ${inningsNo}`;
    const tossWinner = selectedMatch.toss_winner || selectedMatch.team1;
    const tossDec = selectedMatch.toss_decision || 'BAT';
    const otherTeam = tossWinner === selectedMatch.team1 ? selectedMatch.team2 : selectedMatch.team1;

    if (tossDec === 'BAT') {
      return inningsNo === 1 ? tossWinner : otherTeam;
    } else {
      return inningsNo === 1 ? otherTeam : tossWinner;
    }
  };

  const getBowlingTeamName = (inningsNo) => {
    if (!selectedMatch) return '';
    const battingTeam = getBattingTeamName(inningsNo);
    return battingTeam === selectedMatch.team1 ? selectedMatch.team2 : selectedMatch.team1;
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px 32px' }}>
      {/* Top Header Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '24px',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.2) 0%, rgba(79, 172, 254, 0.2) 100%)',
            border: '1px solid rgba(0, 242, 254, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#00f2fe'
          }}>
            <Trophy size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '-0.5px' }}>
              Match History & Scorecards
            </h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
              Complete archived scorecards, batting, bowling stats & delivery speed tracking
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {matches.length > 0 && (
            <button
              onClick={handleClearAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '10px',
                background: 'rgba(255, 23, 68, 0.12)',
                border: '1px solid rgba(255, 23, 68, 0.3)',
                color: '#ff1744',
                fontSize: '13px',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <Trash2 size={15} /> Clear All Archives
            </button>
          )}
          <button
            onClick={() => fetchMatches()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '10px',
              background: 'rgba(0, 242, 254, 0.1)',
              border: '1px solid rgba(0, 242, 254, 0.3)',
              color: '#00f2fe',
              fontSize: '13px',
              fontWeight: '700',
              cursor: 'pointer'
            }}
          >
            <RotateCcw size={15} /> Refresh
          </button>
        </div>
      </div>

      {/* Main Layout Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: matches.length > 0 ? '360px 1fr' : '1fr',
        gap: '24px',
        alignItems: 'start'
      }}>
        {/* Left Column: Match Archives List */}
        <div className="glass-card" style={{ padding: '20px', borderRadius: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <span style={{ fontSize: '15px', fontWeight: '800', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              All Matches
              <span style={{
                fontSize: '11px',
                background: 'rgba(0, 242, 254, 0.15)',
                color: '#00f2fe',
                padding: '2px 8px',
                borderRadius: '10px',
                fontWeight: '800'
              }}>
                {matches.length}
              </span>
            </span>
          </div>

          {/* Search Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '8px 12px',
            borderRadius: '10px',
            marginBottom: '16px'
          }}>
            <Search size={16} color="#64748b" />
            <input
              type="text"
              placeholder="Search team or match #..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#f8fafc',
                fontSize: '13px',
                width: '100%'
              }}
            />
          </div>

          {/* Matches Scroll List */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxHeight: 'calc(100vh - 280px)',
            overflowY: 'auto',
            paddingRight: '4px'
          }}>
            {filteredMatches.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 12px', color: '#64748b' }}>
                <AlertTriangle size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                <p style={{ fontSize: '14px', margin: 0 }}>No matches found in archive.</p>
              </div>
            ) : (
              filteredMatches.map((m) => {
                const isSelected = selectedMatch && selectedMatch.id === m.id;
                const isLive = m.status === 'LIVE';
                return (
                  <div
                    key={m.id}
                    onClick={() => handleSelectMatch(m)}
                    style={{
                      padding: '14px 16px',
                      borderRadius: '12px',
                      background: isSelected
                        ? 'linear-gradient(135deg, rgba(0, 242, 254, 0.16) 0%, rgba(79, 172, 254, 0.1) 100%)'
                        : 'rgba(13, 20, 36, 0.65)',
                      border: isSelected ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.06)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      position: 'relative'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700' }}>
                        Match #{m.id} • {m.total_overs} Overs
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {isLive ? (
                          <span style={{
                            fontSize: '10px',
                            fontWeight: '800',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            background: 'rgba(0, 230, 118, 0.15)',
                            color: '#00e676',
                            border: '1px solid rgba(0, 230, 118, 0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00e676' }} />
                            LIVE
                          </span>
                        ) : (
                          <span style={{
                            fontSize: '10px',
                            fontWeight: '700',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            color: '#94a3b8'
                          }}>
                            COMPLETED
                          </span>
                        )}
                        <button
                          onClick={(e) => handleDeleteMatch(e, m.id)}
                          title="Delete Match"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#64748b',
                            cursor: 'pointer',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#ff1744'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#64748b'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: '15px', fontWeight: '800', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{m.team1}</span>
                      <span style={{ color: '#00f2fe', fontSize: '12px', fontWeight: '900' }}>vs</span>
                      <span>{m.team2}</span>
                    </div>

                    <div style={{ fontSize: '12px', color: m.winner ? '#00e676' : '#ffab00', fontWeight: '700', marginTop: '6px' }}>
                      {m.winner ? `🏆 ${m.winner}` : `Innings ${m.current_innings || 1} in progress`}
                    </div>

                    {m.created_at && (
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>
                        {new Date(m.created_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Complete Detailed Scorecard */}
        {selectedMatch && scorecardDetails ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Match Header Hero Card */}
            <div className="glass-card" style={{ padding: '24px', borderRadius: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '800',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: 'rgba(0, 242, 254, 0.15)',
                      color: '#00f2fe'
                    }}>
                      MATCH #{selectedMatch.id} • {selectedMatch.total_overs} OVERS
                    </span>
                    {selectedMatch.status === 'LIVE' ? (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: '800',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        background: 'rgba(0, 230, 118, 0.15)',
                        color: '#00e676',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00e676' }} />
                        LIVE MATCH
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: '700',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        background: 'rgba(255, 255, 255, 0.08)',
                        color: '#94a3b8'
                      }}>
                        RESULT FINAL
                      </span>
                    )}
                  </div>

                  <h2 style={{ fontSize: '28px', fontWeight: '900', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>
                    {selectedMatch.team1} <span style={{ color: '#00f2fe' }}>vs</span> {selectedMatch.team2}
                  </h2>

                  {/* Toss and Target Info */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '13px', color: '#94a3b8' }}>
                    {selectedMatch.toss_winner && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Target size={15} color="#00f2fe" />
                        Toss: <strong>{selectedMatch.toss_winner}</strong> elected to {selectedMatch.toss_decision}
                      </span>
                    )}
                    {selectedMatch.target > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Shield size={15} color="#ffab00" />
                        Target: <strong>{selectedMatch.target} runs</strong>
                      </span>
                    )}
                    {selectedMatch.created_at && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Clock size={15} color="#64748b" />
                        {new Date(selectedMatch.created_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Big Winner Banner */}
                {selectedMatch.winner ? (
                  <div style={{
                    padding: '12px 20px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(0, 230, 118, 0.15) 0%, rgba(0, 242, 254, 0.15) 100%)',
                    border: '1px solid rgba(0, 230, 118, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}>
                    <Trophy size={28} color="#00e676" />
                    <div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase' }}>
                        Match Result
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: '900', color: '#00e676' }}>
                        {selectedMatch.winner}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    padding: '12px 18px',
                    borderRadius: '12px',
                    background: 'rgba(255, 171, 0, 0.1)',
                    border: '1px solid rgba(255, 171, 0, 0.3)',
                    color: '#ffab00',
                    fontSize: '13px',
                    fontWeight: '700'
                  }}>
                    Innings {selectedMatch.current_innings || 1} • In Progress
                  </div>
                )}
              </div>
            </div>

            {/* Innings Switcher Tabs */}
            <div style={{
              display: 'flex',
              gap: '10px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              paddingBottom: '12px'
            }}>
              {[1, 2].map((inn) => {
                const isActive = selectedInnings === inn;
                const stats = getInningsStats(inn);
                const teamName = getBattingTeamName(inn);
                return (
                  <button
                    key={inn}
                    onClick={() => setSelectedInnings(inn)}
                    style={{
                      padding: '12px 24px',
                      borderRadius: '12px',
                      border: isActive ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.08)',
                      background: isActive
                        ? 'linear-gradient(135deg, rgba(0, 242, 254, 0.2) 0%, rgba(79, 172, 254, 0.1) 100%)'
                        : 'rgba(13, 20, 36, 0.6)',
                      color: isActive ? '#00f2fe' : '#94a3b8',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '4px',
                      transition: 'all 0.2s',
                      minWidth: '220px'
                    }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Innings {inn} {inn === selectedMatch.current_innings && selectedMatch.status === 'LIVE' && '• LIVE'}
                    </span>
                    <span style={{ fontSize: '16px', fontWeight: '900', color: isActive ? '#f8fafc' : '#cbd5e1' }}>
                      {teamName}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: '800', color: isActive ? '#00e676' : '#94a3b8' }}>
                      {stats.totalRuns}/{stats.wickets} <span style={{ fontSize: '11px', color: '#64748b' }}>({stats.overs} ov)</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected Innings Summary Banner */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px'
            }}>
              <div className="glass-card" style={{ padding: '16px', borderRadius: '12px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700' }}>TOTAL SCORE</div>
                <div style={{ fontSize: '24px', fontWeight: '900', color: '#00f2fe', marginTop: '4px' }}>
                  {currentInningsStats.totalRuns}/{currentInningsStats.wickets}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  in {currentInningsStats.overs} overs
                </div>
              </div>

              <div className="glass-card" style={{ padding: '16px', borderRadius: '12px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700' }}>RUN RATE</div>
                <div style={{ fontSize: '24px', fontWeight: '900', color: '#00e676', marginTop: '4px' }}>
                  {currentInningsStats.runRate}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>runs per over</div>
              </div>

              <div className="glass-card" style={{ padding: '16px', borderRadius: '12px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700' }}>EXTRAS</div>
                <div style={{ fontSize: '24px', fontWeight: '900', color: '#ffab00', marginTop: '4px' }}>
                  {currentInningsStats.extras}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>wd, nb, byes</div>
              </div>

              <div className="glass-card" style={{ padding: '16px', borderRadius: '12px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700' }}>BOWLING TEAM</div>
                <div style={{ fontSize: '18px', fontWeight: '900', color: '#f8fafc', marginTop: '4px' }}>
                  {getBowlingTeamName(selectedInnings)}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>fielding side</div>
              </div>
            </div>

            {/* Batting Scorecard Table */}
            <div className="glass-card" style={{ padding: '24px', borderRadius: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#00f2fe', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <Shield size={18} /> Batting Scorecard — {getBattingTeamName(selectedInnings)}
                </h3>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  {currentBatting.length} Batters
                </span>
              </div>

              {currentBatting.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  No batting records registered for Innings {selectedInnings}.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase' }}>
                        <th style={{ padding: '10px 12px' }}>Batter</th>
                        <th style={{ padding: '10px 12px' }}>Dismissal</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Runs</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Balls</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>4s</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>6s</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>SR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentBatting.map((b) => {
                        const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : '0.0';
                        const isNotOut = !b.out_desc || b.out_desc.toLowerCase() === 'not out';
                        return (
                          <tr key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', color: '#f8fafc' }}>
                            <td style={{ padding: '12px', fontWeight: '800' }}>
                              {b.player}
                            </td>
                            <td style={{ padding: '12px', color: isNotOut ? '#00e676' : '#94a3b8', fontWeight: isNotOut ? '700' : '400' }}>
                              {b.out_desc || 'not out'}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: '900', color: '#00f2fe', fontSize: '15px' }}>
                              {b.runs}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#cbd5e1' }}>
                              {b.balls}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#ffab00' }}>
                              {b.fours}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#ff1744', fontWeight: '700' }}>
                              {b.sixes}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#cbd5e1', fontWeight: '600' }}>
                              {sr}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid rgba(255,255,255,0.1)', fontWeight: '900', color: '#f8fafc' }}>
                        <td style={{ padding: '12px' }}>Total</td>
                        <td style={{ padding: '12px', color: '#94a3b8' }}>
                          ({currentInningsStats.wickets} wkts, {currentInningsStats.overs} ov)
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', color: '#00f2fe', fontSize: '16px' }}>
                          {currentInningsStats.totalRuns}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', color: '#cbd5e1' }}>
                          {currentInningsStats.legalBalls}
                        </td>
                        <td colSpan={3}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Bowling Scorecard Table */}
            <div className="glass-card" style={{ padding: '24px', borderRadius: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#ffab00', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <Zap size={18} /> Bowling Scorecard & Ball Speeds
                </h3>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  {currentBowling.length} Bowlers
                </span>
              </div>

              {currentBowling.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  No bowling figures registered for Innings {selectedInnings}.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase' }}>
                        <th style={{ padding: '10px 12px' }}>Bowler</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Overs</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Maidens</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Runs</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Wickets</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Econ</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Peak Speed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentBowling.map((bw) => {
                        const oversStr = `${Math.floor(bw.balls / 6)}.${bw.balls % 6}`;
                        const econ = bw.balls > 0 ? ((bw.runs * 6) / bw.balls).toFixed(2) : '0.00';
                        return (
                          <tr key={bw.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', color: '#f8fafc' }}>
                            <td style={{ padding: '12px', fontWeight: '800' }}>
                              {bw.bowler}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#cbd5e1' }}>
                              {oversStr}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#cbd5e1' }}>
                              {bw.maidens}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#ffab00', fontWeight: '800' }}>
                              {bw.runs}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#ff1744', fontWeight: '900', fontSize: '15px' }}>
                              {bw.wickets}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#cbd5e1' }}>
                              {econ}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#00f2fe', fontWeight: '800' }}>
                              {bw.max_speed > 0 ? (
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  background: 'rgba(0, 242, 254, 0.12)',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(0, 242, 254, 0.25)'
                                }}>
                                  <Zap size={12} /> {bw.max_speed.toFixed(1)} km/h
                                </span>
                              ) : (
                                '--'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Ball-by-Ball Delivery Timeline with Speeds */}
            <div className="glass-card" style={{ padding: '24px', borderRadius: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#00e676', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <Clock size={18} /> Ball-by-Ball Delivery Log (Speed & Outcomes)
                </h3>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  {currentBalls.length} Deliveries Tracked
                </span>
              </div>

              {currentBalls.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  No ball-by-ball delivery log recorded for Innings {selectedInnings}.
                </div>
              ) : (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  paddingRight: '6px'
                }}>
                  {currentBalls.map((bl) => {
                    const isWicket = !!bl.wicket;
                    const isBoundary = bl.runs === 4 || bl.runs === 6;
                    return (
                      <div
                        key={bl.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          borderRadius: '10px',
                          background: isWicket
                            ? 'rgba(255, 23, 68, 0.1)'
                            : isBoundary
                            ? 'rgba(0, 242, 254, 0.08)'
                            : 'rgba(255, 255, 255, 0.03)',
                          border: isWicket
                            ? '1px solid rgba(255, 23, 68, 0.3)'
                            : isBoundary
                            ? '1px solid rgba(0, 242, 254, 0.2)'
                            : '1px solid rgba(255, 255, 255, 0.05)',
                          fontSize: '13px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{
                            fontSize: '12px',
                            fontWeight: '900',
                            color: '#00f2fe',
                            background: 'rgba(0, 242, 254, 0.12)',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            minWidth: '46px',
                            textAlign: 'center'
                          }}>
                            {bl.over_no}.{bl.ball_no}
                          </span>
                          <div>
                            <span style={{ fontWeight: '700', color: '#f8fafc' }}>{bl.bowler}</span>
                            <span style={{ color: '#64748b', margin: '0 6px' }}>to</span>
                            <span style={{ fontWeight: '700', color: '#cbd5e1' }}>{bl.batsman}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          {bl.speed_kmh > 0 && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '12px',
                              color: '#00f2fe',
                              fontWeight: '800',
                              background: 'rgba(0, 242, 254, 0.12)',
                              padding: '2px 8px',
                              borderRadius: '6px'
                            }}>
                              <Zap size={12} /> {bl.speed_kmh.toFixed(1)} km/h
                            </span>
                          )}

                          <span style={{
                            fontWeight: '900',
                            fontSize: '13px',
                            color: isWicket ? '#ff1744' : isBoundary ? '#00f2fe' : '#f8fafc',
                            minWidth: '60px',
                            textAlign: 'right'
                          }}>
                            {isWicket ? `W (${bl.wicket})` : bl.extra_type ? `${bl.runs} ${bl.extra_type}` : `${bl.runs} runs`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: '60px 24px', textAlign: 'center', color: '#94a3b8', borderRadius: '16px' }}>
            <Trophy size={48} style={{ margin: '0 auto 16px', color: '#00f2fe', opacity: 0.5 }} />
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#f8fafc', marginBottom: '8px' }}>
              Select a Match to View Full Scorecard
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '400px', margin: '0 auto' }}>
              Choose any match from the history archives on the left to inspect complete batting, bowling, totals, and delivery speeds.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
