import React, { useState } from 'react';
import { Activity, User, Lock, Eye, EyeOff, LogIn, UserPlus, Gauge, Trophy, History, UserRound, ArrowRight } from 'lucide-react';

/*
 * Login / Create Account / Guest page - matte finish.
 * Same colours as the app (deep navy + cyan accent), but flat surfaces,
 * soft shadows and a fine grain instead of glows and glass. All styles are
 * scoped to this page (cs-auth-*), so nothing else in the app changes.
 */
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const css = `
.cs-auth-page {
  min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px 16px;
  background-color: #070b16;
  background-image: ${GRAIN}, radial-gradient(ellipse at 20% 0%, rgba(0, 242, 254, 0.05) 0%, transparent 55%);
}
.cs-auth-surface {
  background-color: #0d1424;
  background-image: ${GRAIN};
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 22px;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 24px 48px -12px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.35);
}
.cs-auth-tile {
  background: #0a101e; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 14px;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03) inset;
}
.cs-auth-label {
  font-size: 11px; color: #8391a7; display: block; margin-bottom: 8px;
  font-weight: 700; text-transform: uppercase; letter-spacing: 1.1px;
}
.cs-auth-field { position: relative; display: flex; align-items: center; }
.cs-auth-field .cs-auth-icon { position: absolute; left: 15px; color: #5b6a82; pointer-events: none; transition: color .2s; }
.cs-auth-input {
  width: 100%; padding: 13px 16px 13px 46px; font-size: 14px; color: #e8edf5;
  background: #080d19; border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 12px; outline: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.35) inset; transition: border-color .2s, background .2s;
  font-family: var(--font-body);
}
.cs-auth-input::placeholder { color: #4b586d; }
.cs-auth-input:focus { border-color: rgba(0, 242, 254, 0.45); background: #091022; }
.cs-auth-field:focus-within .cs-auth-icon { color: #00f2fe; }
.cs-auth-tabs { display: flex; gap: 4px; padding: 4px; border-radius: 13px; background: #080d19;
  border: 1px solid rgba(255, 255, 255, 0.06); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.35) inset; margin-bottom: 28px; }
.cs-auth-tab { flex: 1; padding: 11px; border-radius: 10px; cursor: pointer; border: 1px solid transparent;
  display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14px; font-weight: 700;
  background: transparent; color: #7d8aa0; transition: all .2s; font-family: var(--font-display); }
.cs-auth-tab:hover { color: #c8d2e0; }
.cs-auth-tab.active { background: #141d31; color: #00f2fe; border-color: rgba(255, 255, 255, 0.06);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 2px 6px rgba(0, 0, 0, 0.4); }
.cs-auth-primary { width: 100%; padding: 15px; border: none; border-radius: 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 9px;
  font-size: 15px; font-weight: 800; color: #05121a; background: #00d9e4;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.35) inset, 0 6px 16px -6px rgba(0, 0, 0, 0.7);
  transition: background .2s, transform .1s; font-family: var(--font-display); }
.cs-auth-primary:hover { background: #00f2fe; }
.cs-auth-primary:active { transform: translateY(1px); }
.cs-auth-primary:disabled { opacity: .65; cursor: default; }
.cs-auth-guest { width: 100%; padding: 14px; border-radius: 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 9px;
  font-size: 14px; font-weight: 700; color: #c8d2e0; background: #111a2c;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 4px 10px -6px rgba(0, 0, 0, 0.6);
  transition: all .2s; font-family: var(--font-display); }
.cs-auth-guest:hover { color: #00f2fe; border-color: rgba(0, 242, 254, 0.3); background: #131e33; }
.cs-auth-guest:disabled { opacity: .65; cursor: default; }
.cs-auth-divider { display: flex; align-items: center; gap: 12px; margin: 22px 0; color: #4b586d;
  font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; }
.cs-auth-divider::before, .cs-auth-divider::after { content: ''; flex: 1; height: 1px; background: rgba(255, 255, 255, 0.06); }
.cs-auth-link { background: none; border: none; color: #00f2fe; font-weight: 700; cursor: pointer; font-size: 13px; padding: 0; }
.cs-auth-link:hover { text-decoration: underline; }
.cs-auth-error { color: #ff6b81; font-size: 13px; font-weight: 600; margin-bottom: 16px; padding: 11px 14px;
  border-radius: 10px; background: #1a0f18; border: 1px solid rgba(255, 23, 68, 0.25); }
`;

export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login');          // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';

  const switchMode = (m) => {
    setMode(m);
    setError('');
    setPassword('');
    setConfirm('');
  };

  const post = async (url, body) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        setError(data.message || 'Something went wrong');
      } else {
        onAuthenticated(data.user);
      }
    } catch (err) {
      setError('Cannot reach the server. Is it running?');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isRegister && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    post(isRegister ? '/api/auth/register' : '/api/auth/login', { username: username.trim(), password });
  };

  const features = [
    { icon: Gauge, title: 'AI Ball Speed', text: 'Speed, swing & spin from any phone video' },
    { icon: Trophy, title: 'Live Scorecard', text: 'Ball-by-ball scoring with targets & chases' },
    { icon: History, title: 'Your History', text: 'Every match and delivery saved to your account' }
  ];

  return (
    <div className="cs-auth-page">
      <style>{css}</style>
      <div style={{
        width: '980px', maxWidth: '100%', display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '36px', alignItems: 'center'
      }}>
        {/* Brand side */}
        <div style={{ padding: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '34px' }}>
            <div style={{
              width: '58px', height: '58px', borderRadius: '17px', background: '#00d9e4',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 1px 0 rgba(255,255,255,0.35) inset, 0 10px 24px -8px rgba(0,0,0,0.8)'
            }}>
              <Activity size={32} color="#05121a" strokeWidth={2.8} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h1 style={{ fontSize: '30px', fontWeight: '900', letterSpacing: '-0.5px' }}>
                  CRIC<span style={{ color: '#00f2fe' }}>SPEED</span>
                </h1>
                <span style={{
                  fontSize: '10px', fontWeight: '800', padding: '3px 8px', borderRadius: '6px',
                  background: '#111a2c', color: '#00f2fe', border: '1px solid rgba(255, 255, 255, 0.08)'
                }}>PRO STUDIO</span>
              </div>
              <span style={{ fontSize: '13px', color: '#8391a7', fontWeight: '600' }}>AI Speed Velocity Radar & Live Scorecard</span>
            </div>
          </div>

          <h2 style={{ fontSize: '32px', fontWeight: '900', lineHeight: 1.2, marginBottom: '12px', color: '#eef2f8' }}>
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h2>
          <p style={{ color: '#8391a7', fontSize: '15px', lineHeight: 1.65, marginBottom: '30px', maxWidth: '440px' }}>
            {isRegister
              ? 'Your matches, scorecards and ball-speed history stay private to your account.'
              : 'Log in to continue scoring matches and tracking ball speed — or jump straight in as a guest.'}
          </p>

          <div style={{ display: 'grid', gap: '10px' }}>
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="cs-auth-tile" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px' }}>
                <div style={{
                  width: '38px', height: '38px', borderRadius: '11px', flexShrink: 0, background: '#111a2c',
                  border: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Icon size={18} color="#00f2fe" />
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: '#e8edf5' }}>{title}</div>
                  <div style={{ fontSize: '12px', color: '#7d8aa0' }}>{text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Form card */}
        <div className="cs-auth-surface" style={{ padding: '36px' }}>
          <div className="cs-auth-tabs">
            {[['login', 'Log In', LogIn], ['register', 'Create Account', UserPlus]].map(([m, label, Icon]) => (
              <button key={m} type="button" onClick={() => switchMode(m)} className={`cs-auth-tab${mode === m ? ' active' : ''}`}>
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '18px' }}>
              <label className="cs-auth-label">Username</label>
              <div className="cs-auth-field">
                <User size={18} className="cs-auth-icon" />
                <input
                  type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="cs-auth-input"
                  placeholder="e.g. dinesh_07" autoComplete="username" required autoFocus
                />
              </div>
              {isRegister && (
                <div style={{ fontSize: '11px', color: '#5b6a82', marginTop: '6px' }}>3–30 characters: letters, numbers, _ . -</div>
              )}
            </div>

            <div style={{ marginBottom: isRegister ? '18px' : '24px' }}>
              <label className="cs-auth-label">Password</label>
              <div className="cs-auth-field">
                <Lock size={18} className="cs-auth-icon" />
                <input
                  type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="cs-auth-input" style={{ paddingRight: '46px' }}
                  placeholder={isRegister ? 'At least 6 characters' : 'Your password'}
                  autoComplete={isRegister ? 'new-password' : 'current-password'} required
                />
                <button type="button" onClick={() => setShowPw(!showPw)} aria-label="Show password" style={{
                  position: 'absolute', right: '13px', background: 'none', border: 'none', color: '#5b6a82', cursor: 'pointer', display: 'flex'
                }}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {isRegister && (
              <div style={{ marginBottom: '24px' }}>
                <label className="cs-auth-label">Confirm Password</label>
                <div className="cs-auth-field">
                  <Lock size={18} className="cs-auth-icon" />
                  <input
                    type={showPw ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                    className="cs-auth-input" placeholder="Type the password again" autoComplete="new-password" required
                  />
                </div>
              </div>
            )}

            {error && <div className="cs-auth-error">{error}</div>}

            <button type="submit" disabled={busy} className="cs-auth-primary">
              {isRegister ? <UserPlus size={18} /> : <LogIn size={18} />}
              {busy ? 'Please wait…' : isRegister ? 'Create Account' : 'Log In'}
            </button>
          </form>

          <div className="cs-auth-divider">or</div>

          <button type="button" disabled={busy} onClick={() => post('/api/auth/guest')} className="cs-auth-guest">
            <UserRound size={18} /> Continue as Guest <ArrowRight size={16} />
          </button>
          <p style={{ textAlign: 'center', fontSize: '12px', color: '#5b6a82', marginTop: '10px', lineHeight: 1.5 }}>
            You'll get a guest ID. Your matches & speeds are kept while you stay logged in on this browser.
          </p>

          <p style={{ textAlign: 'center', fontSize: '13px', color: '#7d8aa0', marginTop: '18px' }}>
            {isRegister ? 'Already have an account? ' : "Don't have an account? "}
            <button type="button" onClick={() => switchMode(isRegister ? 'login' : 'register')} className="cs-auth-link">
              {isRegister ? 'Log in' : 'Create one'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
