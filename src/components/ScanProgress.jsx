import React from 'react';

// A ring that fills while a photo is being read.
//
// The model doesn't report progress, so this is an honest estimate rather than
// a measurement: it eases towards a typical duration and holds near the end
// instead of pretending to finish. The elapsed seconds are shown inside, so
// there's always a real number to look at.
export default function ScanProgress({ startedAt, expectedMs = 90000, size = 54, label, phase, chars = 0 }) {
  const elapsed = Math.max(0, Date.now() - (startedAt ?? Date.now()));
  // Two halves: the wait while it reads the sheet, estimated from the clock,
  // then the part where the answer is actually streaming back, which is real
  // and measurable. A game's worth of notation is roughly 300 characters.
  const waiting = 0.6 * (1 - Math.exp(-elapsed / (expectedMs * 0.5)));
  const fraction = phase === 'writing'
    ? Math.min(0.98, 0.6 + 0.38 * Math.min(1, chars / 300))
    : waiting;
  const seconds = Math.round(elapsed / 1000);

  const r = (size - 7) / 2;
  const c = 2 * Math.PI * r;

  return (
    <span className="scan-progress" title={label || 'Reading the photo'}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="scan-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="scan-fill"
          strokeDasharray={`${c * fraction} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="scan-label">{seconds}s</span>
    </span>
  );
}
