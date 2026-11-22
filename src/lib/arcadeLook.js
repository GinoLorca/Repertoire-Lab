// The rule for every Chess Arcade tab inside Repertoire Lab (Game Review, a
// player's CLAMP, Tactics and Openings, and any ported later): it wears
// Repertoire Lab's theme — the same one of the shared themes, dark when
// Repertoire Lab is dark and light when it's light — and changes with it,
// as it's changed in Settings or as 'auto' turns over at dusk. Read off the
// page itself (lib/theme.js paints data-skin and data-theme on <html>), so
// whatever decided the look, the frames follow. Custom has no theme of its
// own to name: its colours go across as they're painted now.
//
// The colours go across with every theme, too. A copy of Chess Arcade that
// knows the theme by name ignores them; one synced before the theme existed
// (a theme added here before the next `npm run sync:arcade`) wears it as
// Custom, in these colours, rather than in its own default green.
//
// Every component that shows Chess Arcade calls useArcadeLook once it's ready.
// It hands over the arrow colour profile as well (Settings, the "Arrows:"
// label): one setting for the boards of both.
import { useEffect } from 'react';
import { useStore } from '../store';
import { boardColors } from './theme';
import { profileOf } from './arrowProfiles';

// A piece ink a theme gives as var(--x, #colour) (Uptown, Court Cards) goes
// across as the plain colour after the comma: the frame can't see --x.
const plain = (c) => (typeof c === 'string' ? (c.match(/^var\(--[\w-]+,\s*([^()]+)\)$/)?.[1] ?? c).trim() : null);

export function currentLook(settings) {
  const root = document.documentElement;
  const skin = root.dataset.skin || 'custom';
  const theme = root.dataset.theme === 'light' ? 'light' : 'dark';
  const cs = getComputedStyle(root);
  const v = (name) => cs.getPropertyValue(name).trim() || null;
  const board = boardColors(settings, theme);
  return {
    skin,
    theme,
    // Touch screens: a finger rested on a piece draws an arrow from it, or
    // (switched off in Settings) always picks it up — the analysis board's
    // own switch, so Game Review's board answers a finger the same way.
    holdDraw: settings?.holdDrawFromPieces !== false,
    colors: {
      accent: v('--accent'),
      bg: v('--bg'),
      surface: v('--panel'),
      boardLight: plain(board.squareLight) ?? v('--board-light'),
      boardDark: plain(board.squareDark) ?? v('--board-dark'),
      pieceWhite: plain(board.pieceLight),
      pieceBlack: plain(board.pieceDark),
    },
  };
}

// api: () => the frame's window.__rlReview (or null); ready: the frame said so.
export function useArcadeLook(api, ready) {
  const { state } = useStore();
  useEffect(() => {
    if (!ready) return undefined;
    const push = () => { try { api()?.look?.(currentLook(state.settings)); } catch { /* frame gone */ } };
    push();
    const watch = new MutationObserver(push);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin', 'data-theme', 'style'] });
    return () => watch.disconnect();
  }, [ready, state.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  // The arrow colour profile too: one setting for both apps' boards. One
  // picked inside the frame comes back as its 'arrowProfile' message
  // (onArcadeArrows), and is kept here.
  const arrows = profileOf(state.settings);
  useEffect(() => {
    if (!ready) return;
    try { api()?.arrows?.(arrows); } catch { /* frame gone */ }
  }, [ready, arrows]); // eslint-disable-line react-hooks/exhaustive-deps
}

// A frame's message that an arrow colour profile was picked inside it: kept as
// Repertoire Lab's own setting (and so handed back to every frame).
export function onArcadeArrows(d, dispatch, settings) {
  if (d?.type !== 'arrowProfile' || typeof d.id !== 'string') return;
  const id = profileOf({ arrowProfile: d.id });
  if (id !== profileOf(settings)) dispatch({ type: 'setSettings', settings: { arrowProfile: id } });
}
