import React from 'react';
import { Activity, Trophy, Upload, BarChart3, Radio, PlusCircle, History } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, liveCameraRunning, activeMatch, onOpenMatchModal }) {
  const tabs = [
    { id: 'scorecard', label: 'Scorecard', icon: Trophy },
    { id: 'radar', label: 'AI Radar', icon: Activity },
    { id: 'upload', label: 'Analyzer', icon: Upload },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'history', label: 'History', icon: History }
  ];

  return (
    <header style={{
      background: 'rgba(5, 8, 17, 0.92)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      padding: '10px 16px',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }}>
      {/* Top Row: Brand & Quick Action Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(0, 242, 254, 0.45)'
          }}>
            <Activity size={20} color="#050811" strokeWidth={2.8} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <h1 style={{ fontSize: '18px', fontWeight: '900', letterSpacing: '-0.5px' }}>
                CRIC<span className="gradient-text-cyan">SPEED</span>
              </h1>
              <span style={{
                fontSize: '9px',
                fontWeight: '800',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(0, 242, 254, 0.15)',
                color: '#00f2fe',
                border: '1px solid rgba(0, 242, 254, 0.3)',
                textTransform: 'uppercase'
              }}>
                PRO
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onOpenMatchModal}
            className="btn-action btn-gradient"
            style={{
              padding: '8px 14px',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '10px'
            }}
          >
            <PlusCircle size={15} /> New Match
          </button>
        </div>
      </div>

      {/* Bottom Row: Horizontally Scrollable Touch Navigation Tabs */}
      <nav className="no-scrollbar" style={{
        display: 'flex',
        gap: '6px',
        background: 'rgba(13, 20, 36, 0.7)',
        padding: '4px',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch'
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
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                background: isActive ? 'linear-gradient(135deg, rgba(0, 242, 254, 0.2) 0%, rgba(79, 172, 254, 0.15) 100%)' : 'transparent',
                color: isActive ? '#00f2fe' : '#94a3b8',
                fontWeight: isActive ? '800' : '600',
                fontSize: '13px',
                fontFamily: 'var(--font-display)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
              }}
            >
              <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
              {tab.label}
              {tab.id === 'scorecard' && activeMatch && activeMatch.status === 'LIVE' && (
                <span className="live-dot" style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#00e676',
                  boxShadow: '0 0 8px #00e676'
                }} />
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
