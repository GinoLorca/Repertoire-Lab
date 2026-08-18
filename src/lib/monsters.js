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

// Not cryptographic, just deterministic — the same id always lands on the
// same monster, so a freshly added player doesn't look randomised on the
// next render.
export function defaultMonsterId(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return MONSTERS[h % MONSTERS.length].id;
}
