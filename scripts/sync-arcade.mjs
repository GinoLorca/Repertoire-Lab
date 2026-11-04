// Brings Chess Arcade's Game Review into Repertoire Lab.
//
//   npm run sync:arcade                 from ../chess-arcade/index.html
//   npm run sync:arcade -- --from <file>
//   npm run sync:arcade -- --github     from GinoLorca/chess-arcade's main
//
// Game Review is Chess Arcade's own review screen, not a copy rewritten in
// React: the review, its cards, badges, CLAMP, tactics and their cues, the
// Notes card with its word links and diagrams, the engine and the explorer
// are all exactly what Chess Arcade runs. This script takes Chess Arcade's
// index.html as it is and makes three small changes to the copy:
//
//   1. Stockfish comes from /stockfish/ — the same files Repertoire Lab
//      already ships — instead of a folder beside the page.
//   2. A small bridge at the end of the app's own code (window.__rlReview),
//      which Repertoire Lab's Game Review tab talks to: open a game, put a
//      game's saved notes and analysis in, take them out when they change.
//      It runs only inside Repertoire Lab's frame.
//   3. In that frame, the parts of Chess Arcade that belong to Chess Arcade
//      (its home button, Friends, the way back to its Game History, its
//      groups of games) are hidden.
//
// The copy is written to public/arcade/review.<hash>.html — a new name for
// every new copy, so a phone never keeps an old one — and its name goes in
// src/lib/arcadeBuild.js for the app to load.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : (args[i + 1] ?? '');
};

async function source() {
  if (args.includes('--github')) {
    const url = 'https://raw.githubusercontent.com/GinoLorca/chess-arcade/main/index.html';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return { html: await res.text(), from: url, commit: '' };
  }
  const file = resolve(flag('--from') || join(root, '..', 'chess-arcade', 'index.html'));
  let commit = '';
  try {
    commit = execFileSync('git', ['-C', dirname(file), 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim();
  } catch { /* not a git checkout */ }
  return { html: readFileSync(file, 'utf8'), from: file, commit };
}

// Each change must find exactly what it expects, or the copy isn't written:
// a Chess Arcade that moved on in a way this script doesn't know about is
// better caught here than shipped half-working.
function replaceOnce(html, find, replace, what) {
  const at = html.indexOf(find);
  if (at < 0 || html.indexOf(find, at + 1) >= 0) {
    throw new Error(`sync-arcade: ${what} — expected exactly one match for ${JSON.stringify(find.slice(0, 80))}`);
  }
  return html.slice(0, at) + replace + html.slice(at + find.length);
}

// Inside the app's own closure, so it can reach the review's functions and
// its notes store by name. Everything it touches is listed here, in one
// place, for the next time Chess Arcade renames something.
const BRIDGE = String.raw`
  // ---- Repertoire Lab's Game Review (added by Repertoire Lab's scripts/sync-arcade.mjs; not in Chess Arcade itself) ----
  (function rlReviewBridge(){
    if(window.parent===window) return;
    let parentWin = null;
    try{ parentWin = window.parent.location.origin===location.origin ? window.parent : null; }catch(e){ parentWin = null; }
    if(!parentWin) return;
    document.documentElement.classList.add('rl-embed');
    const css = document.createElement('style');
    css.textContent = 'html.rl-embed #home-fab, html.rl-embed #friends-tab, html.rl-embed #view-play-history .back-link,'
      + ' html.rl-embed #hv-groups { display:none !important; }';
    document.head.appendChild(css);
    let quiet = 0, changeTimer = 0;
    const tell = (type, extra)=>{ try{ parentWin.postMessage(Object.assign({ source:'rl-review', type }, extra || {}), location.origin); }catch(e){} };
    // Every change to a note or a game's analysis is saved through gnPersist: after each one, the frame says so.
    const persist = gnPersist;
    gnPersist = function(){
      const ok = persist.apply(this, arguments);
      if(!quiet){ clearTimeout(changeTimer); changeTimer = setTimeout(()=> tell('change', { gid: HV_STATE && HV_STATE.game ? String(HV_STATE.game.id) : null }), 250); }
      return ok;
    };
    const textOf = (id)=> gnNoteText(id) || '';
    window.__rlReview = {
      v: 1,
      // The game's saved note and analysis, as Repertoire Lab keeps them on the game.
      records(gid){ gid = String(gid); return { note: textOf(gid), an: textOf('an-'+gid) }; },
      // Puts them in before the game opens (or while it's open: it opens again, at the same move).
      load(gid, rec){
        gid = String(gid);
        rec = rec || {};
        let changed = false;
        quiet++;
        try{
          [[gid, rec.note], ['an-'+gid, rec.an]].forEach(([id, t])=>{
            t = typeof t==='string' ? t : '';
            if(textOf(id)===t) return;
            gnSetNote(id, t, null);
            changed = true;
          });
        } finally { quiet--; }
        if(changed){
          const open = HV_STATE && HV_STATE.game && String(HV_STATE.game.id)===gid;
          if(open){ try{ hvAnnRefresh(); }catch(e){} try{ gnRefreshFields(); }catch(e){} }
          else HV_TREES.delete(gid);
        }
        return changed;
      },
      open(game, opts){ hvOpen(game, null, opts || {}); },
      current(){ return HV_STATE && HV_STATE.game ? String(HV_STATE.game.id) : null; },
      // What's being typed or drawn, saved now (leaving the tab, closing the app).
      flush(){
        try{ hvAnnSave(); }catch(e){}
        try{ if(hvNote) gnFieldSave(hvNote); }catch(e){}
      },
    };
    tell('ready');
  })();
`;

const { html: original, from, commit } = await source();
let html = original;
html = replaceOnce(
  html,
  "new URL('stockfish/stockfish-nnue-16-single.js', document.baseURI)",
  "new URL('/stockfish/stockfish-nnue-16-single.js', document.baseURI)",
  'Stockfish path',
);
html = replaceOnce(html, '\n})();\n</script>', `\n${BRIDGE}\n})();\n</script>`, 'end of the app');

const hash = createHash('sha256').update(html).digest('hex').slice(0, 10);
const outDir = join(root, 'public', 'arcade');
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) {
  if (/^review\.[0-9a-f]+\.html$/.test(f)) unlinkSync(join(outDir, f));
}
const name = `review.${hash}.html`;
writeFileSync(join(outDir, name), html);
writeFileSync(join(root, 'src', 'lib', 'arcadeBuild.js'), `// Written by scripts/sync-arcade.mjs — run \`npm run sync:arcade\` to update.
// Chess Arcade's Game Review, as Repertoire Lab's Game Review tab loads it.
export const ARCADE_REVIEW_URL = '/arcade/${name}';
export const ARCADE_FROM = ${JSON.stringify(commit || 'chess-arcade')};
`);
console.log(`sync-arcade: ${from}${commit ? ` (${commit})` : ''} → public/arcade/${name} (${(html.length / 1048576).toFixed(1)} MB)`);
