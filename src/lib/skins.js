// The themes from Chess Arcade (wavys-chess-prep), brought across intact.
//
// Chess Arcade names its palette tokens after a card table (--surface, --ink,
// --brass); Repertoire Lab names its after the page (--panel, --text,
// --accent). Same idea, different vocabulary, so each skin below is that app's
// palette translated into this one's tokens — with the two colours it has and
// Chess Arcade doesn't (--card-hover, --track) picked by hand to sit a step
// off the surface they belong to, and --accent-dim chosen for what white text
// sits on rather than as a mechanical tint of --accent.
//
// Each skin carries a full light and dark palette, because both apps already
// had one: choosing a skin doesn't take away Dark / Light / Auto, it changes
// what each of those looks like.
//
// The board and piece colours ride along inside each mode. Chess Arcade's
// board tones differ between its light and dark palettes (Game Boy's LCD goes
// from bright pea-green to dark olive, Tournament Felt's baize deepens), and
// flattening that to one pair per skin would lose the half of each theme you
// see most: the board.

// Every skin bar Custom paints these; Custom leaves them alone so the app's
// own palette shows through. Listed once so applySkin can clear exactly what
// it sets — a leftover token from a previous skin is the one way this could
// go wrong.
export const SKIN_TOKENS = [
  '--bg', '--panel', '--card', '--card-hover', '--border', '--text', '--muted',
  '--accent', '--accent-dim', '--green', '--red', '--amber', '--track',
];

export const SKINS = {
  felt: {
    id: 'felt',
    name: 'Tournament Felt',
    blurb: 'Brass, green baize and ivory — Chess Arcade’s default.',
    light: {
      // Chess Arcade's light felt is the green baize itself (#3a6b4a). That
      // works there because its content sits on ivory cards, but this app puts
      // secondary text straight on the page — and #665d49 on that green is
      // 1.05:1, which is not "low contrast", it's invisible. The light face is
      // the table linen instead: same cloth, same weave over it, 4.3:1 for
      // muted text and 11.5:1 for body. The dark face below keeps the green.
      '--bg': '#dcd2b4',
      '--panel': '#fdfaf1',
      '--card': '#eee2c6',
      '--card-hover': '#e4d5b2',
      '--border': '#c9ba90',
      '--text': '#1e1a12',
      '--muted': '#665d49',
      '--accent': '#8a6a16',
      '--accent-dim': '#a9841f',
      '--green': '#2f7d4f',
      '--red': '#b6392f',
      '--amber': '#b4691a',
      '--track': '#ddd0ad',
      boardLight: '#ecdfc0',
      boardDark: '#55684f',
      pieceLight: '#f7f0dd',
      pieceDark: '#20180c',
    },
    dark: {
      '--bg': '#142a1b',
      '--panel': '#1b2117',
      '--card': '#232a1d',
      '--card-hover': '#2d3526',
      '--border': '#343a28',
      '--text': '#ede6d3',
      '--muted': '#a89f88',
      '--accent': '#e0b13c',
      '--accent-dim': '#8a6a16',
      '--green': '#4fb374',
      '--red': '#e2665a',
      '--amber': '#e0a63e',
      '--track': '#101d13',
      boardLight: '#e9dfc3',
      boardDark: '#3a4a3a',
      pieceLight: '#f4ecd6',
      pieceDark: '#20180c',
    },
  },

  hustler: {
    id: 'hustler',
    name: 'Hustler',
    blurb: 'Park-bench marble and quarried stone, with a jade accent.',
    light: {
      '--bg': '#c9c6bd',
      '--panel': '#deded4',
      '--card': '#c2bfb5',
      '--card-hover': '#b7b4a9',
      '--border': '#a5a196',
      '--text': '#1c1e20',
      '--muted': '#585d61',
      '--accent': '#3f8a76',
      '--accent-dim': '#357462',
      '--green': '#2f7d4f',
      '--red': '#b23a2c',
      '--amber': '#b4691a',
      '--track': '#b4b1a7',
      boardLight: '#efece3',
      boardDark: '#242423',
      pieceLight: '#f4f2ea',
      pieceDark: '#17171a',
    },
    dark: {
      '--bg': '#191b1d',
      '--panel': '#232629',
      '--card': '#2d3134',
      '--card-hover': '#383d41',
      '--border': '#3a3f43',
      '--text': '#e9e6df',
      '--muted': '#979da1',
      '--accent': '#5fcab0',
      '--accent-dim': '#2f6b5d',
      '--green': '#4fb374',
      '--red': '#e2665a',
      '--amber': '#e0a63e',
      '--track': '#141618',
      boardLight: '#efece3',
      boardDark: '#242423',
      pieceLight: '#f4f2ea',
      pieceDark: '#17171a',
    },
  },

  bauhaus: {
    id: 'bauhaus',
    name: 'Bauhaus',
    blurb: 'Flat primaries and hard black rules — yellow, blue, red.',
    light: {
      '--bg': '#ece7dc',
      '--panel': '#faf7f0',
      '--card': '#e6e0d2',
      '--card-hover': '#dbd4c3',
      '--border': '#141414',
      '--text': '#141414',
      '--muted': '#5c5850',
      '--accent': '#1a4fa0',
      '--accent-dim': '#16407f',
      '--green': '#1a4fa0',
      '--red': '#d8232a',
      '--amber': '#e0a500',
      '--track': '#d5cebd',
      boardLight: '#f2ede1',
      boardDark: '#1a4fa0',
      pieceLight: '#faf7f0',
      pieceDark: '#141414',
    },
    dark: {
      '--bg': '#121212',
      '--panel': '#1e1e1e',
      '--card': '#2a2a2a',
      '--card-hover': '#353535',
      '--border': '#4a4a4a',
      '--text': '#f5f2ea',
      '--muted': '#a8a29a',
      '--accent': '#f2c200',
      // White on Bauhaus yellow is unreadable, so the "selected" fill is the
      // primary blue the skin already uses for its board.
      '--accent-dim': '#1a4fa0',
      '--green': '#3d7bd1',
      '--red': '#e8453c',
      '--amber': '#f2c200',
      '--track': '#0c0c0c',
      boardLight: '#e8e2d5',
      boardDark: '#1a4fa0',
      pieceLight: '#f5f2ea',
      pieceDark: '#141414',
    },
  },

  gameboy: {
    id: 'gameboy',
    name: 'Game Boy',
    blurb: 'Dot-matrix green LCD, in a grey plastic shell with a pink button.',
    light: {
      '--bg': '#c9cdb6',
      '--panel': '#dee2cf',
      '--card': '#c3c7ac',
      '--card-hover': '#b7bba0',
      '--border': '#93967f',
      '--text': '#1c1d14',
      '--muted': '#5f6350',
      '--accent': '#b8236b',
      '--accent-dim': '#9a1c59',
      '--green': '#2f9e44',
      '--red': '#c23b3b',
      '--amber': '#c2701a',
      '--track': '#b5b99e',
      boardLight: '#9bbc0f',
      boardDark: '#306230',
      pieceLight: '#e8f0c0',
      pieceDark: '#0f380f',
    },
    dark: {
      '--bg': '#1c2016',
      '--panel': '#262b1d',
      '--card': '#313629',
      '--card-hover': '#3c4133',
      '--border': '#3c4130',
      '--text': '#e4e8d4',
      '--muted': '#9aa088',
      '--accent': '#e2528f',
      '--accent-dim': '#8f2f5a',
      '--green': '#4bbf5e',
      '--red': '#e2665a',
      '--amber': '#e0a63e',
      '--track': '#161a11',
      boardLight: '#8bac0f',
      boardDark: '#0f380f',
      pieceLight: '#e4e8d4',
      pieceDark: '#0b280b',
    },
  },

  outerspace: {
    id: 'outerspace',
    name: 'Outer Space',
    blurb: 'Void black and one hot orange — Cowboy Bebop, not generic sci-fi.',
    light: {
      '--bg': '#161b26',
      '--panel': '#1d2330',
      '--card': '#262d3d',
      '--card-hover': '#313949',
      '--border': '#323a4d',
      '--text': '#eee8d8',
      '--muted': '#8b93a3',
      '--accent': '#ff5a36',
      '--accent-dim': '#b8351a',
      '--green': '#4fd6c4',
      '--red': '#ff3b3b',
      '--amber': '#ffb347',
      '--track': '#11151e',
      boardLight: '#e8b578',
      boardDark: '#12141c',
      pieceLight: '#f3ecda',
      pieceDark: '#14161e',
    },
    dark: {
      '--bg': '#0b0e14',
      '--panel': '#12151f',
      '--card': '#191d29',
      '--card-hover': '#232839',
      '--border': '#252b3a',
      '--text': '#f0ead8',
      '--muted': '#7c8494',
      '--accent': '#ff6a45',
      '--accent-dim': '#c03f22',
      '--green': '#5eead4',
      '--red': '#ff4d4d',
      '--amber': '#ffc266',
      '--track': '#070910',
      boardLight: '#e8b578',
      boardDark: '#0d0f16',
      pieceLight: '#f0ead8',
      pieceDark: '#101219',
    },
  },
};

// The order they're offered in — Chess Arcade's own, with Custom last.
export const SKIN_ORDER = ['felt', 'hustler', 'bauhaus', 'gameboy', 'outerspace'];

export const CUSTOM_SKIN = {
  id: 'custom',
  name: 'Custom',
  blurb: 'Your own palette — the app’s own colours, and the board you set in The board.',
  // Only for drawing Custom's card. The card can't read the live page for
  // these: with a skin on, the page IS that skin, and Custom's swatches would
  // show the very theme you're being offered an escape from. These mirror
  // :root and :root[data-theme="light"] in styles.css — the app's own palette,
  // which is what choosing Custom gives you back.
  light: {
    '--bg': '#f4f6fa', '--card': '#ffffff', '--accent': '#1f6fd0', '--green': '#1a9c53', '--red': '#d03a32',
  },
  dark: {
    '--bg': '#14171d', '--card': '#232833', '--accent': '#3b9cff', '--green': '#2ecc71', '--red': '#e5534b',
  },
};

// Anything that isn't a known skin is Custom, which is also what every
// settings file written before this existed resolves to: no `skin` key means
// the colours already in there are the ones to keep using.
export const skinOf = (settings) => SKINS[settings?.skin] ?? null;

export const skinId = (settings) => (SKINS[settings?.skin] ? settings.skin : 'custom');
