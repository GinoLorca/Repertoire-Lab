// /.netlify/functions/uscf-history?id=12345678
//   A US Chess member's rated history: profile, every rated section with the
//   rating before and after it, and the monthly lists.
// /.netlify/functions/uscf-history?id=12345678&xt=202609070223:5,202508014782:3
//   Those sections' crosstables, as this member played them (up to 8 at a
//   time): each round's colour, result and opponent with their rating.
//
// US Chess's ratings API answers anyone but sends no CORS header, so the page
// can't call it; this does. It only ever asks for the paths built below, from
// a member ID and event/section numbers checked first — it isn't a proxy for
// anything else. The shaping is src/lib/uscfHistory.js, shared with the dev
// server and the tests.
import {
  USCF_ROOT, loadHistory, loadStandings, loadSearch, validMemberId, validSearch, SEARCH_HELP, parseSectionKey,
} from '../../src/lib/uscfHistory.js';

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...extra },
});

const getJson = async (path) => {
  const headers = { accept: 'application/json' };
  if (process.env.USCF_API_KEY) headers['X-Api-Key'] = process.env.USCF_API_KEY;
  const res = await fetch(`${USCF_ROOT}${path}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(res.status === 429 ? 'US Chess is busy — try again in a minute' : `US Chess answered ${res.status}`);
    err.status = res.status;
    err.retryAfter = Number(res.headers.get('retry-after')) || null;
    throw err;
  }
  return res.json();
};

export default async (req) => {
  const params = new URL(req.url).searchParams;
  // ?search=Elliott Crawford — members by name, to scout an opponent.
  const search = params.get('search');
  if (search != null) {
    if (!validSearch(search)) return json({ error: SEARCH_HELP }, 400);
    try {
      return json({ members: await loadSearch(getJson, search) }, 200, { 'cache-control': 'public, max-age=3600' });
    } catch (err) {
      return json({ error: `Couldn't reach US Chess — ${err.message}.` }, 502);
    }
  }
  const id = (params.get('id') ?? '').replace(/\D/g, '');
  if (!validMemberId(id)) return json({ error: 'A US Chess ID is 8 digits.' }, 400);
  try {
    const xt = params.get('xt');
    if (xt != null) {
      const keys = xt.split(',').map((k) => k.trim()).filter((k) => parseSectionKey(k)).slice(0, 8);
      if (!keys.length) return json({ error: 'No sections asked for.' }, 400);
      const standings = await loadStandings(getJson, id, keys);
      // Kept a day when every section came back (the client puts the
      // section's ratings in the URL, so a re-rating asks afresh); never when
      // one failed, or the failure would be served back for a day.
      const complete = keys.every((k) => k in standings);
      return json({ id, standings }, 200, { 'cache-control': complete ? 'public, max-age=86400' : 'no-store' });
    }
    const history = await loadHistory(getJson, id);
    if (!history) return json({ error: 'US Chess has no member with that ID.' }, 404);
    // Ten minutes: fresh enough the evening a tournament is rated.
    return json(history, 200, { 'cache-control': 'public, max-age=600' });
  } catch (err) {
    return json({ error: `Couldn't reach US Chess — ${err.message}.` }, 502);
  }
};
