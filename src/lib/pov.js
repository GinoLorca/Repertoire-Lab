// Whose side a board is seen from when something is sent to it — yours.
// See AnalysisView: a game's own side on record comes first, then these.

export const sideOf = (c) => (c === 'white' || c === 'black' ? c : null);

// The side a PGN's White/Black names put you on: the one that's one of your
// own sections — its name, or its Chess.com / Lichess handle (a student's
// section isn't you). Null when neither name is yours, or both are.
export function sideFromNames({ white, black } = {}, players = []) {
  const known = new Set(
    players
      .filter((p) => (p.kind ?? 'self') === 'self')
      .flatMap((p) => [p.name, p.profile?.chesscom, p.profile?.lichess])
      .filter(Boolean)
      .map((n) => String(n).trim().toLowerCase()),
  );
  const mine = (n) => !!n && known.has(String(n).trim().toLowerCase());
  if (mine(black) && !mine(white)) return 'black';
  if (mine(white) && !mine(black)) return 'white';
  return null;
}
