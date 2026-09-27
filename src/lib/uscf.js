// US Chess ratings, from the data behind ratings.uschess.org.
//
// The old member pages (uschess.org/msa/…) now sit behind Cloudflare's bot
// check: a request from anything that isn't a person in a browser gets "Just
// a moment…" instead of the page, which is why live USCF ratings stopped
// working. The new ratings site is fed by a plain JSON API
// (ratings-api.uschess.org) that answers anyone — but sends no CORS header,
// so a web page can't call it directly. netlify/functions/uscf.mjs calls it
// for the app and hands back what this file makes of it.
//
// Pure, so the function and the tests share it.

export const USCF_API = 'https://ratings-api.uschess.org/api/v1/members';

// The systems US Chess rates in, as the API names them.
const SYSTEMS = {
  R: 'regular', Q: 'quick', B: 'blitz', OR: 'onlineRegular', OQ: 'onlineQuick', OB: 'onlineBlitz',
};

// `member` is /members/{id}; `sections` is /members/{id}/sections — every
// rated section they've played, newest first.
//
// "Live" means the rating after the most recent rated event. The member
// record carries the published (official) figure, which trails the latest
// tournament: a student who gained 160 points on Saturday still shows the
// old number there until the next list. So each system reads from the newest
// event that rated it, with the official figure kept alongside.
export function normalizeUscf(member, sections) {
  if (!member?.id) return null;
  const official = {};
  for (const r of member.ratings ?? []) {
    if (SYSTEMS[r.ratingSystem] && Number.isFinite(r.rating)) official[r.ratingSystem] = r.rating;
  }
  const events = [...(sections?.items ?? [])]
    .sort((a, b) => String(b.endDate ?? '').localeCompare(String(a.endDate ?? '')));
  const live = {};
  let lastEvent = null;
  for (const section of events) {
    for (const rec of section.ratingRecords ?? []) {
      if (!SYSTEMS[rec.ratingSource] || live[rec.ratingSource] != null) continue;
      if (!Number.isFinite(rec.postRating)) continue;
      live[rec.ratingSource] = rec.postRating;
      if (!lastEvent) lastEvent = { name: section.event?.name ?? null, date: section.endDate ?? null };
    }
  }
  const out = {
    id: String(member.id),
    name: [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || null,
    expires: member.expirationDate ?? null,
    status: member.status ?? null,
    lastEvent,
    fetchedAt: Date.now(),
  };
  for (const [code, key] of Object.entries(SYSTEMS)) {
    out[key] = live[code] ?? official[code] ?? null;
    if (official[code] != null && live[code] != null && live[code] !== official[code]) {
      out[`${key}Official`] = official[code];
    }
  }
  return out;
}
