// Reads a US Chess MSA member page and hands it back with CORS headers, so the
// app can show a live rating. US Chess publishes no API and no CORS headers,
// which is the only reason this exists — nothing is stored, and the only thing
// sent on is the (public) member ID.
export const handler = async (event) => {
  const id = String(event.queryStringParameters?.id ?? '').replace(/\D/g, '');
  const headers = {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=3600',
  };
  if (id.length < 6) return { statusCode: 400, headers, body: 'Expected a numeric US Chess ID.' };

  try {
    const res = await fetch(`https://www.uschess.org/msa/MbrDtlMain.php?${id}`, {
      headers: { 'user-agent': 'repertoire-lab/1.0' },
    });
    if (!res.ok) return { statusCode: 502, headers, body: `US Chess replied ${res.status}` };
    return { statusCode: 200, headers, body: await res.text() };
  } catch (err) {
    return { statusCode: 502, headers, body: `Could not reach US Chess: ${err.message}` };
  }
};
