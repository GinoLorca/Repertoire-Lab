import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Vision transcription of chess notation (screenshots + handwritten scoresheets)
// Providers: Claude (best quality) and Google Gemini (has a free tier).
// ---------------------------------------------------------------------------

const PROMPTS = {
  screen: `This screenshot shows one or more chess variations written in algebraic notation (from a chess course or opening repertoire app).

Transcribe every variation you can see. For each one, output exactly one line in this format:

NAME :: MOVES

where NAME is the variation's title if one is visible (otherwise write "Variation"), and MOVES is the complete move sequence in standard algebraic notation with move numbers, e.g. "1.e4 c6 2.d4 d5 3.f3 dxe4". Include every move shown, both the greyed-out and highlighted ones. Output only these lines — no commentary, no markdown.`,

  scoresheet: `These images are photos of a handwritten chess scoresheet from an over-the-board game. If there is more than one image, they are consecutive pages/halves of the SAME game — transcribe them as one continuous game in order.

The photo may be rotated, tilted, shadowed, or creased. Mentally rotate and straighten it as needed before reading.

LAYOUT. A scoresheet is a numbered table with a White column and a Black column. Most sheets have TWO side-by-side blocks: moves 1–20 on the left, 21–40 on the right. Read the ENTIRE left block first (row 1, 2, 3 … 20), then continue with the right block (21, 22 … 40). Never interleave the blocks, never skip a move number, never re-order moves. Row N gives White's move N and Black's move N.

OUTPUT. Exactly one line, in this format:

NAME :: MOVES

NAME is the two players if legible, taken from the "Player's Name" and "Opponent's Name" fields (e.g. "Joseph – Ishaan"); otherwise "Scoresheet game". MOVES is the full game in standard algebraic notation with move numbers, e.g. "1.e4 c5 2.Nf3 d6 3.d4 cxd4".

READING THE HANDWRITING. Use chess reasoning at every step — this matters more than the strokes:
- Maintain the position in your head as you go. A reading that is ILLEGAL in the current position is wrong; pick the legal move that best matches what is written. If exactly one legal move fits the general shape, use it.
- Amateur scoresheets very often write FILES AS CAPITALS: "D4" means d4, "C6" means c6, "BF5" means Bf5, "exD5" means exd5. Capitalisation carries no meaning — infer piece vs pawn from context and legality.
- The knight "N" is frequently written so it looks like h, n, u, w, or m. If "h"/"u"/"w" appears where a piece move must go (e.g. "hc3", "hxe4"), it is almost certainly N (Nc3, Nxe4).
- A check "+" is often written like a "t", "T", or a small cross. Trailing t/T after a legal checking move means check.
- Castling appears as O-O, 0-0, o-o, or O-O-O / 0-0-0.
- Captures may be "x", "×", ":", or omitted entirely ("ed" = exd5). Promotion as "=Q" or "(Q)". Results as 1-0, 0-1, ½-½ — do not include the result in the moves.
- Digit confusions: 1/l/7, 4/9, 5/S, 6/b, 0/O, 2/Z.
- If a cell is scribbled over, crossed out, or has a move written above/through another, the player corrected themselves — transcribe the CORRECTED (final) move, not the abandoned one.
- Expand shorthand into full standard algebraic notation, adding disambiguation when needed (e.g. "Nbd7", "R1e2").
- If a cell is genuinely unreadable and no legal move plausibly fits, write ?? there and continue with the rest of the game. Prefer a well-reasoned legal guess over ?? whenever the strokes support it.
- Stop at the last filled-in row; do not invent moves for empty rows.

Output only that one line — no commentary, no markdown, no explanation.`,
};

// ---------------------------------------------------------------------------
// Image preparation
// Phone photos are far larger than any model needs. Downscaling to the
// high-resolution vision tier keeps handwriting detail while cutting cost,
// and optional contrast enhancement helps faint pencil on white paper.
// ---------------------------------------------------------------------------

const MAX_EDGE = 2400; // within Claude's 2576px high-res tier

export const isHeic = (file) =>
  /\.(heic|heif)$/i.test(file.name || '') || /image\/hei[cf]/i.test(file.type || '');

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Chrome and Firefox cannot decode HEIC/HEIF (iPhone's default format).
      reject(new Error(isHeic(file)
        ? 'This browser can’t open HEIC photos. On iPhone: Settings → Camera → Formats → "Most Compatible" to shoot JPEG. For an existing photo: open it in Preview → File → Export as JPEG. (Photographing straight from your iPhone into this page works — iOS converts automatically.)'
        : 'Could not read that image file.'));
    };
    img.src = url;
  });
}

// Grayscale + contrast stretch: pushes faint pencil away from the paper.
function enhance(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = g; d[i + 1] = g; d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - min) / range) * 255));
    d[i] = v; d[i + 1] = v; d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

// Returns { data: base64 (no prefix), mediaType, width, height, previewUrl }
// rotate: 0 | 90 | 180 | 270 (clockwise) — scoresheet photos are often sideways.
export async function prepareImage(file, { enhanceContrast = false, rotate = 0 } = {}) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const turned = rotate === 90 || rotate === 270;

  const canvas = document.createElement('canvas');
  canvas.width = turned ? h : w;
  canvas.height = turned ? w : h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (rotate) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }
  if (enhanceContrast) enhance(ctx, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  return {
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mediaType: 'image/jpeg',
    width: canvas.width,
    height: canvas.height,
    previewUrl: dataUrl,
  };
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// Handwriting is read at high effort, which is genuinely slow — but never
// unbounded. Without a ceiling a stalled request just sits there and the app
// looks frozen.
const READ_TIMEOUT_MS = { scoresheet: 300000, screen: 120000 };

async function callClaude(apiKey, images, prompt, kind, { signal, onProgress } = {}) {
  let streamed = 0;
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const content = [
    ...images.map((im) => ({
      type: 'image',
      source: { type: 'base64', media_type: im.mediaType, data: im.data },
    })),
    { type: 'text', text: prompt },
  ];
  const request = {
    // A scoresheet is one game read carefully, not a page of variations to
    // pull apart: Sonnet does it well and finishes in a fraction of the time.
    // Opus at high effort was taking longer than the request could stay open.
    model: kind === 'scoresheet' ? 'claude-sonnet-5' : 'claude-opus-5',
    // max_tokens covers thinking AND the answer, and reading handwriting is
    // nearly all thinking. Trimming this budget doesn't make the read quicker,
    // it makes it run out mid-thought and return nothing at all — so a dense
    // 40-move sheet gets plenty of headroom.
    max_tokens: kind === 'scoresheet' ? 12000 : 16000,
    // Printed screenshots are an easy read; handwriting needs real reasoning.
    // Medium leaves room to reason about legality without spending minutes on it.
    output_config: { effort: kind === 'scoresheet' ? 'medium' : 'low' },
    messages: [{ role: 'user', content }],
  };

  // Caller's cancel, plus our own timeout, whichever comes first.
  const ceiling = READ_TIMEOUT_MS[kind] ?? READ_TIMEOUT_MS.screen;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('timeout')), ceiling);
  const onCancel = () => ac.abort(new Error('cancelled'));
  signal?.addEventListener('abort', onCancel);
  const opts = { signal: ac.signal };

  // Streamed, always. A long read is exactly what this is — the API refuses a
  // non-streaming request whose budget could run past ten minutes, which is the
  // "Streaming is required…" failure a full scoresheet used to hit. Streaming
  // also gives real progress to report while it works.
  const runStream = async (maker) => {
    const stream = await maker();
    stream.on('text', (delta) => {
      streamed += delta.length;
      onProgress?.({ phase: 'writing', chars: streamed });
    });
    return stream.finalMessage();
  };

  let response;
  try {
    try {
      response = await runStream(() => client.beta.messages.stream({
        ...request,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }, opts));
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError) {
        // output_config is a beta-only field — drop it for the plain endpoint.
        const { output_config: _drop, ...plain } = request;
        response = await runStream(() => client.messages.stream(plain, opts));
      } else {
        throw err;
      }
    }
  } catch (err) {
    if (ac.signal.aborted) {
      const why = signal?.aborted ? 'cancelled' : 'timeout';
      throw new Error(why === 'cancelled'
        ? 'Reading was cancelled.'
        : `Claude didn't answer within ${Math.round(ceiling / 1000)}s. `
          + 'A very full scoresheet can take a while — try again, photograph one column at a time, '
          + 'or switch the reading engine to Gemini.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined this request. Try the Gemini or local OCR engine.');
  }
  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  // Never let a cut-off list look like a complete one.
  if (response.stop_reason === 'max_tokens') {
    return `${text}\n__TRUNCATED__`;
  }
  return text;
}

// Gemini free tier (get a key at aistudio.google.com/apikey).
// Model IDs shift over time, so try current names in order.
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

async function callGemini(apiKey, images, prompt) {
  const parts = [
    ...images.map((im) => ({ inline_data: { mime_type: im.mediaType, data: im.data } })),
    { text: prompt },
  ];
  let lastError = null;
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0, maxOutputTokens: 4096 },
        }),
      });
    } catch {
      throw new Error('Could not reach Google Gemini — check your internet connection.');
    }
    if (res.ok) {
      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
      if (text) return text;
      lastError = new Error('Gemini returned an empty response.');
      continue;
    }
    const body = await res.json().catch(() => ({}));
    const message = body?.error?.message || `HTTP ${res.status}`;
    // 404 = this model name isn't available to the key; try the next one.
    if (res.status !== 404) throw new Error(`Gemini: ${message}`);
    lastError = new Error(`Gemini: ${message}`);
  }
  throw lastError ?? new Error('Gemini request failed.');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// images: array of { data, mediaType } from prepareImage()
// kind: 'screen' | 'scoresheet'
// Returns [{ name, movetext }]
export async function transcribeImages({
  provider, apiKey, images, kind = 'screen', signal, onProgress,
}) {
  const prompt = PROMPTS[kind] ?? PROMPTS.screen;
  onProgress?.({ phase: 'thinking', chars: 0 });
  const raw = provider === 'gemini'
    ? await callGemini(apiKey, images, prompt)
    : await callClaude(apiKey, images, prompt, kind, { signal, onProgress });

  const truncated = raw.includes('__TRUNCATED__');
  const text = raw.replace('__TRUNCATED__', '');
  if (truncated) {
    // Surfaced to the caller so a partial list is never mistaken for the whole.
    const nothing = text.trim().length === 0;
    const err = new Error(
      // eslint-disable-next-line no-nested-ternary
      nothing
        ? 'Claude ran out of room while working the sheet out and returned nothing. '
          + 'Try again — or photograph one column at a time, or switch the reading engine to Gemini.'
        : kind === 'scoresheet'
          ? 'The answer was cut off partway through the game. The moves read so far are below — '
            + 'check them, or photograph one column at a time and import each half.'
          : 'The screenshot held more variations than fit in one response. Import it in two halves '
            + '(screenshot the first few variations, then the rest), or use the Gemini engine.',
    );
    err.partialText = text;
    throw err;
  }

  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.includes('::') || /\d+\s*\./.test(line))
    .map((line) => {
      const idx = line.indexOf('::');
      if (idx >= 0) {
        return { name: line.slice(0, idx).trim() || 'Variation', movetext: line.slice(idx + 2).trim() };
      }
      return { name: 'Variation', movetext: line };
    });
}

// Turn provider errors into something a human can act on.
export function friendlyError(err, provider) {
  const raw = String(err?.message ?? err);
  const where = provider === 'gemini' ? 'Google AI Studio' : 'the Anthropic Console';
  if (/authentication_error|invalid x-api-key|API_KEY_INVALID|API key not valid/i.test(raw)) {
    return `That API key isn't valid — copy it again from ${where}.`;
  }
  if (/rate_limit|RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    return provider === 'gemini'
      ? "You've hit Gemini's free-tier limit for now — wait a minute and try again."
      : 'Rate limited — wait a moment and try again.';
  }
  if (/credit balance|billing|PERMISSION_DENIED/i.test(raw)) {
    return provider === 'gemini'
      ? `This key doesn't have access — check it in ${where}.`
      : 'Your Anthropic account needs credit before the API will run.';
  }
  if (/Failed to fetch|NetworkError|Could not reach|ERR_/i.test(raw)) {
    return 'No internet connection — vision reading needs to be online.';
  }
  // Strip any JSON envelope so the panel shows the message, not the payload.
  const m = raw.match(/"message"\s*:\s*"([^"]+)"/);
  return m ? m[1] : raw;
}

// Cheap round-trip to confirm a key works before the user relies on it.
export async function testKey(provider, apiKey) {
  if (!apiKey?.trim()) throw new Error('Enter a key first.');
  if (provider === 'gemini') {
    let lastError = null;
    for (const model of GEMINI_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }] }),
      }).catch(() => null);
      if (res?.ok) return `Working — using ${model}.`;
      if (res && res.status !== 404) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      }
      lastError = new Error('No supported Gemini model available for this key.');
    }
    throw lastError;
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  });
  return 'Working — Claude vision is ready.';
}
