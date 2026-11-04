import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import LiveCameraRadar from './components/LiveCameraRadar';
import LiveScorecard from './components/LiveScorecard';
import MatchSetupModal from './components/MatchSetupModal';
import VideoUpload from './components/VideoUpload';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import MatchSummaryView from './components/MatchSummaryView';
import AuthPage from './components/AuthPage';

export default function App() {
  const [activeTab, setActiveTab] = useState('scorecard');
  const [activeMatch, setActiveMatch] = useState(null);
  const [isMatchModalOpen, setIsMatchModalOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Check the login session once, and log out automatically if the server says
  // the session has expired (any API call answering 401).
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      if (res.status === 401 && !url.includes('/api/auth/')) {
        setUser(null);
      }
      return res;
    };
    originalFetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setUser(d.logged_in ? d.user : null))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
    return () => { window.fetch = originalFetch; };
  }, []);

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    setUser(null);
    setActiveMatch(null);
    setActiveTab('scorecard');
  };

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
    if (user) fetchMatchState();
  }, [user]);

  // Keep the live scorecard in sync (balls from the radar tab / another device)
  useEffect(() => {
    if (activeTab !== 'scorecard' || !user) return undefined;
    const id = setInterval(() => {
      if (!document.hidden) fetchMatchState();
    }, 3000);
    return () => clearInterval(id);
  }, [activeTab, user]);

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

  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    return <AuthPage onAuthenticated={(u) => { setUser(u); setActiveTab('scorecard'); }} />;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        liveCameraRunning={true}
        activeMatch={activeMatch}
        onOpenMatchModal={() => setIsMatchModalOpen(true)}
        user={user}
        onLogout={handleLogout}
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

        {activeTab === 'matches' && <MatchSummaryView />}
      </main>

      <MatchSetupModal
        isOpen={isMatchModalOpen}
        onClose={() => setIsMatchModalOpen(false)}
        onMatchCreated={fetchMatchState}
      />
    </div>
  );
}
