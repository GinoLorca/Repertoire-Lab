import React from 'react';
import { monsterFor } from '../lib/monsters';

// One of the preset cast (lib/monsters.js), drawn from a body colour, a
// horn/ear style and an eye count — a squishy rounded body with the
// horns/ears peeking out from behind it, a couple of spots, blushed cheeks
// and a smile. Deliberately simple shapes so it stays legible at 24px.
export default function MonsterAvatar({ variant, size = 40, className }) {
  const m = monsterFor(variant);
  const eyeX = m.eyes === 1 ? [50] : m.eyes === 3 ? [32, 50, 68] : [38, 62];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${m.name} the monster`}
    >
      {m.horn === 'horns' && (
        <>
          <path d="M28 30 18 8 38 22Z" fill={m.spot} />
          <path d="M72 30 82 8 62 22Z" fill={m.spot} />
        </>
      )}
      {m.horn === 'ears' && (
        <>
          <circle cx="19" cy="27" r="13" fill={m.body} />
          <circle cx="81" cy="27" r="13" fill={m.body} />
        </>
      )}
      {m.horn === 'antenna' && (
        <>
          <line x1="50" y1="18" x2="50" y2="3" stroke={m.spot} strokeWidth="4" strokeLinecap="round" />
          <circle cx="50" cy="3" r="6" fill={m.spot} />
        </>
      )}

      <rect x="14" y="18" width="72" height="70" rx="26" fill={m.body} />

      <circle cx="26" cy="70" r="6" fill={m.spot} opacity="0.6" />
      <circle cx="74" cy="76" r="4.5" fill={m.spot} opacity="0.6" />
      <circle cx="70" cy="58" r="3.5" fill={m.spot} opacity="0.5" />

      <circle cx="29" cy="66" r="6.5" fill="#fff" opacity="0.18" />
      <circle cx="71" cy="66" r="6.5" fill="#fff" opacity="0.18" />

      {eyeX.map((x) => (
        <g key={x}>
          <circle cx={x} cy="52" r="10" fill="#fff" />
          <circle cx={x} cy="53" r="5" fill="#20242c" />
          <circle cx={x + 2} cy="50" r="1.6" fill="#fff" />
        </g>
      ))}

      <path d="M40 72 Q50 80 60 72" stroke="#20242c" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
