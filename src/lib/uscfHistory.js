// A US Chess member's rated history, from the ratings API behind
// ratings.uschess.org: every rated section they've played (with the rating
// before and after it), the monthly rating lists, and — section by section —
// the crosstable: who they played in each round, with which colour, and what
// happened.
//
// The API answers anyone but sends no CORS header, so a page can't call it:
// netlify/functions/uscf-history.mjs does, in production, and the Vite dev
// server proxies it (vite.config.js). Both hand the raw answers to the pure
// functions here, which is also what the tests exercise.

import { tidyName } from './uscf';

export const USCF_ROOT = 'https://ratings-api.uschess.org/api/v1';

export const SYSTEMS = ['R', 'Q', 'B', 'OR', 'OQ', 'OB'];
export const SYSTEM_NAME = {
  R: 'Regular', Q: 'Quick', B: 'Blitz', OR: 'Online regular', OQ: 'Online quick', OB: 'Online blitz',
};

const num = (v) => (Number.isFinite(v) ? v : (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null));

// A member ID is digits; an event ID twelve of them (every one seen so far —
// allowed a little either way); a section a small number.
export const validMemberId = (id) => /^\d{6,10}$/.test(String(id ?? ''));
export const validEventId = (id) => /^\d{8,14}$/.test(String(id ?? ''));
export const validSection = (n) => /^\d{1,3}$/.test(String(n ?? ''));

// A name as typed, made searchable: accents composed (a separately typed
// accent is its own character otherwise), and US Chess's own "CRAWFORD,
// ELLIOTT" — pasted from a crosstable — turned round to "ELLIOTT CRAWFORD".
export function tidySearch(q) {
  let t = String(q ?? '').normalize('NFC').trim();
  const lastFirst = t.match(/^([^,]+),\s*([^,]+)$/);
  if (lastFirst) t = `${lastFirst[2]} ${lastFirst[1]}`;
  return t.replace(/\s+/g, ' ').trim();
}
export const SEARCH_HELP = 'Search by a US Chess ID, or a name — letters, spaces, hyphens and apostrophes.';

// A name to look someone up by: letters (any language, with their accents),
// spaces and the punctuation names carry — nothing that could steer the
// request elsewhere.
export const validSearch = (q) => /^[\p{L}][\p{L}\p{M}\s.'’-]{1,59}$/u.test(tidySearch(q));

// "202609070223:5" — one rated section of one event.
export const sectionKey = (eventId, section) => `${eventId}:${section}`;
export function parseSectionKey(key) {
  const [eventId, section] = String(key ?? '').split(':');
  return validEventId(eventId) && validSection(section) ? { eventId, section: Number(section) } : null;
}

// ---------- Profile, sections and lists ----------

// `member`: /members/{id}; `sections`: every item of /members/{id}/sections;
// `lists`: the items of /members/{id}/rating-supplements (monthly lists).
export function normalizeHistory(member, sections = [], lists = []) {
  if (!member?.id) return null;
  const ratings = {};
  for (const r of member.ratings ?? []) {
    if (!SYSTEMS.includes(r.ratingSystem)) continue;
    const official = num(r.rating);
    if (official == null && !r.gamesPlayed) continue;
    ratings[r.ratingSystem] = {
      official,
      games: num(r.gamesPlayed),
      provisional: Boolean(r.isProvisional),
      floor: num(r.floor),
    };
  }
  const first = tidyName(member.firstName);
  const last = tidyName(member.lastName);
  const out = {
    id: String(member.id),
    name: [first, last].filter(Boolean).join(' ') || null,
    // Middle names ride in the first-name field ("PARKER RECKHOW").
    shortName: [first.split(' ')[0], last].filter(Boolean).join(' ') || null,
    state: member.stateRep ?? member.jurisdiction ?? null,
    status: member.status ?? null,
    expires: member.expirationDate ?? null,
    rank: num(member.rank),
    stateRank: num(member.stateRank),
    ratings,
    sections: sections.map(normalizeSection).filter(Boolean)
      .sort((a, b) => String(b.end ?? '').localeCompare(String(a.end ?? ''))
        || String(b.start ?? '').localeCompare(String(a.start ?? ''))
        || b.eventId.localeCompare(a.eventId) || b.section - a.section),
    lists: (lists ?? []).map((l) => ({
      date: l.ratingSupplementDate ?? null,
      ratings: Object.fromEntries((l.ratings ?? [])
        .filter((r) => SYSTEMS.includes(r.source) && num(r.rating) != null)
        .map((r) => [r.source, { rating: num(r.rating), provisionalGames: num(r.provisionalGameCount) }])),
    })).filter((l) => l.date).sort((a, b) => b.date.localeCompare(a.date)),
    fetchedAt: Date.now(),
  };
  return out;
}

function normalizeSection(s) {
  const eventId = String(s?.event?.id ?? '');
  if (!validEventId(eventId) || !validSection(s.sectionNumber)) return null;
  const records = {};
  for (const r of s.ratingRecords ?? []) {
    if (!SYSTEMS.includes(r.ratingSource)) continue;
    records[r.ratingSource] = {
      pre: num(r.preRating),
      post: num(r.postRating),
      // The decimals US Chess actually rates from (634.81, shown as 635).
      preExact: num(r.preRatingDecimal),
      postExact: num(r.postRatingDecimal),
      provisionalGames: num(r.postProvisionalGameCount),
    };
  }
  return {
    key: sectionKey(eventId, s.sectionNumber),
    eventId,
    eventName: String(s.event?.name ?? '').trim(),
    state: s.event?.stateCode ?? null,
    section: Number(s.sectionNumber),
    sectionName: String(s.sectionName ?? '').trim(),
    start: s.startDate ?? s.event?.startDate ?? null,
    end: s.endDate ?? s.event?.endDate ?? null,
    // 'R', 'Q', 'B', … or 'D' for a section rated in two systems at once.
    system: s.ratingSystem ?? null,
    format: s.format ?? null,
    records,
  };
}

// The system a section's games count in first: Regular for a dual-rated
// section, otherwise whichever it was rated in.
export function mainSystem(section) {
  const has = Object.keys(section?.records ?? {});
  for (const s of SYSTEMS) if (has.includes(s)) return s;
  return section?.system && section.system !== 'D' ? section.system : 'R';
}

// The member's rating path in one system, oldest first:
// [{ key, date, eventName, pre, post, change }].
export function ratingSeries(history, system) {
  return (history?.sections ?? [])
    .filter((s) => s.records[system]?.post != null)
    .map((s) => {
      const r = s.records[system];
      return {
        key: s.key,
        date: s.end,
        eventName: s.eventName,
        sectionName: s.sectionName,
        pre: r.pre,
        post: r.post,
        change: r.pre != null ? r.post - r.pre : null,
      };
    })
    .reverse();
}

// Where each system stands: { R: { live, liveDate, liveEvent, change, official,
// next, nextDate, peak, peakDate, games, provisional, provisionalGames, floor } }.
// `live` is the rating after the newest event; `official` the published list
// figure (which trails it); `next` a list already published for a later
// month than `today`.
export function standing(history, today = new Date().toISOString().slice(0, 10)) {
  const out = {};
  const systems = new Set([
    ...Object.keys(history?.ratings ?? {}),
    ...(history?.sections ?? []).flatMap((s) => Object.keys(s.records)),
  ]);
  for (const sys of SYSTEMS) {
    if (!systems.has(sys)) continue;
    const series = ratingSeries(history, sys);
    const latest = series[series.length - 1] ?? null;
    let peak = null;
    for (const p of series) if (p.post != null && (!peak || p.post > peak.post)) peak = p;
    const nextList = (history?.lists ?? []).find((l) => l.date > today && l.ratings[sys]);
    const official = history?.ratings?.[sys] ?? {};
    const live = latest?.post ?? official.official ?? null;
    if (live == null && official.official == null) continue;
    const latestRecord = latest ? history.sections.find((x) => x.key === latest.key)?.records[sys] : null;
    out[sys] = {
      live,
      liveExact: latestRecord?.postExact ?? live,
      liveDate: latest?.date ?? null,
      liveEvent: latest?.eventName ?? null,
      change: latest?.change ?? null,
      official: official.official ?? null,
      next: nextList?.ratings[sys].rating ?? null,
      nextDate: nextList?.date ?? null,
      peak: peak?.post ?? live,
      peakDate: peak?.date ?? null,
      games: official.games ?? null,
      provisional: Boolean(official.provisional),
      provisionalGames: latest ? (history.sections.find((s) => s.key === latest.key)?.records[sys]?.provisionalGames ?? null) : null,
      floor: official.floor ?? null,
    };
  }
  return out;
}

// The same summary the card's profile keeps (lib/uscf.js normalizeUscf):
// live rating per system, the official figure where it differs, the latest
// event — so a dashboard that has just fetched can bring the card up to date.
const SUMMARY_KEY = {
  R: 'regular', Q: 'quick', B: 'blitz', OR: 'onlineRegular', OQ: 'onlineQuick', OB: 'onlineBlitz',
};
export function ratingSummary(history, today) {
  if (!history?.id) return null;
  const w = standing(history, today);
  const newest = history.sections?.[0];
  const out = {
    id: history.id,
    name: history.name,
    shortName: history.shortName,
    expires: history.expires,
    status: history.status,
    lastEvent: newest ? { name: newest.eventName, date: newest.end } : null,
    fetchedAt: history.fetchedAt,
    via: 'US Chess',
  };
  for (const [code, key] of Object.entries(SUMMARY_KEY)) {
    const s = w[code];
    out[key] = s?.live ?? null;
    if (s?.official != null && s.live != null && s.official !== s.live) out[`${key}Official`] = s.official;
  }
  return out;
}

// ---------- A section's crosstable, as one member saw it ----------

// Round outcomes, from the member's side, as short codes:
//   W L D     a game won, lost, drawn
//   FW FL     a forfeit win or loss (no game was played)
//   BF BH     a full- or half-point bye
//   U         unpaired (no game, no point)
export function outcomeCode(outcome) {
  const o = String(outcome ?? '').replace(/[\s_-]/g, '').toLowerCase();
  if (o === 'win') return 'W';
  if (o === 'loss') return 'L';
  if (o === 'draw') return 'D';
  // The API writes a forfeit win as 'WinForfeit' and a forfeit loss as a
  // bare 'Forfeit' (worth nothing, by the crosstable's own scores).
  if (o === 'winforfeit' || o === 'forfeitwin') return 'FW';
  if (o.includes('forfeit')) return 'FL';
  if (o === 'byefull' || o === 'bye') return 'BF';
  if (o === 'byehalf') return 'BH';
  if (o === 'byezero' || o === 'unpaired') return 'U';
  return '?';
}
export const PLAYED = new Set(['W', 'L', 'D']);
export const POINTS = { W: 1, D: 0.5, L: 0, FW: 1, FL: 0, BF: 1, BH: 0.5, U: 0, '?': 0 };

const colourOf = (c) => (/^w/i.test(c ?? '') ? 'white' : /^b/i.test(c ?? '') ? 'black' : null);

// `items`: every row of /rated-events/{id}/sections/{n}/standings; `detail`:
// /rated-events/{id}/sections/{n}. Only this member's row comes back, each
// round joined to the opponent's row for their name and rating — nobody
// else's results are kept.
export function normalizeStanding(items, memberId, detail = null, system = null) {
  const rows = items ?? [];
  const me = rows.find((r) => String(r.memberId) === String(memberId));
  if (!me) return null;
  const byPlayer = new Map(rows.map((r) => [r.playerId, r]));
  // Everyone's ratings in the one system the section counts in first: a
  // dual-rated section lists Regular and Quick in either order, row by row,
  // so Regular is chosen by name — never whichever happens to come first.
  const mine = new Set((me.ratings ?? []).map((x) => x.ratingSystem));
  const sys = system
    ?? (detail?.ratingSystem && detail.ratingSystem !== 'D' ? detail.ratingSystem : null)
    ?? SYSTEMS.find((s) => mine.has(s)) ?? 'R';
  const ratingOf = (row) => {
    const r = (row?.ratings ?? []).find((x) => x.ratingSystem === sys);
    return {
      pre: num(r?.preRating),
      post: num(r?.postRating),
      preExact: num(r?.preRatingDecimal) ?? num(r?.preRating),
      postExact: num(r?.postRatingDecimal) ?? num(r?.postRating),
    };
  };
  const rounds = [...(me.roundOutcomes ?? [])]
    .sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0))
    .map((r) => {
      const opp = r.opponentPlayerId ? byPlayer.get(r.opponentPlayerId) : null;
      const code = outcomeCode(r.outcome);
      const hasOpp = Boolean(r.opponentPlayerId);
      return {
        round: Number(r.roundNumber),
        result: code,
        color: colourOf(r.color),
        oppId: hasOpp ? (String(r.opponentMemberId ?? opp?.memberId ?? '') || null) : null,
        oppFirst: hasOpp ? tidyName(r.opponentFirstName ?? opp?.firstName ?? '') : '',
        oppLast: hasOpp ? tidyName(r.opponentLastName ?? opp?.lastName ?? '') : '',
        oppName: hasOpp
          ? [tidyName(r.opponentFirstName ?? opp?.firstName ?? ''), tidyName(r.opponentLastName ?? opp?.lastName ?? '')].filter(Boolean).join(' ')
          : null,
        oppPre: hasOpp ? ratingOf(opp).pre : null,
        oppPost: hasOpp ? ratingOf(opp).post : null,
        oppPreExact: hasOpp ? ratingOf(opp).preExact : null,
        oppPostExact: hasOpp ? ratingOf(opp).postExact : null,
      };
    });
  const myRating = ratingOf(me);
  return {
    place: num(me.ordinal),
    field: num(detail?.playerCount) ?? rows.length,
    score: num(me.score),
    system: sys,
    pre: myRating.pre,
    post: myRating.post,
    rounds,
    timeControl: detail?.timeControl ?? null,
    roundCount: num(detail?.roundCount) ?? rounds.length,
    online: Boolean(detail?.isOnline),
    gameCount: num(detail?.gameCount),
  };
}

// ---------- Fetching, shared by the function and the dev server ----------

// `getJson(path)` fetches `${USCF_ROOT}${path}` (or a proxy of it) and returns
// the parsed body, null for a 404, and throws otherwise — an error with
// `status` 429 when US Chess says to slow down (and `retryAfter`, seconds,
// if it said how long).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// US Chess limits how fast it's asked. Told to slow down, wait and ask again
// — twice, then give up on that request (the section is asked for again
// next time).
export function patient(getJson, { tries = 3, wait = 1200 } = {}) {
  return async (path) => {
    for (let i = 0; ; i += 1) {
      try {
        return await getJson(path);
      } catch (err) {
        if (err?.status !== 429 || i >= tries - 1) throw err;
        await sleep(Math.min(8000, (err.retryAfter ? err.retryAfter * 1000 : wait * (i + 1))));
      }
    }
  };
}

async function allPages(getJson, path, max = 10) {
  const items = [];
  for (let page = 0; page < max; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const body = await getJson(`${path}${sep}Offset=${page * 100}&Size=100`);
    if (!body) break;
    items.push(...(body.items ?? []));
    if (!body.hasNextPage) break;
  }
  return items;
}

export async function loadHistory(rawGetJson, id) {
  if (!validMemberId(id)) throw new Error('A US Chess ID is 8 digits.');
  const getJson = patient(rawGetJson);
  const member = await getJson(`/members/${id}`);
  if (!member) return null;
  const [sections, lists] = await Promise.all([
    allPages(getJson, `/members/${id}/sections`),
    allPages(getJson, `/members/${id}/rating-supplements`, 3).catch(() => []),
  ]);
  return normalizeHistory(member, sections, lists);
}

// Members whose name is like `q`, best first: [{ id, name, state, status,
// ratings: { R, Q, B } }] — enough to pick the right one.
export function normalizeSearch(items) {
  return (items ?? []).filter((m) => m?.id).map((m) => {
    const ratings = {};
    for (const r of m.ratings ?? []) {
      if (['R', 'Q', 'B'].includes(r.ratingSystem) && num(r.rating) != null) ratings[r.ratingSystem] = num(r.rating);
    }
    const first = tidyName(m.firstName);
    const last = tidyName(m.lastName);
    return {
      id: String(m.id),
      name: [first, last].filter(Boolean).join(' '),
      state: m.stateRep ?? m.jurisdiction ?? null,
      status: m.status ?? null,
      ratings,
    };
  });
}

export async function loadSearch(rawGetJson, q) {
  const query = tidySearch(q);
  if (!validSearch(query)) throw new Error(SEARCH_HELP);
  const body = await patient(rawGetJson)(`/members?Fuzzy=${encodeURIComponent(query)}&Offset=0&Size=12`);
  return normalizeSearch(body?.items);
}

// Crosstables for these sections ("eventId:n" keys), a few at a time:
// { [key]: standing | null }.
export async function loadStandings(rawGetJson, id, keys, { concurrency = 3 } = {}) {
  if (!validMemberId(id)) throw new Error('A US Chess ID is 8 digits.');
  const getJson = patient(rawGetJson);
  const wanted = [...new Set(keys)].map(parseSectionKey).filter(Boolean);
  const out = {};
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const { eventId, section } = wanted[next++];
      const key = sectionKey(eventId, section);
      // A failed request leaves the section out (to be asked for again); a
      // null means US Chess answered and this member isn't in it.
      try {
        const [items, detail] = await Promise.all([
          allPages(getJson, `/rated-events/${eventId}/sections/${section}/standings`, 5),
          getJson(`/rated-events/${eventId}/sections/${section}`),
        ]);
        out[key] = normalizeStanding(items, id, detail);
      } catch {
        /* left out */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, wanted.length) }, worker));
  return out;
}
