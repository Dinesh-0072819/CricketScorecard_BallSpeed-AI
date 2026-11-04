import { useEffect, useRef } from 'react';

/*
 * Draws the AI trajectory overlay (trail, ball marker, bounce marker, speed HUD)
 * on top of the ORIGINAL video in the browser, in sync with playback.
 * Used in fast cloud mode, where the server does not render a processed video.
 */
const TYPE_COLORS = {
  OFF_SPIN: '#ffab00', LEG_SPIN: '#ff1744', INSWING: '#00f2fe', OUTSWING: '#00e676', STRAIGHT: '#94a3b8'
};

export default function TrajectoryOverlay({ videoRef, overlay }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!overlay || !overlay.track) return undefined;
    let raf = 0;
    const pts = overlay.track;
    const tStart = pts.length ? pts[0].t : 0;
    const tEnd = pts.length ? pts[pts.length - 1].t : 0;
    const frameDt = 1.5 / (overlay.fps || 30);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      const parent = canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      const cw = parent.clientWidth;
      const ch = parent.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      // where the picture actually sits inside the <video> box (object-fit: contain)
      const W = overlay.width || video.videoWidth || 1;
      const H = overlay.height || video.videoHeight || 1;
      const vw = video.clientWidth;
      const vh = video.clientHeight;
      const s = Math.min(vw / W, vh / H);
      const ox = video.offsetLeft + (vw - W * s) / 2;
      const oy = video.offsetTop + (vh - H * s) / 2;
      const X = (x) => ox + x * s;
      const Y = (y) => oy + y * s;
      const t = video.currentTime;
      const k = Math.max(0.6, Math.min(W, H) * s / 360);   // size scale for drawing

      if (pts.length && t >= tStart - frameDt && t <= tEnd + 1.5) {
        // trail up to now
        const seen = pts.filter((p) => p.t <= t + 1e-3);
        if (seen.length > 1) {
          ctx.strokeStyle = '#ffff00';
          ctx.lineWidth = 2.5 * k;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(X(seen[0].x), Y(seen[0].y));
          seen.slice(1).forEach((p) => ctx.lineTo(X(p.x), Y(p.y)));
          ctx.stroke();
        }
        // ball marker on the frame it was detected
        const cur = pts.find((p) => Math.abs(p.t - t) <= frameDt);
        if (cur) {
          ctx.strokeStyle = '#00ff66';
          ctx.lineWidth = 2 * k;
          ctx.beginPath();
          ctx.arc(X(cur.x), Y(cur.y), Math.max(7, cur.r * s), 0, Math.PI * 2);
          ctx.stroke();
        }
        // bounce marker
        const b = overlay.bounce;
        if (b && t >= b.t) {
          ctx.strokeStyle = '#ff1744';
          ctx.lineWidth = 2 * k;
          ctx.beginPath();
          ctx.ellipse(X(b.x), Y(b.y), 16 * k, 6 * k, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#ff1744';
          ctx.font = `800 ${Math.round(11 * k)}px sans-serif`;
          ctx.fillText('BOUNCE', X(b.x) + 18 * k, Y(b.y) + 4 * k);
        }
      }

      // speed HUD (top-right of the picture), shown from the release onwards
      const show = pts.length && t >= tStart;
      const bw = 190 * k;
      const bh = 118 * k;
      const hx = ox + W * s - bw - 10 * k;
      const hy = oy + 10 * k;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(hx, hy, bw, bh, 8 * k); else ctx.rect(hx, hy, bw, bh);
      ctx.fill();
      ctx.stroke();
      const noBall = overlay.status === 'NO-BALL';
      const lx = hx + 10 * k;
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(10 * k)}px sans-serif`;
      ctx.fillText('BALL SPEED', lx, hy + 18 * k);
      ctx.fillStyle = noBall ? '#ff1744' : '#00e676';
      ctx.font = `900 ${Math.round(22 * k)}px sans-serif`;
      ctx.fillText(`${show ? overlay.speed.toFixed(1) : '0.0'} km/h`, lx, hy + 45 * k);
      ctx.font = `700 ${Math.round(9 * k)}px sans-serif`;
      ctx.fillText(`LIMIT ${Math.round(overlay.max_speed)} km/h  ${show ? overlay.status : '-'}`, lx, hy + 62 * k);
      ctx.fillStyle = TYPE_COLORS[overlay.delivery_type] || '#ffffff';
      ctx.font = `800 ${Math.round(12 * k)}px sans-serif`;
      ctx.fillText(show ? String(overlay.delivery_type || '').replace('_', ' ') : '-', lx, hy + 82 * k);
      if (show) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.round(9 * k)}px sans-serif`;
        ctx.fillText(`Turn ${Number(overlay.turn_deg || 0).toFixed(1)}°  Swing ${Math.round(overlay.swing_cm || 0)} cm`, lx, hy + 100 * k);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [overlay, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    />
  );
}
