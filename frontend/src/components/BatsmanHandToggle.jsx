import React, { useEffect } from 'react';
import { UserCheck } from 'lucide-react';

const STORAGE_KEY = 'cricspeed_batsman_hand';

export default function BatsmanHandToggle({
  value = 'RIGHT',
  onChange,
  compact = false,
  style = {}
}) {
  // Sync with localStorage on mount if no value provided
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && (saved === 'RIGHT' || saved === 'LEFT')) {
        if (saved !== value && onChange) {
          onChange(saved);
        }
      }
    } catch (e) {
      // localStorage may fail in private mode
    }
  }, []);

  const handleSelect = (hand) => {
    try {
      localStorage.setItem(STORAGE_KEY, hand);
    } catch (e) {}
    if (onChange) {
      onChange(hand);
    }
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: 'rgba(13, 20, 36, 0.85)',
        border: '1px solid rgba(0, 242, 254, 0.25)',
        borderRadius: '12px',
        padding: compact ? '2px' : '4px',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
        ...style
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: compact ? '4px 8px' : '6px 12px',
          color: '#94a3b8',
          fontSize: compact ? '11px' : '12px',
          fontWeight: '700',
          letterSpacing: '0.5px',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          marginRight: '2px'
        }}
      >
        <UserCheck size={compact ? 13 : 15} color="#00f2fe" />
        <span>BAT</span>
      </div>

      <button
        type="button"
        onClick={() => handleSelect('RIGHT')}
        style={{
          border: 'none',
          outline: 'none',
          cursor: 'pointer',
          padding: compact ? '5px 10px' : '7px 14px',
          borderRadius: '8px',
          fontSize: compact ? '11px' : '12px',
          fontWeight: '800',
          letterSpacing: '0.5px',
          minHeight: compact ? '32px' : '38px',
          minWidth: compact ? '48px' : '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          background: value === 'RIGHT' ? 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)' : 'transparent',
          color: value === 'RIGHT' ? '#050811' : '#94a3b8',
          boxShadow: value === 'RIGHT' ? '0 0 12px rgba(0, 242, 254, 0.45)' : 'none'
        }}
        title="Right-Handed Batsman"
      >
        RHB
      </button>

      <button
        type="button"
        onClick={() => handleSelect('LEFT')}
        style={{
          border: 'none',
          outline: 'none',
          cursor: 'pointer',
          padding: compact ? '5px 10px' : '7px 14px',
          borderRadius: '8px',
          fontSize: compact ? '11px' : '12px',
          fontWeight: '800',
          letterSpacing: '0.5px',
          minHeight: compact ? '32px' : '38px',
          minWidth: compact ? '48px' : '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          background: value === 'LEFT' ? 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)' : 'transparent',
          color: value === 'LEFT' ? '#050811' : '#94a3b8',
          boxShadow: value === 'LEFT' ? '0 0 12px rgba(0, 242, 254, 0.45)' : 'none'
        }}
        title="Left-Handed Batsman"
      >
        LHB
      </button>
    </div>
  );
}
