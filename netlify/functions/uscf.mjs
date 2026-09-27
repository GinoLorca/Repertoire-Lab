// /.netlify/functions/uscf?id=12345678 — a US Chess member's live ratings.
//
// US Chess's ratings API answers anyone but sends no CORS header, so the app
// can't call it from the page; this function calls it instead. Only the
// (public) member ID is sent. See src/lib/uscf.js for what comes back.
import { USCF_API, normalizeUscf } from '../../src/lib/uscf.js';

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...extra },
});

export default async (req) => {
  const id = (new URL(req.url).searchParams.get('id') ?? '').replace(/\D/g, '');
  if (id.length < 6) return json({ error: 'A US Chess ID is 8 digits.' }, 400);
  try {
    const [m, s] = await Promise.all([
      fetch(`${USCF_API}/${id}`, { headers: { accept: 'application/json' } }),
      fetch(`${USCF_API}/${id}/sections`, { headers: { accept: 'application/json' } }),
    ]);
    if (m.status === 404) return json({ error: 'US Chess has no member with that ID.' }, 404);
    if (!m.ok) return json({ error: `US Chess answered ${m.status}.` }, 502);
    const member = await m.json();
    const sections = s.ok ? await s.json() : null;
    const out = normalizeUscf(member, sections);
    if (!out) return json({ error: 'US Chess has no member with that ID.' }, 404);
    // An hour is plenty: ratings change after tournaments, not by the minute.
    return json(out, 200, { 'cache-control': 'public, max-age=3600' });
  } catch (err) {
    return json({ error: `Couldn't reach US Chess — ${err.message}.` }, 502);
  }
};
