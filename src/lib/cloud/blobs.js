// Pictures, when there's no bucket to put them in.
//
// Cloud Storage is where a picture belongs, but it needs a paid plan and this
// project runs on the free one — which is why artwork used to stop at
// whichever device it was added on. Firestore has no such restriction, so
// pictures go in there instead: each one becomes its own document (or a short
// run of them), keyed by a hash of its contents.
//
// Content-addressing does two useful things for nothing: the same picture used
// twice is stored once, and a sync that hasn't changed a picture writes
// nothing at all rather than re-uploading it.
import { hashOf, SKIP } from './shape';

// Firestore's hard limit is 1 MiB per document; this leaves room for the
// field names and the overhead around them. A course cover fits in one piece.
export const CHUNK = 700000;
// A wallpaper doesn't: it's a 2560px photo, so it arrives as a couple of
// megabytes of base64 and is split across a few documents. The ceiling is
// there so a runaway image can't turn one sync into fifty writes.
export const MAX_TOTAL = 8 * CHUNK;

const partId = (hash, i) => (i === 0 ? hash : `${hash}~${i}`);

export function makeInlineStore({ db, firestore, uid, meta }) {
  const { doc, setDoc, getDoc } = firestore;
  const at = (id) => doc(db, 'users', uid, 'blobs', id);
  const stats = { skipped: 0, tooBig: 0, written: 0 };

  const upload = async (dataUrl) => {
    if (dataUrl.length > MAX_TOTAL) { stats.tooBig += 1; return SKIP; }
    const hash = hashOf(dataUrl);
    // `hash` is repeated outside the key on purpose: it's what the puller
    // checks against the pictures this device already holds, and without it
    // every device would re-download every image on every sync.
    const ref = { __doc: hash, hash, bytes: dataUrl.length };
    // Written from this device before, and the contents decide the name — so
    // what's out there is already this exact picture.
    if (meta.hashes[`doc:${hash}`]) return ref;

    const parts = Math.ceil(dataUrl.length / CHUNK);
    try {
      // Tail pieces first, head last. The head is what a reader looks for, so
      // an upload that dies halfway leaves something unreadable rather than
      // something that reads as a truncated, broken picture. The orphans cost
      // a few KB and are overwritten the next time the same image is sent.
      await Promise.all(
        Array.from({ length: parts - 1 }, (_, i) => setDoc(at(partId(hash, i + 1)), {
          data: dataUrl.slice((i + 1) * CHUNK, (i + 2) * CHUNK),
        })),
      );
      await setDoc(at(hash), {
        data: dataUrl.slice(0, CHUNK), parts, bytes: dataUrl.length, at: Date.now(),
      });
      meta.hashes[`doc:${hash}`] = true;
      stats.written += parts;
      return ref;
    } catch {
      // Same rule as everywhere else in the sync: a picture may fail to
      // travel, but it must never take the lines down with it.
      stats.skipped += 1;
      return SKIP;
    }
  };

  const download = async (ref) => {
    try {
      const head = await getDoc(at(ref.__doc));
      if (head.exists()) {
        const { data, parts = 1 } = head.data() ?? {};
        if (typeof data === 'string') {
          const rest = await Promise.all(
            Array.from({ length: parts - 1 }, (_, i) => getDoc(at(partId(ref.__doc, i + 1)))),
          );
          if (rest.every((s) => s.exists() && typeof s.data()?.data === 'string')) {
            const whole = data + rest.map((s) => s.data().data).join('');
            // The pieces are only a picture if they add back up to one. A
            // half-written image would otherwise reach the board as a broken
            // one, and broken is worse than missing — missing is recoverable.
            if (hashOf(whole) === (ref.hash ?? hashOf(whole))) return whole;
          }
        }
      }
    } catch { /* falls through */ }
    stats.skipped += 1;
    return null;
  };

  return { upload, download, stats };
}
