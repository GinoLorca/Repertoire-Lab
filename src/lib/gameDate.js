// A game's date. Most are just a calendar day: the game editor's date box
// ("2026-11-14") or a PGN Date tag ("2026.11.14"). game.date keeps that day as
// its UTC midnight, which is what new Date('2026-11-14') gives. Read back in
// local time, UTC midnight is still the evening before anywhere west of
// Greenwich, so "Nov 14" showed as "Nov 13" in New York. A day is read and
// shown as a day here; a real moment (Date.now()) is left as it is.

const DAY = 86400000;

// "2026-11-14", "2026.11.14" or "2026/11/14" as { y, m, d }; null for anything
// else, a partial PGN date like "2026.??.??" included.
export function dayParts(s) {
  const hit = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(String(s ?? '').trim());
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

// A date-only string as game.date keeps it (that day's UTC midnight), or NaN.
export function dayMs(s) {
  const p = dayParts(s);
  return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN;
}

// Whether a timestamp is a calendar day rather than a moment: exactly UTC
// midnight. A real clock reading lands on that exact millisecond about never.
export const isDayMs = (ms) => typeof ms === 'number' && Number.isFinite(ms) && ms % DAY === 0;

// A game date (a timestamp or a string) as a moment for anything that shows it
// in local time, Chess Arcade's review included: a calendar day becomes noon,
// local time, on that day. NaN when there's no date in it.
export function localMoment(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return NaN;
    if (!isDayMs(v)) return v;
    const u = new Date(v);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12).getTime();
  }
  const p = dayParts(v);
  if (p) return new Date(p.y, p.m - 1, p.d, 12).getTime();
  // Otherwise only a full timestamp ("2026-11-14T19:30:00Z"): Date.parse
  // reads "2026.??.??" as Jan 1.
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? Date.parse(s) : NaN;
}

const LONG = { year: 'numeric', month: 'short', day: 'numeric' };

// A game date as "Nov 14, 2026" (or as `opts` say), '' when there's none.
export function formatGameDate(v, opts = LONG, locale = undefined) {
  const t = localMoment(v);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(locale, opts) : '';
}

const pad = (n) => String(n).padStart(2, '0');

// A game date as 'YYYY-MM-DD', the day it shows as; null when there's none.
export function isoDay(v) {
  const t = localMoment(v);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Today as 'YYYY-MM-DD' where you are (toISOString() is already tomorrow on a
// New York evening).
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
