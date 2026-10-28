import React from 'react';
import { Activity, Trophy, Upload, BarChart3, Radio, PlusCircle, History } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, liveCameraRunning, activeMatch, onOpenMatchModal }) {
  const tabs = [
    { id: 'scorecard', label: 'Match Scorecard', icon: Trophy },
    { id: 'radar', label: 'AI Speed Radar', icon: Activity },
    { id: 'upload', label: 'Video Analyzer', icon: Upload },
    { id: 'analytics', label: 'Analytics Hub', icon: BarChart3 },
    { id: 'matches', label: 'Match History', icon: History }
  ];

  return (
    <header style={{
      background: 'rgba(5, 8, 17, 0.85)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      padding: '14px 32px',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }}>
      {/* Brand Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{
          width: '44px',
          height: '44px',
          borderRadius: '14px',
          background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 25px rgba(0, 242, 254, 0.45)'
        }}>
          <Activity size={26} color="#050811" strokeWidth={2.8} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: '900', letterSpacing: '-0.5px' }}>
              CRIC<span className="gradient-text-cyan">SPEED</span>
            </h1>
            <span style={{
              fontSize: '10px',
              fontWeight: '800',
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(0, 242, 254, 0.15)',
              color: '#00f2fe',
              border: '1px solid rgba(0, 242, 254, 0.3)',
              textTransform: 'uppercase'
            }}>
              PRO STUDIO
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', letterSpacing: '0.5px' }}>
            AI Speed Velocity Radar & Live Scorecard
          </span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav style={{
        display: 'flex',
        gap: '6px',
        background: 'rgba(13, 20, 36, 0.6)',
        padding: '6px',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                borderRadius: '12px',
                border: 'none',
                background: isActive ? 'linear-gradient(135deg, rgba(0, 242, 254, 0.2) 0%, rgba(79, 172, 254, 0.15) 100%)' : 'transparent',
                color: isActive ? '#00f2fe' : '#94a3b8',
                fontWeight: isActive ? '800' : '600',
                fontSize: '14px',
                fontFamily: 'var(--font-display)',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                boxShadow: isActive ? '0 0 15px rgba(0, 242, 254, 0.15)' : 'none'
              }}
            >
              <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
              {tab.label}
              {tab.id === 'scorecard' && activeMatch && activeMatch.status === 'LIVE' && (
                <span className="live-dot" style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: '#00e676',
                  boxShadow: '0 0 10px #00e676'
                }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* Action Controls & Badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <button
          onClick={onOpenMatchModal}
          className="btn-action btn-gradient"
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <PlusCircle size={17} /> New Match
        </button>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(0, 230, 118, 0.1)',
          border: '1px solid rgba(0, 230, 118, 0.3)',
          padding: '8px 14px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: '700',
          color: '#00e676'
        }}>
          <Radio size={14} className="live-dot" />
          YOLO RADAR READY
        </div>
      </div>
    </header>
  );
}
