import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { useBackGuard } from '../lib/backGuard';
import { isHead, makeSub, suggestParent } from '../lib/subVariations';

// "Make it a sub-variation of…" on a Library chapter card: file the whole
// chapter under another chapter, or into a folder that already has
// sub-variations (Classical (Mainline) with its Tartakower and Karpov).
//
// Portaled to <body> so it sits over everything, with its events stopped:
// it's opened from a card whose own click opens the chapter.
export default function FileAsSubVariation({ opening, chapter, onClose }) {
  const { dispatch } = useStore();
  useBackGuard(true, onClose);
  const course = chapter.courseId ?? null;
  const peers = opening.chapters.filter((c) => (c.courseId ?? null) === course);
  const headsFolder = isHead(opening.chapters, chapter);

  // Folders it could go in: any in this course, except the one it heads or
  // is already a sub-variation of.
  const folders = [...new Set(peers.filter((c) => c.section).map((c) => c.section))]
    .filter((s) => !(s === chapter.section && (chapter.subsection || headsFolder)))
    .map((section) => {
      const inside = peers.filter((c) => c.section === section && c.id !== chapter.id);
      return {
        key: `folder:${section}`,
        section,
        label: section,
        detail: [...new Set(inside.map((c) => c.subsection).filter(Boolean))].join(', ')
          || `${inside.length} chapter${inside.length === 1 ? '' : 's'}`,
        lines: inside.flatMap((c) => c.variations),
      };
    });
  // Chapters on their own, which would become the head of a new folder.
  const singles = peers
    .filter((c) => c.id !== chapter.id && !c.section)
    .map((c) => ({
      key: `chapter:${c.id}`,
      parentId: c.id,
      label: c.name,
      detail: `${c.variations.length} line${c.variations.length === 1 ? '' : 's'}`,
      lines: c.variations,
    }));
  const candidates = [...folders, ...singles];
  const suggested = suggestParent(candidates, chapter);
  const ordered = suggested
    ? [candidates.find((c) => c.key === suggested), ...candidates.filter((c) => c.key !== suggested)]
    : candidates;
  const family = headsFolder
    ? peers.filter((c) => c.id !== chapter.id && c.section === chapter.section).map((c) => c.subsection || c.name)
    : [];

  const pick = (cand) => {
    const how = cand.parentId ? { parentId: cand.parentId } : { section: cand.section };
    // Where it will land — worked out the same way the store will, so the
    // folder can be opened and the card shown there, instead of both cards
    // vanishing into a closed folder.
    const landed = makeSub(opening, { chapterId: chapter.id, ...how }).chapters.find((c) => c.id === chapter.id);
    dispatch({ type: 'makeSubVariation', openingId: opening.id, chapterId: chapter.id, ...how });
    const key = landed?.section ? `open:${landed.section}` : null;
    if (key && !opening.collapsedGroups?.[key]) {
      dispatch({ type: 'toggleGroupCollapse', openingId: opening.id, key });
    }
    onClose();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = document.querySelector(`[data-chapter-id="${chapter.id}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.remove('just-visited');
      void card.offsetWidth; // restart the flash
      card.classList.add('just-visited');
      setTimeout(() => card.classList.remove('just-visited'), 1700);
    }));
  };

  const stop = (e) => e.stopPropagation();
  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      onPointerDown={stop}
      onContextMenu={stop}
    >
      <div className="modal file-sub" style={{ maxWidth: 520 }} onClick={stop}>
        <h3 style={{ marginTop: 0 }}>Make “{chapter.name}” a sub-variation of…</h3>
        <p className="hint">
          It goes in that folder in the Library as a sub-variation — the way Tartakower and Karpov sit
          under Classical (Mainline). A chapter on its own becomes the folder, with this one beside it.
          {family.length > 0 && ` Its own sub-variations (${family.join(', ')}) come along.`}
        </p>
        {ordered.length === 0 ? (
          <p className="muted-note">There’s no other chapter{course ? ' in this course' : ''} to file it under yet.</p>
        ) : (
          <ul className="parent-pick">
            {ordered.map((cand) => (
              <li key={cand.key}>
                <button type="button" className={cand.key === suggested ? 'suggested' : ''} onClick={() => pick(cand)}>
                  <strong>
                    {cand.section ? '▸ ' : ''}{cand.label}
                    {cand.key === suggested && <span className="muted-note"> · most likely — shares the most moves</span>}
                  </strong>
                  <span className="pick-moves">{cand.section ? `Folder · ${cand.detail}` : cand.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
