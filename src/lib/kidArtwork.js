import { MONSTERS, monsterShapes, defaultMonsterId } from './monsters';

// A student's opening wears a kid-friendly card, never the coach's own
// artwork: one of the little monsters (lib/monsters.js) on a soft ground,
// with the opening's name in big rounded letters. The monster comes from
// the name, so "Caro-Kann" looks the same for every student.
//
// An SVG data URL in the artwork's usual { medium, small } shape, so every
// place that shows artwork shows this too; `kid: true` says it's generated
// (and redrawn when the opening's renamed). A picture a coach deliberately
// puts on a student's opening is theirs to keep — only copies are replaced.

export const isKidArt = (artwork) => artwork?.kid === true;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// The name in one or two lines, as big as fits.
function titleLines(name) {
  const words = String(name || 'Opening').trim().split(/\s+/);
  if (words.join(' ').length <= 12 || words.length === 1) return [words.join(' ')];
  let best = null;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const w = Math.max(a.length, b.length);
    if (!best || w < best.w) best = { lines: [a, b], w };
  }
  return best.lines;
}

export function kidArtSvg(name) {
  const m = MONSTERS.find((x) => x.id === defaultMonsterId(String(name || '').trim().toLowerCase())) ?? MONSTERS[0];
  const shapes = monsterShapes(m.id)
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`)
    .join('');
  const lines = titleLines(name);
  const longest = Math.max(...lines.map((l) => l.length));
  const size = Math.max(14, Math.min(30, Math.floor(178 / (longest * 0.58))));
  const y0 = lines.length === 1 ? 172 : 160;
  const text = lines.map((l, i) => `<text x="100" y="${y0 + i * (size + 2)}">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">`
    + `<rect width="200" height="200" fill="#fffaf2"/>`
    + `<rect width="200" height="200" fill="${m.body}" opacity="0.32"/>`
    + `<circle cx="28" cy="30" r="9" fill="${m.spot}" opacity="0.28"/>`
    + `<circle cx="172" cy="44" r="6" fill="${m.spot}" opacity="0.28"/>`
    + `<circle cx="160" cy="118" r="4" fill="${m.spot}" opacity="0.25"/>`
    + `<circle cx="36" cy="120" r="5" fill="${m.spot}" opacity="0.25"/>`
    + `<g transform="translate(52 ${lines.length === 1 ? 26 : 18}) scale(0.96)">${shapes}</g>`
    + `<g font-family="ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', Nunito, 'Trebuchet MS', sans-serif" font-weight="800" font-size="${size}" text-anchor="middle" fill="#20242c" stroke="#fffaf2" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${text}</g>`
    + `</svg>`;
}

export function kidArtwork(name) {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(kidArtSvg(name))}`;
  return { medium: url, small: url, kid: true };
}

// Every student opening (ownerId set) wearing a copy of artwork — the
// coach's, carried over — gets its kid card instead, and so does one with
// none; a course's cover, copied, likewise. Yours are left exactly as they
// are. Run once (see store's hydrate).
export function kidArtForStudents(openings) {
  let changed = false;
  const out = openings.map((o) => {
    if ((o.ownerId ?? null) === null) return o;
    const art = isKidArt(o.artwork) ? o.artwork : kidArtwork(o.name);
    const courses = (o.courses ?? []).map((c) => (c.artwork && !isKidArt(c.artwork)
      ? { ...c, artwork: kidArtwork(c.name) } : c));
    if (art === o.artwork && courses.every((c, i) => c === (o.courses ?? [])[i])) return o;
    changed = true;
    return { ...o, artwork: art, ...(o.courses ? { courses } : {}) };
  });
  return changed ? out : openings;
}
