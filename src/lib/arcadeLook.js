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
import { useEffect } from 'react';
import { useStore } from '../store';
import { boardColors } from './theme';

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
}
