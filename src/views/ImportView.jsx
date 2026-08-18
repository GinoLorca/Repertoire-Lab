import React, { useEffect, useRef, useState } from 'react';
import { useStore, uid } from '../store';
import { ocrImage, textToLine } from '../lib/ocr';
import { transcribeImages, prepareImage, testKey, friendlyError, isHeic } from '../lib/vision';
import { movetextToLines, validateLine, splitPgnGames, movesToMovetext, variationToPgn, downloadText } from '../lib/pgn';
import MoveText from '../components/MoveText';
import ScanProgress from '../components/ScanProgress';
import {
  CameraIcon, ClipboardIcon, FolderIcon, PencilIcon, AlertIcon, DownloadIcon,
} from '../components/Icons';

// Text sitting just before a variation's moves is its title in course
// screenshots ("Jobava London: 3...a6 with 4.e3"). Keep only a plausible
// heading: the last non-empty line, with any trailing move text removed.
function titleFrom(text) {
  const lines = String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
      // Only strip a trailing game score ("1.d4 d5 2.Nc3 …"). Titles routinely
      // contain notation of their own ("vs 3...a6 with 4.e3") — keep that.
      .replace(/\s*(?<!\d)1\s*\.\s*[a-hKQRNBO][^\n]*$/, '')
      .replace(/^[\s•\-–—*]+/, '')          // bullets
      .replace(/\s*[▶►▸]\s*$/, '')
      .trim();
    // A title has letters and isn't just notation/counters like "3/14" or "Learn".
    if (line.length >= 3 && /[a-zA-Z]{3}/.test(line) && !/^\d+\s*\/\s*\d+$/.test(line)) {
      return line.slice(0, 120);
    }
  }
  return null;
}

// Split raw OCR text into chunks, one per variation. Every "1." that starts
// a new game begins a new chunk. Lines in "NAME :: MOVES" form are kept whole.
function splitVariationChunks(text) {
  if (text.includes('::')) {
    return text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const idx = line.indexOf('::');
      return idx >= 0
        ? { name: line.slice(0, idx).trim() || null, text: line.slice(idx + 2) }
        : { name: null, text: line };
    });
  }
  const indices = [];
  const re = /(?<!\d)1\s*\.+\s*[a-hKQRNBO]/g;
  let m;
  while ((m = re.exec(text)) !== null) indices.push(m.index);
  if (indices.length === 0) return [{ name: titleFrom(text), text }];
  if (indices.length === 1) {
    return [{ name: titleFrom(text.slice(0, indices[0])), text: text.slice(indices[0]) }];
  }
  return indices.map((start, i) => ({
    // The heading for variation i is the text between the previous variation
    // and this one — that's where course apps print the title.
    name: titleFrom(text.slice(i === 0 ? 0 : indices[i - 1], start)),
    text: text.slice(start, indices[i + 1] ?? text.length),
  }));
}

// Raw move tokens exactly as transcribed — keeps ?? and misread moves so the
// verify screen can show what the model actually saw, not a cleaned-up guess.
function rawTokensFrom(text) {
  const body = text.includes('::') ? text.slice(text.indexOf('::') + 2) : text;
  return body
    .replace(/(\d+)\s*\.+\s*/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(t));
}

function parseCardText(card) {
  const chunks = splitVariationChunks(card.text);
  return chunks.map((chunk, i) => {
    const result = textToLine(chunk.text);
    return {
      id: uid(),
      cardId: card.id,
      // Prefer the title printed above the moves; fall back to a plain
      // numbered name rather than the screenshot's filename.
      name: chunk.name || (chunks.length > 1 ? `Variation ${i + 1}` : 'Variation'),
      ...result,
    };
  }).filter((e) => e.moves.length > 0 || !e.ok);
}

function StatusLine({ entry }) {
  if (entry.ok) {
    return (
      <div className="status-line">
        <span className="status-ok">✓ {entry.moves.length} moves, all legal</span>
        {entry.corrections?.length > 0 && (
          <span className="corrections">
            auto-corrected: {entry.corrections.map((c) => `${c.from}→${c.to}`).join(', ')}
          </span>
        )}
        {entry.trailingJunk && (
          <span className="status-busy">
            <AlertIcon size={13} className="warn-tick" /> ignored trailing text from “{entry.trailingJunk}” — check the line is complete
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="status-line">
      <span className="status-bad">
        ✗ stuck at “{entry.failedToken}” (after {entry.moves.length} valid moves) — edit the text and re-parse
      </span>
    </div>
  );
}

export default function ImportView({ onDone, onAnalyze, onVerify, resumePhoto, onResumePhotoUsed }) {
  // One abort handle per card, so a long read can be called off.
  const abortRefs = useRef({});
  // Ticks once a second purely so the elapsed time on a busy card updates.
  const [, setClock] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClock((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState('screenshots');
  const [cards, setCards] = useState([]);
  const [pending, setPending] = useState([]);
  const [pasteText, setPasteText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [pgnInfo, setPgnInfo] = useState(null);
  const [splitByEvent, setSplitByEvent] = useState(true);
  const [multiPage, setMultiPage] = useState(false);
  const [keyStatus, setKeyStatus] = useState(null);
  const fileRef = useRef(null);
  const pgnRef = useRef(null);

  const [openingSel, setOpeningSel] = useState('');
  const [chapterSel, setChapterSel] = useState('');
  const [newOpeningName, setNewOpeningName] = useState('');
  const [newChapterName, setNewChapterName] = useState('');
  const [playerSel, setPlayerSel] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');

  // Vision provider settings. Scoresheets default to Claude because local OCR
  // cannot read handwriting; screenshots default to whatever the user picked.
  const engine = tab === 'scoresheet'
    ? (state.settings.scoresheetEngine ?? 'claude')
    : (state.settings.ocrEngine ?? 'tesseract');
  const setEngine = (value) => dispatch({
    type: 'setSettings',
    settings: tab === 'scoresheet' ? { scoresheetEngine: value } : { ocrEngine: value },
  });
  const apiKey = engine === 'gemini'
    ? (state.settings.geminiKey ?? '')
    : (state.settings.anthropicKey ?? '');
  const setApiKey = (value) => dispatch({
    type: 'setSettings',
    settings: engine === 'gemini' ? { geminiKey: value } : { anthropicKey: value },
  });
  const enhanceContrast = state.settings.enhanceContrast ?? true;
  const needsKey = engine !== 'tesseract';

  const replacePendingForCard = (cardId, entries) => {
    setPending((p) => [...p.filter((e) => e.cardId !== cardId), ...entries]);
  };

  // ---------- Screenshot handling ----------

  // A card may hold several photos when they are pages of one scoresheet.
  const processImages = async (card, files, rotate = 0) => {
    const controller = new AbortController();
    abortRefs.current[card.id] = controller;
    setCards((cs) => cs.map((c) => (
      c.id === card.id ? { ...c, status: 'processing', startedAt: Date.now() } : c)));
    try {
      if (needsKey && !apiKey.trim()) {
        throw new Error(
          `Add your ${engine === 'gemini' ? 'Google AI Studio' : 'Anthropic'} API key above to read this photo`
          + `${card.mode === 'scoresheet' ? ' — local OCR can’t read handwriting.' : '.'}`,
        );
      }
      let text;
      let previewUrls = card.urls ?? [];
      if (needsKey && apiKey) {
        const images = [];
        for (const file of files) {
          images.push(await prepareImage(file, {
            enhanceContrast: card.mode === 'scoresheet' && enhanceContrast,
            rotate,
          }));
        }
        // Show the straightened/enhanced versions the model actually sees.
        previewUrls = images.map((im) => im.previewUrl);
        setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, urls: previewUrls } : c)));
        const variations = await transcribeImages({
          provider: engine,
          apiKey,
          images,
          kind: card.mode,
          signal: controller.signal,
          onProgress: (p) => setCards((cs) => cs.map((c) => (
            c.id === card.id ? { ...c, progress: p } : c))),
        });
        text = variations.map((v) => `${v.name} :: ${v.movetext}`).join('\n');
      } else {
        text = await ocrImage(files[0]);
      }
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, status: 'done', text } : c)));
      const parsed = parseCardText({ ...card, text });
      replacePendingForCard(card.id, parsed);

      // A scoresheet is one game that must be checked before it's trusted —
      // go straight to the verify screen with whatever was transcribed.
      if (card.mode === 'scoresheet' && onVerify) {
        const raw = rawTokensFrom(text);
        const best = parsed[0];
        onVerify({
          name: best?.name || card.label || 'Scoresheet game',
          moves: raw.length > 0 ? raw : (best?.moves ?? []),
          photos: previewUrls,
          // Handwriting gets the line-by-line review against the photo.
          handwritten: true,
          // Set when this card came from a photo archived earlier on a
          // player's game rather than a fresh upload — see startResume below.
          // Verify then updates that same game instead of creating a new one.
          resumeGame: card.resumeGame ?? null,
        });
      }
    } catch (err) {
      console.error(err);
      // A truncated response still holds real variations — keep them and warn.
      if (err.partialText) {
        setCards((cs) => cs.map((c) => (c.id === card.id
          ? { ...c, status: 'done', text: err.partialText, warning: err.message }
          : c)));
        replacePendingForCard(card.id, parseCardText({ ...card, text: err.partialText }));
        return;
      }
      setCards((cs) => cs.map((c) => (c.id === card.id
        ? { ...c, status: 'error', error: friendlyError(err, engine) }
        : c)));
    }
  };

  const addImages = (files, mode) => {
    const all = [...files];
    const heics = all.filter(isHeic);
    const images = all.filter((f) => f.type.startsWith('image/') || isHeic(f));
    if (heics.length > 0) {
      // Surfaced as a card so the guidance sits next to the photo it concerns.
      for (const f of heics) {
        setCards((cs) => [...cs, {
          id: uid(), mode, label: f.name, urls: [], files: [f], rotate: 0,
          status: 'error',
          error: 'HEIC photos can’t be opened by this browser. On iPhone: Settings → Camera → Formats → “Most Compatible”, or export as JPEG from Preview. (Taking the photo directly on your iPhone into this page works — iOS converts it for you.)',
        }]);
      }
    }
    const usable = images.filter((f) => !isHeic(f));
    if (usable.length === 0) return;

    // Scoresheets are commonly photographed in two halves — optionally treat
    // everything dropped at once as pages of a single game.
    const groups = (mode === 'scoresheet' && multiPage && usable.length > 1)
      ? [usable]
      : usable.map((f) => [f]);

    for (const group of groups) {
      const card = {
        id: uid(),
        mode,
        label: mode === 'scoresheet' ? 'Scoresheet game' : group[0].name.replace(/\.[^.]+$/, ''),
        urls: group.map((f) => URL.createObjectURL(f)),
        files: group,
        rotate: 0,
        status: 'processing',
        text: '',
      };
      setCards((cs) => [...cs, card]);
      processImages(card, group, 0);
    }
  };

  // A photo archived earlier from a game's "Scan this photo" button arrives
  // here as a data URL, not a File — turn it back into one and feed it
  // through the same pipeline a fresh upload would take.
  const startResume = async (rp) => {
    setTab('scoresheet');
    const blob = await (await fetch(rp.photo)).blob();
    const file = new File([blob], `${rp.gameName || 'scoresheet'}.jpg`, { type: blob.type || 'image/jpeg' });
    const card = {
      id: uid(),
      mode: 'scoresheet',
      label: rp.gameName || 'Scoresheet game',
      urls: [URL.createObjectURL(file)],
      files: [file],
      rotate: 0,
      status: 'processing',
      text: '',
      resumeGame: { playerId: rp.playerId, gameId: rp.gameId },
    };
    setCards((cs) => [...cs, card]);
    processImages(card, [file], 0);
  };

  useEffect(() => {
    if (resumePhoto?.photo) {
      startResume(resumePhoto);
      onResumePhotoUsed?.();
    }
    // Only ever fires for the photo App.jsx just handed us — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumePhoto]);

  // Rotate a card's photo(s) and re-read them — scoresheets are often sideways.
  const rotateCard = (card, delta) => {
    const rotate = (((card.rotate ?? 0) + delta) % 360 + 360) % 360;
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, rotate } : c)));
    processImages({ ...card, rotate }, card.files, rotate);
  };

  const reparseCard = (card) => {
    replacePendingForCard(card.id, parseCardText(card));
  };

  const runKeyTest = async () => {
    setKeyStatus({ kind: 'busy', text: 'Testing…' });
    try {
      setKeyStatus({ kind: 'ok', text: await testKey(engine, apiKey) });
    } catch (err) {
      setKeyStatus({ kind: 'bad', text: friendlyError(err, engine) });
    }
  };

  // ---------- Paste handling ----------

  const parsePaste = () => {
    const text = pasteText.trim();
    if (!text) return;
    let entries = [];
    if (/^\[\w+\s+"/m.test(text)) {
      entries = pgnGamesToEntries(splitPgnGames(text));
    } else {
      // A new game starts wherever a line begins with "1." — lets you paste
      // several variations at once, one per line/paragraph.
      const blocks = [];
      let cur = [];
      for (const ln of text.split(/\r?\n/)) {
        if (/^\s*1\s*\./.test(ln) && cur.some((l) => l.trim())) {
          blocks.push(cur.join('\n'));
          cur = [ln];
        } else {
          cur.push(ln);
        }
      }
      if (cur.some((l) => l.trim())) blocks.push(cur.join('\n'));

      const lines = blocks.flatMap((block) => movetextToLines(block));
      entries = lines.map((line, i) => {
        const result = validateLine(line.moves);
        return {
          id: uid(),
          cardId: 'paste',
          name: lines.length > 1 ? `Pasted line ${i + 1}` : 'Pasted line',
          comments: line.comments,
          ...result,
        };
      });
    }
    replacePendingForCard('paste', entries);
  };

  // ---------- PGN file handling ----------

  const pgnGamesToEntries = (games) => {
    const entries = [];
    games.forEach((game, gi) => {
      const h = game.headers;
      const baseName =
        (h.White && h.White !== '?' && h.Black && h.Black !== '?' && `${h.White} – ${h.Black}`) ||
        h.Event || `Game ${gi + 1}`;
      const lines = movetextToLines(game.movetext);
      lines.forEach((line, li) => {
        const result = validateLine(line.moves);
        if (result.moves.length === 0) return;
        entries.push({
          id: uid(),
          cardId: 'pgn',
          name: lines.length > 1 && li > 0 ? `${baseName} (alt ${li})` : baseName,
          event: h.Event || null,
          comments: line.comments,
          ...result,
        });
      });
    });
    return entries;
  };

  const loadPgnFile = async (file) => {
    const text = await file.text();
    const games = splitPgnGames(text);
    const entries = pgnGamesToEntries(games);
    const events = [...new Set(entries.map((e) => e.event).filter(Boolean))];
    setPgnInfo({ fileName: file.name, gameCount: games.length, events });
    replacePendingForCard('pgn', entries);
  };

  // ---------- Assignment ----------

  const validPending = pending.filter((e) => e.ok);

  const assign = () => {
    let openingId = openingSel;
    if (openingSel === '__new') {
      openingId = uid();
      dispatch({ type: 'addOpening', id: openingId, name: newOpeningName.trim() });
    }
    const useEventChapters = tab === 'pgn' && splitByEvent && pgnInfo?.events.length > 1;
    if (useEventChapters) {
      const byEvent = new Map();
      for (const e of validPending) {
        const key = e.event || 'Imported';
        if (!byEvent.has(key)) byEvent.set(key, []);
        byEvent.get(key).push(e);
      }
      for (const [eventName, entries] of byEvent) {
        const chapterId = uid();
        dispatch({ type: 'addChapter', id: chapterId, openingId, name: eventName });
        dispatch({ type: 'addVariations', openingId, chapterId, variations: entries });
      }
    } else {
      let chapterId = chapterSel;
      if (chapterSel === '__new') {
        chapterId = uid();
        dispatch({ type: 'addChapter', id: chapterId, openingId, name: newChapterName.trim() });
      }
      dispatch({ type: 'addVariations', openingId, chapterId, variations: validPending });
    }
    setPending([]);
    setCards([]);
    setPgnInfo(null);
    setPasteText('');
    onDone(openingId);
  };

  const downloadPendingPgn = () => {
    const pgn = validPending
      .map((v) => variationToPgn(v, { event: 'Imported', white: v.name, black: '?' }))
      .join('\n');
    downloadText('converted.pgn', pgn);
  };

  const saveToGames = () => {
    let playerId = playerSel;
    if (playerSel === '__new') {
      playerId = uid();
      dispatch({ type: 'addPlayer', id: playerId, name: newPlayerName.trim() });
    }
    for (const entry of validPending) {
      dispatch({ type: 'addGame', playerId, game: { name: entry.name, moves: entry.moves, comments: entry.comments } });
    }
    setPending([]);
    setCards([]);
    onDone('games');
  };

  const canSaveGames =
    validPending.length > 0 &&
    (playerSel === '__new' ? newPlayerName.trim() : playerSel);

  const selectedOpening = state.openings.find((o) => o.id === openingSel);
  const useEventChapters = tab === 'pgn' && splitByEvent && pgnInfo?.events.length > 1;
  const canAssign =
    validPending.length > 0 &&
    (openingSel === '__new' ? newOpeningName.trim() : openingSel) &&
    (useEventChapters || (chapterSel === '__new' ? newChapterName.trim() : chapterSel));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Import</h1>
      </div>

      <div className="tabs">
        <button className={tab === 'screenshots' ? 'active' : ''} onClick={() => setTab('screenshots')}>
          <CameraIcon size={15} /> Screenshots
        </button>
        <button className={tab === 'scoresheet' ? 'active' : ''} onClick={() => setTab('scoresheet')}>
          <PencilIcon size={15} /> Scoresheet photo
        </button>
        <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')}>
          <ClipboardIcon size={15} /> Paste moves
        </button>
        <button className={tab === 'pgn' ? 'active' : ''} onClick={() => setTab('pgn')}>
          <FolderIcon size={15} /> PGN file / course
        </button>
      </div>

      {(tab === 'screenshots' || tab === 'scoresheet') && (
        <>
          <div className="vision-setup">
            <div className="settings-row">
              <label style={{ color: 'var(--muted)', fontSize: 13.5, fontWeight: 600 }}>
                Reading engine:
              </label>
              <select value={engine} onChange={(e) => { setEngine(e.target.value); setKeyStatus(null); }}>
                <option value="claude">Claude vision — best accuracy (paid API key)</option>
                <option value="gemini">Google Gemini — free tier (free API key)</option>
                <option value="tesseract">Local OCR — free, printed text only</option>
              </select>
              {tab === 'scoresheet' && (
                <label className="checkbox-inline" title="Grayscale + contrast stretch makes faint pencil easier to read">
                  <input
                    type="checkbox"
                    checked={enhanceContrast}
                    onChange={(e) => dispatch({ type: 'setSettings', settings: { enhanceContrast: e.target.checked } })}
                  />
                  Enhance photo contrast
                </label>
              )}
              {tab === 'scoresheet' && (
                <label className="checkbox-inline" title="Send all photos dropped together as pages of one game">
                  <input type="checkbox" checked={multiPage} onChange={(e) => setMultiPage(e.target.checked)} />
                  Photos are pages of one game
                </label>
              )}
            </div>

            {needsKey && (
              <div className="settings-row">
                <input
                  type="password"
                  placeholder={engine === 'gemini' ? 'Google AI Studio API key' : 'Anthropic API key'}
                  style={{ minWidth: 300, flex: 1 }}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setKeyStatus(null); }}
                />
                <button disabled={!apiKey.trim()} onClick={runKeyTest}>Test key</button>
                <a
                  className="setup-link"
                  href={engine === 'gemini'
                    ? 'https://aistudio.google.com/apikey'
                    : 'https://console.anthropic.com/settings/keys'}
                  target="_blank"
                  rel="noreferrer"
                >
                  Get a key ↗
                </a>
              </div>
            )}

            {keyStatus && (
              <div className="status-line">
                <span className={keyStatus.kind === 'ok' ? 'status-ok' : keyStatus.kind === 'bad' ? 'status-bad' : 'status-busy'}>
                  {keyStatus.kind === 'ok' ? '✓ ' : keyStatus.kind === 'bad' ? '✗ ' : '… '}{keyStatus.text}
                </span>
              </div>
            )}

            <div className="muted-note">
              {engine === 'claude' && 'Reads messy handwriting well and checks moves for legality as it transcribes. Roughly 3–4¢ per scoresheet photo. Your key is stored only in this browser and is sent straight to Anthropic.'}
              {engine === 'gemini' && 'Google\'s free tier — no cost, generous daily limits, and good at handwriting (a notch below Claude on the messiest sheets). Your key is stored only in this browser.'}
              {engine === 'tesseract' && (tab === 'scoresheet'
                ? 'Local OCR is built for printed text and will misread most handwriting — pick Claude or Gemini above for scoresheets.'
                : 'Runs entirely on your device, no key and no internet needed. Great for app screenshots; not for handwriting.')}
            </div>
          </div>

          {needsKey && !apiKey.trim() && (
            <div className="status-line" style={{ marginBottom: 12 }}>
              <span className="status-busy">
                <AlertIcon size={13} className="warn-tick" /> Add {engine === 'gemini' ? 'a free Google AI Studio' : 'an Anthropic'} API key above,
                or photos will fall back to local OCR.
              </span>
            </div>
          )}

          <div
            className={`dropzone${dragOver ? ' drag' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addImages([...e.dataTransfer.files], tab === 'scoresheet' ? 'scoresheet' : 'screen');
            }}
          >
            {tab === 'scoresheet' ? (
              <>
                <strong>Drop photos of handwritten scoresheets here</strong> or click to browse.<br />
                The game is transcribed to notation — review it, fix any misread moves, and re-parse.
              </>
            ) : (
              <>
                <strong>Drop screenshots here</strong> or click to browse.<br />
                Each image is converted to moves, checked for legality, and auto-corrected.
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addImages([...e.target.files], tab === 'scoresheet' ? 'scoresheet' : 'screen');
                e.target.value = '';
              }}
            />
          </div>

          {cards.filter((c) => (tab === 'scoresheet') === (c.mode === 'scoresheet')).map((card) => (
            <div key={card.id} className="import-card">
              <div className="import-thumbs">
                {card.urls.map((u, i) => <img key={i} src={u} alt={card.label} />)}
                {card.files?.length > 0 && card.status !== 'error' && (
                  <div className="rotate-row">
                    <button className="small ghost" title="Rotate left" onClick={() => rotateCard(card, -90)}>↺</button>
                    <button className="small ghost" title="Rotate right" onClick={() => rotateCard(card, 90)}>↻</button>
                  </div>
                )}
              </div>
              <div className="import-body">
                {card.status === 'processing' && (
                  <div className="status-line scanning">
                    <ScanProgress
                      startedAt={card.startedAt}
                      expectedMs={card.mode === 'scoresheet' ? 90000 : 25000}
                      phase={card.progress?.phase}
                      chars={card.progress?.chars ?? 0}
                      label={card.mode === 'scoresheet' ? 'Reading the scoresheet' : 'Reading the screenshot'}
                    />
                    <span className="status-busy">
                      Reading {card.urls.length > 1 ? `${card.urls.length} pages` : 'moves'}
                      {needsKey && apiKey ? ` with ${engine === 'gemini' ? 'Gemini' : 'Claude'}…` : '…'}
                      {card.progress?.phase === 'writing' && ' writing the moves out'}
                    </span>
                    {card.mode === 'scoresheet' && (
                      <span className="muted-note">
                        A full sheet of handwriting takes a while — up to four minutes.
                      </span>
                    )}
                    <button
                      className="small"
                      onClick={() => {
                        abortRefs.current[card.id]?.abort();
                        setCards((cs) => cs.map((c) => (c.id === card.id
                          ? { ...c, status: 'error', error: 'Reading was cancelled.' }
                          : c)));
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {card.status === 'error' && (
                  <>
                    <div className="status-line"><span className="status-bad">✗ {card.error}</span></div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="small ghost danger"
                        onClick={() => {
                          setCards((cs) => cs.filter((c) => c.id !== card.id));
                          setPending((p) => p.filter((e) => e.cardId !== card.id));
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </>
                )}
                {card.status === 'done' && (
                  <>
                    {card.warning && (
                      <div className="status-line">
                        <span className="status-busy"><AlertIcon size={13} /> {card.warning}</span>
                      </div>
                    )}
                    {card.text.includes('??') && (
                      <div className="status-line">
                        <span className="status-busy">
                          Some moves were unreadable and marked <strong>??</strong> — replace them below, then Re-parse.
                        </span>
                      </div>
                    )}
                    <textarea
                      rows={4}
                      value={card.text}
                      onChange={(e) => {
                        const text = e.target.value;
                        setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, text } : c)));
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="small"
                        onClick={() => reparseCard(cards.find((c) => c.id === card.id))}
                      >
                        Re-parse
                      </button>
                      <button
                        className="small ghost danger"
                        onClick={() => {
                          setCards((cs) => cs.filter((c) => c.id !== card.id));
                          setPending((p) => p.filter((e) => e.cardId !== card.id));
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'paste' && (
        <>
          <p style={{ color: 'var(--muted)' }}>
            Paste moves in any common format — with or without move numbers, comments, or nested
            variations in parentheses (each branch becomes its own variation). Full PGN with headers works too.
          </p>
          <textarea
            rows={8}
            placeholder={'1.e4 c6 2.d4 d5 3.f3 dxe4 4.fxe4 e5 5.dxe5 Qh4+ …'}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div style={{ marginTop: 10 }}>
            <button className="primary" onClick={parsePaste} disabled={!pasteText.trim()}>Parse</button>
          </div>
        </>
      )}

      {tab === 'pgn' && (
        <>
          <p style={{ color: 'var(--muted)' }}>
            Import a .pgn file — e.g. a purchased course exported as PGN. Each game becomes a
            variation; nested variations are expanded into separate lines.
          </p>
          <div className="dropzone" onClick={() => pgnRef.current?.click()}>
            <strong>Choose a .pgn file</strong>
            <input
              ref={pgnRef}
              type="file"
              accept=".pgn,.txt"
              hidden
              onChange={(e) => { if (e.target.files[0]) loadPgnFile(e.target.files[0]); e.target.value = ''; }}
            />
          </div>
          {pgnInfo && (
            <div className="status-line" style={{ marginBottom: 12 }}>
              <span className="status-ok">
                {pgnInfo.fileName}: {pgnInfo.gameCount} games, {pgnInfo.events.length} distinct chapter tags
              </span>
              {pgnInfo.events.length > 1 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={splitByEvent}
                    onChange={(e) => setSplitByEvent(e.target.checked)}
                  />
                  Create one chapter per Event tag
                </label>
              )}
            </div>
          )}
        </>
      )}

      {pending.length > 0 && (
        <>
          <h2 style={{ fontSize: 18, marginTop: 26 }}>
            Converted variations{' '}
            <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
              ({validPending.length} valid / {pending.length})
            </span>
          </h2>
          {pending.map((entry) => (
            <div key={entry.id} className="variation-row">
              <div className="row-head">
                <input
                  type="text"
                  style={{ flex: 1 }}
                  value={entry.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setPending((p) => p.map((x) => (x.id === entry.id ? { ...x, name } : x)));
                  }}
                />
                <button
                  className="small ghost danger"
                  onClick={() => setPending((p) => p.filter((x) => x.id !== entry.id))}
                >
                  ✕
                </button>
              </div>
              <div className="variation-moves" style={{ cursor: 'default' }}>
                <MoveText moves={entry.moves} comments={entry.comments} />
                {!entry.ok && <span className="status-bad"> ✗ {entry.failedToken}</span>}
              </div>
              <StatusLine entry={entry} />
              {entry.ok && entry.moves.length > 0 && (
                <div className="row-foot">
                  <button
                    className="small"
                    title="Open this game on the analysis board — it identifies which of your openings it follows"
                    onClick={() => onAnalyze({ name: entry.name, moves: entry.moves })}
                  >
                    ⇢ Analyze game
                  </button>
                </div>
              )}
            </div>
          ))}

          {tab === 'scoresheet' && (
            <div className="assign-bar" style={{ marginBottom: 12 }}>
              <label>
                Save to Games
                <select value={playerSel} onChange={(e) => setPlayerSel(e.target.value)}>
                  <option value="">Select group…</option>
                  {state.players.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                  <option value="__new">+ New group…</option>
                </select>
              </label>
              {playerSel === '__new' && (
                <label className="grow">
                  New group name
                  <input
                    type="text"
                    placeholder="e.g. My games, Student: Alex"
                    value={newPlayerName}
                    onChange={(e) => setNewPlayerName(e.target.value)}
                  />
                </label>
              )}
              <span style={{ flex: 1 }} />
              <button className="primary" disabled={!canSaveGames} onClick={saveToGames}>
                Save {validPending.length} game{validPending.length === 1 ? '' : 's'} to history
              </button>
            </div>
          )}

          <div className="assign-bar">
            <label>
              Opening
              <select value={openingSel} onChange={(e) => { setOpeningSel(e.target.value); setChapterSel(''); }}>
                <option value="">Select…</option>
                {state.openings.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
                <option value="__new">+ New opening…</option>
              </select>
            </label>
            {openingSel === '__new' && (
              <label className="grow">
                New opening name
                <input type="text" value={newOpeningName} onChange={(e) => setNewOpeningName(e.target.value)} />
              </label>
            )}
            {!useEventChapters && (
              <label>
                Chapter
                <select value={chapterSel} onChange={(e) => setChapterSel(e.target.value)}>
                  <option value="">Select…</option>
                  {selectedOpening?.chapters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  <option value="__new">+ New chapter…</option>
                </select>
              </label>
            )}
            {!useEventChapters && chapterSel === '__new' && (
              <label className="grow">
                New chapter name
                <input type="text" value={newChapterName} onChange={(e) => setNewChapterName(e.target.value)} />
              </label>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={downloadPendingPgn} disabled={validPending.length === 0}>
              <DownloadIcon size={15} /> Download .pgn
            </button>
            <button className="primary" disabled={!canAssign} onClick={assign}>
              Add {validPending.length} variation{validPending.length === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
