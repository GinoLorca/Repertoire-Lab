import React, { useState } from 'react';
import { useStore, uid } from '../store';
import { useBackGuard } from '../lib/backGuard';
import {
  isWhiteMove, moveNumberOf, moveNumberLabel, sameStart,
} from '../lib/startPos';
import {
  branchOf, destinationsFor, familyOf, folderFor, stemOf, subLabel, suggestName,
} from '../lib/subVariations';

// Lines from a chapter, sent to a sub-variation of it: a chapter of their
// own, filed with this one in the Library — Panov Attack beside Exchange
// Variation, the way Tartakower and Karpov sit under Classical (Mainline).
//
// Opened from a line's long-press / right-click menu (`anchorId`: that line,
// with every line making the same move where the chapter branches ticked
// along with it), or from Select mode (`initialIds`: the ticked lines).
export default function SendToSubVariation({
  opening, chapter, anchorId = null, initialIds = null, onClose, onSent,
}) {
  const { dispatch } = useStore();
  useBackGuard(true, onClose);
  const lines = chapter.variations;
  const folder = folderFor(opening, chapter);
  // The folder's sub-variations — and, from a sub-variation, the chapter the
  // folder is of, so lines can go back.
  const existing = destinationsFor(opening, chapter);
  const label = (c) => (c.subsection ? subLabel(opening, c) : `${c.name} (the main chapter)`);

  const anchor = lines.find((v) => v.id === anchorId) ?? null;
  const branch = anchor ? branchOf(lines, anchor.id) : null;
  const family = anchor ? familyOf(anchor.name) : '';
  const named = family ? lines.filter((v) => familyOf(v.name) === family).map((v) => v.id) : [];

  const [picked, setPicked] = useState(() => new Set(initialIds ?? branch?.ids ?? (anchor ? [anchor.id] : [])));
  const [dest, setDest] = useState('new'); // 'new', or an existing sub-variation's chapter id
  const [typed, setTyped] = useState(null); // null: follow the suggestion as the ticks change

  const ids = lines.filter((v) => picked.has(v.id)).map((v) => v.id);
  const suggestion = suggestName(chapter, ids);
  const name = (typed ?? suggestion).trim();
  // A new name that's already a sub-variation here means that one — when
  // exactly one fits; with two chapters under one name, pick from the list.
  const matches = dest === 'new' && name
    ? existing.filter((c) => c.subsection && [c.subsection, c.name].some((n) => n?.toLowerCase() === name.toLowerCase()))
    : [];
  const same = matches.length === 1 ? matches[0] : null;
  const ambiguous = matches.length > 1;
  const target = dest === 'new' ? same : existing.find((c) => c.id === dest);
  const canSend = ids.length > 0 && (target || (name && !ambiguous));

  const sameSet = (a) => a.length === ids.length && a.every((id) => picked.has(id));
  const quick = [
    branch?.label && branch.ids.length > 1 && {
      label: `Every line with ${branch.label}`, ids: branch.ids,
    },
    named.length > 1 && named.length < lines.length
      && !(branch && named.length === branch.ids.length && named.every((id) => branch.ids.includes(id))) && {
      label: `Named “${shorten(family)}”`, ids: named,
    },
    anchor && { label: 'Just this one', ids: [anchor.id] },
  ].filter(Boolean);

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const send = () => {
    if (!canSend) return;
    if (target) {
      dispatch({ type: 'sendToSubVariation', openingId: opening.id, chapterId: chapter.id, variationIds: ids, toChapterId: target.id });
      onSent({ chapterId: target.id, name: target.subsection ? subLabel(opening, target) : target.name, count: ids.length });
      return;
    }
    const newChapterId = uid();
    dispatch({ type: 'sendToSubVariation', openingId: opening.id, chapterId: chapter.id, variationIds: ids, newChapterId, name });
    onSent({ chapterId: newChapterId, name, count: ids.length });
  };

  // Each line from just before where the chapter's lines part ways — the
  // opening moves they all share would only hide the difference. Worked out
  // among lines from the same start (some may be set up from a position).
  const fromOf = (v) => {
    const peers = lines.filter((x) => sameStart(x, v));
    return peers.length < 2 ? 0 : Math.max(0, stemOf(peers).length - 1);
  };
  const leftBehind = lines.length - ids.length;
  // A line already in the target (a copy from before) is merged, not added.
  const landing = target
    ? target.variations.length + ids.filter((id) => !target.variations.some((v) => v.id === id)).length
    : ids.length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal send-sub" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Send to a sub-variation</h3>
        <p className="hint">
          The lines move to a chapter of their own, filed with “{chapter.name}” in the Library — the way
          Tartakower and Karpov sit under Classical (Mainline). Progress, notes and badges go with them.
        </p>

        <div className="send-sub-section">
          <div className="send-sub-label">Sub-variation</div>
          {existing.map((c) => (
            <label key={c.id} className="send-sub-dest">
              <input type="radio" name="dest" checked={dest === c.id} onChange={() => setDest(c.id)} />
              <span>{label(c)}</span>
              <span className="muted-note">{c.variations.length} line{c.variations.length === 1 ? '' : 's'}</span>
            </label>
          ))}
          <label className="send-sub-dest">
            <input type="radio" name="dest" checked={dest === 'new'} onChange={() => setDest('new')} />
            <span>New:</span>
            <input
              type="text"
              value={typed ?? suggestion}
              placeholder="e.g. Panov Attack"
              onFocus={() => setDest('new')}
              onChange={(e) => { setDest('new'); setTyped(e.target.value); }}
            />
          </label>
          {same && <p className="muted-note">“{same.subsection}” is already a sub-variation here — the lines join it.</p>}
          {ambiguous && <p className="muted-note">More than one sub-variation is called that — pick one above.</p>}
        </div>

        <div className="send-sub-section">
          <div className="send-sub-label">
            Lines <span className="muted-note">· {ids.length} of {lines.length}</span>
          </div>
          {quick.length > 0 && (
            <div className="send-sub-quick">
              {quick.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className={`small${sameSet(q.ids) ? ' primary' : ' ghost'}`}
                  onClick={() => setPicked(new Set(q.ids))}
                >
                  {q.label}{q.ids.length > 1 ? ` (${q.ids.length})` : ''}
                </button>
              ))}
            </div>
          )}
          <ul className="send-sub-lines">
            {lines.map((v) => (
              <li key={v.id}>
                <label>
                  <input type="checkbox" checked={picked.has(v.id)} onChange={() => toggle(v.id)} />
                  <span className="send-sub-text">
                    <span className="send-sub-name">{v.name}</span>
                    <span className="muted-note">{movesFrom(v.moves, fromOf(v), v.startFen)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="send-sub-preview" aria-label="How it will look in the Library">
          <div className="send-sub-label">In the Library</div>
          <div>▾ <strong>{folder}</strong></div>
          <div className="send-sub-indent">
            {chapter.name} <span className="muted-note">· {leftBehind} line{leftBehind === 1 ? '' : 's'}</span>
          </div>
          {existing.filter((c) => c.id !== target?.id && c.subsection).map((c) => (
            <div key={c.id} className="send-sub-indent muted-note">{subLabel(opening, c)} · {c.variations.length}</div>
          ))}
          <div className="send-sub-indent send-sub-new">
            {target ? label(target) : (name || '…')}{' '}
            <span className="muted-note">
              · {landing} line{landing === 1 ? '' : 's'}
            </span>
          </div>
          {leftBehind === 0 && ids.length > 0 && (
            <p className="hint">“{chapter.name}” will be left with no lines of its own.</p>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!canSend} onClick={send}>
            Send {ids.length || ''} line{ids.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

const shorten = (s) => (s.length > 32 ? `…${s.slice(-30)}` : s);

function movesFrom(moves, from, startFen) {
  const out = [];
  for (let i = from; i < Math.min(moves.length, from + 8); i += 1) {
    if (isWhiteMove(i, startFen)) out.push(`${moveNumberOf(i, startFen)}.${moves[i]}`);
    else out.push(i === from ? `${moveNumberLabel(i, startFen)}${moves[i]}` : moves[i]);
  }
  if (!out.length) return '';
  return (from > 0 ? '… ' : '') + out.join(' ') + (moves.length > from + 8 ? ' …' : '');
}
