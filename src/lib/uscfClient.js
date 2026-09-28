// Fetching a member's US Chess history for the dashboard, and keeping it.
//
// In production the app asks its own function (netlify/functions/
// uscf-history.mjs); in development the Vite server proxies the API
// (/uscf-root) and the same shaping runs here. Either way the result is
// lib/uscfHistory.js's.
//
// Kept on the device (IndexedDB, its own store — not the synced library):
// the history, so the dashboard opens at once and works offline, and each
// section's crosstable — fetched again only when US Chess re-rates the
// section (it does: late events cascade, corrections), which shows as the
// member's before/after ratings for it moving in the history. Nothing here
// goes into the player's synced record: a long history would crowd the one
// document a player's games live in.
import { createStore, get, set } from 'idb-keyval';
import { loadHistory, loadStandings, validMemberId } from './uscfHistory';

let store = null;
const cache = () => {
  if (!store && typeof indexedDB !== 'undefined') store = createStore('repertoire-lab-uscf', 'cache');
  return store;
};
const cacheGet = async (key) => { try { return cache() ? await get(key, cache()) : undefined; } catch { return undefined; } };
const cacheSet = async (key, value) => { try { if (cache()) await set(key, value, cache()); } catch { /* storage full or blocked */ } };

const DEV = Boolean(import.meta.env?.DEV);

async function getJson(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = new Error(body?.error ?? (res.status === 429 ? 'US Chess is busy — try again in a minute' : `HTTP ${res.status}`));
      err.status = res.status;
      err.retryAfter = Number(res.headers.get('retry-after')) || null;
      throw err;
    }
    // A page that isn't JSON (a deploy without the function) isn't an answer.
    if (body == null) throw new Error('No answer from US Chess.');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// Straight to the API through the dev server's proxy.
const devGetJson = (path) => getJson(`/uscf-root${path}`);

export async function fetchHistory(id, { fresh = false } = {}) {
  if (!validMemberId(id)) throw new Error('A US Chess ID is 8 digits.');
  let history;
  if (DEV) history = await loadHistory(devGetJson, id);
  else {
    const bust = fresh ? `&t=${Date.now()}` : '';
    history = await getJson(`/.netlify/functions/uscf-history?id=${id}${bust}`);
  }
  if (!history?.id) throw new Error('US Chess has no member with that ID.');
  await cacheSet(`history:${id}`, history);
  return history;
}

export const cachedHistory = (id) => cacheGet(`history:${id}`);

// What a section's rating looked like when its crosstable was kept.
export const sectionStamp = (section) => JSON.stringify(section?.records ?? {});
const hash = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

// Crosstables for these sections (history sections, newest first): the kept
// ones still current, and the rest fetched a few at a time.
//
// US Chess limits how fast its API is asked (a rule in front of it, with no
// numbers published), and a long record is a hundred-odd requests. So:
// small batches, a short pause between them, and when a batch is turned
// away, a longer one — 15 s, then 30, then 60 — before asking for what was
// missed again, up to three times. What arrives is kept, so a record is only
// ever fetched in full once.
//
// `onBatch(partial)` hears each batch as it lands; `stop()` ends early (the
// page went away). Returns { standings, failed } — failed: keys still
// missing after every try.
const BATCH = 6;
const wait = (ms, stop) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => (stop?.() || Date.now() - t0 >= ms ? resolve() : setTimeout(tick, 250));
  tick();
});

async function fetchBatch(id, batch) {
  const keys = batch.map((s) => s.key);
  if (DEV) return loadStandings(devGetJson, id, keys);
  // The ratings in the URL too, so a copy cached before a re-rating is
  // never the one served.
  const v = hash(batch.map(sectionStamp).join('|'));
  return (await getJson(`/.netlify/functions/uscf-history?id=${id}&xt=${keys.join(',')}&v=${v}`))?.standings ?? {};
}

export async function fetchStandings(id, sections, { onBatch, stop } = {}) {
  const out = {};
  let queue = [];
  for (const s of sections) {
    const kept = await cacheGet(`xt:${id}:${s.key}`);
    if (kept?.standing && kept.stamp === sectionStamp(s)) out[s.key] = kept.standing;
    else queue.push(s);
  }
  if (Object.keys(out).length) onBatch?.({ ...out });
  const tries = {};
  const failed = [];
  let cooldown = 15000;
  while (queue.length && !stop?.()) {
    const batch = queue.slice(0, BATCH);
    queue = queue.slice(BATCH);
    let got = {};
    try { got = await fetchBatch(id, batch); } catch { got = {}; }
    const missed = [];
    for (const s of batch) {
      if (got[s.key]) {
        out[s.key] = got[s.key];
        await cacheSet(`xt:${id}:${s.key}`, { stamp: sectionStamp(s), standing: got[s.key] });
      } else if (!(s.key in got)) {
        tries[s.key] = (tries[s.key] ?? 0) + 1;
        if (tries[s.key] < 3) missed.push(s); else failed.push(s.key);
      }
    }
    onBatch?.({ ...out });
    if (missed.length) {
      // Turned away: back off, then these first.
      queue = [...missed, ...queue];
      await wait(cooldown, stop);
      cooldown = Math.min(60000, cooldown * 2);
    } else if (queue.length) {
      await wait(900, stop);
    }
  }
  return { standings: out, failed };
}
