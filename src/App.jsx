import React, { useEffect, useRef, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { resolveTheme, applyTheme, applyBackground, applySkin } from './lib/theme';
import { runTopGuard } from './lib/backGuard';
import { parsePath, pathFor, SECTION_LABEL } from './lib/routes';
import { LinkIcon } from './components/Icons';
import Library from './views/Library';
import ChapterView from './views/ChapterView';
import ImportView from './views/ImportView';
import PracticeView from './views/PracticeView';
import GroupsView from './views/GroupsView';
import AnalysisView from './views/AnalysisView';
import GamesView from './views/GamesView';
import VerifyView from './views/VerifyView';
import SearchPanel from './views/SearchPanel';
import SettingsView from './views/SettingsView';
import CoachesView from './views/CoachesView';
import MigratePlayersModal from './components/MigratePlayersModal';
import ErrorBoundary from './components/ErrorBoundary';
import Inbox from './components/Inbox';

function AppInner() {
  const { state } = useStore();
  // Where the URL says we are. Read once, at mount: after that the address bar
  // follows the app (see the sync effect below) rather than driving it, except
  // on back/forward, which restores state from our own stack anyway.
  const [route] = useState(() => parsePath(
    typeof window === 'undefined' ? '/' : window.location.pathname,
  ));
  const [view, setView] = useState(route.view);
  const [chapterNav, setChapterNav] = useState(route.chapterNav ?? null);
  // The sub-mode inside a section — Analysis's engine/compare/editor, the
  // Settings tab. Lifted up here only so it can be part of the address; each
  // view still owns its own switching.
  const [sub, setSub] = useState(route.sub ?? null);
  const [practiceScope, setPracticeScope] = useState(undefined);
  const [analysisLine, setAnalysisLine] = useState(null);
  const [verifyDraft, setVerifyDraft] = useState(null);
  // A photo archived earlier from "Scan this photo" on a game with no moves
  // yet — carried to Import so it can be fed straight into the OCR pipeline.
  const [resumePhoto, setResumePhoto] = useState(null);
  const lastChapterId = useRef(null);
  const revealChapter = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Seeds the Library's own "My repertoire / Students" tab once, when you
  // arrive from a student's Coaches profile — see openLibraryFor below.
  const [libraryScope, setLibraryScope] = useState(null);
  // Same idea, for Collections — see openCollectionsFor below.
  const [collectionsScope, setCollectionsScope] = useState(null);
  // A saved Lab session being reopened on the analysis board.
  const [analysisLab, setAnalysisLab] = useState(null);
  // Opened via Coaches Corner's Studio button: a blank board with the
  // annotate rail and Lichess/repertoire import switched on.
  const [coachStudio, setCoachStudio] = useState(false);
  // "Copied" for a second after the link button is used.
  const [linkCopied, setLinkCopied] = useState(false);

  const themeSettings = state?.settings;
  useEffect(() => {
    // The skin rides along with the palette: each one has a light and a dark
    // face, so whatever flips light/dark has to repaint it too — including the
    // once-a-minute tick that drives Auto.
    const paint = () => {
      const mode = resolveTheme(themeSettings);
      applyTheme(mode);
      applySkin(themeSettings, mode);
    };
    paint();
    if (themeSettings?.theme !== 'auto') return undefined;
    const t = setInterval(paint, 60000);
    return () => clearInterval(t);
  }, [themeSettings?.theme, themeSettings?.lightFrom, themeSettings?.darkFrom, themeSettings?.skin, themeSettings?.skinWallpaper]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    applyBackground(themeSettings);
    // `skin` is in here because the picture is per theme: changing theme
    // changes which one is behind the app, or whether there's one at all.
  }, [themeSettings?.background, themeSettings?.backgrounds, themeSettings?.skin,
    themeSettings?.backgroundVeil, themeSettings?.surfaceOpacity, themeSettings?.boardOpacity]); // eslint-disable-line react-hooks/exhaustive-deps

  // The phone's back gesture / Safari's back button — and now the forward
  // button too, which used to be wrong in a way nothing could see. Every
  // popstate was treated as a step back, so Forward unwound the app's own
  // stack a second time instead of redoing the step. With no URL to compare
  // against, the two just drifted silently; now that each screen has an
  // address, the address is the thing to trust.
  useEffect(() => {
    const onPop = () => {
      if (poppingRef.current) { poppingRef.current = false; return; }
      // A modal or editor is open: back closes that, not the page — otherwise a
      // stray edge-swipe throws away whatever you were typing.
      if (runTopGuard()) {
        try { window.history.pushState({ rlGuard: true }, ''); } catch { /* ignore */ }
        return;
      }
      const here = window.location.pathname;
      const prev = history.current[history.current.length - 1];
      // Landing exactly where our own stack says we came from: a real step
      // back, so unwind it properly and get the scroll position with it.
      if (prev && pathFor(prev) === here) { goBack(true); return; }
      // Anything else — Forward, or an address typed or pasted into the bar —
      // is resolved from the URL. No scroll to restore in that case, but the
      // screen matches what the address says, which is the part that matters.
      const target = parsePath(here);
      setSub(target.sub ?? null);
      setChapterNav(target.chapterNav ?? null);
      setView(target.view);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Put where we are into the address bar. replaceState rather than pushState
  // because `go` has already pushed the entry for this step — this fills in its
  // URL. Back and forward therefore restore the right address on their own.
  //
  // The one path left alone is "/": arriving at the bare domain and being
  // bounced to "/library" would be a rewrite of the address someone just
  // typed, for no gain.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const path = pathFor({ view, sub, chapterNav });
    const here = window.location.pathname;
    if (here === path) return;
    if (here === '/' && path === '/library') return;
    try { window.history.replaceState(window.history.state, '', path); } catch { /* history unavailable */ }
  }, [view, sub, chapterNav?.openingId, chapterNav?.chapterId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘K / Ctrl-K, or "/" when not already typing, opens search from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A real back stack: every navigation records where you were, including how
  // far down the page you had scrolled, so Back returns you to that exact spot.
  const history = useRef([]);
  const pendingScroll = useRef(null);

  const snapshot = () => ({
    view,
    sub,
    chapterNav,
    practiceScope,
    analysisLine,
    scrollY: window.scrollY,
    chapterId: view === 'chapter' ? chapterNav?.chapterId : null,
  });

  // Mirror each step into browser history so the iPhone's swipe-back gesture
  // and Safari's back button walk the app instead of leaving it.
  const poppingRef = useRef(false);

  const go = (next) => {
    history.current.push(snapshot());
    pendingScroll.current = 0; // a forward move starts at the top
    try {
      window.history.pushState({ rlDepth: history.current.length }, '');
    } catch { /* history unavailable (rare) */ }
    next();
  };

  const goBack = (fromPop = false) => {
    const prev = history.current.pop();
    if (!fromPop) {
      // An in-app Back should also consume the matching browser entry, or the
      // phone's gesture would replay a step we've already taken.
      poppingRef.current = true;
      try { window.history.back(); } catch { poppingRef.current = false; }
    }
    if (!prev) { setView('library'); return; }
    setSub(prev.sub ?? null);
    setChapterNav(prev.chapterNav);
    setPracticeScope(prev.practiceScope);
    setAnalysisLine(prev.analysisLine);
    setView(prev.view);
    pendingScroll.current = prev.scrollY;
    // Coming back to the library, make sure the chapter you were in is visible
    // even if it lives inside a collapsed section.
    revealChapter.current = prev.view === 'library' ? lastChapterId.current : null;
  };

  const openChapter = (openingId, chapterId) => {
    lastChapterId.current = chapterId;
    go(() => {
      setChapterNav({ openingId, chapterId });
      setView('chapter');
    });
  };

  // Put the page back where it was. Several frames, because boards, lists and
  // any section that had to re-expand only settle after a render or two — and
  // a document that is still short clamps the scroll.
  useEffect(() => {
    const y = pendingScroll.current;
    if (y === null) return;
    pendingScroll.current = null;
    const wantsCard = view === 'library' && revealChapter.current;
    let frames = 0;
    const settle = () => {
      window.scrollTo(0, y);
      // If the chapter you came from ended up off-screen (its section had to be
      // re-opened, so the page is a different height), put it back in view.
      if (wantsCard) {
        const card = document.querySelector(`[data-chapter-id="${revealChapter.current}"]`);
        if (card) {
          const r = card.getBoundingClientRect();
          if (r.top < 0 || r.bottom > window.innerHeight) card.scrollIntoView({ block: 'center' });
          card.classList.add('just-visited');
          setTimeout(() => card.classList.remove('just-visited'), 1600);
          revealChapter.current = null;
          return;
        }
      }
      frames += 1;
      if (frames < 6) requestAnimationFrame(settle);
    };
    settle();
    // iOS lays out later than a couple of frames, and a page that is still
    // short clamps the scroll — so try again once things have settled.
    const t1 = setTimeout(settle, 80);
    const t2 = setTimeout(settle, 250);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [view]);

  const startPractice = (scope) => {
    go(() => {
      setPracticeScope(scope);
      setView('practice');
    });
  };

  // `studio`: open straight into the Annotate tab (badges/notes) instead of
  // Engine — used by "Send to studio" on a saved game, so its gameId/playerId
  // below are what let the badges and notes picked there sync straight onto
  // that game's own record (see syncGameMove in AnalysisView), the same way
  // Coaches Corner's Studio already does for a student's line.
  const analyze = (line, { studio = false } = {}) => {
    go(() => {
      // Carry whatever context came with it — a game brings its players,
      // result and opening so the analysis board can say what it's showing.
      // ownerId (a student's player id, or null for your own) scopes which
      // repertoire the board checks book moves against.
      // gameId/playerId (only set for a real saved game, not a repertoire
      // line or a blank board) let the board edit that game's notes/themes
      // in place instead of just displaying a snapshot of them.
      setAnalysisLab(null);
      setCoachStudio(studio);
      setAnalysisLine({
        name: line.name,
        moves: line.moves,
        meta: line.meta ?? null,
        subtitle: line.subtitle ?? null,
        date: line.date ?? null,
        ownerId: line.ownerId ?? null,
        gameId: line.gameId ?? null,
        playerId: line.playerId ?? null,
        // Whatever a coach badged or wrote on this line in Coaches Corner —
        // "Analyze this line" is the most common way anyone reaches the
        // analysis board, so dropping these here is why they weren't showing
        // up: the board itself always knew how to display them.
        comments: line.comments ?? null,
        badges: line.badges ?? null,
        // Arrows/highlights saved from a previous Studio "Save changes" —
        // see AnalysisView's annotations state.
        annotations: line.annotations ?? null,
        // The full move tree and any coloured variations on it, if a
        // previous Studio "Save changes" left them on this game — see
        // setGameTree in store.jsx. Absent for every other line (a
        // repertoire variation, a blank board), which rebuild a flat trunk
        // from `moves` instead.
        tree: line.tree ?? null,
        variationHighlights: line.variationHighlights ?? null,
      });
      setView('analysis');
    });
  };

  // Same line, opened straight into Studio's Annotate tab — "Send to
  // studio" on a saved game, next to the ordinary "Send to analysis board".
  const analyzeInStudio = (line) => analyze(line, { studio: true });

  // Reopen a saved Lab session: its own moves, marks and notes, and no
  // repertoire line underneath it.
  const openLab = (entry) => {
    go(() => {
      setAnalysisLine(null);
      setAnalysisLab(entry);
      setCoachStudio(!!entry.coach);
      setView('analysis');
    });
  };

  const openStudio = () => {
    go(() => {
      setAnalysisLine(null);
      setAnalysisLab(null);
      setCoachStudio(true);
      setView('analysis');
    });
  };

  const scanPhoto = ({ playerId, gameId, gameName, photo }) => {
    go(() => {
      setResumePhoto({ playerId, gameId, gameName, photo });
      setView('import');
    });
  };

  const openLibraryFor = (studentId) => {
    setLibraryScope(studentId);
    go(() => setView('library'));
  };

  const openCollectionsFor = (studentId) => {
    setCollectionsScope(studentId);
    go(() => setView('groups'));
  };

  const navTo = (v) => {
    if (v === view) return;
    go(() => {
      if (v === 'practice') setPracticeScope(undefined);
      setSub(null);
      setView(v);
    });
  };

  // The name and knight are the home button: the library, from the top.
  // Pressing it while already there scrolls back up rather than doing nothing.
  const goHome = () => {
    if (view === 'library') {
      const start = window.scrollY;
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* no options form */ }
      // Some engines ignore the options form entirely — make sure we arrive.
      setTimeout(() => {
        if (start !== 0 && window.scrollY === start) window.scrollTo(0, 0);
      }, 250);
      return;
    }
    navTo('library');
  };

  return (
    <>
      <div className="topbar">
        <button
          type="button"
          className="logo"
          title="Repertoire Lab — back to your library"
          aria-label="Home: your library"
          onClick={goHome}
        >
          <img className="knight" src="/icons/logo-64.png" alt="" width="26" height="26" /> Repertoire Lab
        </button>
        <nav>
          <button
            className={view === 'library' || view === 'chapter' ? 'active' : ''}
            onClick={() => navTo('library')}
          >
            Library
          </button>
          <button className={view === 'import' ? 'active' : ''} onClick={() => navTo('import')}>
            Import
          </button>
          <button className={view === 'practice' ? 'active' : ''} onClick={() => navTo('practice')}>
            Practice
          </button>
          <button
            className={view === 'groups' ? 'active' : ''}
            title="Favorites and every theme, across all openings"
            onClick={() => navTo('groups')}
          >
            Collections
          </button>
          <button className={view === 'games' ? 'active' : ''} onClick={() => navTo('games')}>
            Games
          </button>
          <button className={view === 'analysis' ? 'active' : ''} onClick={() => navTo('analysis')}>
            Analysis
          </button>
          {/* Set apart from the lesson-planning tabs above — a student on the
              same device has no reason to poke at this one. Pushed to the far
              end on desktop (there's room); on a phone, where the whole bar
              already scrolls sideways, being last is itself the separation —
              it's a deliberate scroll away, not sitting next to Practice. */}
          <span className="nav-divider" aria-hidden="true" />
          <button className={view === 'coaches' ? 'active' : ''} onClick={() => navTo('coaches')}>
            Coaches Corner
          </button>
          <Inbox />
          {/* Installed as an app there's no address bar to copy from, which is
              exactly where a link to "the chapter we're doing today" is most
              useful. This copies wherever you're standing. */}
          <button
            className={`nav-icon${linkCopied ? ' active' : ''}`}
            title={`Copy a link to ${SECTION_LABEL[view] ?? 'this page'}`}
            aria-label="Copy a link to this page"
            onClick={async () => {
              const url = window.location.href;
              // Three goes, weakest excuse last. The async clipboard API is
              // refused on an insecure origin and in some in-app browsers;
              // execCommand still works in most of those; and if even that
              // fails, show the link so it can be copied by hand rather than
              // leaving a button that looks like it did nothing.
              let ok = false;
              try {
                await navigator.clipboard.writeText(url);
                ok = true;
              } catch { /* try the old way */ }
              if (!ok) {
                try {
                  const box = document.createElement('textarea');
                  box.value = url;
                  box.setAttribute('readonly', '');
                  box.style.position = 'fixed';
                  box.style.opacity = '0';
                  document.body.appendChild(box);
                  box.select();
                  ok = document.execCommand('copy');
                  document.body.removeChild(box);
                } catch { ok = false; }
              }
              if (!ok) { window.prompt('Copy this link', url); return; }
              setLinkCopied(true);
              setTimeout(() => setLinkCopied(false), 1400);
            }}
          >
            <LinkIcon size={17} />
          </button>
          <button
            className="nav-icon"
            title="Search (⌘K)"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.2" y1="16.2" x2="21" y2="21" />
            </svg>
          </button>
          <button
            className={`nav-icon${view === 'settings' ? ' active' : ''}`}
            title="Settings"
            aria-label="Settings"
            onClick={() => navTo('settings')}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9v.03a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
        </nav>
      </div>

      {/* Any one screen can fail without taking the app down with it. */}
      <ErrorBoundary resetKey={view}>
        {view === 'library' && (
          <Library
            onOpenChapter={openChapter}
            onPractice={startPractice}
            revealChapterId={revealChapter.current}
            initialScope={libraryScope}
          />
        )}
        {view === 'groups' && (
          <GroupsView
            onOpenChapter={openChapter}
            onPractice={startPractice}
            onOpenLab={openLab}
            initialScope={collectionsScope}
          />
        )}
        {view === 'chapter' && chapterNav && (
          <ChapterView
            openingId={chapterNav.openingId}
            chapterId={chapterNav.chapterId}
            onBack={goBack}
            onPractice={startPractice}
            onAnalyze={analyze}
          />
        )}
        {view === 'import' && (
          <ImportView
            onDone={(dest) => setView(dest === 'games' ? 'games' : 'library')}
            onAnalyze={analyze}
            onVerify={(d) => { setVerifyDraft(d); setView('verify'); }}
            resumePhoto={resumePhoto}
            onResumePhotoUsed={() => setResumePhoto(null)}
          />
        )}
        {view === 'verify' && verifyDraft && (
          <VerifyView
            draft={verifyDraft}
            onCancel={() => { setVerifyDraft(null); goBack(); }}
            onAnalyze={(line) => { setVerifyDraft(null); analyze(line); }}
            onSaved={() => { setVerifyDraft(null); setView('games'); }}
          />
        )}
        {view === 'practice' && (
          <PracticeView
            scope={practiceScope}
            onScopeChange={(s) => setPracticeScope(s)}
            onExit={goBack}
            onAnalyze={analyze}
          />
        )}
        {view === 'games' && (
          <GamesView onAnalyze={analyze} onGameStudio={analyzeInStudio} onScan={scanPhoto} />
        )}
        {view === 'coaches' && (
          <CoachesView
            onAnalyze={analyze}
            onGameStudio={analyzeInStudio}
            onScan={scanPhoto}
            onOpenLibrary={openLibraryFor}
            onOpenCollections={openCollectionsFor}
            onOpenStudio={openStudio}
          />
        )}
        {view === 'settings' && <SettingsView tab={sub} onTabChange={setSub} />}
        <MigratePlayersModal />

        {searchOpen && (
          <SearchPanel
            onClose={() => setSearchOpen(false)}
            onOpenChapter={openChapter}
            onAnalyze={analyze}
          />
        )}
        {view === 'analysis' && (
          <AnalysisView
            key={analysisLab?.id ?? 'board'}
            initialLine={analysisLine}
            initialLab={analysisLab}
            coachMode={coachStudio}
            mode={sub}
            onModeChange={setSub}
          />
        )}
      </ErrorBoundary>
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppInner />
    </StoreProvider>
  );
}
