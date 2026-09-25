import React, { useRef, useState } from 'react';
import { useStore } from '../store';
import ChapterVideo from '../components/ChapterVideo';
import { fmtTime } from '../lib/videoLinks';
import { chapterToPgn, downloadText, safeFilename } from '../lib/pgn';
import {
  isDue, unlearnedCount, isPracticed, dueLabel, levelLabel, intervalLabel, practicedCount, dueCount,
} from '../lib/srs';
import MoveText from '../components/MoveText';
import VariationViewer from '../components/VariationViewer';
import TreeBrowser from '../components/TreeBrowser';
import TagEditor, { TagChips, allTags } from '../components/TagEditor';
import PgnImport from '../components/PgnImport';
import MoreMenu from '../components/MoreMenu';
import { useIsPhone } from '../components/useViewportWidth';
import {
  TagIcon, StarIcon, PencilIcon, ClockIcon, CheckIcon, DownloadIcon, CapIcon, PlayIcon, FolderIcon,
  UploadIcon, CheckboxIcon, VideoIcon, LinkIcon,
} from '../components/Icons';

export default function ChapterView({ openingId, chapterId, onBack, onPractice, onAnalyze }) {
  const { state, dispatch } = useStore();
  const isPhone = useIsPhone();
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
  const [browsing, setBrowsing] = useState(false);
  const viewing = chapter?.variations.find((v) => v.id === viewingId);
  const videoRef = useRef(null);
  const videoBlockRef = useRef(null);
  const showVideo = state.settings.showChapterVideos !== false;

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

      {/* On a phone the chapter's dozen header controls become one Practice
          button, a Learn button and a ⋯ sheet — the wide layout's row of
          eleven buttons wrapped into four lines and pushed the lines
          themselves below the fold. */}
      {isPhone ? (
        <>
          <div className="page-head phone-chapter-head">
            <h1>
              {chapter.starred && <span className="phone-star"><StarIcon size={16} filled /></span>}
              {chapter.name}
            </h1>
          </div>
          <div className="phone-toolbar">
            <button
              type="button"
              className="tap-btn primary grow"
              disabled={chapter.variations.length === 0}
              onClick={() => onPractice({ openingId, chapterId, mode: 'practice' })}
            >
              <PlayIcon size={16} /> Practice chapter
            </button>
            <button
              type="button"
              className="tap-btn"
              disabled={unlearnedCount(chapter) === 0}
              title="Guided learning for the variations you haven't learned yet"
              onClick={() => onPractice({ openingId, chapterId, mode: 'learn' })}
            >
              <CapIcon size={16} /> Learn
            </button>
            <MoreMenu
              title={chapter.name}
              items={[
                {
                  label: chapter.starred ? 'Remove from favorites' : 'Add to favorites',
                  icon: <StarIcon size={16} filled={chapter.starred} />,
                  onClick: () => dispatch({ type: 'toggleChapterStar', openingId, chapterId }),
                },
                {
                  label: 'Rename chapter',
                  icon: <PencilIcon size={16} />,
                  onClick: () => {
                    const name = window.prompt('Chapter name:', chapter.name);
                    if (name?.trim()) dispatch({ type: 'renameChapter', openingId, chapterId, name: name.trim() });
                  },
                },
                {
                  label: 'Section',
                  hint: chapter.section
                    ? `${chapter.section}${chapter.subsection ? ` ▸ ${chapter.subsection}` : ''}`
                    : 'none',
                  icon: <FolderIcon size={16} />,
                  onClick: () => {
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
                      type: 'setChapterSection', openingId, chapterId, section: section.trim(), subsection: subsection.trim() || null,
                    });
                  },
                },
                {
                  label: 'Themes',
                  hint: chapter.tags?.length ? chapter.tags.join(', ') : undefined,
                  icon: <TagIcon size={16} />,
                  onClick: () => setTagging({ kind: 'chapter' }),
                },
                { sep: true },
                { label: 'Add lines (PGN)', icon: <UploadIcon size={16} />, onClick: () => setImporting(true) },
                chapter.variations.length > 0 && {
                  label: picking ? 'Done selecting' : 'Select variations',
                  hint: picking ? undefined : 'tick several and delete them in one go',
                  icon: <CheckboxIcon size={16} />,
                  onClick: () => (picking ? leavePicking() : setPicking(true)),
                },
                chapter.variations.length > 0 && {
                  label: 'Rename all variations',
                  icon: <PencilIcon size={16} />,
                  onClick: openBulk,
                },
                chapter.variations.length > 0 && {
                  label: 'Export chapter (PGN)',
                  icon: <DownloadIcon size={16} />,
                  onClick: () => downloadText(`${safeFilename(chapter.name)}.pgn`, chapterToPgn(opening, chapter)),
                },
                chapter.variations.length > 0 && {
                  label: 'Browse as a tree',
                  hint: 'every line at once, watching them branch',
                  icon: <FolderIcon size={16} />,
                  onClick: () => setBrowsing(true),
                },
                showVideo && !chapter.video && { sep: true },
                showVideo && !chapter.video && {
                  label: 'Add a video file',
                  icon: <VideoIcon size={16} />,
                  onClick: () => videoRef.current?.openAdd('upload'),
                },
                showVideo && !chapter.video && {
                  label: 'Paste a video link',
                  icon: <LinkIcon size={16} />,
                  onClick: () => videoRef.current?.openAdd('url'),
                },
              ]}
            />
          </div>
          {(opening.courses ?? []).length > 0 && (
            <label className="course-picker phone-course">
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
        </>
      ) : (
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
          title={chapter.tags?.length ? `Themes: ${chapter.tags.join(', ')}` : 'Add this chapter to a theme'}
          onClick={() => setTagging({ kind: 'chapter' })}
        >
          <TagIcon size={15} /> Themes
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
      )}

      {/* Nothing renders here at all when the setting is off, or wrapped in a
          ref div only while there's something to scroll to — a chapter with
          no video and the feature enabled still gets the slim "add a video"
          row, since that's the only way to attach the first one, but a
          chapter that will never have one (the setting's off) costs it
          nothing. */}
      {showVideo && (
        <div ref={videoBlockRef}>
          <ChapterVideo
            ref={videoRef}
            video={chapter.video}
            // On a phone the "add a video" row lives in the ⋯ sheet instead
            // of taking a strip of the screen on every chapter without one.
            hideEmpty={isPhone}
            onChange={(video) => dispatch({ type: 'setChapterVideo', openingId, chapterId, video })}
          />
        </div>
      )}

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

      {chapter.variations.length > 0 && (
        <div className="course-options">
          <h4>Course Options</h4>
          <button
            className="co-link"
            title="Walk every line in this chapter as one tree, and watch them branch"
            onClick={() => setBrowsing(true)}
          >
            Browse Tree
          </button>
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
            {isPhone ? (() => {
              // The phone's line: the whole width for its name, its state on
              // the line under, and everything else in ⋯. A row of nine
              // controls beside the name had been squeezing "Jobava London
              // Mainline: 3...e6 with 4...c6" down to one word per line.
              const linked = showVideo && chapter.video && variation.videoTimestamp != null;
              const hasMeta = green || variation.learned || due || variation.srs?.level > 0
                || variation.tags?.length > 0 || linked;
              return (
                <>
                  <div className="row-head phone-line-head">
                    {picking && (
                      <input
                        type="checkbox"
                        className="row-check"
                        title="Select this variation"
                        checked={!!chosen[variation.id]}
                        onChange={() => toggleChosen(variation.id)}
                      />
                    )}
                    <h3>
                      {variation.starred && <span className="phone-star"><StarIcon size={14} filled /></span>}
                      {variation.name}
                    </h3>
                    <MoreMenu
                      title={variation.name}
                      items={[
                        {
                          label: variation.starred ? 'Remove from favorites' : 'Add to favorites',
                          icon: <StarIcon size={16} filled={variation.starred} />,
                          onClick: () => dispatch({ type: 'toggleStar', openingId, chapterId, variationId: variation.id }),
                        },
                        {
                          label: 'Rename',
                          icon: <PencilIcon size={16} />,
                          onClick: () => {
                            const name = window.prompt('Variation name:', variation.name);
                            if (name?.trim()) {
                              dispatch({ type: 'renameVariation', openingId, chapterId, variationId: variation.id, name: name.trim() });
                            }
                          },
                        },
                        {
                          label: 'Themes',
                          hint: variation.tags?.length ? variation.tags.join(', ') : undefined,
                          icon: <TagIcon size={16} />,
                          onClick: () => setTagging({ kind: 'variation', variationId: variation.id }),
                        },
                        showVideo && chapter.video && { sep: true },
                        showVideo && chapter.video && !linked && {
                          label: 'Link to the video here',
                          hint: 'pause the video where this line starts first',
                          icon: <VideoIcon size={16} />,
                          onClick: () => dispatch({
                            type: 'setVariationTimestamp',
                            openingId,
                            chapterId,
                            variationId: variation.id,
                            seconds: videoRef.current?.getCurrentTime?.() ?? 0,
                          }),
                        },
                        linked && {
                          label: 'Unlink from the video',
                          hint: `linked at ${fmtTime(variation.videoTimestamp)}`,
                          icon: <VideoIcon size={16} />,
                          onClick: () => dispatch({
                            type: 'setVariationTimestamp', openingId, chapterId, variationId: variation.id, seconds: null,
                          }),
                        },
                        { sep: true },
                        { label: 'Move up', icon: '▲', onClick: () => dispatch({ type: 'moveVariation', openingId, chapterId, variationId: variation.id, dir: -1 }) },
                        { label: 'Move down', icon: '▼', onClick: () => dispatch({ type: 'moveVariation', openingId, chapterId, variationId: variation.id, dir: 1 }) },
                        { sep: true },
                        {
                          label: 'Delete variation',
                          danger: true,
                          onClick: () => {
                            if (window.confirm(`Delete "${variation.name}"?`)) {
                              dispatch({ type: 'deleteVariation', openingId, chapterId, variationId: variation.id });
                            }
                          },
                        },
                      ]}
                    />
                  </div>
                  {hasMeta && (
                    <div className="phone-line-meta">
                      {green && !due && (
                        <span className="practiced-pill"><CheckIcon size={13} /> practiced</span>
                      )}
                      {variation.learned && !green && !due && <span className="muted-note">learning</span>}
                      {due && <span className="due-pill"><ClockIcon size={14} /> due</span>}
                      {variation.srs?.level > 0 && (
                        <span className="srs-pill">
                          {levelLabel(variation.srs)}
                          {!due && dueLabel(variation) ? ` · ${dueLabel(variation)}` : ''}
                        </span>
                      )}
                      <TagChips tags={variation.tags} max={3} />
                      {linked && (
                        <button
                          type="button"
                          className="small ghost video-link-btn on"
                          title="Watch the video from here"
                          onClick={() => {
                            videoBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            videoRef.current?.seekTo(variation.videoTimestamp);
                          }}
                        >
                          <VideoIcon size={15} />
                          <span className="video-link-time">{fmtTime(variation.videoTimestamp)}</span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              );
            })() : (
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
              {showVideo && chapter.video && (
                <button
                  className={`small ghost video-link-btn${variation.videoTimestamp != null ? ' on' : ''}`}
                  title={variation.videoTimestamp != null
                    ? `Watch the video from ${fmtTime(variation.videoTimestamp)} — click to jump there`
                    : 'Pause the video where the explanation for this line starts, then click here to link it'}
                  onClick={() => {
                    if (variation.videoTimestamp != null) {
                      videoBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      videoRef.current?.seekTo(variation.videoTimestamp);
                      return;
                    }
                    const seconds = videoRef.current?.getCurrentTime?.() ?? 0;
                    dispatch({
                      type: 'setVariationTimestamp', openingId, chapterId, variationId: variation.id, seconds,
                    });
                  }}
                >
                  <VideoIcon size={15} />
                  {variation.videoTimestamp != null && (
                    <span className="video-link-time">{fmtTime(variation.videoTimestamp)}</span>
                  )}
                </button>
              )}
              {showVideo && chapter.video && variation.videoTimestamp != null && (
                <button
                  className="small ghost"
                  title="Unlink this line from the video"
                  onClick={() => dispatch({
                    type: 'setVariationTimestamp', openingId, chapterId, variationId: variation.id, seconds: null,
                  })}
                >
                  ✕
                </button>
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
                  ? `In ${variation.tags.length} theme${variation.tags.length === 1 ? '' : 's'}: ${variation.tags.join(', ')}`
                  : 'Add this line to a theme'}
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
            )}
            <div
              className="variation-moves"
              title="Click to review on the board"
              onClick={() => setViewingId(variation.id)}
            >
              <MoveText
                moves={variation.moves}
                comments={variation.comments}
                badges={variation.badges}
              />
            </div>
            <div className="row-foot">
              <button
                className={`learn-btn${!variation.learned ? ' primary' : ''}`}
                title="The moves are shown first, you copy them, then replay the whole line from memory. Mistakes queue 3 drill runs."
                onClick={() => onPractice({ openingId, chapterId, variationId: variation.id, mode: 'learn' })}
              >
                Learn
                {/* The line's length, worth knowing before you start — once
                    it's learned this isn't the button to look at any more,
                    so a leftover number here read as "still not done". */}
                {!variation.learned && <span className="badge">{variation.moves.length}</span>}
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

      {browsing && (
        <TreeBrowser
          chapter={chapter}
          orientation={opening.color}
          onClose={() => setBrowsing(false)}
          // Landing on a line from the tree opens the same preview a row
          // click does, so there's one way to read a variation, not two.
          onOpenVariation={(id) => { setBrowsing(false); setViewingId(id); }}
          onAnalyze={(moves) => {
            setBrowsing(false);
            onAnalyze({
              name: chapter.name,
              moves,
              subtitle: `${opening.name} — ${chapter.name}`,
            });
          }}
        />
      )}

      {viewing && (
        <VariationViewer
          variation={viewing}
          orientation={opening.color}
          // Walks the chapter in the order the rows are listed in, so ↑/↓ and
          // the pager match what's on the page behind the modal.
          position={(() => {
            const index = chapter.variations.findIndex((v) => v.id === viewing.id);
            return { index, total: chapter.variations.length };
          })()}
          onPrevVariation={() => setViewingId((id) => {
            const i = chapter.variations.findIndex((v) => v.id === id);
            return i > 0 ? chapter.variations[i - 1].id : id;
          })}
          onNextVariation={() => setViewingId((id) => {
            const i = chapter.variations.findIndex((v) => v.id === id);
            return i >= 0 && i < chapter.variations.length - 1 ? chapter.variations[i + 1].id : id;
          })}
          onClose={() => setViewingId(null)}
          onAnalyze={(v) => {
            setViewingId(null);
            onAnalyze({ ...v, subtitle: `${opening.name} — ${chapter.name}` });
          }}
          onToggleStar={() => dispatch({ type: 'toggleStar', openingId, chapterId, variationId: viewing.id })}
          onEditTags={() => setTagging({ kind: 'variation', variationId: viewing.id })}
          onSetBadge={(ply, badge) => dispatch({
            type: 'setMoveBadge',
            openingId,
            chapterId,
            variationId: viewing.id,
            ply,
            badge,
          })}
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
