// Lichess opening explorer. The public host has started demanding
// authorisation, so a token (Settings → Analysis) is sent when there is one.
export async function fetchExplorer(fen, db, token) {
  let url;
  if (db === 'masters') {
    url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=12`;
  } else {
    const params = new URLSearchParams({
      variant: 'standard',
      fen,
      moves: '12',
      speeds: 'blitz,rapid,classical',
      ratings: '1200,1400,1600,1800,2000,2200,2500',
    });
    url = `https://explorer.lichess.ovh/lichess?${params}`;
  }
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const res = await fetch(url, { headers });
  if (res.status === 401) {
    const err = new Error(token
      ? 'Lichess rejected that API token (401).'
      : 'Lichess is asking for an API token for explorer requests (401).');
    err.needsToken = true;
    throw err;
  }
  if (res.status === 429) throw new Error('Lichess is rate-limiting explorer requests — try again shortly.');
  if (!res.ok) throw new Error(`Lichess explorer request failed (${res.status})`);
  return res.json();
}
export function explorerTotals(entry) {
  return entry.white + entry.draws + entry.black;
}

export function pct(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
