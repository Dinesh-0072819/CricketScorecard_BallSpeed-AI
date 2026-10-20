import React from 'react';

export const DELIVERY_COLORS = {
  OFF_SPIN: {
    bg: 'rgba(255, 171, 0, 0.15)',
    border: '#ffab00',
    text: '#ffab00',
    label: 'OFF SPIN',
    accent: '#ffab00'
  },
  LEG_SPIN: {
    bg: 'rgba(255, 23, 68, 0.15)',
    border: '#ff1744',
    text: '#ff1744',
    label: 'LEG SPIN',
    accent: '#ff1744'
  },
  INSWING: {
    bg: 'rgba(0, 242, 254, 0.15)',
    border: '#00f2fe',
    text: '#00f2fe',
    label: 'INSWING',
    accent: '#00f2fe'
  },
  OUTSWING: {
    bg: 'rgba(0, 230, 118, 0.15)',
    border: '#00e676',
    text: '#00e676',
    label: 'OUTSWING',
    accent: '#00e676'
  },
  STRAIGHT: {
    bg: 'rgba(148, 163, 184, 0.15)',
    border: '#94a3b8',
    text: '#cbd5e1',
    label: 'STRAIGHT',
    accent: '#94a3b8'
  }
};

export function getDeliveryColor(type) {
  if (!type) return DELIVERY_COLORS.STRAIGHT;
  const upper = String(type).toUpperCase().replace(/[\s-]/g, '_');
  return DELIVERY_COLORS[upper] || DELIVERY_COLORS.STRAIGHT;
}

export default function DeliveryTypeBadge({
  type,
  size = 'md',
  showDot = true,
  onClick = null,
  style = {}
}) {
  const color = getDeliveryColor(type);
  const isClickable = Boolean(onClick);

  const sizeStyles = {
    sm: {
      padding: '2px 8px',
      fontSize: '11px',
      dotSize: '6px'
    },
    md: {
      padding: '4px 12px',
      fontSize: '12px',
      dotSize: '8px'
    },
    lg: {
      padding: '6px 16px',
      fontSize: '14px',
      dotSize: '10px'
    }
  };

  const currentSize = sizeStyles[size] || sizeStyles.md;

  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: currentSize.padding,
        borderRadius: '20px',
        background: color.bg,
        border: `1px solid ${color.border}`,
        color: color.text,
        fontSize: currentSize.fontSize,
        fontWeight: '800',
        letterSpacing: '0.4px',
        lineHeight: 1,
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        userSelect: 'none',
        ...style
      }}
    >
      {showDot && (
        <span
          style={{
            width: currentSize.dotSize,
            height: currentSize.dotSize,
            borderRadius: '50%',
            backgroundColor: color.accent,
            boxShadow: `0 0 6px ${color.accent}`
          }}
        />
      )}
      {color.label}
    </span>
  );
}
