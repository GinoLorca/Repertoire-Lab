import React from 'react';
import { monsterFor, monsterShapes } from '../lib/monsters';

// One of the preset cast (lib/monsters.js), drawn from its shapes there.
// Deliberately simple shapes so it stays legible at 24px.
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export default function MonsterAvatar({ variant, size = 40, className }) {
  const m = monsterFor(variant);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${m.name} the monster`}
    >
      {monsterShapes(variant).map(([Tag, attrs], i) => (
        // eslint-disable-next-line react/no-array-index-key
        <Tag key={i} {...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [camel(k), v]))} />
      ))}
    </svg>
  );
}
