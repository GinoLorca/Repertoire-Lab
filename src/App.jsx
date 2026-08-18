import React, { useEffect, useRef, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { resolveTheme, applyTheme } from './lib/theme';
import { runTopGuard } from './lib/backGuard';
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

function AppInner() {
  const { state } = useStore();
  const [view, setView] = useState('library');
  const [chapterNav, setChapterNav] = useState(null);
  const [practiceScope, setPracticeScope] = useState(undefined);
  const [analysisLine, setAnalysisLine] = useState(null);
  const [verifyDraft, setVerifyDraft] = useState(null);
  const lastChapterId = useRef(null);
  const revealChapter = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const themeSettings = state?.settings;
  useEffect(() => {
    applyTheme(resolveTheme(themeSettings));
    if (themeSettings?.theme !== 'auto') return undefined;
    const t = setInterval(() => applyTheme(resolveTheme(themeSettings)), 60000);
    return () => clearInterval(t);
  }, [themeSettings?.theme, themeSettings?.lightFrom, themeSettings?.darkFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  // The phone's back gesture / Safari's back button.
  useEffect(() => {
    const onPop = () => {
      if (poppingRef.current) { poppingRef.current = false; return; }
      // A modal or editor is open: back closes that, not the page — otherwise a
      // stray edge-swipe throws away whatever you were typing.
      if (runTopGuard()) {
        try { window.history.pushState({ rlGuard: true }, ''); } catch { /* ignore */ }
        return;
      }
      if (history.current.length === 0) return; // nothing of ours left to unwind
      goBack(true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const analyze = (line) => {
    go(() => {
      // Carry whatever context came with it — a game brings its players,
      // result and opening so the analysis board can say what it's showing.
      setAnalysisLine({
        name: line.name,
        moves: line.moves,
        meta: line.meta ?? null,
        subtitle: line.subtitle ?? null,
        date: line.date ?? null,
      });
      setView('analysis');
    });
  };

  const navTo = (v) => {
    if (v === view) return;
    go(() => {
      if (v === 'practice') setPracticeScope(undefined);
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
            title="Favorites and every tag / nickname, across all openings"
            onClick={() => navTo('groups')}
          >
            Groups
          </button>
          <button className={view === 'games' ? 'active' : ''} onClick={() => navTo('games')}>
            Games
          </button>
          <button className={view === 'analysis' ? 'active' : ''} onClick={() => navTo('analysis')}>
            Analysis
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

      {view === 'library' && (
        <Library
          onOpenChapter={openChapter}
          onPractice={startPractice}
          revealChapterId={revealChapter.current}
        />
      )}
      {view === 'groups' && <GroupsView onOpenChapter={openChapter} onPractice={startPractice} />}
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
        />
      )}
      {view === 'games' && <GamesView onAnalyze={analyze} />}
      {view === 'settings' && <SettingsView />}

      {searchOpen && (
        <SearchPanel
          onClose={() => setSearchOpen(false)}
          onOpenChapter={openChapter}
          onAnalyze={analyze}
        />
      )}
      {view === 'analysis' && <AnalysisView initialLine={analysisLine} />}
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
