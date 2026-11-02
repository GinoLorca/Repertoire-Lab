// A small cast of cute monster avatars — drawn as SVG from a handful of
// parameters (lib/components/MonsterAvatar.jsx does the drawing) rather than
// shipped as image files, so there's nothing to fetch and it works offline.
// A new player gets one assigned at random but stably (from their id, so it
// doesn't reshuffle every render) and can pick a different one, or upload a
// real photo instead, from the avatar picker.

export const MONSTERS = [
  { id: 'blip', name: 'Blip', body: '#5ec9b3', spot: '#33a487', horn: 'ears', eyes: 2 },
  { id: 'snorf', name: 'Snorf', body: '#f2a65a', spot: '#d9822f', horn: 'horns', eyes: 1 },
  { id: 'puddle', name: 'Puddle', body: '#6fa8f5', spot: '#3b7fe0', horn: 'none', eyes: 2 },
  { id: 'tootle', name: 'Tootle', body: '#f2789a', spot: '#d95277', horn: 'antenna', eyes: 3 },
  { id: 'grumble', name: 'Grumble', body: '#a67cf2', spot: '#7d4fd9', horn: 'horns', eyes: 2 },
  { id: 'wiggle', name: 'Wiggle', body: '#f2d95c', spot: '#d9b93a', horn: 'ears', eyes: 1 },
  { id: 'clonk', name: 'Clonk', body: '#7fd1e8', spot: '#4facc7', horn: 'none', eyes: 3 },
  { id: 'fuzzbucket', name: 'Fuzzbucket', body: '#f28c6b', spot: '#d96540', horn: 'antenna', eyes: 2 },
  { id: 'mossy', name: 'Mossy', body: '#8fd15a', spot: '#63a832', horn: 'horns', eyes: 1 },
  { id: 'pebble', name: 'Pebble', body: '#c2c9d6', spot: '#98a2b3', horn: 'ears', eyes: 2 },
  { id: 'ember', name: 'Ember', body: '#f26b5e', spot: '#d94436', horn: 'antenna', eyes: 3 },
  { id: 'lilypad', name: 'Lilypad', body: '#5ecf9c', spot: '#33ab77', horn: 'none', eyes: 2 },
];

export function monsterFor(id) {
  return MONSTERS.find((m) => m.id === id) ?? MONSTERS[0];
}

// A monster as shapes on a 100×100 grid — [tag, attributes] in SVG's own
// attribute names — a squishy rounded body with the horns/ears peeking out
// from behind it, a couple of spots, blushed cheeks and a smile. Drawn by
// components/MonsterAvatar.jsx and, as an SVG string, by lib/kidArtwork.js.
export function monsterShapes(variant) {
  const m = monsterFor(variant);
  const eyeX = m.eyes === 1 ? [50] : m.eyes === 3 ? [32, 50, 68] : [38, 62];
  const horns = {
    horns: [['path', { d: 'M28 30 18 8 38 22Z', fill: m.spot }], ['path', { d: 'M72 30 82 8 62 22Z', fill: m.spot }]],
    ears: [['circle', { cx: 19, cy: 27, r: 13, fill: m.body }], ['circle', { cx: 81, cy: 27, r: 13, fill: m.body }]],
    antenna: [
      ['line', { x1: 50, y1: 18, x2: 50, y2: 3, stroke: m.spot, 'stroke-width': 4, 'stroke-linecap': 'round' }],
      ['circle', { cx: 50, cy: 3, r: 6, fill: m.spot }],
    ],
  }[m.horn] ?? [];
  return [
    ...horns,
    ['rect', { x: 14, y: 18, width: 72, height: 70, rx: 26, fill: m.body }],
    ['circle', { cx: 26, cy: 70, r: 6, fill: m.spot, opacity: 0.6 }],
    ['circle', { cx: 74, cy: 76, r: 4.5, fill: m.spot, opacity: 0.6 }],
    ['circle', { cx: 70, cy: 58, r: 3.5, fill: m.spot, opacity: 0.5 }],
    ['circle', { cx: 29, cy: 66, r: 6.5, fill: '#fff', opacity: 0.18 }],
    ['circle', { cx: 71, cy: 66, r: 6.5, fill: '#fff', opacity: 0.18 }],
    ...eyeX.flatMap((x) => [
      ['circle', { cx: x, cy: 52, r: 10, fill: '#fff' }],
      ['circle', { cx: x, cy: 53, r: 5, fill: '#20242c' }],
      ['circle', { cx: x + 2, cy: 50, r: 1.6, fill: '#fff' }],
    ]),
    ['path', { d: 'M40 72 Q50 80 60 72', stroke: '#20242c', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }],
  ];
}

// Not cryptographic, just deterministic — the same id always lands on the
// same monster, so a freshly added player doesn't look randomised on the
// next render.
export function defaultMonsterId(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return MONSTERS[h % MONSTERS.length].id;
}
