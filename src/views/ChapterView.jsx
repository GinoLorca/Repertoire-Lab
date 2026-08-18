import React, { useState } from 'react';
import { useStore } from '../store';
import { chapterToPgn, downloadText, safeFilename } from '../lib/pgn';
import {
  isDue, unlearnedCount, isPracticed, dueLabel, levelLabel, intervalLabel, practicedCount, dueCount,
} from '../lib/srs';
import MoveText from '../components/MoveText';
import VariationViewer from '../components/VariationViewer';
import TagEditor, { TagChips, allTags } from '../components/TagEditor';
import PgnImport from '../components/PgnImport';
import {
  TagIcon, StarIcon, PencilIcon, ClockIcon, CheckIcon, DownloadIcon, CapIcon, PlayIcon, FolderIcon,
  UploadIcon, CheckboxIcon,
} from '../components/Icons';

export default function ChapterView({ openingId, chapterId, onBack, onPractice, onAnalyze }) {
  const { state, dispatch } = useStore();
  const opening = state.openings.find((o) => o.id === openingId);
  const chapter = opening?.chapters.find((c) => c.id === chapterId);
  const [viewingId, setViewingId] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [tagging, setTagging] = useState(null); // { kind, variationId? }
  const [importing, setImporting] = useState(false);
  // Tick-box mode: off until you ask for it, so an ordinary tap still opens a
  // line rather than selecting it.
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState({}); // { [variationId]: true }
  const [confirmDelete, setConfirmDelete] = useState(false);
  const viewing = chapter?.variations.find((v) => v.id === viewingId);

  const chosenIds = Object.keys(chosen).filter((id) => chosen[id]);
  const toggleChosen = (id) => setChosen((c) => ({ ...c, [id]: !c[id] }));
  const leavePicking = () => { setPicking(false); setChosen({}); };
  const deleteChosen = () => {
    dispatch({
      type: 'deleteVariations', openingId, chapterId, variationIds: chosenIds,
    });
    setConfirmDelete(false);
    leavePicking();
  };

  const openBulk = () => {
    setBulkText((chapter?.variations ?? []).map((v) => v.name).join('\n'));
    setBulkOpen(true);
  };

  const applyBulk = () => {
    const names = bulkText.split(/\r?\n/).map((n) => n.trim());
    chapter.variations.forEach((v, i) => {
      const name = names[i];
      if (name && name !== v.name) {
        dispatch({ type: 'renameVariation', openingId, chapterId, variationId: v.id, name });
      }
    });
    setBulkOpen(false);
  };

  if (!opening || !chapter) {
    return (
      <div className="page">
        <div className="empty-note">Chapter not found. <a onClick={onBack}>Back to library</a></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="breadcrumb">
        <a onClick={onBack}>Chapters</a>
        <span>▸</span>
        <span>{chapter.name}</span>
      </div>

      <div className="page-head">
        <button
          className={`star-btn big${chapter.starred ? ' on' : ''}`}
          title={chapter.starred ? 'Remove chapter from favorites' : 'Favorite this chapter'}
          onClick={() => dispatch({ type: 'toggleChapterStar', openingId, chapterId })}
        >
          <StarIcon size={22} filled={chapter.starred} />
        </button>
        <h1>{chapter.name}</h1>
        <button
          className="small ghost"
          title="Rename chapter"
          onClick={() => {
            const name = window.prompt('Chapter name:', chapter.name);
            if (name?.trim()) {
              dispatch({ type: 'renameChapter', openingId, chapterId, name: name.trim() });
            }
          }}
        >
          <PencilIcon />
        </button>
        <button
          className="small ghost"
          title="Set the section and sub-section this chapter lives under"
          onClick={() => {
            const section = window.prompt('Section (leave empty to ungroup):', chapter.section ?? '');
            if (section === null) return;
            let subsection = chapter.subsection ?? '';
            if (section.trim()) {
              const answer = window.prompt(
                `Sub-section inside "${section.trim()}" (optional — e.g. Tartakower Variation):`,
                subsection,
              );
              if (answer === null) return;
              subsection = answer;
            }
            dispatch({
              type: 'setChapterSection',
              openingId,
              chapterId,
              section: section.trim(),
              subsection: subsection.trim() || null,
            });
          }}
        >
          <FolderIcon size={15} />{chapter.section ? ` ${chapter.section}${chapter.subsection ? ` ▸ ${chapter.subsection}` : ''}` : ''}
        </button>
        {(opening.courses ?? []).length > 0 && (
          <label className="course-picker" title="Which course / author this chapter belongs to">
            <span className="muted-note">Course</span>
            <select
              value={chapter.courseId ?? ''}
              onChange={(e) => dispatch({
                type: 'setChapterCourse', openingId, chapterId, courseId: e.target.value || null,
              })}
            >
              <option value="">— none —</option>
              {(opening.courses ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <button
          className={`tag-btn${chapter.tags?.length ? ' on' : ''}`}
          title={chapter.tags?.length ? `Groups: ${chapter.tags.join(', ')}` : 'Add this chapter to a group'}
          onClick={() => setTagging({ kind: 'chapter' })}
        >
          <TagIcon size={15} /> Tags
        </button>
        <button
          title="Add lines to this chapter from a PGN file or pasted moves"
          onClick={() => setImporting(true)}
        >
          <UploadIcon size={15} /> Add PGN
        </button>
        <button
          disabled={chapter.variations.length === 0}
          className={picking ? 'primary' : ''}
          title="Tick several variations and delete them in one go"
          onClick={() => (picking ? leavePicking() : setPicking(true))}
        >
          <CheckboxIcon size={15} /> {picking ? 'Done selecting' : 'Select'}
        </button>
        <button
          disabled={chapter.variations.length === 0}
          title="Rename every variation at once — paste the titles, one per line, in order"
          onClick={openBulk}
        >
          <PencilIcon size={15} /> Rename all
        </button>
        <button
          onClick={() => downloadText(`${safeFilename(chapter.name)}.pgn`, chapterToPgn(opening, chapter))}
          disabled={chapter.variations.length === 0}
        >
          <DownloadIcon size={15} /> Export chapter (PGN)
        </button>
        <button
          disabled={unlearnedCount(chapter) === 0}
          title="Guided learning for the variations you haven't learned yet"
          onClick={() => onPractice({ openingId, chapterId, mode: 'learn' })}
        >
          <CapIcon size={15} /> Learn chapter
        </button>
        <button
          className="primary"
          disabled={chapter.variations.length === 0}
          onClick={() => onPractice({ openingId, chapterId, mode: 'practice' })}
        >
          <PlayIcon size={15} /> Practice chapter
        </button>
      </div>

      {chapter.variations.length === 0 && (
        <div className="empty-note">
          No variations yet — use <a onClick={() => setImporting(true)}>Add PGN</a> above for a file
          or pasted moves, or the Import tab for screenshots.
        </div>
      )}

      {picking && (
        <div className="select-bar">
          <span><strong>{chosenIds.length}</strong> selected</span>
          <button
            className="small ghost"
            onClick={() => setChosen(Object.fromEntries(chapter.variations.map((v) => [v.id, true])))}
          >
            Select all
          </button>
          <button className="small ghost" onClick={() => setChosen({})}>Clear</button>
          <span style={{ flex: 1 }} />
          <button
            className="danger"
            disabled={chosenIds.length === 0}
            onClick={() => setConfirmDelete(true)}
          >
            Delete {chosenIds.length || ''} variation{chosenIds.length === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {chapter.variations.length > 0 && (
        <div className="chapter-progress">
          <strong>{practicedCount(chapter)}</strong> of {chapter.variations.length} learned &amp; practiced
          {dueCount(chapter) > 0 && (
            <span className="due-pill"><ClockIcon size={13} /> {dueCount(chapter)} due</span>
          )}
        </div>
      )}

      {chapter.variations.map((variation) => {
        const due = isDue(variation);
        const green = isPracticed(variation);
        return (
          <div
            key={variation.id}
            className={`variation-row${green ? ' practiced' : ''}${due ? ' due' : ''}${picking && chosen[variation.id] ? ' chosen' : ''}`}
          >
            <div className="row-head">
              {picking && (
                <input
                  type="checkbox"
                  className="row-check"
                  title="Select this variation"
                  checked={!!chosen[variation.id]}
                  onChange={() => toggleChosen(variation.id)}
                />
              )}
              <button
                className={`star-btn${variation.starred ? ' on' : ''}`}
                title={variation.starred ? 'Remove from favorites' : 'Mark as a favorite'}
                onClick={() => dispatch({ type: 'toggleStar', openingId, chapterId, variationId: variation.id })}
              >
                <StarIcon size={16} filled={variation.starred} />
              </button>
              <h3>{variation.name}</h3>
              <TagChips tags={variation.tags} max={3} />
              {green && !due && (
                <span className="practiced-pill" title="Learned and recalled cleanly at least once">
                  <CheckIcon size={13} /> practiced
                </span>
              )}
              {variation.learned && !green && !due && (
                <span className="muted-note" title="Taught, but not yet recalled without a mistake">learning</span>
              )}
              {due && <span className="due-pill"><ClockIcon size={14} /> due</span>}
              {variation.srs?.level > 0 && (
                <span
                  className="srs-pill"
                  title={`Level ${variation.srs.level} of 8 — reviews ${intervalLabel(variation.srs)} apart`}
                >
                  {levelLabel(variation.srs)}
                  {!due && dueLabel(variation) ? ` · ${dueLabel(variation)}` : ''}
                </span>
              )}
              <span className="reorder">
                <button
                  className="small ghost"
                  title="Move variation up"
                  onClick={() => dispatch({ type: 'moveVariation', openingId, chapterId, variationId: variation.id, dir: -1 })}
                >
                  ▲
                </button>
                <button
                  className="small ghost"
                  title="Move variation down"
                  onClick={() => dispatch({ type: 'moveVariation', openingId, chapterId, variationId: variation.id, dir: 1 })}
                >
                  ▼
                </button>
              </span>
              <button
                className={`small ghost tag-btn${variation.tags?.length ? ' on' : ''}`}
                title={variation.tags?.length
                  ? `In ${variation.tags.length} group${variation.tags.length === 1 ? '' : 's'}: ${variation.tags.join(', ')}`
                  : 'Add this line to a group'}
                onClick={() => setTagging({ kind: 'variation', variationId: variation.id })}
              >
                <TagIcon size={15} />
              </button>
              <button
                className="small ghost"
                title="Rename"
                onClick={() => {
                  const name = window.prompt('Variation name:', variation.name);
                  if (name?.trim()) {
                    dispatch({ type: 'renameVariation', openingId, chapterId, variationId: variation.id, name: name.trim() });
                  }
                }}
              >
                <PencilIcon size={15} />
              </button>
              <button
                className="small ghost danger"
                title="Delete variation"
                onClick={() => {
                  if (window.confirm(`Delete "${variation.name}"?`)) {
                    dispatch({ type: 'deleteVariation', openingId, chapterId, variationId: variation.id });
                  }
                }}
              >
                ✕
              </button>
            </div>
            <div
              className="variation-moves"
              title="Click to review on the board"
              onClick={() => setViewingId(variation.id)}
            >
              <MoveText moves={variation.moves} comments={variation.comments} />
            </div>
            <div className="row-foot">
              <button
                className={`learn-btn${!variation.learned ? ' primary' : ''}`}
                title="The moves are shown first, you copy them, then replay the whole line from memory. Mistakes queue 3 drill runs."
                onClick={() => onPractice({ openingId, chapterId, variationId: variation.id, mode: 'learn' })}
              >
                Learn
                <span className="badge">{variation.moves.length}</span>
              </button>
              <button
                className={`learn-btn${variation.learned ? ' primary' : ''}`}
                title="Recall the line with no previews"
                onClick={() => onPractice({ openingId, chapterId, variationId: variation.id, mode: 'practice' })}
              >
                Practice
                {due && <span className="badge due"><ClockIcon size={12} /></span>}
              </button>
            </div>
          </div>
        );
      })}

      {bulkOpen && (
        <div className="modal-overlay" onClick={() => setBulkOpen(false)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <h3>Rename all variations</h3>
            <p className="hint">
              One name per line, in the same order as the list below — line 1 renames the first
              variation, line 2 the second, and so on. Blank lines leave that variation unchanged.
            </p>
            <div className="bulk-grid">
              <textarea
                rows={Math.min(16, Math.max(6, chapter.variations.length))}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
              />
              <ol className="bulk-preview">
                {chapter.variations.map((v, i) => {
                  const next = bulkText.split(/\r?\n/)[i]?.trim();
                  return (
                    <li key={v.id} className={next && next !== v.name ? 'changed' : ''}>
                      {next || v.name}
                      <span className="bulk-moves">{v.moves.slice(0, 6).join(' ')}…</span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="modal-actions">
              <button onClick={() => setBulkOpen(false)}>Cancel</button>
              <button className="primary" onClick={applyBulk}>Apply names</button>
            </div>
          </div>
        </div>
      )}

      {importing && (
        <PgnImport
          chapterName={chapter.name}
          onClose={() => setImporting(false)}
          onAdd={(variations) => dispatch({
            type: 'addVariations', openingId, chapterId, variations,
          })}
        />
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3>Delete {chosenIds.length} variation{chosenIds.length === 1 ? '' : 's'}?</h3>
            <p className="hint">
              This removes them from “{chapter.name}”, along with what you've learned about them.
              It can't be undone — a backup file is the only way back.
            </p>
            <ul className="confirm-list">
              {chosenIds.slice(0, 8).map((id) => (
                <li key={id}>{chapter.variations.find((v) => v.id === id)?.name}</li>
              ))}
              {chosenIds.length > 8 && <li className="muted-note">…and {chosenIds.length - 8} more</li>}
            </ul>
            <div className="modal-actions">
              <button onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="danger" onClick={deleteChosen}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <VariationViewer
          variation={viewing}
          orientation={opening.color}
          onClose={() => setViewingId(null)}
          onAnalyze={(v) => {
            setViewingId(null);
            onAnalyze({ ...v, subtitle: `${opening.name} — ${chapter.name}` });
          }}
          onToggleStar={() => dispatch({ type: 'toggleStar', openingId, chapterId, variationId: viewing.id })}
          onEditTags={() => setTagging({ kind: 'variation', variationId: viewing.id })}
          onSaveComment={(moveIndex, text) => dispatch({
            type: 'setMoveComment',
            openingId,
            chapterId,
            variationId: viewing.id,
            moveIndex,
            text,
          })}
        />
      )}
      {tagging && (() => {
        const target = tagging.kind === 'chapter'
          ? chapter
          : chapter.variations.find((v) => v.id === tagging.variationId);
        if (!target) return null;
        return (
          <TagEditor
            title={target.name}
            tags={target.tags}
            suggestions={allTags(state)}
            onClose={() => setTagging(null)}
            onChange={(tags) => dispatch(tagging.kind === 'chapter'
              ? { type: 'setChapterTags', openingId, chapterId, tags }
              : { type: 'setVariationTags', openingId, chapterId, variationId: tagging.variationId, tags })}
          />
        );
      })()}


    </div>
  );
}
