import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mainLineFrom, branchRootOf } from '../lib/moveTree';
import MoveBadge from './MoveBadge';
import { useStore } from '../store';

// "4." for White's move, "4…" for Black's — from a *virtual* ply, one that
// always starts White's move 1 at 1, whatever real move number the game
// actually starts from (see basePly in MoveTree below).
const numFor = (virtualPly, startNumber) => (
  `${Math.floor((virtualPly - 1) / 2) + startNumber}${virtualPly % 2 === 1 ? '.' : '…'}`
);

// A colour on the whole variation, not one move in it — "this was the line
// that should've been played" — so it's a background wash across the row
// rather than anything living on an individual move button. Same hex the
// pens/squares elsewhere already draw in, so a green here means the same
// thing a green arrow does.
const HIGHLIGHT_HEX = { green: '#2ecc71', blue: '#3b9cff', yellow: '#e8b339' };
const highlightStyle = (color) => (color ? {
  backgroundColor: `${HIGHLIGHT_HEX[color]}2e`,
  borderRadius: 5,
} : undefined);

// One variation, written the way a book writes it: 3…Bd6 4.e3 Nf6, with any
// further branches inside it in their own brackets. `startPly` here is
// already virtual — callers convert once, at the branch point, and this
// just keeps incrementing it node by node.
function InlineLine({
  start, startPly, startNumber, headId, badges, highlights, onGo, onMenu,
}) {
  const nodes = [start, ...mainLineFrom(start)];
  return (
    <>
      {nodes.map((node, i) => {
        const ply = startPly + i;
        const showNum = ply % 2 === 1 || i === 0;
        // Alternatives to *this* move, which belong right after it.
        const siblings = i === 0 ? [] : (nodes[i - 1].children ?? []).slice(1);
        return (
          <React.Fragment key={node.id}>
            {showNum && <span className="mt-inline-num">{numFor(ply, startNumber)}</span>}
            <button
              className={`mt-move inline${headId === node.id ? ' current' : ''}`}
              onClick={() => onGo(node.id)}
              onContextMenu={(e) => { e.preventDefault(); onMenu(node.id, e); }}
            >
              {node.san}
              {badges?.[node.id] && <MoveBadge id={badges[node.id]} size={11} />}
            </button>
            {siblings.map((sib) => (
              <span key={sib.id} className="mt-nested" style={highlightStyle(highlights?.[sib.id])}>
                (
                <InlineLine
                  start={sib}
                  startPly={ply}
                  startNumber={startNumber}
                  headId={headId}
                  badges={badges}
                  highlights={highlights}
                  onGo={onGo}
                  onMenu={onMenu}
                />
                )
              </span>
            ))}
          </React.Fragment>
        );
      })}
    </>
  );
}

// The main line as a numbered table, with each variation on its own indented
// row underneath the move it answers.
//
// `startNumber`/`startColor` describe the position the tree's root actually
// stands for — 1/white for an ordinary game or repertoire line, but
// whatever a Board Editor position (or a pasted FEN) says otherwise. Every
// ply below is "virtual": shifted by one when the game starts on Black's
// move, so ply 1 always means White's move 1 internally and the White/Black
// table columns stay meaningful — the real first move (Black's) simply
// lands in the Black column of row one, White's cell left blank.
export default function MoveTree({
  root, headId, badges: badgesIn, highlights, onHighlight, onGo, onPromote, onPromoteOne, onDelete,
  startNumber = 1, startColor = 'w',
}) {
  const { state } = useStore();
  // Gated once, here, rather than in every downstream renderer (InlineLine
  // recurses into its own branches) — undefined reads as "no badges" wherever
  // it's checked, so nothing further needs to know the setting exists.
  const badges = state.settings.showMoveListBadges !== false ? badgesIn : undefined;
  const [menu, setMenu] = useState(null); // { nodeId, x, y }
  const [menuPos, setMenuPos] = useState(null); // clamped { left, top }, once measured
  const menuRef = useRef(null);
  const main = mainLineFrom(root);
  // How far a virtual ply runs ahead of main[]'s real index.
  const basePly = startColor === 'b' ? 1 : 0;
  const rows = Math.ceil((main.length + basePly) / 2);
  // Whichever move the open menu is actually on, resolved up to the branch
  // it belongs to — the same resolution assignHighlight itself does, done
  // here too just to know whether to show the swatches at all (a main-line
  // move has no variation to colour) and which one to mark as current.
  const menuBranchRoot = menu ? branchRootOf(root, menu.nodeId) : null;

  const openMenu = (nodeId, e) => {
    setMenuPos(null);
    setMenu({ nodeId, x: e.clientX, y: e.clientY });
  };

  // The menu opens at the click point, which on a narrow screen (or a move
  // near the right edge of the panel) can push it partly off-screen — this
  // pulls it back in once its real size is known, before the browser paints.
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const margin = 8;
    const rect = menuRef.current.getBoundingClientRect();
    const left = Math.min(menu.x, window.innerWidth - rect.width - margin);
    const top = Math.min(menu.y, window.innerHeight - rect.height - margin);
    setMenuPos({ left: Math.max(margin, left), top: Math.max(margin, top) });
  }, [menu]);

  // Variations that answer the move at this REAL ply (1-based).
  const branchesAt = (ply) => {
    const parent = ply === 1 ? root : main[ply - 2];
    return (parent?.children ?? []).slice(1);
  };

  // `ply` here is real (1-based into main[]) — 0 or negative means "before
  // the game actually starts" (Black-to-move row one's blank White cell),
  // which main[] already reads as undefined with no special-casing needed.
  const cell = (ply) => {
    const node = main[ply - 1];
    if (!node) return <span key={`gap${ply}`} />;
    return (
      <button
        key={node.id}
        className={`mt-move${headId === node.id ? ' current' : ''}`}
        onClick={() => onGo(node.id)}
        onContextMenu={(e) => { e.preventDefault(); openMenu(node.id, e); }}
      >
        {node.san}
        {badges?.[node.id] && <MoveBadge id={badges[node.id]} size={12} />}
      </button>
    );
  };

  return (
    <>
      {/* The scrolling is the wrapper's job (see .movelist-scroll) — a second
          scroll box in here is what stopped the list following the game. */}
      <div className="move-table">
        {Array.from({ length: rows }, (_, row) => {
          const whiteReal = row * 2 + 1 - basePly;
          const blackReal = whiteReal + 1;
          const branches = [...branchesAt(whiteReal).map((b) => [b, whiteReal]),
            ...branchesAt(blackReal).map((b) => [b, blackReal])];
          return (
            <React.Fragment key={row}>
              <span className="mt-num">{startNumber + row}.</span>
              {cell(whiteReal)}
              {cell(blackReal)}
              {branches.map(([branch, realPly]) => (
                <div key={branch.id} className="mt-branch" style={highlightStyle(highlights?.[branch.id])}>
                  <button
                    className="mt-branch-menu"
                    title="Promote, delete, or highlight this variation"
                    onClick={(e) => openMenu(branch.id, e)}
                  >
                    ⋮
                  </button>
                  <InlineLine
                    start={branch}
                    startPly={realPly + basePly}
                    startNumber={startNumber}
                    headId={headId}
                    badges={badges}
                    highlights={highlights}
                    onGo={onGo}
                    onMenu={openMenu}
                  />
                </div>
              ))}
            </React.Fragment>
          );
        })}
      </div>

      {/* Portaled straight to <body>, not just rendered here with `position:
          fixed` — a `fixed` element still obeys an ANCESTOR's containing
          block if that ancestor has a filter/backdrop-filter/transform on it,
          which .analysis-movelist-panel does the moment a custom background
          is on (see styles.css's .has-custom-bg rules). Without the portal
          this menu was opening hundreds of pixels off-screen — the click
          registered, `menu` state was genuinely set, there was just nothing
          visible anywhere to click on afterwards. Rendering outside that
          whole subtree is what makes `fixed` mean the viewport again,
          regardless of what any ancestor's CSS does now or in the future. */}
      {menu && createPortal(
        <>
          <div className="menu-scrim" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            ref={menuRef}
            className="move-menu"
            style={{ left: menuPos ? menuPos.left : menu.x, top: menuPos ? menuPos.top : menu.y }}
          >
            {onHighlight && menuBranchRoot && (
              <div className="mt-highlight-row">
                {['green', 'blue', 'yellow'].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`mt-swatch${highlights?.[menuBranchRoot] === color ? ' on' : ''}`}
                    style={{ background: HIGHLIGHT_HEX[color] }}
                    title={`Highlight ${color}`}
                    onClick={() => { onHighlight(menu.nodeId, color); setMenu(null); }}
                  />
                ))}
                <button
                  type="button"
                  className="mt-swatch mt-swatch-clear"
                  title="Clear highlight"
                  disabled={!highlights?.[menuBranchRoot]}
                  onClick={() => { onHighlight(menu.nodeId, null); setMenu(null); }}
                >
                  ✕
                </button>
              </div>
            )}
            <button onClick={() => { onPromote(menu.nodeId); setMenu(null); }}>
              Promote to main line
            </button>
            <button onClick={() => { onPromoteOne(menu.nodeId); setMenu(null); }}>
              Promote one level
            </button>
            <button className="danger" onClick={() => { onDelete(menu.nodeId); setMenu(null); }}>
              Delete from here
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
