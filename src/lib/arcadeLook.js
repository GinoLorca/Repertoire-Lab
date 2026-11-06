// The rule for every Chess Arcade tab inside Repertoire Lab (Game Review, a
// player's CLAMP, Tactics and Openings, and any ported later): it wears
// Repertoire Lab's theme — the same one of the shared themes, dark when
// Repertoire Lab is dark and light when it's light — and changes with it,
// as it's changed in Settings or as 'auto' turns over at dusk. Read off the
// page itself (lib/theme.js paints data-skin and data-theme on <html>), so
// whatever decided the look, the frames follow. Custom has no theme of its
// own to name: its colours go across as they're painted now.
//
// Every component that shows Chess Arcade calls useArcadeLook once it's ready.
import { useEffect } from 'react';
import { useStore } from '../store';
import { boardColors } from './theme';

export function currentLook(settings) {
  const root = document.documentElement;
  const skin = root.dataset.skin || 'custom';
  const theme = root.dataset.theme === 'light' ? 'light' : 'dark';
  if (skin !== 'custom') return { skin, theme };
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
      boardLight: board.squareLight ?? v('--board-light'),
      boardDark: board.squareDark ?? v('--board-dark'),
      pieceWhite: board.pieceLight ?? null,
      pieceBlack: board.pieceDark ?? null,
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
