// Open one person's card in Coaches Corner (or Games) from anywhere — the
// coach's bell uses it for "Parker added a game → Open". The roster may not
// be on screen yet, so the request is left where it looks when it mounts,
// and announced for one that already is.
export function openPlayerCard(player) {
  window.__repertoireOpenPlayer = { id: player.id, kind: player.kind ?? 'self' };
  window.dispatchEvent(new CustomEvent('repertoire-open-screen', {
    detail: player.kind === 'student' ? 'coaches' : 'games',
  }));
  window.dispatchEvent(new Event('repertoire-open-player'));
}
