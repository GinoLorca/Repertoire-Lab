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
//      game's saved notes and analysis in, take them out when they change,
//      and wear Repertoire Lab's theme and piece set (look).
//      It runs only inside Repertoire Lab's frame.
//   3. In that frame, the parts of Chess Arcade that belong to Chess Arcade
//      (its home button, Friends, the way back to its Game History, its
//      groups of games) are hidden.
//
// The copy is written to public/arcade/review.<hash>.html — a new name for
// every new copy, so a phone never keeps an old one — and its name goes in
// src/lib/arcadeBuild.js for the app to load.
//
// Chess Arcade's piece sets reach Repertoire Lab's own boards only through
// `npm run sync:pieces` (scripts/sync-pieces.mjs), run by hand in an RL change
// that gets screenshots. This sync never writes that module: when a new copy's
// sets have moved on, the hourly job only warns (scripts/check-pieces.mjs).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
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
    const git = (...a) => execFileSync('git', ['-C', dirname(file), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    commit = git('log', '-1', '--format=%h %s');
    // a copy made from a working tree with changes of its own says so (ARCADE_FROM), as sync-pieces does
    if (commit && git('status', '--porcelain', '--', file)) commit += ' + uncommitted changes';
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

// Every name in Chess Arcade's own code the bridge below uses. Most of those calls sit in
// try/catch, so a Chess Arcade that renamed one would break a part of Game Review quietly:
// the copy answers __rlReview.missing() with any it no longer has, and scripts/check-arcade.mjs
// refuses a copy that names one; a Chess Arcade that doesn't declare one isn't copied at all
// (below). tests/arcadeSync.test.mjs keeps this list up to date with the bridge.
const USES = [
  'GH_STATE', 'GH_UI', 'GN', 'GN_TAC_MEMO', 'HV_STATE', 'HV_TREES', 'RP', 'RP_JOB', 'RP_RES',
  'applyLookPrefs', 'currentView', 'ghBaseList', 'ghGameFromSummary', 'ghOpenGame', 'ghRender',
  'ghoSetView', 'gnCleanG', 'gnFieldSave', 'gnIsAn', 'gnNoteText', 'gnPersist', 'gnRefreshFields',
  'gnSetNote', 'gnStatusText', 'gnStore', 'hvAnnRefresh', 'hvAnnSave', 'hvLineEnd', 'hvLrDraw',
  'hvNote', 'hvOnNode', 'hvOpen', 'hvRenderBoard', 'lookPrefs', 'rlDecode', 'rlEncode', 'rpFire',
  'rpMake', 'rpQueue', 'saveLookPrefs', 'showView', 'ttPractice', 'setAnnoProfile', 'annoProfile',
  'hrSave', 'hrLoad', 'hrSig', 'hrEncScore', 'hrDecScore', 'hrValidEntry', 'hrReadStore', 'hrJob',
  'hrRenderAll', 'hvRedraw', 'HR_BY_ID', 'HR_BY_CODE', 'GH_FILTERS', 'PIECE_SETS', 'HRS_VER', 'OJ_RS', 'OJ_VER',
  'ctModel', 'ctRender',
];
// …and the ones only a player's Positions uses (the bridge's POSITIONS part). Chess Arcade has had Positions as a tab of
// its own, with pawn structures, since 2026-11; a copy from before it is never asked for these, nor for Positions
// (ARCADE_POSITIONS, below). A copy that has it is asked about each, as about USES.
const USES_POSITIONS = [
  'GHP', 'GHP_IX', 'PSN', 'PS_GEN', 'ghpFrom', 'ghpLoadFen', 'ghpPlacement', 'ghpReveal', 'ghpSearch', 'gnOpenEditor',
  'psOpen', 'pxAfter', 'pxBackText',
];
// …and the parts of its page it reaches for (or hides: a renamed one would show again).
const USES_IDS = ['home-fab', 'view-history', 'gh-oj', 'piece-style-row', 'custom-piece-stroke-field'];

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
    // Hidden here: Chess Arcade's own ways around Chess Arcade, and the Settings that only
    // matter there — its accounts (Lichess, chess.com, Repertoire Lab, Spotify), its puzzles,
    // notes sync and Game History's opening checks, and its drills' titles and game intro. What
    // stays is what the review looks and sounds like: squares, arrows, line signs, background,
    // the board's cards, sounds and the tactic sound; the theme and the pieces are always
    // Repertoire Lab's own (look).
    const HIDE = ['#friends-tab', '#lichess-activity-widget',
      // a player's CLAMP, Tactics, Openings and Positions: Chess Arcade's page header, its way home, Game History's own
      // header (its title, the Lichess line, its tabs), its Games view's All games | Groups, its sites and the chess.com
      // offer. The way back from a board (Play it out) stays there: "← Positions"
      'html.rl-history #page-header', 'html.rl-history #home-fab', 'html.rl-history #settings-fab',
      'html.rl-history #view-history > .back-link', 'html.rl-history #view-history .history-head',
      'html.rl-history #gh-view', 'html.rl-history #gh-sub', 'html.rl-history #gh-site', 'html.rl-history #cc-offer', 'html.rl-history #cc-progress-sr', 'html.rl-embed:not(.rl-chrome):not(.rl-history) #view-play-history .back-link', '#hv-groups',
      // a game's row there: Add note (the note is the game's in Game Review; typed here it was lost) and Add to group
      // (Chess Arcade's own groups)
      'html.rl-history .gh-note-btn', 'html.rl-history .gh-grp-btn',
      // the review's "Find games with this position / this pawn structure": where there's a player whose games to search
      // (finds, below)
      'html.rl-embed:not(.rl-finds) .hv-pop-findpos', 'html.rl-embed:not(.rl-finds) .hv-pop-findpawns',
      // Chess Arcade's home button and the Game Review button: only while the review has the whole
      // window (Repertoire Lab's own bars are hidden then; see "corners" below)
      'html.rl-embed:not(.rl-chrome) #home-fab', 'html.rl-embed:not(.rl-chrome) #rl-menu',
      '#settings-overlay .field:has(#glass-row)', '#settings-overlay .field:has(#intro-row)', '#oj-field', '#gz-field',
      '#settings-overlay .field:has(#lichess-token-input)', '#gn-field', '#pz-sync-field', '#cc-field', '#rl-field',
      '#settings-overlay .field:has(#spotify-client-id-input)',
      // the Openings tab's "Connect Repertoire Lab": Repertoire Lab hands it the openings to sort by (repertoire)
      'html.rl-history #gho-connect',
      // Game History's Puzzles tab (Chess Arcade 2026-11): puzzles from the player's own games, searched by Stockfish on
      // Chess Arcade's own device; not part of the review Repertoire Lab embeds (its tab button goes with #gh-view)
      'html.rl-history #gz',
      // the review's "your usual in this line" (Chess Arcade 2026-11): read against the player's other games in Chess Arcade's
      // Game History; Chess Arcade's own for now
      '#hv-prep-usual',
      // the theme: always Repertoire Lab's own, dark or light as Repertoire Lab is (look)
      '#settings-overlay .field:has(#skin-row)', '#custom-colors-field',
      // "Hold a piece to draw": Repertoire Lab's own switch (Settings, the board), handed over with the look
      '#holddraw-field',
      // the pieces too: the set picked in Repertoire Lab (Settings → Themes → Piece style), and Custom's outline as
      // Repertoire Lab draws it (look); the Piece outline row only ever changed this frame
      '#settings-overlay .field:has(#piece-style-row)', '#custom-piece-stroke-field'];
    const css = document.createElement('style');
    css.textContent = HIDE.map((s)=> (s.indexOf('html')===0 ? s : 'html.rl-embed '+s)).join(', ')+' { display:none !important; }'
      + ' #rl-menu { position:fixed; right:16px; bottom:16px; z-index:40; display:flex; flex-direction:row-reverse; gap:8px; align-items:center; }'
      + ' #rl-save-pill.rl-done { color:var(--good); border-color:var(--good); }'
      // Highlighted side lines (yellow, neon green, blue): a highlighter pen rather than a solid box: about 70%,
      // soft edges that fade in and out unevenly, a slightly lopsided stroke — as if marked by hand.
      + ' html.rl-embed .hv-movelist .hv-var.hv-hl > .hv-var-line, html.rl-embed .hv-movelist .hv-nest.hv-hl {'
      + ' background: linear-gradient(100deg, transparent .4%, color-mix(in srgb, var(--hl) 62%, transparent) 2.2%,'
      + ' color-mix(in srgb, var(--hl) 70%, transparent) 5%, color-mix(in srgb, var(--hl) 64%, transparent) 38%,'
      + ' color-mix(in srgb, var(--hl) 70%, transparent) 71%, color-mix(in srgb, var(--hl) 60%, transparent) 95.5%, transparent 99.4%),'
      + ' linear-gradient(181deg, transparent 0%, color-mix(in srgb, var(--hl) 22%, transparent) 9%, transparent 24%,'
      + ' transparent 80%, color-mix(in srgb, var(--hl) 18%, transparent) 94%, transparent 100%) !important;'
      + ' border-radius: .9em .35em 1.05em .3em / .5em .95em .4em 1.1em !important; padding: 2px 8px !important;'
      + ' -webkit-box-decoration-break: clone; box-decoration-break: clone; }'
      // what Positions brings to the top of the screen (Find games by pawns and its answer, the library, your games in a
      // structure): below Repertoire Lab's own bar, which stays there
      + ' html.rl-history :is(#ghp-setup, #ghp-results, #ps-lib, #ps-mine) { scroll-margin-top:84px; }'
      // with the whole window, the way back to Game History keeps its place, unseen: the layout is Chess Arcade's to the pixel
      + ' html.rl-embed.rl-chrome #view-play-history .back-link { visibility:hidden !important; pointer-events:none !important; }'
      // The wheel (or a swipe) over this frame goes on to Repertoire Lab's page. Chess Arcade forbids that for its own
      // window (html, body: overscroll-behavior none, against the browser's pull-to-refresh), and here the frame is as
      // tall as what it shows, so it has nothing of its own to scroll: with the pointer over a player's CLAMP, Tactics or
      // Openings the wheel did nothing at all, and the page could only be scrolled from beside the frame or by its
      // scrollbar. Not while the review has the whole window (rl-chrome): there the frame scrolls itself.
      + ' html.rl-embed:not(.rl-chrome), html.rl-embed:not(.rl-chrome) body { overscroll-behavior:auto !important; }';
    document.head.appendChild(css);
    // Chess Arcade's "Below your usual" (its Opening's job filter, 2026-11) is read against the player's other games in Chess
    // Arcade's own Game History: not offered here. Taken out, not hidden (Safari draws a hidden <option> anyway); a stale one cleared.
    try{
      const o = document.querySelector('#gh-oj option[value="below"]');
      if(o) o.remove();
      if(typeof GH_FILTERS==='object' && GH_FILTERS && GH_FILTERS.oj==='below') GH_FILTERS.oj = '';
    }catch(e){}
    // ---- corners: while the review has the whole window, Repertoire Lab's controls sit where Chess
    // Arcade keeps its own — its home button (top left: back to Repertoire Lab's bars) and a Game
    // Review button (bottom right, where Chess Arcade keeps its Friends pill, which its review
    // leaves clear on a desktop and an iPad — bottom left is the board's own buttons on an iPad:
    // switch modes, open games), with Save beside it, in Chess Arcade's own style for the theme on show. A click on either goes to Repertoire
    // Lab; so does any other press in the review, to close Repertoire Lab's menu if it's open.
    const menu = document.createElement('div');
    menu.id = 'rl-menu';
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'friends-tab';
    pill.id = 'rl-menu-pill';
    pill.setAttribute('aria-haspopup', 'menu');
    pill.title = 'Switch to Engine, Compare lines, Board Editor or Studio, or open another game';
    pill.innerHTML = '<span>Game Review</span><span class="friends-chevron">&#9650;</span>';
    menu.appendChild(pill);
    // Save, beside it: a game that isn't saved yet (pasted, or played on a fresh board), or Save on one
    // that is (it's kept as you go; Save sends it to the student now). Repertoire Lab says which (saveState).
    const savePill = document.createElement('button');
    savePill.type = 'button';
    savePill.className = 'friends-tab';
    savePill.id = 'rl-save-pill';
    savePill.style.display = 'none';
    menu.appendChild(savePill);
    document.body.appendChild(menu);
    const chromeOn = ()=> document.documentElement.classList.contains('rl-chrome');
    document.addEventListener('click', (e)=>{
      if(!chromeOn() || !e.target || !e.target.closest) return;
      if(e.target.closest('#home-fab')){ e.preventDefault(); e.stopImmediatePropagation(); tell('home'); return; }
      if(e.target.closest('#rl-menu-pill')){ e.preventDefault(); e.stopImmediatePropagation(); tell('menu'); return; }
      if(e.target.closest('#rl-save-pill')){ e.preventDefault(); e.stopImmediatePropagation(); tell('save'); }
    }, true);
    document.addEventListener('pointerdown', (e)=>{
      if(chromeOn() && !(e.target && e.target.closest && e.target.closest('#rl-menu'))) tell('tap');
    }, true);
    // The Notes card's line under the note: Repertoire Lab keeps the note (on the game, synced),
    // so never "Connect Lichess to keep them on all your devices". A note this browser couldn't
    // save still says so, as Chess Arcade words it.
    const statusOf = gnStatusText;
    gnStatusText = function(gid){
      if(gnStore==='blocked' || gnStore==='full') return statusOf.apply(this, arguments);
      return gnNoteText(gid) ? 'Saved onto this game in Repertoire Lab.' : '';
    };
    let quiet = 0, changeTimer = 0;
    const tell = (type, extra)=>{ try{ parentWin.postMessage(Object.assign({ source:'rl-review', type }, extra || {}), location.origin); }catch(e){} };
    // Every change to a note or a game's analysis is saved through gnPersist: after each one, the frame says so.
    const persist = gnPersist;
    gnPersist = function(){
      const ok = persist.apply(this, arguments);
      if(!quiet){ clearTimeout(changeTimer); changeTimer = setTimeout(()=> tell('change', { gid: HV_STATE && HV_STATE.game ? String(HV_STATE.game.id) : null }), 250); }
      return ok;
    };
    // The arrow colour profile is one setting with Repertoire Lab's (Settings, the "Arrows:" label): one picked in
    // here (its label, its Settings) is told to Repertoire Lab, which keeps it and hands it back (arrows() below).
    const setProfile = setAnnoProfile;
    setAnnoProfile = function(){
      const was = annoProfile();
      const r = setProfile.apply(this, arguments);
      if(!quiet && annoProfile()!==was) tell('arrowProfile', { id: annoProfile() });
      return r;
    };
    const textOf = (id)=> gnNoteText(id) || '';
    // The kinds of record Chess Arcade keeps for a game besides its note: '<kind>-<game>' (an, lr, …).
    const KIND = /^[a-z]{2,3}$/;
    const kindsOf = (gid)=>{
      const tail = '-'+gid, out = [];
      Object.keys((typeof GN==='object' && GN && GN.notes) || {}).forEach(id=>{
        if(id.length > tail.length && id.endsWith(tail)){ const k = id.slice(0, -tail.length); if(KIND.test(k) && k!=='at') out.push(k); }
      });
      return out;
    };
    // The engine's review of a game (its badges, the graph, accuracy): Chess Arcade keeps it on this device only
    // (hrSave), so on another device, or the student's, the review had to be run again. Here it's one of the game's
    // records too, 'rv' — the entry hrSave stores, as JSON — kept on the game in Repertoire Lab like the others and
    // handed back on load. Opening a game, the newer of this device's review and the record's is shown; either
    // stands only for the same moves (n, h). Chess Arcade's notes take only its own kinds (gnIdOk), so the record
    // lives here, beside them.
    const RV = new Map();          // gid -> the 'rv' text Repertoire Lab gave, or that a review here just wrote
    const rvEntry = (S, R)=>{
      const r1 = (v)=> v==null || !Number.isFinite(v) ? null : Math.floor(v*10 + 0.5)/10;      // accuracy: 0-100
      return { at:R.at, n:S.main.length, h:hrSig(S), d:R.d, e:R.ev.map(hrEncScore).join(','),
        b:R.b.map((id)=> (HR_BY_ID[id] || { code:'.' }).code).join(''), a:[r1(R.acc.white), r1(R.acc.black)] };
    };
    const rvParse = (gid, t)=>{
      let e = null;
      try{ e = t ? JSON.parse(t) : null; }catch(err){ e = null; }
      return e && hrValidEntry(gid, e) ? e : null;
    };
    // The newest review of the game this device knows: the record's or its own store's, as the record's text.
    const rvText = (gid)=>{
      const mine = (()=>{ try{ return hrReadStore().g[gid] || null; }catch(err){ return null; } })();
      const rec = rvParse(gid, RV.get(gid) || '');
      const e = rec && (!mine || (rec.at || 0) >= (mine.at || 0)) ? rec : mine;
      return e ? JSON.stringify(e) : '';
    };
    // blunders (Chess Arcade's blOf, ojRevs): the reviews Repertoire Lab gave count as this device's own
    const storeWas = hrReadStore;
    hrReadStore = function(){
      const st = storeWas.apply(this, arguments);
      RV.forEach((t, gid)=>{ const e = rvParse(gid, t), m = st.g[gid]; if(e && !(m && (m.at || 0) >= (e.at || 0))) st.g[gid] = e; });
      return st;
    };
    const rvFresh = ()=>{ HRS_VER++; OJ_RS = null; OJ_VER++; };
    const reviewSaved = hrSave;
    hrSave = function(S, R){
      const ok = reviewSaved.apply(this, arguments);
      try{
        const gid = S && S.game && S.game.id ? String(S.game.id) : '';
        const e = gid && R && !R.partial ? rvEntry(S, R) : null;
        if(e && hrValidEntry(gid, e)){
          RV.set(gid, JSON.stringify(e));
          if(!quiet) tell('change', { gid });
        }
      }catch(err){}
      return ok;
    };
    const reviewLoaded = hrLoad;
    hrLoad = function(S){
      let mine = null;
      try{ mine = reviewLoaded.apply(this, arguments); }catch(err){ mine = null; }
      const gid = S && S.game && S.game.id ? String(S.game.id) : '';
      const e = gid ? rvParse(gid, RV.get(gid) || '') : null;
      if(!e || e.n!==S.main.length || e.h!==hrSig(S) || (mine && (mine.at || 0) >= e.at)) return mine;
      return { ev:e.e.split(',').map(hrDecScore), b:e.b.split('').map((c)=> HR_BY_CODE[c] ? HR_BY_CODE[c].id : null),
        acc:{ white:e.a[0], black:e.a[1] }, at:e.at, d:e.d, partial:false };
    };
    // The line on the board, from the start to the end of the line being looked at: on a fresh board,
    // the moves played (they're side lines there, the game having none of its own).
    const playedLine = ()=>{
      const S = HV_STATE;
      if(!S || !S.cur) return [];
      const out = [];
      for(let n = hvLineEnd(S.cur); n && n.parent; n = n.parent) out.unshift(n.san);
      return out;
    };
    hvOnNode(()=> tell('node', { plies: playedLine().length }));
    // A link to a Repertoire Lab chapter (the Openings tab's, a line's Learn and Practice) opens it in Repertoire
    // Lab itself, not in a new tab.
    document.addEventListener('click', (e)=>{
      const a = e.target && e.target.closest ? e.target.closest('a[href^="https://repertoirelabs.com/chapter/"]') : null;
      if(!a) return;
      const m = /^https:\/\/repertoirelabs\.com\/chapter\/([^/?#]+)\/([^/?#]+)\/?(?:\?([^#]*))?/.exec(a.href);
      if(!m) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const q = new URLSearchParams(m[3] || '');
      tell('openChapter', { openingId: decodeURIComponent(m[1]), chapterId: decodeURIComponent(m[2]), line: q.get('line') || null, go: q.get('go') || null });
    }, true);

    // ---- a player's CLAMP, Tactics, Openings and Positions (Repertoire Lab's player page): Chess Arcade's own Game History
    // tabs, over that player's games only — their analysis records, with the summary each tab reads (who had which side,
    // the result, the speed, the moves). Game History's way around Chess Arcade (its sites, its other tabs, the
    // chess.com offer, the page's own header) is hidden; opening a game, or a moment, goes to Repertoire Lab's Game
    // Review; Practice opens that tactic's puzzles on Lichess. The frame is as tall as the page (height).
    const historyOn = ()=> document.documentElement.classList.contains('rl-history');
    const openGameWas = ghOpenGame;
    ghOpenGame = function(g, opts){
      if(historyOn() && g && g.id){
        const o = opts || {};
        tell('openGame', { gid: String(g.id), opts: { at: o.at || null, clamp: o.clamp || null, tac: o.tac || null },
          place: POSITIONS && GH_UI.view==='positions' ? placeNow() : null });
        return Promise.resolve();
      }
      return openGameWas.apply(this, arguments);
    };
    // The Openings and Positions tabs: Game History's list is every game of the player's that Repertoire Lab hands over
    // (history), not only the ones with a note. CLAMP: the games handed over too (marked, badged or reviewed), so a review's
    // blunders count with no letter on the game, and a letter's games are listed. Tactics keeps reading the games with marks,
    // as before.
    let rlBase = null;
    const baseWas = ghBaseList;
    ghBaseList = function(){
      if(historyOn() && rlBase && (GH_UI.view==='openings' || GH_UI.view==='positions' || GH_UI.view==='clamp')) return rlBase.slice();
      return baseWas.apply(this, arguments);
    };
    // CLAMP isn't given the player's other games, so what it says of all of them stays out: "Not marked yet" (losses with no
    // letters) and "of N games against people".
    const modelWas = ctModel;
    ctModel = function(){
      const md = modelWas.apply(this, arguments);
      if(historyOn() && md) md.loss = 0;
      return md;
    };
    const renderWas = ctRender;
    ctRender = function(){
      const r = renderWas.apply(this, arguments);
      const c = historyOn() ? document.getElementById('gh-count') : null, t = c ? c.textContent.replace(/ of [\d,]+ games? against people$/, '') : '';
      if(c && c.textContent!==t) c.textContent = t;
      return r;
    };
    const practiceWas = ttPractice;
    ttPractice = function(key){
      if(historyOn()){ try{ window.open('https://lichess.org/training/'+encodeURIComponent(key), '_blank', 'noopener'); }catch(e){} return; }
      return practiceWas.apply(this, arguments);
    };
    let heightWas = 0, lookSig = '';
    const sayHeight = ()=>{
      if(!historyOn() || currentView!=='history') return;
      const v = document.getElementById('view-history');
      const h = v ? Math.ceil(v.getBoundingClientRect().bottom + window.scrollY + 24) : 0;
      if(h && Math.abs(h - heightWas) > 2){ heightWas = h; tell('height', { h }); }
    };
    try{ new ResizeObserver(sayHeight).observe(document.getElementById('view-history')); }catch(e){}
    // A board in a player's tab (Play it out): Repertoire Lab gives the frame the whole window while it's up (board), so
    // it's the size it is in Chess Arcade. Its own way back (the link above it, Esc) puts the tab back as it was.
    const practiceOn = ()=> currentView==='play-history' && !!(HV_STATE && HV_STATE.game && HV_STATE.game._practice);
    let boardWas = false;
    const showWas = showView;
    showView = function(){
      const r = showWas.apply(this, arguments);
      const on = historyOn() && currentView==='play-history';
      if(on!==boardWas){ boardWas = on; tell('board', { on }); }
      return r;
    };
    let tabWas = '', gamesWas = '';
    // ---- Positions (Pawn structures | Find a position): only a copy that has it (USES_POSITIONS)
    const POSITIONS = !!document.getElementById('ghp-sub');
    // Repertoire Lab hands over a game's moves, not its last position: a row's little board gets it when it's drawn
    const lastOf = (g)=>{
      if(!g || g.lastFen) return;
      let fen = null;
      try{
        Object.defineProperty(g, 'lastFen', { configurable:true, enumerable:false, get(){
          if(fen===null){ try{ const t = String(g.moves || '').trim().split(/\s+/); fen = pxAfter(t, t.length, null) || ''; }catch(e){ fen = ''; } }
          return fen;
        } });
      }catch(e){}
    };
    let findWas = null, openWas = null;
    // where you are in it, to come back to after a game (place): the sub-tab, a structure's page, what's open on it, a
    // search, how far down
    const placeNow = ()=>{
      const P = PSN.pg || {};
      return { sub:GH_UI.psub==='find' ? 'find' : 'structures', card:String(GH_UI.pcard || ''), m:GH_UI.pm ? 1 : 0, color:String(GH_UI.pc || ''),
        open:String(PSN.open || ''), n:Number(PSN.n) || 0, rows:Number(PSN.rows) || 0, more:String(PSN.more || ''),
        pg:P.id ? { id:String(P.id), f:String(P.f || ''), n:Number(P.n) || 0, more:!!P.more } : null,
        find:GHP.q ? { fen:ghpPlacement(), flip:!!GHP.flip, color:String(GHP.color || ''), pmode:GHP.pmode==='similar' ? 'similar' : 'structure' } : null,
        y:window.scrollY };
    };
    const placeSet = (o)=>{
      const str = (v)=> typeof v==='string' ? v.slice(0, 200) : '', num = (v)=> Math.max(0, Math.min(5000, Math.floor(Number(v) || 0)));
      GH_UI.psub = o.sub==='find' ? 'find' : 'structures';
      PSN.open = str(o.open); PSN.n = num(o.n); PSN.rows = num(o.rows); PSN.more = str(o.more);
      const p = o.pg && str(o.pg.id) ? o.pg : null;
      if(p) PSN.pg = { id:str(p.id), f:str(p.f), n:num(p.n), more:!!p.more };
      if(o.find && ghpLoadFen(str(o.find.fen))){
        GHP.flip = !!o.find.flip;
        GHP.color = o.find.color==='white' || o.find.color==='black' ? o.find.color : '';
        GHP.pmode = o.find.pmode==='similar' ? 'similar' : 'structure';
        ghpSearch();
      }
      if(o.card) openWas(str(o.card), o.m ? 1 : 0, { color:str(o.color) });
      else ghRender();
      // (in full screen the frame scrolls itself: down to where you were, once there's that much to scroll)
      const y = num(o.y);
      let tries = y ? 12 : 0;
      const down = ()=>{
        if(!tries-- || currentView!=='history' || GH_UI.view!=='positions') return;
        if(document.documentElement.scrollHeight - window.innerHeight >= y){ window.scrollTo(0, y); return; }
        setTimeout(down, 150);
      };
      down();
    };
    if(POSITIONS){
      // "Find games with this position / pawn structure" in a review: Repertoire Lab shows the player's Positions. On a
      // board in Positions itself (Play it out), that's here.
      findWas = ghpFrom;
      ghpFrom = function(fen, flip, sub){
        if(historyOn() && practiceOn() && GH_UI.view==='positions') return findWas.apply(this, arguments);
        tell('findPosition', { fen:String(fen || ''), flip:!!flip, sub:sub==='structures' ? 'structures' : 'find' });
      };
      // a structure's page opens at its top, and Back goes back to where you were: the frame is as tall as what it
      // shows, so Repertoire Lab's page is what scrolls
      openWas = psOpen;
      psOpen = function(id, m, o){
        const was = String(GH_UI.pcard || ''), r = openWas.apply(this, arguments), now = String(GH_UI.pcard || '');
        if(historyOn() && now!==was && !(o && o.stay)) tell('page', { to:!now ? 'back' : 'top', from:was });
        return r;
      };
      // the way back from a board says the tab
      const backWas = pxBackText;
      pxBackText = function(P){
        const name = { openings:'Openings', positions:'Positions', clamp:'CLAMP', tactics:'Tactics' }[GH_UI.view];
        return historyOn() && name && !(P && P.back && P.back.game) ? name : backWas.apply(this, arguments);
      };
      // a note's line on a row opens the game in Game Review, where the note is (an editor here would lose what's typed)
      const noteWas = gnOpenEditor;
      gnOpenEditor = function(g){
        if(historyOn() && g){ ghOpenGame(g, {}); return; }
        return noteWas.apply(this, arguments);
      };
    }
    window.__rlReview = {
      v: 1,
      // Everything Chess Arcade keeps for the game, as Repertoire Lab keeps it on the game: the note,
      // and each '<kind>-<game>' record (an: the analysis, lr: Larry's review, and any kind added later).
      records(gid){
        gid = String(gid);
        const out = { note: textOf(gid), an: textOf('an-'+gid) };
        kindsOf(gid).forEach(k=>{ const t = textOf(k+'-'+gid); if(t) out[k] = t; });
        const rv = rvText(gid);
        if(rv) out.rv = rv;
        return out;
      },
      // Puts them in before the game opens (or while it's open: it opens again, at the same move).
      load(gid, rec){
        gid = String(gid);
        rec = rec || {};
        let changed = false;
        quiet++;
        try{
          // every kind the game has, here or in Repertoire Lab: one Repertoire Lab doesn't have is cleared
          const kinds = new Set(['note', 'an'].concat(kindsOf(gid), Object.keys(rec).filter(k=> KIND.test(k) && k!=='at' && k!=='rv')));
          kinds.forEach(k=>{
            const id = k==='note' ? gid : k+'-'+gid;
            const t = typeof rec[k]==='string' ? rec[k] : '';
            if(textOf(id)===t) return;
            gnSetNote(id, t, null);
            changed = true;
          });
        } finally { quiet--; }
        // the engine's review, kept here (RV): a newer one shows on the open game at once, unless one is running
        const rv = typeof rec.rv==='string' ? rec.rv : '';
        let rvChanged = false;
        if((RV.get(gid) || '')!==rv){
          if(rv) RV.set(gid, rv); else RV.delete(gid);
          rvChanged = true;
        }
        const open = HV_STATE && HV_STATE.game && String(HV_STATE.game.id)===gid;
        if(changed){
          if(open){ try{ hvAnnRefresh(); }catch(e){} try{ gnRefreshFields(); }catch(e){} try{ if(typeof hvLrDraw==='function') hvLrDraw(); }catch(e){} }
          else HV_TREES.delete(gid);
        }
        if(rvChanged && open && !hrJob){
          try{ HV_STATE.review = hrLoad(HV_STATE); hrRenderAll(); hvRedraw(); }catch(e){}
        }
        return changed || rvChanged;
      },
      open(game, opts){ hvOpen(game, null, opts || {}); },
      // Clear analysis is for a player's own copy (open()'s _noClear): said again when a coach's review of the open game comes in.
      noClear(gid, on){
        const g = HV_STATE && HV_STATE.game;
        if(!g || String(g.id)!==String(gid) || g._noClear===!!on) return false;
        g._noClear = !!on;
        try{ hrRenderAll(); }catch(e){}
        return true;
      },
      // Repertoire Lab's corners on (the review has the whole window) or off.
      chrome(on){
        document.documentElement.classList.toggle('rl-chrome', !!on);
        const home = document.getElementById('home-fab');
        if(home){ home.title = on ? 'Back to Repertoire Lab' : ''; home.setAttribute('aria-label', on ? 'Back to Repertoire Lab' : 'Home'); }
      },
      current(){ return HV_STATE && HV_STATE.game ? String(HV_STATE.game.id) : null; },
      line(){ return playedLine(); },
      // games: [{ id, an, rv?, summary }] — that player's, and only theirs (rv: the game's review); view: 'clamp' | 'tactics' |
      // 'openings' | 'positions' (Openings and Positions: every game with moves, marked or not). place: Positions as it was
      // when a game was opened from it (openGame's place).
      history(games, view, place){
        const want = new Set((games || []).map((g)=> 'an-'+String(g.id)));
        quiet++;
        try{
          Object.keys(GN.notes).forEach((id)=>{ if(gnIsAn(id) && !want.has(id)) delete GN.notes[id]; });
          (games || []).forEach((g)=>{
            const id = 'an-'+String(g.id);
            if(textOf(id)!==String(g.an || '')) gnSetNote(id, String(g.an || ''), null);
            const n = GN.notes[id];
            if(n) n.g = gnCleanG(g.summary);
          });
          gnPersist();
        } finally { quiet--; }
        try{ GN_TAC_MEMO.clear(); }catch(e){}
        RV.clear();
        (games || []).forEach((g)=>{ if(typeof g.rv==='string' && rvParse(String(g.id), g.rv)) RV.set(String(g.id), g.rv); });
        rvFresh();
        const tab = view === 'tactics' ? 'tactics' : view === 'openings' ? 'openings' : view === 'positions' && POSITIONS ? 'positions' : 'clamp';
        rlBase = tab !== 'tactics'
          ? (games || []).filter((g)=> g && g.summary).map((g)=> ghGameFromSummary({ id: String(g.id), g: gnCleanG(g.summary) })).filter((g)=> g.moves)
          : null;
        if(POSITIONS && rlBase) rlBase.forEach(lastOf);
        // Game History counts itself loaded once its own list has games (it's Lichess's, here none): the Openings, Positions
        // and CLAMP tabs' are those; Tactics goes back to reading the games with marks.
        GH_STATE.games = rlBase ? rlBase.slice() : [];
        GH_STATE.ids = new Set(GH_STATE.games.map((g)=> g.id));
        GH_STATE.exhausted = true;
        // Positions keeps what it has read of a game by its id: games changed since (a move corrected, a result) are read again
        if(tab==='positions'){
          const sig = JSON.stringify(rlBase.map((g)=> [g.id, g.moves, g.winner || '', g._me || '', g.speed || '']));
          if(gamesWas && gamesWas!==sig){ GHP_IX.clear(); GHP.res = null; PS_GEN++; }
          gamesWas = sig;
        }
        const here = historyOn() && tabWas===tab;
        tabWas = tab;
        document.documentElement.classList.add('rl-history');
        document.documentElement.classList.remove('rl-chrome');
        if(POSITIONS) document.documentElement.classList.add('rl-finds');
        // (a board of this tab's is up, Play it out: it stays, and the tab draws the games on the way back)
        if(here && practiceOn()) return;
        if(currentView!=='history') showView('history');
        if(GH_UI.view!==tab) ghoSetView(tab);
        else ghRender();
        if(rlBase && RP){ try{ rpQueue(); }catch(e){} }
        if(!here) window.scrollTo(0, 0);
        heightWas = 0;
        setTimeout(sayHeight, 60);
        if(tab==='positions' && place && typeof place==='object'){ try{ placeSet(place); }catch(e){} }
      },
      // This copy has Positions, and what it shows of the player's games that reach a position (sub 'find') or its pawns
      // ('structures'): the board set up, searched.
      positions: POSITIONS,
      find(fen, flip, sub){
        if(!POSITIONS || !historyOn() || GH_UI.view!=='positions') return false;
        findWas(String(fen || ''), !!flip, sub==='structures' ? 'structures' : 'find');
        // Pawn structures' search is its third panel: to it again once its answer (and the panels over it) are drawn
        if(GH_UI.psub==='structures') [350, 1100].forEach((t)=> setTimeout(()=>{ if(GH_UI.view==='positions' && GHP.q && !GH_UI.pcard) ghpReveal(false); }, t));
        return true;
      },
      // Whether the review's "Find games with…" have somewhere to look: the game on the board is a player's.
      finds(on){ document.documentElement.classList.toggle('rl-finds', POSITIONS && !!on); },
      // Back from a board in a player's tab, as its own way back does it. Whether there was one.
      back(){
        if(!historyOn() || currentView!=='play-history') return false;
        const b = document.querySelector('#view-play-history .back-link');
        if(b) b.click();
        return currentView!=='play-history';
      },
      // The repertoire the Openings tab sorts games by: the openings Repertoire Lab picked, in Chess Arcade's own
      // compact form ({ o:[{ i, n, c:'w'|'b', k:[[courseId, name]], ch:[{ i, n, k, s, ss, l:[[id, name, moves[], fen|null]] }] }] }),
      // checked the way a copy read from Repertoire Lab is. None: the tab groups games by opening name.
      // Also Game Review's: its book moves, review prep and Similar openings check the game against it.
      // o: { label, whose }: what Chess Arcade calls it on its cards ("Joseph's + yours") and in a sentence
      // ("Joseph's repertoire or yours"); none, "your repertoire".
      repertoire(p, o){
        const uid = 'rl-embed';
        const name = (v)=> typeof v==='string' && v.trim() ? v.trim().slice(0, 80) : null;
        const label = name(o && o.label), whose = name(o && o.whose);
        let dec = null;
        try{
          if(p && Array.isArray(p.o) && p.o.length) dec = rlDecode(rlEncode({ v:1, uid, email:'', at:Date.now(), o:p.o }), uid);
        }catch(e){ dec = null; }
        if(!dec || !dec.o.length){
          if(RP){ RP = null; RP_RES = new Map(); RP_JOB = null; rpFire('rep'); }
          if(historyOn()) ghRender();
          return 0;
        }
        if(!RP || RP.h!==dec.h){ rpMake(dec, null); RP.label = label; RP.whose = whose; rpFire('rep'); try{ rpQueue(); }catch(e){} }
        else if(RP.label!==label || RP.whose!==whose){ RP.label = label; RP.whose = whose; rpFire('rep'); }
        return RP.openings.length;
      },
      // Repertoire Lab's arrow colour profile ('default' | 'sequential' | 'strategic' | 'gamereview'): the marks
      // on the boards in here follow it, as Repertoire Lab's own do. Whether it changed.
      arrows(id){
        if(typeof id!=='string' || id===annoProfile()) return false;
        quiet++;
        try{ setAnnoProfile(id); } finally { quiet--; }
        return annoProfile()===id;
      },
      // Repertoire Lab's theme, dark or light as it is there: { skin, theme:'dark'|'light', colors, pieces } (colors:
      // Custom's own, as Repertoire Lab paints them, its outline included; pieces: the piece set Repertoire Lab's boards
      // draw, by its key). Chess Arcade's theme and piece pickers are hidden here: the look is Repertoire Lab's. The set
      // is kept as this theme's pick (pieceStyleBySkin), and saved, so Chess Arcade's own row, data-pset and the boards
      // all agree, and the next load paints it before Repertoire Lab says so again. A set this copy doesn't have (one
      // newer than it) leaves the theme's own set.
      look(o){
        o = o || {};
        const SK = ['felt','hustler','bauhaus','gameboy','outerspace','drivethru','rose','chessbook','uptown','cards','custom'];
        const skin = SK.indexOf(o.skin)>=0 ? o.skin : 'custom';
        const theme = o.theme==='light' ? 'light' : 'dark';
        const col = (v)=> typeof v==='string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(v.trim()) ? v.trim() : null;
        const has = (k)=> typeof k==='string' && Object.prototype.hasOwnProperty.call(PIECE_SETS, k);
        const pieces = has(o.pieces) ? o.pieces : null;
        const c = o.colors || {};
        const colors = skin==='custom' ? { accent:col(c.accent), bg:col(c.bg), surface:col(c.surface), boardLight:col(c.boardLight),
          boardDark:col(c.boardDark), pieceWhite:col(c.pieceWhite), pieceBlack:col(c.pieceBlack), pieceStroke:col(c.pieceStroke) } : null;
        // A finger rested on a piece draws an arrow from it (Repertoire Lab's "Hold a piece to draw"), or picks it up.
        const hold = o.holdDraw===false ? 'off' : 'on';
        const sig = skin+'|'+theme+'|'+JSON.stringify(colors)+'|'+hold+'|'+(pieces || '');
        if(sig===lookSig) return false;
        lookSig = sig;
        lookPrefs.skin = skin;
        lookPrefs.holdDrawPieces = hold;
        if(colors) lookPrefs.customColors = colors;
        // the outline switch is hidden here: never left off
        lookPrefs.pieceStrokeEnabled = true;
        if(!lookPrefs.pieceStyleBySkin || typeof lookPrefs.pieceStyleBySkin!=='object') lookPrefs.pieceStyleBySkin = {};
        if(pieces) lookPrefs.pieceStyleBySkin[skin] = pieces;
        else delete lookPrefs.pieceStyleBySkin[skin];
        document.documentElement.setAttribute('data-theme', theme);
        applyLookPrefs();
        try{ saveLookPrefs(); }catch(e){}
        try{ if(HV_STATE && HV_STATE.game) hvRenderBoard(); }catch(e){}
        try{ if(historyOn()) ghRender(); }catch(e){}
        return true;
      },
      // The Save button in the corner: null hides it; { label, title, done } shows it.
      saveState(st){
        if(!st){ savePill.style.display = 'none'; return; }
        savePill.style.display = '';
        savePill.textContent = st.label || 'Save';
        savePill.title = st.title || '';
        savePill.classList.toggle('rl-done', !!st.done);
      },
      // What's being typed or drawn, saved now (leaving the tab, closing the app).
      flush(){
        try{ hvAnnSave(); }catch(e){}
        try{ if(hvNote) gnFieldSave(hvNote); }catch(e){}
      },
      // What this bridge uses of Chess Arcade that this Chess Arcade doesn't have (scripts/check-arcade.mjs).
      // (Each name is read: only one that's gone throws, whatever it holds.)
      missing(){
        const gone = [];
        ${USES.map((n) => `try{ void ${n}; }catch(e){ gone.push('${n}'); }`).join('\n        ')}
        if(POSITIONS){
        ${USES_POSITIONS.map((n) => `try{ void ${n}; }catch(e){ gone.push('${n}'); }`).join('\n        ')}
        }
        return gone.concat(${JSON.stringify(USES_IDS)}.filter((id)=> !document.getElementById(id)).map((id)=> '#'+id));
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
// Chess Arcade's own "sign in with Repertoire Lab" (its Game History sorting) carries
// Repertoire Lab's Firebase web key. Inside Repertoire Lab that sign-in is hidden and never
// used, so the copy goes without it — and a key in a file in the repository is what
// Netlify's secrets scan refuses to deploy.
const keyLine = html.match(/var RL_API_KEY = '[^']*';/g) ?? [];
if (keyLine.length !== 1) throw new Error(`sync-arcade: expected one RL_API_KEY line, found ${keyLine.length}`);
html = html.replace(keyLine[0], "var RL_API_KEY = '';      // left out of Repertoire Lab's copy (scripts/sync-arcade.mjs)");
// Nothing that looks like a key, token or private key goes into the repository — a new one
// in a later Chess Arcade stops the copy here, rather than the deploy on Netlify.
const SECRETS = [
  /AIza[0-9A-Za-z_-]{35}/, /AKIA[0-9A-Z]{16}/, /lip_[0-9A-Za-z]{16,}/, /\bsk[-_](?:live|test)?[-_]?[A-Za-z0-9]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/, /xox[abpr]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
for (const re of SECRETS) {
  const m = html.match(re);
  if (m) throw new Error(`sync-arcade: the copy would contain something that looks like a secret (${m[0].slice(0, 8)}…, matching ${re}) — not written`);
}
// The copy's code has to parse: one slip in it (a name declared twice, say) and Game Review
// is a blank page in Repertoire Lab. Compiled here, never run. Chess Arcade is one plain
// <script>; anything else (JSON, a module) is left to the browser check.
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(([, attrs]) => !/\btype=/i.test(attrs) || /\btype=["']?(?:text|application)\/javascript/i.test(attrs));
if (!scripts.length) throw new Error('sync-arcade: no code found in the copy — not written');
for (const [, , code] of scripts) {
  try {
    new vm.Script(code, { filename: 'chess-arcade-copy.js' }); // eslint-disable-line no-new
  } catch (err) {
    throw new Error(`sync-arcade: the copy's code doesn't parse (${err.message}) — not written`);
  }
}

// A Chess Arcade without something the bridge uses (an older one than this script is written for, or one
// that renamed it) would be a copy that breaks as it's used: not written.
const declared = new Set();
for (const m of original.matchAll(/^ {2}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) declared.add(m[1]);
for (const m of original.matchAll(/^ {2}(?:const|let|var)\s+([^;]*);/gm)) {
  for (const part of m[1].split(',')) declared.add(part.split('=')[0].trim());
}
const gone = USES.filter((n) => !declared.has(n));
if (gone.length) throw new Error(`sync-arcade: this Chess Arcade doesn't have ${gone.join(', ')}, which the bridge uses — not written`);

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
// Whether that copy has Positions (pawn structures): the player page's Positions tab, and Game Review's "Find games with…".
export const ARCADE_POSITIONS = ${original.includes('id="ghp-sub"')};
`);
console.log(`sync-arcade: ${from}${commit ? ` (${commit})` : ''} → public/arcade/${name} (${(html.length / 1048576).toFixed(1)} MB)`);
