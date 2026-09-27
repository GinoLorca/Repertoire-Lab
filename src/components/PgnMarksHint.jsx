import React from 'react';

// What to write in a PGN so its arrows come in with it — for anyone (or any
// assistant) typing up a course by hand. The same commands Lichess, ChessBase
// and Chessable export.
export default function PgnMarksHint() {
  return (
    <details className="pgn-marks-hint">
      <summary>Arrows &amp; highlighted squares in a PGN</summary>
      <p>
        Put them inside a move’s comment — they show on the board after that move, in Study and when
        the line is opened:
      </p>
      <code>8.Qxf3 {'{'}The knight was the key defender. [%cal Gf3f7,Rg5f6] [%csl Ye5]{'}'}</code>
      <ul>
        <li><code>[%cal Gf3f7]</code> an arrow from f3 to f7 · <code>[%csl Ye5]</code> a highlighted e5</li>
        <li>Colours: <strong>G</strong> green, <strong>R</strong> red, <strong>B</strong> blue, <strong>Y</strong> yellow; several at once separated by commas</li>
        <li>A comment before <code>1.</code> belongs to the starting position</li>
        <li>Forgot them? Open the line, press <strong>✎ Draw</strong>, and draw them on — they’re saved to that move.</li>
      </ul>
    </details>
  );
}
