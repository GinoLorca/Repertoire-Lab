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

// Every name in Chess Arcade's own code the bridge below uses. Most of those calls sit in
// try/catch, so a Chess Arcade that renamed one would break a part of Game Review quietly:
// the copy answers __rlReview.missing() with any it no longer has, and scripts/check-arcade.mjs
// refuses a copy that names one. tests/arcadeSync.test.mjs keeps this list up to date with
// the bridge.
const USES = [
  'GH_STATE', 'GH_UI', 'GN', 'GN_TAC_MEMO', 'HV_STATE', 'HV_TREES', 'RP', 'RP_JOB', 'RP_RES',
  'applyLookPrefs', 'currentView', 'ghBaseList', 'ghGameFromSummary', 'ghOpenGame', 'ghRender',
  'ghoSetView', 'gnCleanG', 'gnFieldSave', 'gnIsAn', 'gnNoteText', 'gnPersist', 'gnRefreshFields',
  'gnSetNote', 'gnStatusText', 'gnStore', 'hvAnnRefresh', 'hvAnnSave', 'hvLineEnd', 'hvLrDraw',
  'hvNote', 'hvOnNode', 'hvOpen', 'hvRenderBoard', 'lookPrefs', 'rlDecode', 'rlEncode', 'rpFire',
  'rpMake', 'rpQueue', 'saveLookPrefs', 'showView', 'ttPractice',
];
// …and the parts of its page it reaches for.
const USES_IDS = ['home-fab', 'view-history'];

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
    // stays is what the review looks and sounds like: theme, pieces, squares, arrows, line signs,
    // background, the board's cards, sounds and the tactic sound.
    const HIDE = ['#friends-tab', '#lichess-activity-widget',
      // a player's CLAMP and Tactics: Chess Arcade's page header, its way home, Game History's own header (its title,
      // the Lichess line, its tabs), its sites and the chess.com offer
      'html.rl-history #page-header', 'html.rl-history #home-fab', 'html.rl-history #settings-fab',
      'html.rl-history #view-history > .back-link', 'html.rl-history #view-history .history-head',
      'html.rl-history #gh-view', 'html.rl-history #gh-site', 'html.rl-history #cc-offer', 'html.rl-history #cc-progress-sr', 'html.rl-embed:not(.rl-chrome) #view-play-history .back-link', '#hv-groups',
      // Chess Arcade's home button and the Game Review button: only while the review has the whole
      // window (Repertoire Lab's own bars are hidden then; see "corners" below)
      'html.rl-embed:not(.rl-chrome) #home-fab', 'html.rl-embed:not(.rl-chrome) #rl-menu',
      '#settings-overlay .field:has(#glass-row)', '#settings-overlay .field:has(#intro-row)', '#oj-field',
      '#settings-overlay .field:has(#lichess-token-input)', '#gn-field', '#pz-sync-field', '#cc-field', '#rl-field',
      '#settings-overlay .field:has(#spotify-client-id-input)',
      // the Openings tab's "Connect Repertoire Lab": Repertoire Lab hands it the openings to sort by (repertoire)
      'html.rl-history #gho-connect',
      // the theme: always Repertoire Lab's own, dark or light as Repertoire Lab is (look)
      '#settings-overlay .field:has(#skin-row)', '#custom-colors-field'];
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
      // with the whole window, the way back to Game History keeps its place, unseen: the layout is Chess Arcade's to the pixel
      + ' html.rl-embed.rl-chrome #view-play-history .back-link { visibility:hidden !important; pointer-events:none !important; }';
    document.head.appendChild(css);
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

    // ---- a player's CLAMP and Tactics (Repertoire Lab's player page): Chess Arcade's own two Game History tabs,
    // over that player's games only — their analysis records, with the summary each tab reads (who had which side,
    // the result, the speed, the moves). Game History's way around Chess Arcade (its sites, its other tabs, the
    // chess.com offer, the page's own header) is hidden; opening a game, or a moment, goes to Repertoire Lab's Game
    // Review; Practice opens that tactic's puzzles on Lichess. The frame is as tall as the page (height).
    const historyOn = ()=> document.documentElement.classList.contains('rl-history');
    const openGameWas = ghOpenGame;
    ghOpenGame = function(g, opts){
      if(historyOn() && g && g.id){
        const o = opts || {};
        tell('openGame', { gid: String(g.id), opts: { at: o.at || null, clamp: o.clamp || null, tac: o.tac || null } });
        return Promise.resolve();
      }
      return openGameWas.apply(this, arguments);
    };
    // The Openings tab: Game History's list is every game of the player's that Repertoire Lab hands over (history),
    // not only the ones with a note — CLAMP and Tactics keep reading the games with marks, as before.
    let rlBase = null;
    const baseWas = ghBaseList;
    ghBaseList = function(){
      if(historyOn() && rlBase && GH_UI.view==='openings') return rlBase.slice();
      return baseWas.apply(this, arguments);
    };
    const practiceWas = ttPractice;
    ttPractice = function(key){
      if(historyOn()){ try{ window.open('https://lichess.org/training/'+encodeURIComponent(key), '_blank', 'noopener'); }catch(e){} return; }
      return practiceWas.apply(this, arguments);
    };
    let heightWas = 0, lookSig = '';
    const sayHeight = ()=>{
      if(!historyOn()) return;
      const v = document.getElementById('view-history');
      const h = v ? Math.ceil(v.getBoundingClientRect().bottom + window.scrollY + 24) : 0;
      if(h && Math.abs(h - heightWas) > 2){ heightWas = h; tell('height', { h }); }
    };
    try{ new ResizeObserver(sayHeight).observe(document.getElementById('view-history')); }catch(e){}
    window.__rlReview = {
      v: 1,
      // Everything Chess Arcade keeps for the game, as Repertoire Lab keeps it on the game: the note,
      // and each '<kind>-<game>' record (an: the analysis, lr: Larry's review, and any kind added later).
      records(gid){
        gid = String(gid);
        const out = { note: textOf(gid), an: textOf('an-'+gid) };
        kindsOf(gid).forEach(k=>{ const t = textOf(k+'-'+gid); if(t) out[k] = t; });
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
          const kinds = new Set(['note', 'an'].concat(kindsOf(gid), Object.keys(rec).filter(k=> KIND.test(k) && k!=='at')));
          kinds.forEach(k=>{
            const id = k==='note' ? gid : k+'-'+gid;
            const t = typeof rec[k]==='string' ? rec[k] : '';
            if(textOf(id)===t) return;
            gnSetNote(id, t, null);
            changed = true;
          });
        } finally { quiet--; }
        if(changed){
          const open = HV_STATE && HV_STATE.game && String(HV_STATE.game.id)===gid;
          if(open){ try{ hvAnnRefresh(); }catch(e){} try{ gnRefreshFields(); }catch(e){} try{ if(typeof hvLrDraw==='function') hvLrDraw(); }catch(e){} }
          else HV_TREES.delete(gid);
        }
        return changed;
      },
      open(game, opts){ hvOpen(game, null, opts || {}); },
      // Repertoire Lab's corners on (the review has the whole window) or off.
      chrome(on){
        document.documentElement.classList.toggle('rl-chrome', !!on);
        const home = document.getElementById('home-fab');
        if(home){ home.title = on ? 'Back to Repertoire Lab' : ''; home.setAttribute('aria-label', on ? 'Back to Repertoire Lab' : 'Home'); }
      },
      current(){ return HV_STATE && HV_STATE.game ? String(HV_STATE.game.id) : null; },
      line(){ return playedLine(); },
      // games: [{ id, an, summary }] — that player's, and only theirs; view: 'clamp' | 'tactics' | 'openings'
      // (Openings: every game with moves, marked or not)
      history(games, view){
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
        const tab = view === 'tactics' ? 'tactics' : view === 'openings' ? 'openings' : 'clamp';
        rlBase = tab === 'openings'
          ? (games || []).filter((g)=> g && g.summary).map((g)=> ghGameFromSummary({ id: String(g.id), g: gnCleanG(g.summary) })).filter((g)=> g.moves)
          : null;
        // Game History counts itself loaded once its own list has games (it's Lichess's, here none): the Openings tab's
        // are those; CLAMP and Tactics go back to reading the games with marks.
        GH_STATE.games = rlBase ? rlBase.slice() : [];
        GH_STATE.ids = new Set(GH_STATE.games.map((g)=> g.id));
        GH_STATE.exhausted = true;
        document.documentElement.classList.add('rl-history');
        document.documentElement.classList.remove('rl-chrome');
        if(currentView!=='history') showView('history');
        if(GH_UI.view!==tab) ghoSetView(tab);
        else ghRender();
        if(rlBase && RP){ try{ rpQueue(); }catch(e){} }
        window.scrollTo(0, 0);
        heightWas = 0;
        setTimeout(sayHeight, 60);
      },
      // The repertoire the Openings tab sorts games by: the openings Repertoire Lab picked, in Chess Arcade's own
      // compact form ({ o:[{ i, n, c:'w'|'b', k:[[courseId, name]], ch:[{ i, n, k, s, ss, l:[[id, name, moves[], fen|null]] }] }] }),
      // checked the way a copy read from Repertoire Lab is. None: the tab groups games by opening name.
      repertoire(p){
        const uid = 'rl-embed';
        let dec = null;
        try{
          if(p && Array.isArray(p.o) && p.o.length) dec = rlDecode(rlEncode({ v:1, uid, email:'', at:Date.now(), o:p.o }), uid);
        }catch(e){ dec = null; }
        if(!dec || !dec.o.length){
          if(RP){ RP = null; RP_RES = new Map(); RP_JOB = null; rpFire('rep'); }
          if(historyOn()) ghRender();
          return 0;
        }
        if(!RP || RP.h!==dec.h){ rpMake(dec, null); rpFire('rep'); try{ rpQueue(); }catch(e){} }
        return RP.openings.length;
      },
      // Repertoire Lab's theme, dark or light as it is there: { skin, theme:'dark'|'light', colors } (colors: Custom's
      // own, as Repertoire Lab paints them). Chess Arcade's theme picker is hidden here: the look is Repertoire Lab's.
      look(o){
        o = o || {};
        const SK = ['felt','hustler','bauhaus','gameboy','outerspace','drivethru','rose','chessbook','uptown','custom'];
        const skin = SK.indexOf(o.skin)>=0 ? o.skin : 'custom';
        const theme = o.theme==='light' ? 'light' : 'dark';
        const col = (v)=> typeof v==='string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(v.trim()) ? v.trim() : null;
        const c = o.colors || {};
        const colors = skin==='custom' ? { accent:col(c.accent), bg:col(c.bg), surface:col(c.surface), boardLight:col(c.boardLight),
          boardDark:col(c.boardDark), pieceWhite:col(c.pieceWhite), pieceBlack:col(c.pieceBlack), pieceStroke:null } : null;
        const sig = skin+'|'+theme+'|'+JSON.stringify(colors);
        if(sig===lookSig) return false;
        lookSig = sig;
        lookPrefs.skin = skin;
        if(colors) lookPrefs.customColors = colors;
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
