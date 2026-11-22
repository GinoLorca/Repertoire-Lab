// Checks the copy of Chess Arcade's Game Review that scripts/sync-arcade.mjs
// made, in a real browser, the way Repertoire Lab uses it — before a new copy
// goes out on its own (.github/workflows/sync-arcade.yml):
//
//   npm run build && npm run check:arcade
//
// It serves the built app (dist/), puts the copy in a frame the way the Game
// Review tab does, and asks it for what Repertoire Lab relies on:
//
//   · it starts, says it's ready and tells its height, with nothing thrown
//   · it still has everything of Chess Arcade's the bridge uses (missing())
//   · a game's records go in and come back out — note, analysis, a Larry
//     Review — and one taken away is gone
//   · a game opens, and a note typed in its Notes card is saved and reported
//   · an engine review handed in as a record (rv) shows on the game's moves,
//     comes back out as it went in, and goes when the record does
//   · Repertoire Lab's theme, dark and light, is the one it wears, and its
//     arrow colour profile, set from here and told back when picked in there
//   · a repertoire goes in, and CLAMP, Tactics and Openings each open; the Puzzles tab
//     (its Settings field and its panel) and the review's "your usual in this line" stay
//     out of the copy
//   · with it, the review shows its book moves above the engine's, and its
//     Similar openings tab finds the line the game is in, named whose it is
//   · the corner buttons and flush() take what they're given
//   · Stockfish is where the copy looks for it
//
// Any failure: it says which, and exits 1 — the workflow then ships nothing.
// Needs Playwright and a Chromium: `npm i --no-save playwright && npx playwright
// install chromium`, or CHROMIUM_PATH pointing at one.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCADE_REVIEW_URL, ARCADE_FROM } from '../src/lib/arcadeBuild.js';
import { arcadeGame, arcadeId, cleanRecords } from '../src/lib/gameReviewBridge.js';
import { arcadeRepertoire, openingsGames } from '../src/lib/openingsBasis.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const copyFile = join(dist, ARCADE_REVIEW_URL.replace(/^\//, ''));
const fails = [];
const ok = (cond, what) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) fails.push(what);
};

if (!existsSync(copyFile)) {
  console.error(`check-arcade: ${ARCADE_REVIEW_URL} isn't in dist/ — run npm run build first`);
  process.exit(1);
}

// ---- the built app, and a page that holds the copy in a frame ----
const HARNESS = `<!doctype html><meta charset="utf-8"><title>Game Review check</title>
<script>window.__msgs = []; addEventListener('message', (e) => { if (e.data && e.data.source === 'rl-review') window.__msgs.push(e.data); });</script>
<iframe id="gr" src="${ARCADE_REVIEW_URL}" style="width:1440px;height:960px;border:0"></iframe>`;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.nnue': 'application/octet-stream', '.webmanifest': 'application/manifest+json',
};
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/__check.html') {
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    res.end(HARNESS);
    return;
  }
  const file = normalize(join(dist, path));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const browser = await pw.chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});

try {
  console.log(`check-arcade: ${ARCADE_REVIEW_URL} (from ${ARCADE_FROM})`);
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  // The network isn't the copy's fault (fonts, Lichess's explorer): only what its code throws counts.
  const noise = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_INTERNET|Failed to fetch|NetworkError|Load failed/i;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text())) errors.push(m.text()); });

  // Stockfish where the copy looks for it.
  const sf = await fetch(`${base}/stockfish/stockfish-nnue-16-single.js`);
  ok(sf.ok, 'Stockfish is at /stockfish/ for the copy');

  await page.goto(`${base}/__check.html`);
  const frame = await (await page.waitForSelector('#gr')).contentFrame();
  const started = await frame.waitForFunction(() => !!window.__rlReview, null, { timeout: 90000 }).then(() => true, () => false);
  ok(started, 'it starts: window.__rlReview is there');
  if (!started) throw new Error('the copy never started');
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'ready'), null, { timeout: 10000 }).catch(() => {});
  ok(await page.evaluate(() => window.__msgs.some((m) => m.type === 'ready')), 'it says it’s ready');
  ok(await frame.evaluate(() => window.__rlReview.v === 1), 'bridge version 1');

  const missing = await frame.evaluate(() => window.__rlReview.missing?.() ?? ['missing() itself']);
  ok(missing.length === 0, `everything of Chess Arcade’s the bridge uses is there${missing.length ? ` — gone: ${missing.join(', ')}` : ''}`);

  // ---- records in and out ----
  const player = {
    id: 'p1',
    name: 'Check',
    kind: 'self',
    games: [{
      id: 'check-game-1',
      name: 'Ann vs Bo',
      moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'],
      date: Date.UTC(2026, 10, 1),
      meta: { white: 'Ann', black: 'Bo', result: '1-0', color: 'white', timeControl: '600+5' },
    }],
  };
  const gid = arcadeId(player.games[0].id);
  const LR = '# Review\n3. Bb5 is the Ruy Lopez. **KEY**: 5. O-O keeps it simple.';
  const NOTE = 'A check note.';
  await frame.evaluate(({ gid, rec }) => window.__rlReview.load(gid, rec), { gid, rec: { note: NOTE, an: '', lr: LR } });
  let back = cleanRecords(await frame.evaluate((gid) => window.__rlReview.records(gid), gid));
  ok(back?.note === NOTE && back?.lr === LR, 'records go in and come back out (note, Larry Review)');
  await frame.evaluate(({ gid, rec }) => window.__rlReview.load(gid, rec), { gid, rec: { note: NOTE, an: '' } });
  back = cleanRecords(await frame.evaluate((gid) => window.__rlReview.records(gid), gid));
  ok(back?.note === NOTE && back?.lr === undefined, 'one taken away is gone');
  // The engine's review of the game, as Chess Arcade keeps it (hrSave): its moves' fingerprint (gnFnv), a score
  // before each move and after the last, a badge a move, accuracy.
  const sans = player.games[0].moves;
  let h = 0x811c9dc5;
  for (const ch of sans.join(' ')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  const RV = JSON.stringify({
    at: Date.now(), n: sans.length, h: (h >>> 0).toString(16).padStart(8, '0'), d: 15,
    e: '20,25,22,30,28,35,30,40,38,120,110', b: 'kkkksesixm', a: [91.2, 64.5],
  });
  await frame.evaluate(({ gid, rec }) => window.__rlReview.load(gid, rec), { gid, rec: { note: NOTE, an: '', lr: LR, rv: RV } });

  // ---- a game opens; a note typed is saved and reported ----
  const game = arcadeGame(player.games[0], gid, { side: 'white' });
  await frame.evaluate((g) => window.__rlReview.open(g, {}), game);
  const opened = await frame.waitForFunction((gid) => window.__rlReview.current() === gid, gid, { timeout: 20000 }).then(() => true, () => false);
  ok(opened, 'a game opens (current() is its id)');
  ok(await frame.evaluate(() => Array.isArray(window.__rlReview.line())), 'line() is the line on the board');
  const badged = await frame.waitForFunction(() => document.querySelectorAll('#hv-movelist .hv-badge').length >= 8, null, { timeout: 8000 })
    .then(() => true, () => false);
  ok(badged, 'an engine review handed in (rv) shows its badges on the game’s moves');
  back = cleanRecords(await frame.evaluate((gid) => window.__rlReview.records(gid), gid));
  ok(back?.rv === RV, 'and comes back out as it went in');
  await frame.evaluate(({ gid, rec }) => window.__rlReview.load(gid, rec), { gid, rec: { note: NOTE, an: '', lr: LR } });
  const gone = await frame.waitForFunction(() => document.querySelectorAll('#hv-movelist .hv-badge').length === 0, null, { timeout: 8000 })
    .then(() => true, () => false);
  back = cleanRecords(await frame.evaluate((gid) => window.__rlReview.records(gid), gid));
  ok(gone && back?.rv === undefined, 'and goes when the record does');
  await page.evaluate(() => { window.__msgs.length = 0; });
  const note = frame.locator('#hv-note');
  let typed = false;
  if (await note.count()) {
    await note.click().catch(() => {});
    await note.press('End').catch(() => {});
    await note.pressSequentially(' Typed in the review.', { delay: 5 }).then(() => { typed = true; }, () => {});
    await frame.evaluate(() => window.__rlReview.flush());
  }
  ok(typed, 'the Notes card can be typed in (#hv-note)');
  if (typed) {
    const told = await page.waitForFunction((gid) => window.__msgs.some((m) => m.type === 'change' && m.gid === gid), gid, { timeout: 8000 })
      .then(() => true, () => false);
    ok(told, 'a change in the review is reported to Repertoire Lab');
    back = cleanRecords(await frame.evaluate((gid) => window.__rlReview.records(gid), gid));
    ok(/Typed in the review\./.test(back?.note ?? ''), 'and what was typed is in the game’s records');
  }

  // ---- Repertoire Lab's theme ----
  for (const theme of ['light', 'dark']) {
    await frame.evaluate((t) => window.__rlReview.look({ skin: 'felt', theme: t }), theme);
    ok(await frame.evaluate(() => document.documentElement.getAttribute('data-theme')) === theme, `it wears Repertoire Lab’s ${theme} theme`);
  }

  // ---- Repertoire Lab's arrow colour profile, both ways ----
  const took = await frame.evaluate(() => window.__rlReview.arrows?.('gamereview') === true
    && document.documentElement.getAttribute('data-anno-prof') === 'on');
  ok(took, 'it takes Repertoire Lab’s arrow colour profile (Game Review)');
  await page.evaluate(() => { window.__msgs.length = 0; });
  await frame.evaluate(() => document.querySelector('.anno-profile')?.click());
  const told = await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'arrowProfile' && m.id === 'default'), null, { timeout: 5000 })
    .then(() => true, () => false);
  ok(told, 'and tells Repertoire Lab when one is picked in it');
  await frame.evaluate(() => window.__rlReview.arrows?.('default'));

  // ---- the corner buttons, flush ----
  const corners = await frame.evaluate(() => {
    try {
      const a = window.__rlReview;
      a.chrome(true); a.saveState({ label: 'Save', title: 'Save it' }); a.saveState({ label: 'Saved', done: true });
      a.saveState(null); a.chrome(false); a.flush();
      return true;
    } catch (e) { return String(e?.message ?? e); }
  });
  ok(corners === true, `chrome(), saveState() and flush() take what they’re given${corners === true ? '' : ` — ${corners}`}`);

  // ---- a repertoire, and CLAMP, Tactics, Openings ----
  const opening = {
    id: 'o-ruy', name: 'Ruy Lopez', color: 'white', courses: [],
    chapters: [{ id: 'c-main', name: 'Main line', variations: [{ id: 'v-main', name: 'Closed', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'] }] }],
  };
  const named = { label: 'Check’s + yours', whose: 'Check’s repertoire or yours' };
  const count = await frame.evaluate(({ p, o }) => window.__rlReview.repertoire(p, o), { p: arcadeRepertoire([opening], ['o-ruy']), o: named });
  ok(count === 1, `a repertoire goes in (${count} opening)`);
  const { games } = openingsGames(player);
  for (const view of ['clamp', 'tactics', 'openings']) {
    const res = await frame.evaluate(({ games, view }) => {
      try { window.__rlReview.history(games, view); return true; } catch (e) { return String(e?.message ?? e); }
    }, { games, view });
    await page.waitForTimeout(400);
    const shown = await frame.evaluate(() => document.documentElement.classList.contains('rl-history')
      && !!document.getElementById('view-history')?.offsetParent);
    ok(res === true && shown, `${view === 'clamp' ? 'CLAMP' : view[0].toUpperCase() + view.slice(1)} opens${res === true ? '' : ` — ${res}`}`);
  }
  // Chess Arcade's Puzzles tab (2026-11) stays out of the copy: its Settings field and its panel are hidden by the bridge
  // (unhidden for a moment here, so the bridge's own rule is what's asked, not Game History's tab state)
  const gzOut = await frame.evaluate(() => {
    const f = document.getElementById('gz-field'), p = document.getElementById('gz');
    if (!f || !p) return `not in this copy (${!f ? '#gz-field' : '#gz'})`;
    const was = p.hidden; p.hidden = false;
    const out = getComputedStyle(f).display === 'none' && getComputedStyle(p).display === 'none';
    p.hidden = was;
    return out;
  });
  ok(gzOut === true || /^not in this copy/.test(String(gzOut)), `Chess Arcade’s Puzzles tab stays out (its Settings field and its panel hidden)${gzOut === true ? '' : ` — ${gzOut}`}`);
  // the review's "your usual in this line" (Chess Arcade 2026-11) stays out too (unhidden for a moment, as above)
  const ouOut = await frame.evaluate(() => {
    if (document.querySelector('#gh-oj option[value="below"]')) return 'the Games filter still offers "Below your usual"';
    const u = document.getElementById('hv-prep-usual');
    if (!u) return 'not in this copy (#hv-prep-usual)';
    const was = u.hidden; u.hidden = false;
    const out = getComputedStyle(u).display === 'none';
    u.hidden = was;
    return out;
  });
  ok(ouOut === true || /^not in this copy/.test(String(ouOut)), `Chess Arcade’s “your usual in this line” and “Below your usual” stay out${ouOut === true ? '' : ` — ${ouOut}`}`);
  // back to a game, as the tab does
  await frame.evaluate((g) => window.__rlReview.open(g, {}), game);
  await frame.waitForFunction((gid) => window.__rlReview.current() === gid, gid, { timeout: 20000 }).catch(() => {});
  ok(await page.evaluate(() => window.__msgs.some((m) => m.type === 'height')), 'it tells Repertoire Lab its height');

  // ---- the repertoire in the review: book moves, and Similar openings ----
  // (stepping with the review's own Start and Next buttons, #hv-start and #hv-next)
  const step = async (plies) => {
    await frame.evaluate(() => document.getElementById('hv-start')?.click());
    for (let i = 0; i < plies; i += 1) await frame.evaluate(() => document.getElementById('hv-next')?.click());
    await page.waitForTimeout(600);
  };
  await step(0);
  const book = await frame.waitForFunction(() => [...document.querySelectorAll('#hv-eng-book .hv-book-line')]
    .map((b) => b.textContent.replace(/\s+/g, ' ')).join(' | ') || null, null, { timeout: 15000 }).then((h) => h.jsonValue(), () => '');
  ok(/BOOK\s*e4\s*— Ruy Lopez: Closed/.test(book), `the repertoire’s moves are above the engine’s (${book || 'none'})`);
  const tabOn = await frame.evaluate(() => {
    const t = document.getElementById('hv-tab-similar');
    if (!t || t.classList.contains('hv-tab-gone')) return false;
    t.click();
    return true;
  });
  ok(tabOn, 'with a repertoire, there’s a Similar openings tab (#hv-tab-similar)');
  await step(6);
  const sim = await frame.waitForFunction(() => {
    const p = document.getElementById('hv-pane-similar');
    return p && /Same position/i.test(p.textContent) ? p.textContent.replace(/\s+/g, ' ') : null;
  }, null, { timeout: 15000 }).then((h) => h.jsonValue(), () => '');
  ok(/Ruy Lopez/.test(sim) && /Closed/.test(sim) && /Ba4/.test(sim), `Similar openings finds the line the game is in (${sim.slice(0, 90) || 'nothing'})`);
  ok(sim.includes(named.label), 'and names whose lines they are');
  const learn = await frame.evaluate(() => [...document.querySelectorAll('#hv-pane-similar a')].map((a) => a.href).find((h) => /go=learn/.test(h)) || '');
  ok(/\/chapter\/o-ruy\/c-main\?line=v-main&go=learn$/.test(learn), 'its Learn link opens that very line in Repertoire Lab');

  await page.waitForTimeout(500);
  ok(errors.length === 0, `nothing thrown${errors.length ? `:\n       ${errors.slice(0, 8).join('\n       ')}` : ''}`);
} catch (err) {
  ok(false, `the check itself stopped: ${err?.message ?? err}`);
} finally {
  await browser.close();
  server.close();
}

if (fails.length) {
  console.error(`\ncheck-arcade: ${fails.length} failed — this copy shouldn't go out.`);
  process.exit(1);
}
console.log('\ncheck-arcade: all good.');
