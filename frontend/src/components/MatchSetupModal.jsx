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
      background: 'rgba(0, 0, 0, 0.88)', backdropFilter: 'blur(16px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '12px'
    }}>
      <div className="glass-panel mobile-full-modal" style={{
        width: '640px', maxWidth: '100%', maxHeight: '94vh', overflowY: 'auto',
        padding: '28px', position: 'relative', borderColor: 'rgba(0, 242, 254, 0.4)'
      }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
        >
          <X size={26} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <Trophy size={32} className="gradient-text-cyan" />
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: '900', color: '#ffffff' }}>New Cricket Match Setup</h2>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '2px' }}>Configure teams, overs, toss, and opening players</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Teams Section */}
          <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '15px', fontWeight: '800', color: '#00f2fe', display: 'block', marginBottom: '8px' }}>
                Team 1 Name
              </label>
              <input
                type="text"
                value={team1}
                onChange={(e) => setTeam1(e.target.value)}
                className="glass-input-large"
                placeholder="e.g. India"
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '15px', fontWeight: '800', color: '#00f2fe', display: 'block', marginBottom: '8px' }}>
                Team 2 Name
              </label>
              <input
                type="text"
                value={team2}
                onChange={(e) => setTeam2(e.target.value)}
                className="glass-input-large"
                placeholder="e.g. Australia"
                required
              />
            </div>
          </div>

          {/* Match Settings Section */}
          <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '15px', fontWeight: '800', color: '#ffab00', display: 'block', marginBottom: '8px' }}>
                Total Overs
              </label>
              <input
                type="number"
                min="1"
                max="100"
                placeholder="e.g. 20"
                value={totalOvers}
                onChange={(e) => setTotalOvers(e.target.value)}
                className="glass-input-large"
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '15px', fontWeight: '800', color: '#ffab00', display: 'block', marginBottom: '8px' }}>
                Toss Winner
              </label>
              <select
                value={tossWinner}
                onChange={(e) => setTossWinner(e.target.value)}
                className="glass-input-large"
              >
                <option value={team1}>{team1}</option>
                <option value={team2}>{team2}</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '15px', fontWeight: '800', color: '#ffab00', display: 'block', marginBottom: '8px' }}>
                Toss Choice
              </label>
              <select
                value={tossDecision}
                onChange={(e) => setTossDecision(e.target.value)}
                className="glass-input-large"
              >
                <option value="BAT">Bat First</option>
                <option value="BOWL">Bowl First</option>
              </select>
            </div>
          </div>

          {/* Opening Players Section */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
            <h4 style={{ fontSize: '18px', fontWeight: '900', color: '#00e676', marginBottom: '16px' }}>
              Opening Players (Innings 1)
            </h4>

            <div className="mobile-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '15px', fontWeight: '800', color: '#ffffff', display: 'block', marginBottom: '8px' }}>
                  Striker Batter
                </label>
                <input
                  type="text"
                  value={striker}
                  onChange={(e) => setStriker(e.target.value)}
                  className="glass-input-large"
                  placeholder="Striker Batter Name"
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '15px', fontWeight: '800', color: '#ffffff', display: 'block', marginBottom: '8px' }}>
                  Non-Striker Batter
                </label>
                <input
                  type="text"
                  value={nonStriker}
                  onChange={(e) => setNonStriker(e.target.value)}
                  className="glass-input-large"
                  placeholder="Non-Striker Batter Name"
                  required
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '15px', fontWeight: '800', color: '#ffffff', display: 'block', marginBottom: '8px' }}>
                Opening Bowler Name
              </label>
              <input
                type="text"
                value={bowler}
                onChange={(e) => setBowler(e.target.value)}
                className="glass-input-large"
                placeholder="Opening Bowler Name"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-action btn-gradient"
            style={{
              width: '100%',
              padding: '18px',
              borderRadius: '16px',
              fontSize: '19px',
              fontWeight: '900',
              marginTop: '10px',
              boxShadow: '0 0 30px rgba(0, 242, 254, 0.45)'
            }}
          >
            Launch Match & Live Scoring ➔
          </button>
        </form>
      </div>
    </div>
  );
}
