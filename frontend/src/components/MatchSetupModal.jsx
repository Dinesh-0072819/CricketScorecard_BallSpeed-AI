import React, { useState } from 'react';
import { Trophy, X } from 'lucide-react';

export default function MatchSetupModal({ isOpen, onClose, onMatchCreated }) {
  const [team1, setTeam1] = useState('India');
  const [team2, setTeam2] = useState('Australia');
  const [totalOvers, setTotalOvers] = useState(20);
  const [tossWinner, setTossWinner] = useState('India');
  const [tossDecision, setTossDecision] = useState('BAT');

  const [striker, setStriker] = useState('Rohit Sharma');
  const [nonStriker, setNonStriker] = useState('Shubman Gill');
  const [bowler, setBowler] = useState('Mitchell Starc');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Step 1: Create Match
      const res1 = await fetch('/api/match/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team1, team2, total_overs: totalOvers, toss_winner: tossWinner, toss_decision: tossDecision })
      });
      const data1 = await res1.json();
      
      // Step 2: Setup Innings 1
      await fetch('/api/match/setup_innings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ striker, non_striker: nonStriker, bowler, current_innings: 1 })
      });

      onMatchCreated();
      onClose();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div className="glass-card" style={{ width: '520px', padding: '32px', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <Trophy size={28} className="gradient-text" />
          <h2 style={{ fontSize: '20px', fontWeight: '800' }}>New Cricket Match Setup</h2>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Team 1 Name</label>
              <input type="text" value={team1} onChange={(e) => setTeam1(e.target.value)} className="glass-input" style={{ width: '100%' }} required />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Team 2 Name</label>
              <input type="text" value={team2} onChange={(e) => setTeam2(e.target.value)} className="glass-input" style={{ width: '100%' }} required />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '20px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Total Overs</label>
              <select value={totalOvers} onChange={(e) => setTotalOvers(e.target.value)} className="glass-input" style={{ width: '100%' }}>
                <option value={5}>5 Overs</option>
                <option value={10}>10 Overs</option>
                <option value={20}>20 Overs (T20)</option>
                <option value={50}>50 Overs (ODI)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Toss Winner</label>
              <select value={tossWinner} onChange={(e) => setTossWinner(e.target.value)} className="glass-input" style={{ width: '100%' }}>
                <option value={team1}>{team1}</option>
                <option value={team2}>{team2}</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Toss Choice</label>
              <select value={tossDecision} onChange={(e) => setTossDecision(e.target.value)} className="glass-input" style={{ width: '100%' }}>
                <option value="BAT">Bat First</option>
                <option value="BOWL">Bowl First</option>
              </select>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px', marginBottom: '24px' }}>
            <h4 style={{ fontSize: '14px', color: '#00f2fe', marginBottom: '14px' }}>Opening Players</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Striker Batter</label>
                <input type="text" value={striker} onChange={(e) => setStriker(e.target.value)} className="glass-input" style={{ width: '100%' }} required />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Non-Striker Batter</label>
                <input type="text" value={nonStriker} onChange={(e) => setNonStriker(e.target.value)} className="glass-input" style={{ width: '100%' }} required />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Opening Bowler Name</label>
              <input type="text" value={bowler} onChange={(e) => setBowler(e.target.value)} className="glass-input" style={{ width: '100%' }} required />
            </div>
          </div>

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '12px',
              border: 'none',
              background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
              color: '#070a14',
              fontWeight: '800',
              fontSize: '15px',
              cursor: 'pointer',
              boxShadow: '0 0 20px rgba(0, 242, 254, 0.4)'
            }}
          >
            Launch Match & Live Scoring
          </button>
        </form>
      </div>
    </div>
  );
}
