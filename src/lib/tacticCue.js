// The tactic cue on the analysis board: one short sound when the board steps
// one move forward onto a move marked with a tactic in Game Review — Chess
// Arcade's rule for its own review, so the two screens sound alike.
//
//   · One step forward only (the arrow key, the ▶ button, playing the game's
//     next move): never a jump, a step back, or a game opening on that move.
//   · After the move's own sound has had its loud part (CUE_AFTER_MS), so
//     neither hides the other.
//   · A held arrow key runs through marked moves silently; the cue comes
//     once it stops on one (each step cancels the cue waiting from the last).
//   · Sound off, or "Tactic sound" off in Settings: nothing.

// How long after the step the cue plays. Chess Arcade measures each theme's
// move sounds (120 to 450 ms); this sits in the middle of that.
export const CUE_AFTER_MS = 320;

// prev: the move the board was on (a node id; 'root' the start; null before
// anything was shown) · head: the move it is on now · parent: that move's
// parent · tactics: the tactics marked on it · soundOn / setting: the app's
// sound, and Settings' "Tactic sound" (absent reads as on).
export function tacticCueDue({
  prev, head, parent, tactics, soundOn = true, setting,
}) {
  if (!soundOn || setting === false) return false;
  if (prev == null || head == null || head === prev) return false;
  if (!Array.isArray(tactics) || tactics.length === 0) return false;
  return parent === prev;
}
