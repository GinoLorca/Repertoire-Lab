import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import SoundsSection from './SoundsView';
import { resolveTheme, themeForHour } from '../lib/theme';
import {
  PENS, SHORTCUTS, shortcutKey,
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

// One collapsible group of settings. Everything is open to begin with; the page
// is long enough now that being able to fold a section away matters.
function Section({ title, hint, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`settings-section${open ? ' open' : ''}`}>
      <button className="settings-head" onClick={() => setOpen((o) => !o)}>
        <span className="folder-caret">{open ? '▾' : '▸'}</span>
        <span className="settings-head-text">
          <h2>{title}</h2>
          {hint && <span className="muted-note">{hint}</span>}
        </span>
      </button>
      {open && <div className="settings-body">{children}</div>}
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

// The rebindable analysis-board shortcuts, click-to-capture. Binding a key
// already used elsewhere swaps the two rather than leaving one unreachable.
function ShortcutEditor({ settings, set }) {
  const [listening, setListening] = useState(null); // a shortcut id, while waiting for a keypress

  useEffect(() => {
    if (!listening) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setListening(null); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return; // wait for the plain key
      if (e.key.length !== 1) return; // named keys (Tab, F5, …) aren't bindable
      const key = e.key.toLowerCase();
      const current = { ...(settings.shortcuts ?? {}) };
      const holder = SHORTCUTS.find((s) => s.id !== listening && shortcutKey(settings, s.id) === key);
      if (holder) current[holder.id] = shortcutKey(settings, listening);
      current[listening] = key;
      set({ shortcuts: current });
      setListening(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
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
              title="Click, then press a key"
            >
              {listening === s.id ? '…' : shortcutKey(settings, s.id).toUpperCase()}
            </button>
            <span>{s.label}</span>
          </React.Fragment>
        ))}
        <React.Fragment><kbd>H</kbd><span>Practice: hint</span></React.Fragment>
        <React.Fragment><kbd>?</kbd><span>The shortcut list, on the analysis board</span></React.Fragment>
      </div>
      <p className="hint">
        Click a key above, then press its replacement — <kbd>Esc</kbd> cancels. Taking a key that's
        already in use swaps the two.
      </p>
      {customized && (
        <button className="small ghost" onClick={() => set({ shortcuts: {} })}>
          Reset all to defaults
        </button>
      )}
    </>
  );
}

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
  const speed = s.trainerSpeed ?? 'fast';

  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>

      <Section title="Appearance" hint="Theme">
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
      </Section>

      <Section title="The board" hint="Everywhere a board appears">
        <Toggle
          label="Show legal moves"
          hint="Tap or click a piece and every square it can go to is marked with a dot."
          on={s.showLegalMoves !== false}
          onChange={(v) => set({ showLegalMoves: v })}
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

      <Section title="Move trainer" hint="Learn and Practice">
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

      <Section title="Analysis board" hint="Engine, evaluation and book moves">
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

      <Section title="Keyboard" hint="On the analysis board — click a key to rebind it">
        <ShortcutEditor settings={s} set={set} />
      </Section>

      <Section title="Opening explorer" defaultOpen={false}>
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

      <Section title="Sounds" defaultOpen={false}>
        <SoundsSection bare />
      </Section>
    </div>
  );
}
