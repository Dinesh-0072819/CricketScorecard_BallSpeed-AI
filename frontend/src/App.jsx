import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import LiveCameraRadar from './components/LiveCameraRadar';
import LiveScorecard from './components/LiveScorecard';
import MatchSetupModal from './components/MatchSetupModal';
import VideoUpload from './components/VideoUpload';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import MatchSummaryView from './components/MatchSummaryView';

export default function App() {
  const [activeTab, setActiveTab] = useState('scorecard');
  const [activeMatch, setActiveMatch] = useState(null);
  const [isMatchModalOpen, setIsMatchModalOpen] = useState(false);

  const fetchMatchState = async () => {
    try {
      const res = await fetch('/api/match/state');
      const data = await res.json();
      setActiveMatch(data);
    } catch (e) {
      console.error('Error fetching match state:', e);
    }
  };

  useEffect(() => {
    fetchMatchState();
  }, []);

  const handleSyncDeliverySpeed = async (speed) => {
    if (!activeMatch || !activeMatch.match_id) return;
    try {
      await fetch('/api/match/ball', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'NORMAL', runs: 0, speed_kmh: speed })
      });
      fetchMatchState();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        liveCameraRunning={true}
        activeMatch={activeMatch}
        onOpenMatchModal={() => setIsMatchModalOpen(true)}
      />

      <main style={{ flex: 1 }}>
        {activeTab === 'radar' && (
          <LiveCameraRadar
            activeMatch={activeMatch}
            onSyncDelivery={handleSyncDeliverySpeed}
          />
        )}

        {activeTab === 'scorecard' && (
          <LiveScorecard
            matchState={activeMatch}
            onRefresh={fetchMatchState}
            onOpenNewMatch={() => setIsMatchModalOpen(true)}
          />
        )}

        {activeTab === 'upload' && <VideoUpload />}

        {activeTab === 'analytics' && <AnalyticsDashboard />}

        {(activeTab === 'history' || activeTab === 'matches') && <MatchSummaryView />}
      </main>

      <MatchSetupModal
        isOpen={isMatchModalOpen}
        onClose={() => setIsMatchModalOpen(false)}
        onMatchCreated={fetchMatchState}
      />
    </div>
  );
}
