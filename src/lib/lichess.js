// Lichess studies, pulled in as PGN.
//
// A study exports as a PGN with one game per chapter, each carrying an [Event]
// tag holding the study and chapter names — which is exactly the shape the
// course importer already understands, so a study lands as chapters with their
// lines and the author's comments intact.
//
// Public studies need no credentials. A private or unlisted one returns 404 to
// an anonymous request; there's no way around that without the owner's OAuth
// token, so the error says so plainly rather than looking like a broken link.

const STUDY_ID = /[a-zA-Z0-9]{8}/;

// Accepts a full URL, a study id, or a URL pointing at one chapter.
export function parseStudyUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  const url = text.match(/lichess\.org\/study\/([a-zA-Z0-9]{8})(?:\/([a-zA-Z0-9]{8}))?/);
  if (url) return { studyId: url[1], chapterId: url[2] ?? null };

  // A bare id typed or pasted on its own.
  if (STUDY_ID.test(text) && text.length === 8) return { studyId: text, chapterId: null };
  return null;
}

export const studyUrl = (studyId) => `https://lichess.org/study/${studyId}`;

// The whole study, or one chapter of it. `clocks`/`comments` stay on so the
// author's annotations survive the trip.
export async function fetchStudyPgn({ studyId, chapterId }, { signal } = {}) {
  const path = chapterId
    ? `https://lichess.org/api/study/${studyId}/${chapterId}.pgn`
    : `https://lichess.org/api/study/${studyId}.pgn`;
  const url = `${path}?comments=true&variations=true&clocks=false`;

  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/x-chess-pgn' }, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Could not reach lichess.org — check the connection and try again.');
  }

  if (res.status === 404) {
    throw new Error(
      'Lichess returned "not found" for that study. Public studies import fine; private and '
      + 'unlisted ones are only visible to their owner, so make it public on Lichess first.',
    );
  }
  if (res.status === 429) {
    throw new Error('Lichess is rate-limiting these requests — wait a minute and try again.');
  }
  if (!res.ok) throw new Error(`Lichess replied ${res.status}.`);

  const pgn = await res.text();
  if (!pgn.trim()) throw new Error('That study came back empty — it may have no chapters yet.');
  return pgn;
}
