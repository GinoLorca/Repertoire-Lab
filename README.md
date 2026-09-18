# Repertoire Lab

A local, Chessable-style chess opening repertoire manager.

- **Library** — openings (Jobava London, Caro-Kann, Slav, …) → chapters → variations, with learned/due progress on each chapter card. Each opening is collapsible (▾/▸) with a one-line summary when closed. Chapters can be grouped into named **sections** within an opening (e.g. "Advance Variation", "Exchange Variation") — set the section when adding a chapter, or via the 🗂 button in a chapter's header. Each opening renders as a Chessable-style course card: large square **artwork** on the left (JPG/PNG/GIF, 1:1, min 650×650, max 3 MB — stored as 650×650 medium + 90×90 thumbnail; click to view/replace/remove, or use the dashed tile to add), with the title, progress bar, and due count beside it. Click the WHITE/BLACK badge to set which side you play in that opening (controls board orientation in practice).
- **Import** — three ways in:
  - **Screenshots**: drop images of move lists (e.g. from Chessable). Local OCR (Tesseract) reads them; every token is checked for chess legality and auto-corrected (`Qhd+`→`Qh4+`, `0-0`→`O-O`, …). Optionally switch to Claude vision for best accuracy (paste an Anthropic API key — stored only in your browser).
  - **Paste moves**: any movetext, including nested variations in parentheses (each branch becomes its own line) and full PGN.
  - **PGN file / course**: import a purchased course exported as PGN; one chapter per Event tag if you want.
  - Converted lines can also be downloaded directly as a `.pgn` without adding them to the library.
- **Annotations** — every move can carry a comment. PGN `{comments}` are kept on import (course explanations survive), commented moves get a dotted underline with a hover tooltip, comments can be read/edited in the board viewer, they pop up during practice as you pass through the moves, and they're included in PGN exports.
- **Learn** (per variation or per chapter) — Chessable-style guided learning: each of your moves is shown on the board (green highlight + arrow) and you copy it; when the line ends, you replay the whole sequence from the start, from memory. Any mistake during the interaction queues **3 drill runs** of that line immediately after — for every line you get wrong.
- **Practice** — pure recall, no previews: the opponent's moves auto-play, you play your side. Hints after repeated misses. Spaced repetition (1/3/7/14/30/60/120-day intervals; mistakes push a line back). **Transposition-tolerant**: if you play a move that isn't "the" expected move but reaches a position from another line in your repertoire (an alternative correct move or a genuine transposition), it's accepted and practice continues in that line. The Practice tab's mixed sessions quiz due lines and teach brand-new ones. Perfect runs get a confetti celebration. 🎉 During any session, the 📖 book button (top-right of the status card) opens a cheat sheet: the full move order with a mini board you can step through with the arrow keys (Esc closes). Moves play a chess.com-style wooden knock (deeper for captures, double for castling) — the 🔊/🔇 button next to the book icon mutes them, and the choice is remembered.
- **Games** — a history section with a group per person (yourself, each student). Scoresheet imports get saved here, and every game is automatically matched against your uploaded openings: which opening/variation it follows, how deep, and exactly where it left book.
- **Analysis** — repertoire-aware: when a game follows one of your uploaded openings, a 📖 panel names the line, shows how far it was followed, and flags the deviation (click it to jump to that position). At any position that appears in your repertoire, your own book move is shown first — green, with the line it comes from — and Stockfish 16 (3 lines, local) analyzes below it, taking over entirely once you're out of book. Plus the Lichess opening explorer (masters or player database) for most-common-move stats.
- **Export** — per chapter, per opening, or the whole repertoire as standard PGN (works for Lichess study import).

There's also a **✍️ Scoresheet photo** import tab for pictures of handwritten over-the-board notation. Pick a reading engine in the Import tab:

| Engine | Cost | Handwriting |
|---|---|---|
| **Claude vision** (`claude-opus-5`) | ~3–4¢ per photo | Best — reasons about legality while reading |
| **Google Gemini** (free tier) | Free | Good |
| **Local OCR** (Tesseract) | Free, offline | Printed text only — not handwriting |

**Every scoresheet goes through a verify screen before it's committed.** The photo sits next to a board and a scoresheet-style table (# / White / Black) that mirrors the sheet you're reading from, so you can check it row by row. Illegal moves are red, unreadable ones amber, and anything after the first problem is greyed out until it's fixed. Click a cell to see the position; ✎ to edit, with type-to-search over the legal moves in that position, look-alike suggestions, and — when the position is in your repertoire — the book move offered first. Then **Commit & Analyze**, and/or save it to a Games group.

Keys are stored only in your browser and sent straight to the provider; there's a **Test key** button to confirm one works. Photos are auto-downscaled to 2400px, can be contrast-enhanced (helps faint pencil a lot), rotated if the photo is sideways, and several photos can be sent as pages of one game. Anything the model can't read comes back as `??`, and the whole transcription is editable before re-parsing.

> **iPhone note:** photographing a scoresheet directly into the page works — iOS converts to JPEG automatically. HEIC files copied to a Mac can't be opened by Chrome/Firefox; export them as JPEG first (or set Settings → Camera → Formats → "Most Compatible").

Everything is stored locally in your browser (IndexedDB). No account, no server. A service worker caches the app after your first visit, so **Practice, Learn, and your whole library work offline** (analysis engine included, once you've used it online once) — only the Lichess explorer and Claude vision need internet. Use ⬇ Backup / ⬆ Restore in the Library to move your data between devices.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5199.

## Deploy it

Netlify builds this repo on every push to `main` — `netlify.toml` at the root
carries the build command, the publish directory and the no-cache headers the
service worker depends on. Nothing to upload by hand.

```bash
npm run build   # vite build, then scripts/precache.mjs pins the offline shell
```

`npm run build` is the only build worth running: plain `vite build` skips
`scripts/precache.mjs`, which is what substitutes the cache version and the
file list into `sw.js`. Without it the shipped service worker throws on its
first line and the old one keeps serving the old app — a broken deploy that
looks fine in `dist/`.

`npm run zip` still produces `repertoire-lab-site.zip` for a hand-drop onto
Netlify, as a fallback if a build ever needs to bypass Git.
