import React, { useState } from 'react';
import { mainLineFrom } from '../lib/moveTree';

// "4." for White's move, "4…" for Black's, from the ply it was played at.
const numFor = (ply) => `${Math.floor((ply - 1) / 2) + 1}${ply % 2 === 1 ? '.' : '…'}`;

// One variation, written the way a book writes it: 3…Bd6 4.e3 Nf6, with any
// further branches inside it in their own brackets.
function InlineLine({ start, startPly, headId, onGo, onMenu }) {
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
            {showNum && <span className="mt-inline-num">{numFor(ply)}</span>}
            <button
              className={`mt-move inline${headId === node.id ? ' current' : ''}`}
              onClick={() => onGo(node.id)}
              onContextMenu={(e) => { e.preventDefault(); onMenu(node.id, e); }}
            >
              {node.san}
            </button>
            {siblings.map((sib) => (
              <span key={sib.id} className="mt-nested">
                (
                <InlineLine
                  start={sib}
                  startPly={ply}
                  headId={headId}
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
export default function MoveTree({ root, headId, onGo, onPromote, onPromoteOne, onDelete }) {
  const [menu, setMenu] = useState(null); // { nodeId, x, y }
  const main = mainLineFrom(root);
  const rows = Math.ceil(main.length / 2);

  const openMenu = (nodeId, e) => {
    setMenu({ nodeId, x: e.clientX, y: e.clientY });
  };

  // Variations that answer the move at this ply (1-based).
  const branchesAt = (ply) => {
    const parent = ply === 1 ? root : main[ply - 2];
    return (parent?.children ?? []).slice(1);
  };

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
      </button>
    );
  };

  return (
    <>
      {/* The scrolling is the wrapper's job (see .movelist-scroll) — a second
          scroll box in here is what stopped the list following the game. */}
      <div className="move-table">
        {Array.from({ length: rows }, (_, row) => {
          const whitePly = row * 2 + 1;
          const blackPly = whitePly + 1;
          const branches = [...branchesAt(whitePly).map((b) => [b, whitePly]),
            ...branchesAt(blackPly).map((b) => [b, blackPly])];
          return (
            <React.Fragment key={row}>
              <span className="mt-num">{row + 1}.</span>
              {cell(whitePly)}
              {cell(blackPly)}
              {branches.map(([branch, ply]) => (
                <div key={branch.id} className="mt-branch">
                  <button
                    className="mt-branch-menu"
                    title="Promote or delete this variation"
                    onClick={(e) => openMenu(branch.id, e)}
                  >
                    ⋮
                  </button>
                  <InlineLine
                    start={branch}
                    startPly={ply}
                    headId={headId}
                    onGo={onGo}
                    onMenu={openMenu}
                  />
                </div>
              ))}
            </React.Fragment>
          );
        })}
      </div>

      {menu && (
        <>
          <div className="menu-scrim" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="move-menu" style={{ left: menu.x, top: menu.y }}>
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
        </>
      )}
    </>
  );
}
