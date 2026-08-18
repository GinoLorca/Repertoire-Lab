import React from 'react';

// Vertical evaluation bar, chess.com style: White fills from the bottom.
// The score is always from White's point of view.
export default function EvalBar({ score, height, running }) {
  const mate = score?.type === 'mate';
  const cp = score ? (mate ? (score.value > 0 ? 1500 : -1500) : score.value) : 0;
  // A gentle curve: small edges move the bar a lot, big ones saturate.
  const pct = score ? 50 + 50 * (2 / (1 + Math.exp(-cp / 320)) - 1) : 50;
  const whitePct = Math.max(3, Math.min(97, pct));
  const label = score
    ? (mate ? `M${Math.abs(score.value)}` : (Math.abs(score.value) / 100).toFixed(1))
    : '–';

  return (
    <div className="eval-bar" style={{ height }} title={running ? 'Engine evaluation' : 'Engine is off'}>
      <div className="eval-bar-black" />
      <div className="eval-bar-white" style={{ height: `${whitePct}%` }} />
      <span className={`eval-bar-label${whitePct > 50 ? ' low' : ' high'}`}>{label}</span>
    </div>
  );
}
