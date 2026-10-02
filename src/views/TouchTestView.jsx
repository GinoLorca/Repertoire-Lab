import React, { useEffect, useRef, useState } from 'react';

// A two-minute check of a classroom smart board, before a lesson leans on it.
//
// A board's touch cable reaches an iPad as whatever the board says it is — a
// finger on some, a mouse on others — and on some the point it reports isn't
// quite where the finger is. This page shows which it is, and whether a line
// lands under the finger: drag across the pad, and aim at the dots.
// The telestrator works with any of the three; what matters is the line
// landing where you touch.

const KIND = { touch: 'Finger', mouse: 'Mouse', pen: 'Pen' };
const COLOUR = { touch: '#2ecc71', mouse: '#3b9cff', pen: '#e8b339' };
const DOTS_X = [0.1, 0.3, 0.5, 0.7, 0.9];
const DOTS_Y = [0.15, 0.5, 0.85];

export default function TouchTestView() {
  const padRef = useRef(null);
  const canvasRef = useRef(null);
  const last = useRef(new Map()); // pointerId -> { x, y }
  const [info, setInfo] = useState({
    kind: null, x: null, y: null, pressure: null, now: 0, most: 0, kinds: [],
  });

  // Keep the canvas sharp at the screen's own pixel density.
  useEffect(() => {
    const size = () => {
      const pad = padRef.current;
      const canvas = canvasRef.current;
      if (!pad || !canvas) return;
      const r = pad.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener('resize', size);
    return () => window.removeEventListener('resize', size);
  }, []);

  const local = (e) => {
    const r = padRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const report = (e, p) => setInfo((i) => ({
    ...i,
    kind: e.pointerType,
    x: Math.round(p.x),
    y: Math.round(p.y),
    pressure: e.pressure,
    now: last.current.size,
    most: Math.max(i.most, last.current.size),
    kinds: i.kinds.includes(e.pointerType) ? i.kinds : [...i.kinds, e.pointerType],
  }));

  const onDown = (e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const p = local(e);
    last.current.set(e.pointerId, p);
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = COLOUR[e.pointerType] ?? '#e9ecf2';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    report(e, p);
  };

  const onMove = (e) => {
    const from = last.current.get(e.pointerId);
    const p = local(e);
    if (from) {
      const ctx = canvasRef.current.getContext('2d');
      ctx.strokeStyle = COLOUR[e.pointerType] ?? '#e9ecf2';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current.set(e.pointerId, p);
    }
    report(e, p);
  };

  const onEnd = (e) => {
    last.current.delete(e.pointerId);
    setInfo((i) => ({ ...i, now: last.current.size }));
  };

  const clear = () => {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setInfo({ kind: null, x: null, y: null, pressure: null, now: 0, most: 0, kinds: [] });
  };

  return (
    <div className="page touch-test">
      <div className="page-head">
        <h1>Touch test</h1>
        <button className="small" onClick={clear}>Clear</button>
      </div>
      <p className="hint">
        Checking a smart board before a lesson: drag a finger across the pad below, then tap the
        middle of each dot. If the line lands under your finger and the taps land on the dots, the
        telestrator (the pen in the corner of any board) will draw where you touch. Try two fingers
        at once too — if the board passes both through, a two-finger tap clears the ink.
      </p>

      <div className="touch-stats">
        <span>Comes through as <strong>{info.kind ? KIND[info.kind] ?? info.kind : '—'}</strong></span>
        <span>Fingers now <strong>{info.now}</strong> · most at once <strong>{info.most}</strong></span>
        <span>At <strong>{info.x == null ? '—' : `${info.x}, ${info.y}`}</strong></span>
        <span>Pressure <strong>{info.pressure == null ? '—' : info.pressure.toFixed(2)}</strong></span>
      </div>

      <div
        ref={padRef}
        className="touch-pad"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        {DOTS_Y.map((y) => DOTS_X.map((x) => (
          <span key={`${x}-${y}`} className="touch-dot" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />
        )))}
        <canvas ref={canvasRef} className="touch-canvas" />
      </div>

      <p className="hint touch-legend">
        <span style={{ color: COLOUR.touch }}>●</span> finger
        {' '}<span style={{ color: COLOUR.mouse }}>●</span> mouse
        {' '}<span style={{ color: COLOUR.pen }}>●</span> pen
        {info.kinds.length > 0 && ` — seen so far: ${info.kinds.map((k) => KIND[k] ?? k).join(', ')}`}
      </p>
      <p className="hint">
        Comes through as Mouse? That's fine — the telestrator draws with a mouse too. What matters
        is that the line lands where you touch. If it's off by a steady amount, the board's own
        calibration (in its settings menu) usually fixes it.
      </p>
    </div>
  );
}
