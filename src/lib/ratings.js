// Live ratings for a player profile.
//
// Chess.com and Lichess publish open APIs that a web page may call directly.
// US Chess doesn't allow that: its old member pages are now behind a bot
// check, and its new ratings API sends no CORS header — so the app asks its
// own small function (netlify/functions/uscf.mjs) to fetch it instead. See
// lib/uscf.js for what "live" means there.
import { normalizeUscf } from './uscf';

async function getJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    if (res.status === 404) throw new Error(body?.error ?? 'US Chess has no member with that ID.');
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// US Chess ratings for a member ID — live (after their latest rated event),
// with the official published figure alongside where it differs.
export async function fetchUscf(id) {
  const clean = String(id ?? '').replace(/\D/g, '');
  if (clean.length < 6) throw new Error('A US Chess ID is 8 digits.');
  try {
    if (import.meta.env?.DEV) {
      // No functions in local development: Vite proxies /uscf-api to US
      // Chess instead (vite.config.js), and the same parser runs here.
      const [member, sections] = await Promise.all([
        getJson(`/uscf-api/${clean}`),
        getJson(`/uscf-api/${clean}/sections`).catch(() => null),
      ]);
      const out = normalizeUscf(member, sections);
      if (!out) throw new Error('US Chess has no member with that ID.');
      return { ...out, via: 'US Chess' };
    }
    return { ...(await getJson(`/.netlify/functions/uscf?id=${clean}`)), via: 'US Chess' };
  } catch (err) {
    throw new Error(`Couldn't get the US Chess rating — ${err.message}`);
  }
}


export async function fetchChesscom(handle) {
  const name = String(handle ?? '').trim().replace(/^@/, '');
  if (!name) throw new Error('No chess.com username.');
  const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(name.toLowerCase())}/stats`);
  if (res.status === 404) throw new Error(`chess.com has no player “${name}”.`);
  if (!res.ok) throw new Error(`chess.com said ${res.status}.`);
  const d = await res.json();
  const at = (key) => d[key]?.last?.rating ?? null;
  return {
    rapid: at('chess_rapid'),
    blitz: at('chess_blitz'),
    bullet: at('chess_bullet'),
    daily: at('chess_daily'),
    fetchedAt: Date.now(),
  };
}

export async function fetchLichess(handle) {
  const name = String(handle ?? '').trim().replace(/^@/, '');
  if (!name) throw new Error('No Lichess username.');
  const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(name)}`);
  if (res.status === 404) throw new Error(`Lichess has no player “${name}”.`);
  if (!res.ok) throw new Error(`Lichess said ${res.status}.`);
  const d = await res.json();
  const at = (key) => (d.perfs?.[key]?.games ? d.perfs[key].rating : null);
  return {
    rapid: at('rapid'),
    blitz: at('blitz'),
    bullet: at('bullet'),
    classical: at('classical'),
    fetchedAt: Date.now(),
  };
}

// How a set of live ratings reads in one line.
export function ratingSummary(ratings) {
  if (!ratings) return null;
  const bits = [];
  const add = (label, value) => { if (value) bits.push(`${label} ${value}`); };
  add('reg', ratings.regular);
  add('quick', ratings.quick);
  add('blitz', ratings.blitz);
  add('rapid', ratings.rapid);
  add('bullet', ratings.bullet);
  return bits.length ? bits.join(' · ') : null;
}

export const ratingAge = (fetchedAt) => {
  if (!fetchedAt) return null;
  const hours = (Date.now() - fetchedAt) / 3600000;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};
