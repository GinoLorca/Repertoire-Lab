// Live ratings for a player profile.
//
// Chess.com and Lichess publish open APIs that browsers may call directly.
// US Chess has no API and its MSA pages send no CORS headers, so the page is
// read either through the small function shipped with this site, or — on a host
// without functions — through a public text proxy. Both return the same page;
// one parser handles either shape.

const MSA = (id) => `https://www.uschess.org/msa/MbrDtlMain.php?${id}`;

const stripHtml = (s) => s
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/\*\*/g, ' ') // the text proxy marks bold cells like this
  .replace(/[ \t]+/g, ' ');

// The value cell follows its label; "(Unrated)" means they have no rating in
// that time control yet. Ratings run 100–3000, published as 3 or 4 digits.
function ratingAfter(text, label) {
  // "Regular Rating" also occurs inside "Online-Regular Rating".
  const at = new RegExp(`(^|[^-A-Za-z])${label}`).exec(text);
  if (!at) return null;
  const after = text.slice(at.index + at[0].length, at.index + at[0].length + 140);
  if (/^[^0-9]{0,30}\(Unrated/.test(after)) return null;
  const num = /(\d{3,4})/.exec(after);
  if (!num) return null;
  const value = Number(num[1]);
  return value >= 100 && value <= 3200 ? value : null;
}

export function parseMsa(raw) {
  const text = stripHtml(raw);
  const who = /(\d{6,})\s*:\s*([A-Z][A-Za-z .,'\-]{2,60})/.exec(text);
  const expires = /Expiration Dt\.?\s*([A-Za-z0-9-]+(?: Member)?)/.exec(text);
  const out = {
    id: who?.[1] ?? null,
    name: who?.[2]?.trim() ?? null,
    regular: ratingAfter(text, 'Regular Rating'),
    quick: ratingAfter(text, 'Quick Rating'),
    blitz: ratingAfter(text, 'Blitz Rating'),
    onlineRegular: ratingAfter(text, 'Online-Regular Rating'),
    expires: expires?.[1]?.trim() ?? null,
    fetchedAt: Date.now(),
  };
  if (!out.name && out.regular == null && out.quick == null && out.blitz == null) return null;
  return out;
}

async function textFrom(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// US Chess published ratings for a member ID.
export async function fetchUscf(id) {
  const clean = String(id ?? '').replace(/\D/g, '');
  if (clean.length < 6) throw new Error('A US Chess ID is 8 digits.');

  const sources = [
    // Shipped with the site — no third party involved when it's available.
    { via: 'US Chess', url: `/.netlify/functions/uscf?id=${clean}` },
    // Any static host: a public reader that fetches the page and sends CORS
    // headers back. Only the (public) member ID leaves the device.
    { via: 'US Chess (via r.jina.ai)', url: `https://r.jina.ai/${MSA(clean)}` },
  ];

  let lastError = null;
  for (const source of sources) {
    try {
      const parsed = parseMsa(await textFrom(source.url));
      if (parsed) return { ...parsed, via: source.via };
      lastError = new Error('That ID has no member record.');
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Couldn't reach US Chess — ${lastError?.message ?? 'no answer'}.`);
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
