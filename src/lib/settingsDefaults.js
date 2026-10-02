// Every setting's out-of-the-box value.
//
// Lives in its own plain module, not in store.jsx, so the sync engine can
// import it without dragging React and JSX along — which is what lets the
// sync tests in tests/ run under plain Node.
// Defaults for anything the Settings tab controls. Merged over a restored
// state so an older backup gains new settings instead of missing them.
export const DEFAULT_SETTINGS = {
  anthropicKey: '',
  geminiKey: '',
  ocrEngine: 'tesseract',
  scoresheetEngine: 'claude',
  soundEnabled: true,
  volume: 1,
  pauseAtEnd: false, // wait at the end of a line instead of moving straight on
  practiceList: true, // the session's lines listed beside the practice board
  trainerSpeed: 'fast', // 'fast' | 'medium' | 'slow' — how quickly the trainer plays
  moveTimer: false, // put a clock on each move in Learn and Practice
  moveTimerSeconds: 15, // …and how long you get before the move plays itself
  checkHighlight: true, // red glow under a king that's in check
  lastMoveHighlight: true, // pale mark on the squares of the move just played
  showLegalMoves: true, // dots on the squares a picked piece can go to
  showChapterVideos: true, // the video block at the top of a chapter's page
  showBoardBadges: true, // a badged move's coloured square + glyph, on the board itself
  showMoveListBadges: true, // …and the small glyph next to the move in a move list or note
  hints: false, // reveal the answer's squares after repeated wrong tries
  evalBar: true, // the vertical engine evaluation beside the analysis board
  engineLines: true, // Stockfish's candidate lines under the board
  engineArrows: true, // draw the engine's suggestions on the board
  telestratorFade: 0, // seconds before telestrator ink fades by itself; 0 = stays until cleared
  clickerMode: false, // ↑/↓ step one move on the analysis board (a presenter clicker), not jump to first/last
  arrowBest: true, // …the first choice
  arrowSecond: true, // …the second
  arrowThird: true, // …the third
  engineAuto: true, // start Stockfish as soon as the analysis board opens
  bookMoves: true, // your own lines shown above the engine's on the board
  theme: 'dark', // 'dark' | 'light' | 'auto' (auto follows the time of day)
  // Which palette the whole app wears — one of the themes, or 'custom' for
  // this app's own colours plus whatever's set below. Tournament Felt is what
  // a new account opens on: it's the one that looks like the game.
  //
  // This is the default for a FRESH install only. An app that has been used
  // before keeps what it's wearing, including the plain 'custom' look that
  // used to be the default — see the hydrate below, which pins it there. A
  // person who has never chosen a theme shouldn't have one chosen for them by
  // an update.
  skin: 'felt',
  skinWallpaper: true, // the chosen theme's own page background, behind everything
  // Your own picture behind the app, as a data URL, keyed by theme — each
  // theme shows its own, or the wallpaper it shipped with. `background` below
  // is the single pre-per-theme picture, read as Custom's; see backgroundFor.
  backgrounds: {},
  background: null,
  backgroundVeil: 70, // how much of the theme colour is laid over it, 0–95%
  surfaceOpacity: 100, // how solid cards and panels are over that picture, 40–100%
  boardOpacity: 100, // …and the board itself, on its own control
  squareLight: null, // board colours; null means the built-in pair
  squareDark: null,
  pieceLight: null, // piece inks; null means the built-in black-and-white set
  pieceDark: null,
  lightFrom: 7, // hour the light theme starts under 'auto'
  darkFrom: 19, // hour the dark theme starts under 'auto'
};
