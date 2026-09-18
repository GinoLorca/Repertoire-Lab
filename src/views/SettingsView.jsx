import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import SoundsSection from './SoundsView';
import { resolveTheme, themeForHour, backgroundFor } from '../lib/theme';
import { SKINS, SKIN_ORDER, CUSTOM_SKIN, skinId } from '../lib/skins';
import { processBackground } from '../lib/background';
import { makePieces, DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK } from '../lib/pieces';
import { DEFAULT_SQUARE_LIGHT, DEFAULT_SQUARE_DARK } from '../components/Board';
import {
  PENS, SHORTCUTS, shortcutKey, formatShortcutKey, isPenShortcut, modifierToken, MODIFIER_ORDER,
  eventKey,
} from '../lib/shortcuts';

function Toggle({ label, hint, on, onChange }) {
  return (
    <label className={`setting-toggle${on ? ' on' : ''}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="setting-text">
        <strong>{label}</strong>
        {hint && <span className="muted-note">{hint}</span>}
      </span>
      <span className="switch" aria-hidden="true"><span className="knob" /></span>
    </label>
  );
}

// One group of settings, shown when its tab is the selected one. These used to
// stack as collapsible folds, but with eight groups the page became a long
// scroll where nothing was more than a few lines tall — a tab strip puts every
// group one click away instead of one hunt away.
function Section({ id, tab, title, hint, children }) {
  if (tab !== id) return null;
  return (
    <div className="settings-section open">
      <div className="settings-head static">
        <span className="settings-head-text">
          <h2>{title}</h2>
          {hint && <span className="muted-note">{hint}</span>}
        </span>
      </div>
      <div className="settings-body">{children}</div>
    </div>
  );
}

const TABS = [
  ['appearance', 'Appearance'],
  ['themes', 'Themes'],
  ['board', 'The board'],
  ['trainer', 'Move trainer'],
  ['analysis', 'Analysis board'],
  ['keyboard', 'Keyboard'],
  ['explorer', 'Explorer'],
  ['sounds', 'Sounds'],
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

// The rebindable analysis-board shortcuts, click-to-capture. Binding a key
// already used elsewhere swaps the two rather than leaving one unreachable.
function ShortcutEditor({ settings, set }) {
  const [listening, setListening] = useState(null); // a shortcut id, while waiting for a keypress

  useEffect(() => {
    if (!listening) return undefined;
    // Pen shortcuts can also bind to a pure modifier chord — Option alone, or
    // Option+Control together, no letter — since those sit right under the
    // fingers already on the mouse/trackpad hand. Captured by holding
    // whichever modifiers you want and releasing them all: the widest combo
    // reached during the hold becomes the binding. A plain letter still
    // finalizes immediately on its own keydown, same as any other shortcut.
    const comboCapable = isPenShortcut(listening);
    const heldMods = new Set();
    const maxCombo = new Set();

    const finalize = (key) => {
      const current = { ...(settings.shortcuts ?? {}) };
      const holder = SHORTCUTS.find((s) => s.id !== listening && shortcutKey(settings, s.id) === key);
      if (holder) current[holder.id] = shortcutKey(settings, listening);
      current[listening] = key;
      set({ shortcuts: current });
      setListening(null);
    };

    const onKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setListening(null); return; }
      const mod = modifierToken(e.key);
      if (mod && comboCapable) { heldMods.add(mod); maxCombo.add(mod); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return; // wait for the plain key (or a release, for a combo)
      // Via eventKey so a numpad digit binds as its printed digit rather than
      // as whatever Num Lock makes it report — without it, pressing numpad 1
      // here arrives as 'End' and gets rejected below as unbindable.
      const key = eventKey(e);
      if (key.length !== 1) return; // named keys (Tab, F5, …) aren't bindable
      finalize(key.toLowerCase());
    };

    const onKeyUp = (e) => {
      if (!comboCapable) return;
      const mod = modifierToken(e.key);
      if (!mod) return;
      heldMods.delete(mod);
      if (heldMods.size === 0 && maxCombo.size > 0) {
        finalize(MODIFIER_ORDER.filter((m) => maxCombo.has(m)).join('+'));
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
    };
  }, [listening, settings, set]);

  const customized = Object.keys(settings.shortcuts ?? {}).length > 0;
  const defaultPenId = settings.defaultPen ?? 'green';

  return (
    <>
      <div className="settings-row">
        <span>Default pen colour — what a drag draws in when no pen key is held</span>
      </div>
      <span className="pens">
        {PENS.map((p) => (
          <button
            key={p.id}
            className={`pen${defaultPenId === p.id ? ' active' : ''}`}
            style={{ background: p.value }}
            title={p.name}
            onClick={() => set({ defaultPen: p.id })}
          />
        ))}
      </span>
      <div className="shortcut-grid" style={{ marginTop: 14 }}>
        <React.Fragment><kbd>← →</kbd><span>Step back and forward through the moves</span></React.Fragment>
        <React.Fragment><kbd>↑ ↓</kbd><span>Analysis: start / end · Practice: previous / next line</span></React.Fragment>
        {SHORTCUTS.map((s) => (
          <React.Fragment key={s.id}>
            <button
              className={`kbd-edit${listening === s.id ? ' listening' : ''}`}
              onClick={() => setListening(s.id)}
              title={isPenShortcut(s.id)
                ? 'Click, then press a key — or hold Option and/or Control alone, no letter, and release'
                : 'Click, then press a key'}
            >
              {listening === s.id ? '…' : formatShortcutKey(shortcutKey(settings, s.id))}
            </button>
            <span>{s.label}</span>
          </React.Fragment>
        ))}
        <React.Fragment><kbd>H</kbd><span>Practice: hint</span></React.Fragment>
        <React.Fragment><kbd>?</kbd><span>The shortcut list, on the analysis board</span></React.Fragment>
      </div>
      <p className="hint">
        Click a key above, then press its replacement — <kbd>Esc</kbd> cancels. Taking a key that's
        already in use swaps the two. The four pen rows can also take Option and/or Control alone
        (no letter) — hold whichever you want, then let go.
      </p>
      {customized && (
        <button className="small ghost" onClick={() => set({ shortcuts: {} })}>
          Reset all to defaults
        </button>
      )}
    </>
  );
}

// A colour with its hex shown, so a value can be read and typed as well as picked.
function Swatch({ label, value, onChange }) {
  return (
    <label className="colour-field">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="cf-text">
        <strong>{label}</strong>
        <span className="muted-note">{value}</span>
      </span>
    </label>
  );
}

// Four squares and two pieces — enough to judge a scheme without leaving the page.
function BoardPreview({ squareLight, squareDark, pieceLight, pieceDark }) {
  const pieces = makePieces(pieceLight, pieceDark);
  const cell = (sq, code, key) => (
    <div key={key} className="bpv-sq" style={{ background: sq }}>
      {code ? pieces[code]({ squareWidth: 44 }) : null}
    </div>
  );
  return (
    <div className="board-preview">
      {cell(squareLight, 'bN', 0)}
      {cell(squareDark, 'bQ', 1)}
      {cell(squareDark, 'wK', 2)}
      {cell(squareLight, 'wP', 3)}
    </div>
  );
}

// A theme card: the palette's own chrome behind a four-square corner of its
// board, so each one is judged on what it actually looks like rather than on
// its name. Painted from the skin's tokens directly instead of from the live
// page, which is the only way to show five themes at once.
function SkinCard({ skin, mode, active, onPick }) {
  const p = skin[mode] ?? skin.dark;
  return (
    <button
      className={`skin-card${active ? ' active' : ''}`}
      style={{ background: p['--panel'], borderColor: active ? p['--accent'] : p['--border'] }}
      onClick={onPick}
    >
      <BoardPreview
        squareLight={p.boardLight}
        squareDark={p.boardDark}
        pieceLight={p.pieceLight}
        pieceDark={p.pieceDark}
      />
      <span className="skin-name" style={{ color: p['--text'] }}>{skin.name}</span>
      <span className="skin-blurb" style={{ color: p['--muted'] }}>{skin.blurb}</span>
      <span className="skin-chips" aria-hidden="true">
        {['--bg', '--card', '--accent', '--green', '--red'].map((t) => (
          <span key={t} className="skin-chip" style={{ background: p[t] }} />
        ))}
      </span>
    </button>
  );
}

const BOARD_PRESETS = [
  { name: 'Default', light: DEFAULT_SQUARE_LIGHT, dark: DEFAULT_SQUARE_DARK, pw: '#ffffff', pb: '#000000' },
  { name: 'Green', light: '#eeeed2', dark: '#769656', pw: '#ffffff', pb: '#000000' },
  { name: 'Walnut', light: '#f0d9b5', dark: '#b58863', pw: '#fffdf6', pb: '#2b2118' },
  { name: 'Slate', light: '#dfe3ea', dark: '#8397ab', pw: '#ffffff', pb: '#1b2430' },
  { name: 'Ink', light: '#c9c9c9', dark: '#3f3f46', pw: '#f4f4f5', pb: '#09090b' },
];

const MOVE_SECONDS = [
  [5, '5 seconds', 'Blitz recall — for lines you already know cold'],
  [10, '10 seconds', 'Enough to see the position, not to work it out'],
  [15, '15 seconds', 'Room to think, still a clock'],
  [30, '30 seconds', 'Gentle — a nudge rather than a test of speed'],
];

const SPEEDS = [
  ['fast', 'Fast', 'The reply comes straight back — best when you know the line'],
  ['medium', 'Medium', 'A beat between moves, enough to say what just happened'],
  ['slow', 'Slow', 'Time to talk a move through with a student before the reply'],
];

export default function SettingsView() {
  const { state, dispatch } = useStore();
  const s = state.settings;
  const set = (settings) => dispatch({ type: 'setSettings', settings });
  const active = resolveTheme(s);
  const currentSkin = skinId(s);
  const skinName = currentSkin === 'custom' ? CUSTOM_SKIN.name : SKINS[currentSkin].name;
  // The picture belongs to the theme that's on, so a theme change is a
  // wallpaper change — see backgroundFor in lib/theme.
  const bgImage = backgroundFor(s);
  const setBackground = (url) => set({
    backgrounds: { ...(s.backgrounds ?? {}), [currentSkin]: url },
    // The single pre-per-theme picture was Custom's; once Custom has a real
    // entry the old key is dead weight, and it's the largest thing in here.
    ...(currentSkin === 'custom' ? { background: null } : {}),
  });
  const speed = s.trainerSpeed ?? 'fast';
  const bgFileRef = useRef(null);
  const [bgError, setBgError] = useState(null);
  const [tab, setTab] = useState('appearance');

  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>

      <div className="settings-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`settings-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <Section id="appearance" tab={tab} title="Appearance" hint="Theme and background">
        <div className="theme-choices">
          {[
            ['dark', 'Dark', 'Always the dark palette'],
            ['light', 'Light', 'Always the light palette'],
            ['auto', 'Auto', 'Follows the time of day'],
          ].map(([value, label, hint]) => (
            <button
              key={value}
              className={`theme-card${s.theme === value ? ' active' : ''}`}
              onClick={() => set({ theme: value })}
            >
              <span className={`theme-swatch ${value}`} aria-hidden="true" />
              <strong>{label}</strong>
              <span className="muted-note">{hint}</span>
            </button>
          ))}
        </div>
        {s.theme === 'auto' ? (
          <div className="settings-row auto-hours">
            <span>Light from</span>
            <select value={s.lightFrom} onChange={(e) => set({ lightFrom: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <span>dark from</span>
            <select value={s.darkFrom} onChange={(e) => set({ darkFrom: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <span className="muted-note">
              Right now that's <strong>{themeForHour(new Date().getHours(), s.lightFrom, s.darkFrom)}</strong>.
              Switch to Dark or Light above to stop it changing on its own.
            </span>
          </div>
        ) : (
          <p className="hint">
            Showing the <strong>{active}</strong> palette. Choose Auto to let it follow the clock.
          </p>
        )}

        <div className="settings-row" style={{ marginTop: 18 }}>
          <span><strong>Background picture for {skinName}</strong></span>
        </div>
        {bgImage && (
          <div className="bg-preview" style={{ backgroundImage: `url("${bgImage}")` }} />
        )}
        {bgError && <p className="hint" style={{ color: 'var(--red)' }}>{bgError}</p>}
        <p className="hint">
          Your own image behind the app, kept <strong>per theme</strong> — this one belongs to{' '}
          <strong>{skinName}</strong>, and each theme shows its own (or the wallpaper it came with,
          if you haven't given it one). It's stored on this device and travels in a Backup, so keep
          an eye on the file size — it's shrunk to 2560px and re-encoded, but a picture is still far
          bigger than the rest of your settings put together.
        </p>
        {bgImage && (
          <>
            <div className="bg-veil-row">
              <span className="muted-note" title="How much of the theme colour is laid over the picture">
                Veil
              </span>
              <input
                type="range"
                min="0"
                max="95"
                value={s.backgroundVeil ?? 70}
                onChange={(e) => set({ backgroundVeil: Number(e.target.value) })}
              />
              <span className="val">{s.backgroundVeil ?? 70}%</span>
            </div>
            <div className="bg-veil-row">
              <span className="muted-note" title="How solid the cards and panels are over the picture">
                Panels
              </span>
              <input
                type="range"
                min="40"
                max="100"
                value={s.surfaceOpacity ?? 100}
                onChange={(e) => set({ surfaceOpacity: Number(e.target.value) })}
              />
              <span className="val">{s.surfaceOpacity ?? 100}%</span>
            </div>
            <div className="bg-veil-row">
              <span className="muted-note" title="How solid the chess board is over the picture">
                Board
              </span>
              <input
                type="range"
                min="30"
                max="100"
                value={s.boardOpacity ?? 100}
                onChange={(e) => set({ boardOpacity: Number(e.target.value) })}
              />
              <span className="val">{s.boardOpacity ?? 100}%</span>
            </div>
            <p className="hint">
              <strong>Veil</strong> dims the picture itself. <strong>Panels</strong> and{' '}
              <strong>Board</strong> let it show through what sits on top — panels are frosted so
              their text stays readable, and the board has its own control because how far you can
              push it depends entirely on the picture behind it.
            </p>
          </>
        )}
        <div className="settings-row">
          <button className="small" onClick={() => bgFileRef.current?.click()}>
            {bgImage ? 'Replace picture' : 'Choose a picture'}
          </button>
          {bgImage && (
            <button
              className="small ghost danger"
              onClick={() => { setBgError(null); setBackground(null); }}
            >
              Remove
            </button>
          )}
          <input
            ref={bgFileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setBgError(null);
              try {
                setBackground(await processBackground(file));
              } catch (err) {
                setBgError(err.message);
              }
            }}
          />
        </div>
      </Section>

      <Section
        id="themes"
        tab={tab}
        title="Themes"
        hint="The whole app’s palette — chrome, board and pieces together"
      >
        <p className="hint">
          The themes from <strong>Chess Arcade</strong>, brought across whole. Each one has a light
          and a dark face, so Dark / Light / Auto in Appearance still does its job — it just does it
          in the theme you pick here. Showing the <strong>{active}</strong> face below.
        </p>
        <div className="skin-grid">
          {SKIN_ORDER.map((id) => (
            <SkinCard
              key={id}
              skin={SKINS[id]}
              mode={active}
              active={currentSkin === id}
              onPick={() => set({ skin: id })}
            />
          ))}
          {/* Custom is the app's own palette — the one that was here before
              any of these existed. It paints nothing, which is exactly why
              an existing setup lands on it and looks untouched. */}
          <button
            className={`skin-card${currentSkin === 'custom' ? ' active' : ''}`}
            onClick={() => set({ skin: 'custom' })}
          >
            <BoardPreview
              squareLight={s.squareLight ?? DEFAULT_SQUARE_LIGHT}
              squareDark={s.squareDark ?? DEFAULT_SQUARE_DARK}
              pieceLight={s.pieceLight ?? DEFAULT_PIECE_LIGHT}
              pieceDark={s.pieceDark ?? DEFAULT_PIECE_DARK}
            />
            <span className="skin-name">{CUSTOM_SKIN.name}</span>
            <span className="skin-blurb">{CUSTOM_SKIN.blurb}</span>
            <span className="skin-chips" aria-hidden="true">
              {['--bg', '--card', '--accent', '--green', '--red'].map((t) => (
                <span
                  key={t}
                  className="skin-chip"
                  style={{ background: (CUSTOM_SKIN[active] ?? CUSTOM_SKIN.dark)[t] }}
                />
              ))}
            </span>
          </button>
        </div>
        {currentSkin !== 'custom' && (
          <Toggle
            label="Theme wallpaper"
            hint={'The page background that came with the theme — Tournament Felt\u2019s baize, '
              + 'Hustler\u2019s stone floor, Outer Space\u2019s stars, and the artwork Bauhaus and '
              + 'Game Boy ship with. Your own background picture, if you set one, wins over it either way.'}
            on={s.skinWallpaper !== false}
            onChange={(v) => set({ skinWallpaper: v })}
          />
        )}
        <p className="hint">
          {currentSkin === 'custom'
            ? 'Custom is on — the colours in The board are the ones in use, and your background picture sits behind them.'
            : `${SKINS[currentSkin].name} brings its own board and pieces, so the colours in The board are set aside while it's on. Switch back to Custom to use them again.`}
        </p>
      </Section>

      <Section id="board" tab={tab} title="The board" hint="Everywhere a board appears">
        <div className="settings-row"><span><strong>Colours</strong></span></div>
        {currentSkin !== 'custom' && (
          <p className="hint">
            <strong>{SKINS[currentSkin].name}</strong> is painting the board at the moment, so these
            are on hold — they're kept, not lost, and come back the moment you choose Custom in
            Themes.
          </p>
        )}
        <div className="board-colours">
          <BoardPreview
            squareLight={s.squareLight ?? DEFAULT_SQUARE_LIGHT}
            squareDark={s.squareDark ?? DEFAULT_SQUARE_DARK}
            pieceLight={s.pieceLight ?? DEFAULT_PIECE_LIGHT}
            pieceDark={s.pieceDark ?? DEFAULT_PIECE_DARK}
          />
          <div className="colour-fields">
            <Swatch
              label="Light squares"
              value={s.squareLight ?? DEFAULT_SQUARE_LIGHT}
              onChange={(v) => set({ squareLight: v })}
            />
            <Swatch
              label="Dark squares"
              value={s.squareDark ?? DEFAULT_SQUARE_DARK}
              onChange={(v) => set({ squareDark: v })}
            />
            <Swatch
              label="White pieces"
              value={s.pieceLight ?? DEFAULT_PIECE_LIGHT}
              onChange={(v) => set({ pieceLight: v })}
            />
            <Swatch
              label="Black pieces"
              value={s.pieceDark ?? DEFAULT_PIECE_DARK}
              onChange={(v) => set({ pieceDark: v })}
            />
          </div>
        </div>
        <div className="settings-row">
          {BOARD_PRESETS.map((p) => (
            <button
              key={p.name}
              className="board-preset"
              title={p.name}
              onClick={() => set({
                squareLight: p.light, squareDark: p.dark, pieceLight: p.pw, pieceDark: p.pb,
              })}
            >
              <span className="bp-swatch" style={{ background: `linear-gradient(135deg, ${p.light} 50%, ${p.dark} 50%)` }} />
              {p.name}
            </button>
          ))}
          <button
            className="small ghost"
            onClick={() => set({
              squareLight: null, squareDark: null, pieceLight: null, pieceDark: null,
            })}
          >
            Reset
          </button>
        </div>
        <p className="hint">
          Applies to every board in the app — analysis, practice, the cheat sheet and compare.
          The piece colours are the two inks of the set: a white piece is filled with the first and
          outlined in the second, and a black piece is the other way round.
        </p>

        <Toggle
          label="Show legal moves"
          hint="Tap or click a piece and every square it can go to is marked with a dot."
          on={s.showLegalMoves !== false}
          onChange={(v) => set({ showLegalMoves: v })}
        />
        <Toggle
          label="Chapter videos"
          hint="The video at the top of a chapter's page, and the camera icon that jumps a line to its
            moment in it. Off hides the whole block — a chapter with no video attached never shows
            anything there either way."
          on={s.showChapterVideos !== false}
          onChange={(v) => set({ showChapterVideos: v })}
        />
        <Toggle
          label="Move badges — on the board"
          hint="A badged move's coloured square and glyph, wherever a board is showing that move —
            analysis, practice, the line viewer, compare. Editing badges from Coaches Corner or a
            chapter's line viewer still works with this off; it only changes what's shown."
          on={s.showBoardBadges !== false}
          onChange={(v) => set({ showBoardBadges: v })}
        />
        <Toggle
          label="Move badges — in move lists and notes"
          hint="The small glyph next to a badged move in a move list, and on the note card under the
            analysis board. Independent of the board toggle above — turn off either one, or both."
          on={s.showMoveListBadges !== false}
          onChange={(v) => set({ showMoveListBadges: v })}
        />
        <Toggle
          label="Highlight the last move"
          hint="A pale mark on the square a piece came from and the one it moved to, the way
            chess.com does it — on every board in the app."
          on={s.lastMoveHighlight !== false}
          onChange={(v) => set({ lastMoveHighlight: v })}
        />
        <Toggle
          label="Highlight the king in check"
          hint="A red glow under a king that's in check, on every board in the app."
          on={s.checkHighlight !== false}
          onChange={(v) => set({ checkHighlight: v })}
        />
      </Section>

      <Section id="trainer" tab={tab} title="Move trainer" hint="Learn and Practice">
        <div className="speed-choices">
          {SPEEDS.map(([value, label, hint]) => (
            <button
              key={value}
              className={`theme-card${speed === value ? ' active' : ''}`}
              onClick={() => set({ trainerSpeed: value })}
            >
              <strong>{label}</strong>
              <span className="muted-note">{hint}</span>
            </button>
          ))}
        </div>
        <Toggle
          label="Time each move"
          hint="Puts a clock on every move you owe. Run out and the correct move is played for you,
            with the author's note on it if the course has one. In Learn — where the move is already
            shown — running out costs nothing; while you're being tested it counts as a miss and
            earns the same drill as playing it wrong."
          on={!!s.moveTimer}
          onChange={(v) => set({ moveTimer: v })}
        />
        {s.moveTimer && (
          <div className="speed-choices">
            {MOVE_SECONDS.map(([value, label, hint]) => (
              <button
                key={value}
                className={`theme-card${(s.moveTimerSeconds ?? 15) === value ? ' active' : ''}`}
                onClick={() => set({ moveTimerSeconds: value })}
              >
                <strong>{label}</strong>
                <span className="muted-note">{hint}</span>
              </button>
            ))}
          </div>
        )}
        <Toggle
          label="Pause between drill repeats"
          hint="A finished line always waits for you to press Next. Turn this on to stop between the
            individual repeats of a missed move as well."
          on={!!s.pauseAtEnd}
          onChange={(v) => set({ pauseAtEnd: v })}
        />
        <Toggle
          label="List the session's lines beside the board"
          hint="A panel down the left in Learn and Practice showing every line in the session, where
            you are, and what's already done. Wide screens only."
          on={s.practiceList !== false}
          onChange={(v) => set({ practiceList: v })}
        />
        <Toggle
          label="Give hints after repeated mistakes"
          hint="Off by default: get a move wrong and you simply try again. Turn this on to have the
            answer's squares lit up — and eventually spelled out — after a few wrong tries."
          on={!!s.hints}
          onChange={(v) => set({ hints: v })}
        />
      </Section>

      <Section id="analysis" tab={tab} title="Analysis board" hint="Engine, evaluation and book moves">
        <Toggle
          label="Engine on when the board opens"
          hint="Stockfish starts thinking as soon as you open an analysis board — the arrows and the
            evaluation bar come from it, so nothing is drawn until it's running."
          on={s.engineAuto !== false}
          onChange={(v) => set({ engineAuto: v })}
        />
        <Toggle
          label="Evaluation bar"
          hint="A vertical bar beside the analysis board showing who stands better, from Stockfish."
          on={s.evalBar !== false}
          onChange={(v) => set({ evalBar: v })}
        />
        <Toggle
          label="Engine lines"
          hint="Stockfish's candidate moves beside the board. Turn off for a quieter board."
          on={s.engineLines !== false}
          onChange={(v) => set({ engineLines: v })}
        />
        <Toggle
          label="Engine arrows"
          hint="Draw Stockfish's top suggestions on the analysis board, strongest first."
          on={s.engineArrows !== false}
          onChange={(v) => set({ engineArrows: v })}
        />
        {s.engineArrows !== false && (
          <div className="setting-children">
            <Toggle
              label="Best move arrow"
              hint="Green — the engine's first choice."
              on={s.arrowBest !== false}
              onChange={(v) => set({ arrowBest: v })}
            />
            <Toggle
              label="2nd best arrow"
              hint="Blue."
              on={s.arrowSecond !== false}
              onChange={(v) => set({ arrowSecond: v })}
            />
            <Toggle
              label="3rd best arrow"
              hint="Amber."
              on={s.arrowThird !== false}
              onChange={(v) => set({ arrowThird: v })}
            />
          </div>
        )}
        <Toggle
          label="Repertoire book moves"
          hint="Show your own lines above the engine's on the analysis board. Turn off to judge a
            game purely on Stockfish."
          on={s.bookMoves !== false}
          onChange={(v) => set({ bookMoves: v })}
        />
      </Section>

      <Section id="keyboard" tab={tab} title="Keyboard" hint="On the analysis board — click a key to rebind it">
        <ShortcutEditor settings={s} set={set} />
      </Section>

      <Section id="explorer" tab={tab} title="Opening explorer">
        <p className="hint">
          Lichess has started refusing anonymous explorer requests (a 401). Paste a personal API
          token from lichess.org → Preferences → API access tokens to use it again. No scopes are
          needed; it is stored on this device only.
        </p>
        <input
          type="text"
          value={s.lichessToken ?? ''}
          placeholder="lip_… (optional)"
          onChange={(e) => set({ lichessToken: e.target.value.trim() })}
        />
      </Section>

      <Section id="sounds" tab={tab} title="Sounds">
        <SoundsSection bare />
      </Section>
    </div>
  );
}
