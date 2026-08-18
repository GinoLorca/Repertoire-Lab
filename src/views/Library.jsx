import React, { useEffect, useRef, useState } from 'react';
import { useStore, emptyState, uid } from '../store';
import { chapterToPgn, openingToPgn, downloadText, safeFilename } from '../lib/pgn';
import {
  dueCount, learnedCount, practicedCount, chapterPracticed, openingPracticed,
} from '../lib/srs';
import { processArtwork } from '../lib/artwork';
import { useBackGuard } from '../lib/backGuard';
import TagEditor, { TagChips, allTags } from '../components/TagEditor';
import PgnImport from '../components/PgnImport';
import {
  ImageIcon, TagIcon, StarIcon, PencilIcon, ClockIcon, CheckIcon, DownloadIcon, UploadIcon, PlayIcon,
  FolderIcon,
} from '../components/Icons';

function openingTotals(opening) {
  return opening.chapters.reduce(
    (acc, c) => ({
      variations: acc.variations + c.variations.length,
      learned: acc.learned + learnedCount(c),
      practiced: acc.practiced + practicedCount(c),
      due: acc.due + dueCount(c),
    }),
    { variations: 0, learned: 0, practiced: 0, due: 0 },
  );
}

// Chapters grouped into Section ▸ Sub-section, in the order they appear.
// [{ section, subs: [{ subsection, chapters, key }] }]
function groupChapters(chapters) {
  const sections = [];
  const sectionIndex = new Map();
  for (const chapter of chapters) {
    const section = chapter.section || '';
    const subsection = chapter.subsection || '';
    if (!sectionIndex.has(section)) {
      sectionIndex.set(section, sections.length);
      sections.push({ section, subs: [], subIndex: new Map() });
    }
    const group = sections[sectionIndex.get(section)];
    if (!group.subIndex.has(subsection)) {
      group.subIndex.set(subsection, group.subs.length);
      group.subs.push({ subsection, chapters: [], key: `${section}|${subsection}` });
    }
    group.subs[group.subIndex.get(subsection)].chapters.push(chapter);
  }
  return sections;
}

// Compact ▲▼ pair used for every reorderable row.
function Reorder({ onUp, onDown, label }) {
  return (
    <span className="reorder" onClick={(e) => e.stopPropagation()}>
      <button className="small ghost" title={`Move ${label} up`} onClick={onUp}>▲</button>
      <button className="small ghost" title={`Move ${label} down`} onClick={onDown}>▼</button>
    </span>
  );
}

// "… (Bortnyk and Naroditsky)" -> "Bortnyk and Naroditsky"
const AUTHOR_SUFFIX = /\s*\(([^()]{3,60})\)\s*$/;

function detectAuthors(opening) {
  const found = new Map();
  for (const chapter of opening.chapters) {
    if (chapter.courseId) continue;
    const m = chapter.name.match(AUTHOR_SUFFIX);
    if (!m) continue;
    const author = m[1].trim();
    if (!found.has(author)) found.set(author, []);
    found.get(author).push(chapter);
  }
  // A single chapter by one author isn't worth a shelf of its own.
  return [...found.entries()].filter(([, chapters]) => chapters.length >= 1);
}

function tallyChapters(chapters) {
  return chapters.reduce(
    (acc, c) => ({
      chapters: acc.chapters + 1,
      variations: acc.variations + c.variations.length,
      learned: acc.learned + learnedCount(c),
      practiced: acc.practiced + practicedCount(c),
      due: acc.due + dueCount(c),
    }),
    { chapters: 0, variations: 0, learned: 0, practiced: 0, due: 0 },
  );
}

// A section / sub-section shown as a box in the same grid as chapter cards.
// Clicking it opens the group to reveal what's inside.
function FolderCard({ title, chapters, chips, open, onToggle, actions, practiceLabel, onPractice }) {
  const t = tallyChapters(chapters);
  const pct = t.variations ? Math.round((t.practiced / t.variations) * 100) : 0;
  const green = chapters.length > 0 && chapters.every(chapterPracticed);
  return (
    <div
      className={`chapter-card folder-card${open ? ' open' : ''}${green ? ' practiced' : ''}`}
      onClick={onToggle}
    >
      <h3>
        <span className="folder-caret">{open ? '▾' : '▸'}</span>
        {title}
      </h3>
      {chips?.length > 0 && (
        <div className="folder-chips">
          {chips.map((c) => <span key={c} className="sub-chip">{c}</span>)}
        </div>
      )}
      <div className="chapter-meta">
        <span className="counts">
          {green && <CheckIcon size={14} className="done-tick" />}
          <strong>{t.practiced}/{t.variations}</strong> practiced
        </span>
        <span style={{ flex: 1 }} />
        {t.due > 0 && <span className="due-pill"><ClockIcon size={14} /> {t.due}</span>}
      </div>
      <div className="progress-track">
        <div className={`progress-fill${green ? ' done' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <span className="folder-count">
          {t.chapters} chapter{t.chapters === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="small ghost"
          title={practiceLabel}
          disabled={t.variations === 0}
          onClick={onPractice}
        >
          <PlayIcon size={14} />
        </button>
        {actions}
      </div>
    </div>
  );
}

function Modal({ title, hint, defaultValue = '', placeholder, onSubmit, onClose }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {hint && <p className="hint">{hint}</p>}
        <input
          type="text"
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onSubmit(value.trim()); }}
        />
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!value.trim()} onClick={() => onSubmit(value.trim())}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function AddChapterModal({ opening, onSubmit, onClose }) {
  const [name, setName] = useState('');
  const [section, setSection] = useState('');
  const [subsection, setSubsection] = useState('');
  const sections = [...new Set(opening.chapters.map((c) => c.section).filter(Boolean))];
  const subsections = [...new Set(
    opening.chapters.filter((c) => !section || c.section === section)
      .map((c) => c.subsection).filter(Boolean),
  )];
  const submit = (thenImport = false) =>
    onSubmit(name.trim(), section.trim() || null, subsection.trim() || null, thenImport);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New chapter in {opening.name}</h3>
        <p className="hint">e.g. "1a) Advance: main line". Group related chapters with an optional section, e.g. "Advance Variation".</p>
        <input
          type="text"
          autoFocus
          value={name}
          placeholder="Chapter name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) submit(); }}
        />
        <input
          type="text"
          list="section-suggestions"
          value={section}
          placeholder="Section (optional) — e.g. Advance Variation"
          onChange={(e) => setSection(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) submit(); }}
        />
        <datalist id="section-suggestions">
          {sections.map((s) => <option key={s} value={s} />)}
        </datalist>
        <input
          type="text"
          list="subsection-suggestions"
          value={subsection}
          placeholder="Sub-section (optional) — e.g. Tartakower Variation"
          disabled={!section.trim()}
          onChange={(e) => setSubsection(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) submit(); }}
        />
        <datalist id="subsection-suggestions">
          {subsections.map((s) => <option key={s} value={s} />)}
        </datalist>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button disabled={!name.trim()} onClick={() => submit(false)}>Save</button>
          <button className="primary" disabled={!name.trim()} onClick={() => submit(true)}>
            <UploadIcon size={15} /> Save &amp; add PGN
          </button>
        </div>
      </div>
    </div>
  );
}

// Pick which authors become courses, and whether to trim their names off the
// chapter titles.
function GroupByAuthorModal({ opening, authors, onApply, onClose }) {
  const [picked, setPicked] = useState(() => Object.fromEntries(authors.map(([name]) => [name, true])));
  const [shorten, setShorten] = useState(true);
  const chosen = authors.filter(([name]) => picked[name]);
  const example = chosen[0]?.[1]?.[0]?.name ?? '';
  const shortened = example.replace(AUTHOR_SUFFIX, '').trim();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3>Group {opening.name} by author</h3>
        <p className="hint">
          These authors were found in the chapter names. Each becomes its own course inside the
          opening, with the chapters filed underneath.
        </p>
        {authors.length === 0 && (
          <div className="empty-note">
            No authors in brackets found — add courses by hand with “+ Add course / author”.
          </div>
        )}
        {authors.map(([name, chapters]) => (
          <label key={name} className="author-row">
            <input
              type="checkbox"
              checked={!!picked[name]}
              onChange={(e) => setPicked((p) => ({ ...p, [name]: e.target.checked }))}
            />
            <span className="author-name">{name}</span>
            <span className="muted-note">{chapters.length} chapter{chapters.length === 1 ? '' : 's'}</span>
          </label>
        ))}
        {chosen.length > 0 && (
          <label className="author-row">
            <input type="checkbox" checked={shorten} onChange={(e) => setShorten(e.target.checked)} />
            <span className="author-name">Shorten the chapter names</span>
          </label>
        )}
        {chosen.length > 0 && shorten && example && (
          <div className="cmp-paste-preview" style={{ fontSize: 13 }}>
            <span className="muted-note">{example}</span>
            <br />
            <strong>{shortened}</strong>
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={chosen.length === 0} onClick={() => onApply(chosen, shorten)}>
            Create {chosen.length} course{chosen.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChapterCard({
  opening, chapter, onOpen, onDelete, onMove, onToggleStar, onPractice, groupLabel,
}) {
  const { dispatch } = useStore();
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const total = chapter.variations.length;
  const learned = learnedCount(chapter);
  const practiced = practicedCount(chapter);
  const due = dueCount(chapter);
  const green = chapterPracticed(chapter);
  const pctDone = total ? Math.round((practiced / total) * 100) : 0;

  return (
    <div
      className={`chapter-card${green ? ' practiced' : ''}`}
      data-chapter-id={chapter.id}
      onClick={onOpen}
      title={green ? 'Every line here is learned and practiced' : undefined}
    >
      {groupLabel && <span className="card-group-label">{groupLabel}</span>}
      <div className="card-title-row">
        <button
          className={`star-btn${chapter.starred ? ' on' : ''}`}
          title={chapter.starred ? 'Remove chapter from favorites' : 'Favorite this chapter'}
          onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
        >
          <StarIcon size={16} filled={chapter.starred} />
        </button>
        <h3>{chapter.name}</h3>
      </div>
      <TagChips tags={chapter.tags} max={3} />
      <div className="chapter-meta">
        <span className="counts">
          {green && <CheckIcon size={14} className="done-tick" />}
          <strong>{practiced}/{total}</strong> practiced
          {learned > practiced && <span className="muted-note"> · {learned - practiced} learning</span>}
        </span>
        <span style={{ flex: 1 }} />
        {due > 0 && <span className="due-pill"><ClockIcon size={14} /> {due}</span>}
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill${green ? ' done' : ''}`}
          style={{ width: `${pctDone}%` }}
        />
      </div>
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className={`small${due > 0 ? ' primary' : ' ghost'}`}
          title={due > 0
            ? `Practice this chapter — ${due} line${due === 1 ? '' : 's'} due for review`
            : 'Practice this chapter'}
          disabled={total === 0}
          onClick={onPractice}
        >
          <PlayIcon size={14} /> Practice{due > 0 ? ` (${due})` : ''}
        </button>
        <button
          className="small ghost"
          title="Add lines to this chapter from a PGN file or pasted moves"
          onClick={() => setImporting(true)}
        >
          <UploadIcon size={14} /> Add
        </button>
        <button
          className="small ghost"
          title="Export this chapter as PGN"
          onClick={() => downloadText(`${safeFilename(chapter.name)}.pgn`, chapterToPgn(opening, chapter))}
        >
          <DownloadIcon size={14} /> PGN
        </button>
        {onMove && <Reorder label="chapter" onUp={() => onMove(-1)} onDown={() => onMove(1)} />}
        <span style={{ flex: 1 }} />
        <button className="small ghost danger" title="Delete chapter" onClick={() => setConfirming(true)}>
          ✕
        </button>

        {importing && (
          <PgnImport
            chapterName={chapter.name}
            onClose={() => setImporting(false)}
            onAdd={(variations) => dispatch({
              type: 'addVariations', openingId: opening.id, chapterId: chapter.id, variations,
            })}
          />
        )}
        {confirming && (
          <div className="modal-overlay" onClick={() => setConfirming(false)}>
            <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
              <h3>Delete “{chapter.name}”?</h3>
              <p className="hint">
                Its {chapter.variations.length} variation{chapter.variations.length === 1 ? '' : 's'} go
                with it, along with what you've learned about them. Only a backup can bring them back.
              </p>
              <div className="modal-actions">
                <button onClick={() => setConfirming(false)}>Cancel</button>
                <button className="danger" onClick={() => { setConfirming(false); onDelete(); }}>Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Library({ onOpenChapter, onPractice, revealChapterId, initialScope }) {
  // Practicing a section/sub-section = every chapter inside it.
  const onPracticeGroup = (openingId, chapters) =>
    onPractice({ openingId, chapterIds: chapters.map((c) => c.id), mode: 'practice' });
  const { state, dispatch } = useStore();

  // 'me' or a student's player id — which slice of state.openings is on
  // screen. Whichever is active when you add an opening is who it's for.
  const [scope, setScope] = useState('me');
  useEffect(() => { if (initialScope) setScope(initialScope); }, [initialScope]);
  const students = state.players.filter((p) => p.kind === 'student');
  const openings = state.openings.filter((o) => (o.ownerId ?? null) === (scope === 'me' ? null : scope));
  const scopedStudent = scope !== 'me' ? students.find((p) => p.id === scope) : null;

  // Coming back from a chapter: make sure it's actually on screen — expand its
  // opening and the section it sits in, so Back never lands on a closed shelf.
  useEffect(() => {
    if (!revealChapterId) return;
    for (const opening of state.openings) {
      const chapter = opening.chapters.find((c) => c.id === revealChapterId);
      if (!chapter) continue;
      // The chapter might belong to a student's shelf, not yours.
      setScope((opening.ownerId ?? null) === null ? 'me' : opening.ownerId);
      if (opening.collapsed) {
        dispatch({ type: 'toggleOpeningCollapse', openingId: opening.id });
      }
      const groups = opening.collapsedGroups ?? {};
      const keys = [];
      if (chapter.section) keys.push(`open:${chapter.section}`);
      if (chapter.section && chapter.subsection) {
        keys.push(`open:${chapter.section}|${chapter.subsection}`);
      }
      for (const key of keys) {
        if (!groups[key]) dispatch({ type: 'toggleGroupCollapse', openingId: opening.id, key });
      }
      break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealChapterId]);

  const [modal, setModal] = useState(null);
  useBackGuard(!!modal, () => setModal(null));

  const artInputRef = useRef(null);
  const artTargetRef = useRef(null);
  const restoreRef = useRef(null);

  // Scoped to whichever tab is open — exporting a student's repertoire
  // shouldn't silently bundle in your own.
  const exportAll = () => {
    const pgn = openings.map(openingToPgn).join('\n');
    const stamp = scopedStudent ? safeFilename(scopedStudent.name) : 'all';
    downloadText(`repertoire-${stamp}.pgn`, pgn);
  };

  // Everything: openings with progress and artwork, player profiles and their
  // games, your categories and settings.
  const backup = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const payload = {
      app: 'repertoire-lab',
      version: 2,
      savedAt: new Date().toISOString(),
      openings: state.openings,
      players: state.players ?? [],
      categories: state.categories ?? [],
      settings: state.settings,
    };
    downloadText(`repertoire-lab-backup-${stamp}.json`, JSON.stringify(payload));
  };

  const summarise = (parsed) => {
    const variations = (parsed.openings ?? []).reduce(
      (a, o) => a + o.chapters.reduce((b, c) => b + c.variations.length, 0), 0,
    );
    const players = parsed.players ?? [];
    const games = players.reduce((a, p) => a + (p.games?.length ?? 0), 0);
    return { variations, players: players.length, games };
  };

  const onRestoreFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.openings) || typeof parsed.settings !== 'object') {
        throw new Error('That file is not a Repertoire Lab backup.');
      }
      const n = summarise(parsed);
      setModal({ kind: 'restore', parsed, summary: n });
    } catch (err) {
      window.alert(err.message || 'Could not read that backup file.');
    }
  };

  const pickArtwork = (openingId) => {
    artTargetRef.current = openingId;
    artInputRef.current?.click();
  };

  const applyArtwork = async (file, openingId) => {
    if (!file || !openingId) return;
    try {
      const artwork = await processArtwork(file);
      dispatch({ type: 'setOpeningArtwork', openingId, artwork });
    } catch (err) {
      window.alert(err.message);
    }
  };

  const onArtworkFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    const target = artTargetRef.current;
    if (target && typeof target === 'object' && target.courseId) await applyCourseArtwork(file, target);
    else await applyArtwork(file, target);
  };

  const pickCourseArtwork = (openingId, courseId) => {
    artTargetRef.current = { openingId, courseId };
    artInputRef.current?.click();
  };

  const applyCourseArtwork = async (file, target) => {
    if (!file || !target?.courseId) return;
    try {
      const artwork = await processArtwork(file);
      dispatch({
        type: 'setCourseArtwork', openingId: target.openingId, courseId: target.courseId, artwork,
      });
    } catch (err) {
      window.alert(err.message);
    }
  };

  const dropCourseArtwork = (e, openingId, courseId) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) applyCourseArtwork(file, { openingId, courseId });
  };

  // One press: a course per author, chapters filed into it, and the author's
  // name dropped from each chapter title since the course bar now carries it.
  // Courses from the author in brackets. Driven by a real panel rather than
  // window.confirm — Safari suppresses repeat native dialogs, which made the
  // button look dead.
  const applyGrouping = (openingId, authors, shorten) => {
    for (const [name, chapters] of authors) {
      const courseId = uid();
      dispatch({ type: 'addCourse', openingId, id: courseId, name });
      for (const chapter of chapters) {
        dispatch({ type: 'setChapterCourse', openingId, chapterId: chapter.id, courseId });
        if (shorten) {
          const short = chapter.name.replace(AUTHOR_SUFFIX, '').trim();
          if (short && short !== chapter.name) {
            dispatch({ type: 'renameChapter', openingId, chapterId: chapter.id, name: short });
          }
        }
      }
    }
  };

  const dropArtwork = (e, openingId) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) applyArtwork(file, openingId);
  };

  return (
    <div className="page">
      <input
        ref={artInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif"
        hidden
        onChange={onArtworkFile}
      />

      <div className="page-head">
        <h1>{scopedStudent ? `${scopedStudent.name}'s Repertoire` : 'My Repertoire'}</h1>
        <button
          className="ghost"
          title="Download everything — openings, progress, artwork, player profiles, games and settings — as one file"
          onClick={backup}
        >
          <DownloadIcon size={15} /> Backup
        </button>
        <button
          className="ghost"
          title="Load a backup file: openings, players and games all come back"
          onClick={() => restoreRef.current?.click()}
        >
          <UploadIcon size={15} /> Restore
        </button>
        <input ref={restoreRef} type="file" accept="application/json,.json" hidden onChange={onRestoreFile} />
        <button
          className="ghost danger"
          title="Erase everything on this device and start fresh"
          onClick={() => {
            if (window.confirm(
              'Erase ALL openings, games and progress on this device?\n\n'
              + 'This cannot be undone — take a Backup first if you might want it back.',
            )) {
              dispatch({ type: 'hydrate', state: { ...emptyState(), settings: state.settings } });
            }
          }}
        >
          Reset
        </button>
        <button onClick={() => setModal({ kind: 'addOpening' })}>
          + Add Opening{scopedStudent ? ` for ${scopedStudent.name}` : ''}
        </button>
        <button
          className="primary"
          disabled={openings.every((o) => o.chapters.length === 0)}
          onClick={exportAll}
        >
          <DownloadIcon size={15} /> Export All (PGN)
        </button>
      </div>

      <div className="tabs">
        <button className={scope === 'me' ? 'active' : ''} onClick={() => setScope('me')}>
          My repertoire
        </button>
        {students.length > 0 && (
          <select
            className={scope !== 'me' ? 'active' : ''}
            value={scope === 'me' ? '' : scope}
            title="A student's repertoire — built here, it's what shows when you analyze their games"
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="" disabled>Student…</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      {students.length === 0 && scope === 'me' && (
        <p className="hint" style={{ marginTop: -12 }}>
          Add a student from the <strong>Coaches</strong> tab to build a repertoire just for them here.
        </p>
      )}

      {openings.length === 0 && scope === 'me' && (
        <div className="empty-note">
          <img
            src="/icons/icon-192.png"
            alt=""
            width="72"
            height="72"
            style={{ borderRadius: 16, marginBottom: 12 }}
          />
          <p style={{ fontSize: 17, color: 'var(--text)', marginBottom: 6 }}>Welcome to Repertoire Lab</p>
          <p style={{ margin: 0 }}>
            Add an opening (Jobava London, Caro-Kann, Slav…), then fill it from the <strong>Import</strong> tab —
            course screenshots, pasted moves, or a PGN file.
          </p>
        </div>
      )}

      {openings.length === 0 && scopedStudent && (
        <div className="empty-note">
          <p style={{ margin: 0 }}>
            Nothing here yet for {scopedStudent.name}. Press <strong>+ Add Opening</strong> above to
            start building what you've taught them — it'll come up automatically when you analyze
            their games.
          </p>
        </div>
      )}

      {openings.map((opening) => {
        const totals = openingTotals(opening);
        const pctLearned = totals.variations
          ? Math.round((totals.practiced / totals.variations) * 100)
          : 0;
        const openingGreen = openingPracticed(opening);
        const toggle = () => dispatch({ type: 'toggleOpeningCollapse', openingId: opening.id });
        return (
          <section key={opening.id} className="opening-section">
            <div className={`opening-row${openingGreen ? ' practiced' : ''}`}>
              {/* Dropping an image file straight onto the tile is the quickest
                  way to set artwork; the picture button in the header is the other. */}
              {opening.artwork ? (
                <img
                  className="opening-art"
                  src={opening.artwork.medium}
                  alt=""
                  title={`${opening.collapsed ? 'Open' : 'Close'} ${opening.name} · drop an image here to replace the artwork`}
                  onClick={toggle}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => dropArtwork(e, opening.id)}
                />
              ) : (
                <button
                  className="art-add-tile"
                  title="Add artwork — click to choose, or drop an image here (square JPG/PNG/GIF, at least 650×650, up to 3 MB)"
                  onClick={() => pickArtwork(opening.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => dropArtwork(e, opening.id)}
                >
                  <ImageIcon size={26} />
                  <span>Add artwork</span>
                </button>
              )}
              <div className="opening-info">
                <div className="opening-head">
                  <button className="collapse-btn" title={opening.collapsed ? 'Expand' : 'Collapse'} onClick={toggle}>
                    {opening.collapsed ? '▸' : '▾'}
                  </button>
                  <button
                    className={`star-btn${opening.starred ? ' on' : ''}`}
                    title={opening.starred ? 'Remove opening from favorites' : 'Favorite this whole opening'}
                    onClick={() => dispatch({ type: 'toggleOpeningStar', openingId: opening.id })}
                  >
                    <StarIcon size={17} filled={opening.starred} />
                  </button>
                  <h2 onClick={toggle} style={{ cursor: 'pointer' }}>{opening.name}</h2>
                  <Reorder
                    label="opening"
                    onUp={() => dispatch({ type: 'moveOpening', openingId: opening.id, dir: -1 })}
                    onDown={() => dispatch({ type: 'moveOpening', openingId: opening.id, dir: 1 })}
                  />
                  <button
                    className="small ghost"
                    title="Rename opening"
                    onClick={() => setModal({ kind: 'renameOpening', openingId: opening.id, name: opening.name })}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    className={`small ghost tag-btn${opening.tags?.length ? ' on' : ''}`}
                    title={opening.tags?.length
                      ? `Groups: ${opening.tags.join(', ')} — chapters and variations inside inherit them`
                      : 'Add this opening to a group'}
                    onClick={() => setModal({ kind: 'tagOpening', openingId: opening.id })}
                  >
                    <TagIcon />
                  </button>
                  <button
                    className="small ghost"
                    title={opening.artwork ? 'Artwork — view, replace or remove' : 'Add artwork for this opening'}
                    onClick={() => (opening.artwork
                      ? setModal({ kind: 'artwork', openingId: opening.id })
                      : pickArtwork(opening.id))}
                  >
                    <ImageIcon />
                  </button>
                  <span
                    className={`color-badge ${opening.color}`}
                    title="Which side you play in this opening (click to flip)"
                    onClick={() => dispatch({
                      type: 'setOpeningColor',
                      openingId: opening.id,
                      color: opening.color === 'white' ? 'black' : 'white',
                    })}
                  >
                    {opening.color === 'white' ? 'WHITE' : 'BLACK'}
                  </span>
                  {(() => {
                    const authors = detectAuthors(opening);
                    if (authors.length === 0) return null;
                    return (
                      <button
                        className="small ghost"
                        title={`Put these chapters into courses by author: ${authors.map(([a]) => a).join(', ')}`}
                        onClick={() => setModal({ kind: 'groupByAuthor', openingId: opening.id })}
                      >
                        <FolderIcon size={15} /> Group by author ({authors.length})
                      </button>
                    );
                  })()}
                  <span className="spacer" />
                  <button
                    className="small"
                    title="Add a chapter to this opening"
                    onClick={() => setModal({ kind: 'addChapter', openingId: opening.id, courseId: null })}
                  >
                    + Chapter
                  </button>
                  <button
                    className="small ghost"
                    disabled={opening.chapters.length === 0}
                    onClick={() => downloadText(`${safeFilename(opening.name)}.pgn`, openingToPgn(opening))}
                  >
                    <DownloadIcon size={15} /> Export opening
                  </button>
                  <button
                    className="small ghost danger"
                    onClick={() => {
                      if (window.confirm(`Delete "${opening.name}" and all its chapters?`)) {
                        dispatch({ type: 'deleteOpening', openingId: opening.id });
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
                <div className="opening-stats">
                  <span>
                    <strong>{totals.practiced}/{totals.variations}</strong> practiced
                  </span>
                  <div className="progress-track opening-progress">
                    <div
                      className={`progress-fill${openingGreen ? ' done' : ''}`}
                      style={{ width: `${pctLearned}%` }}
                    />
                  </div>
                  <span>{opening.chapters.length} chapter{opening.chapters.length === 1 ? '' : 's'}</span>
                  {totals.due > 0 && <span className="due-pill"><ClockIcon size={14} /> {totals.due} due</span>}
                  <TagChips tags={opening.tags} max={4} />
                </div>
              </div>
            </div>

            {!opening.collapsed && (() => {
              const courses = opening.courses ?? [];
              const chaptersIn = (courseId) => opening.chapters
                .filter((c) => (c.courseId ?? null) === (courseId ?? null));

              const renderGrid = (chapterList, courseId) => (() => {
              const groups = groupChapters(chapterList);
              const openGroups = opening.collapsedGroups ?? {};
              const ungrouped = groups.find((g) => g.section === '');
              const sections = groups.filter((g) => g.section !== '');
              const sectionNames = sections.map((g) => g.section);

              const chapterCard = (chapter) => (
                <ChapterCard
                  key={chapter.id}
                  opening={opening}
                  chapter={chapter}
                  onOpen={() => onOpenChapter(opening.id, chapter.id)}
                  onDelete={() => dispatch({ type: 'deleteChapter', openingId: opening.id, chapterId: chapter.id })}
                  onMove={(dir) => dispatch({ type: 'moveChapter', openingId: opening.id, chapterId: chapter.id, dir })}
                  onToggleStar={() => dispatch({ type: 'toggleChapterStar', openingId: opening.id, chapterId: chapter.id })}
                  onPractice={() => onPractice({ openingId: opening.id, chapterId: chapter.id, mode: 'practice' })}
                />
              );

              return (
                <div className="chapter-grid">
                  {sections.map(({ section, subs }) => {
                    const chapters = subs.flatMap((s) => s.chapters);
                    const isOpen = !!openGroups[`open:${section}`];
                    const others = sectionNames.filter((s) => s !== section);
                    const hasSubs = subs.some((s) => s.subsection);
                    return (
                      <React.Fragment key={section}>
                        <FolderCard
                          title={section}
                          chapters={chapters}
                          chips={subs.map((s) => s.subsection).filter(Boolean)}
                          open={isOpen}
                          onToggle={() => dispatch({ type: 'toggleGroupCollapse', openingId: opening.id, key: `open:${section}` })}
                          practiceLabel={`Practice everything in ${section}`}
                          onPractice={() => onPracticeGroup(opening.id, chapters)}
                          actions={(
                            <>
                              <button
                                className="small ghost"
                                title="Rename section"
                                onClick={() => {
                                  const to = window.prompt('Section name (leave empty to ungroup):', section);
                                  if (to !== null) {
                                    dispatch({ type: 'renameSection', openingId: opening.id, from: section, to: to.trim() });
                                  }
                                }}
                              >
                                <PencilIcon size={15} />
                              </button>
                              {others.length > 0 && (
                                <button
                                  className="small ghost"
                                  title="Nest this section inside another"
                                  onClick={() => {
                                    const under = window.prompt(
                                      `Nest "${section}" inside which section?\n\nExisting: ${others.join(', ')}`,
                                      others[0],
                                    );
                                    if (under?.trim()) {
                                      dispatch({ type: 'nestSection', openingId: opening.id, from: section, under: under.trim() });
                                    }
                                  }}
                                >
                                  ⤵
                                </button>
                              )}
                              <Reorder
                                label="section"
                                onUp={() => dispatch({ type: 'moveSection', openingId: opening.id, key: subs[0].key, dir: -1 })}
                                onDown={() => dispatch({ type: 'moveSection', openingId: opening.id, key: subs[subs.length - 1].key, dir: 1 })}
                              />
                            </>
                          )}
                        />

                        {/* Contents open on the row directly beneath their own card. */}
                        {isOpen && (
                          <div className="folder-open-panel">
                            <div className="chapter-grid">
                              {hasSubs
                                ? subs.map(({ subsection, chapters: subChapters, key }) => (
                                  // A sub-section holding a single chapter would
                                  // be a folder wrapping one item — show the
                                  // chapter itself and skip the empty level.
                                  subsection && subChapters.length === 1 ? (
                                    <ChapterCard
                                      key={key}
                                      opening={opening}
                                      chapter={subChapters[0]}
                                      groupLabel={subsection}
                                      onOpen={() => onOpenChapter(opening.id, subChapters[0].id)}
                                      onDelete={() => dispatch({ type: 'deleteChapter', openingId: opening.id, chapterId: subChapters[0].id })}
                                      onMove={(dir) => dispatch({ type: 'moveSection', openingId: opening.id, key, dir })}
                                      onToggleStar={() => dispatch({ type: 'toggleChapterStar', openingId: opening.id, chapterId: subChapters[0].id })}
                                      onPractice={() => onPractice({ openingId: opening.id, chapterId: subChapters[0].id, mode: 'practice' })}
                                    />
                                  ) : subsection ? (
                                    <React.Fragment key={key}>
                                      <FolderCard
                                        title={subsection}
                                        chapters={subChapters}
                                        open={!!openGroups[`open:${key}`]}
                                        onToggle={() => dispatch({ type: 'toggleGroupCollapse', openingId: opening.id, key: `open:${key}` })}
                                        practiceLabel={`Practice ${subsection}`}
                                        onPractice={() => onPracticeGroup(opening.id, subChapters)}
                                        actions={(
                                          <>
                                            <button
                                              className="small ghost"
                                              title="Rename sub-section"
                                              onClick={() => {
                                                const to = window.prompt('Sub-section name (empty to move up a level):', subsection);
                                                if (to !== null) {
                                                  dispatch({ type: 'renameSubsection', openingId: opening.id, section, from: subsection, to: to.trim() });
                                                }
                                              }}
                                            >
                                              ✎
                                            </button>
                                            <button
                                              className="small ghost"
                                              title="Make this its own section again"
                                              onClick={() => dispatch({ type: 'unnestSubsection', openingId: opening.id, section, subsection })}
                                            >
                                              ⤴
                                            </button>
                                            <Reorder
                                              label="sub-section"
                                              onUp={() => dispatch({ type: 'moveSection', openingId: opening.id, key, dir: -1 })}
                                              onDown={() => dispatch({ type: 'moveSection', openingId: opening.id, key, dir: 1 })}
                                            />
                                          </>
                                        )}
                                      />
                                      {openGroups[`open:${key}`] && (
                                        <div className="folder-open-panel nested">
                                          <div className="chapter-grid">
                                            {subChapters.map(chapterCard)}
                                          </div>
                                        </div>
                                      )}
                                    </React.Fragment>
                                  ) : (
                                    <React.Fragment key={key}>{subChapters.map(chapterCard)}</React.Fragment>
                                  )
                                ))
                                : chapters.map(chapterCard)}
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {ungrouped?.subs[0]?.chapters.map(chapterCard)}

                  <div
                    className="add-card"
                    onClick={() => setModal({ kind: 'addChapter', openingId: opening.id, courseId })}
                  >
                    + Add Chapter
                  </div>
                </div>
              );
              })();

              return (
                <>
                  {/* Courses sit between the opening and its chapters: same look,
                      one step down, so two authors' takes stay apart. */}
                  {courses.map((course) => {
                    const courseChapters = chaptersIn(course.id);
                    const t = tallyChapters(courseChapters);
                    const pct = t.variations ? Math.round((t.practiced / t.variations) * 100) : 0;
                    const green = courseChapters.length > 0 && courseChapters.every(chapterPracticed);
                    const toggleCourse = () => dispatch({
                      type: 'toggleCourseCollapse', openingId: opening.id, courseId: course.id,
                    });
                    return (
                      <div key={course.id} className="course-block">
                        <div className={`opening-row course-row${green ? ' practiced' : ''}`}>
                          {course.artwork ? (
                            <img
                              className="opening-art course-art"
                              src={course.artwork.medium}
                              alt=""
                              title={`${course.collapsed ? 'Open' : 'Close'} ${course.name} · drop an image here to replace the artwork`}
                              onClick={toggleCourse}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => dropCourseArtwork(e, opening.id, course.id)}
                            />
                          ) : (
                            <button
                              className="art-add-tile course-art"
                              title="Add artwork for this course — click to choose, or drop an image here"
                              onClick={() => pickCourseArtwork(opening.id, course.id)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => dropCourseArtwork(e, opening.id, course.id)}
                            >
                              <ImageIcon size={20} />
                              <span>Artwork</span>
                            </button>
                          )}
                          <div className="opening-info">
                            <div className="opening-head">
                              <button
                                className="collapse-btn"
                                title={course.collapsed ? 'Expand' : 'Collapse'}
                                onClick={toggleCourse}
                              >
                                {course.collapsed ? '▸' : '▾'}
                              </button>
                              <h3 onClick={toggleCourse} style={{ cursor: 'pointer', margin: 0 }}>
                                {course.name}
                              </h3>
                              <Reorder
                                label="course"
                                onUp={() => dispatch({ type: 'moveCourse', openingId: opening.id, courseId: course.id, dir: -1 })}
                                onDown={() => dispatch({ type: 'moveCourse', openingId: opening.id, courseId: course.id, dir: 1 })}
                              />
                              <button
                                className="small ghost"
                                title="Rename course"
                                onClick={() => {
                                  const name = window.prompt('Course / author name:', course.name);
                                  if (name?.trim()) {
                                    dispatch({ type: 'renameCourse', openingId: opening.id, courseId: course.id, name: name.trim() });
                                  }
                                }}
                              >
                                <PencilIcon size={15} />
                              </button>
                              <button
                                className="small ghost"
                                title={course.artwork ? 'Replace or remove the artwork' : 'Add artwork'}
                                onClick={() => (course.artwork
                                  ? setModal({ kind: 'courseArtwork', openingId: opening.id, courseId: course.id })
                                  : pickCourseArtwork(opening.id, course.id))}
                              >
                                <ImageIcon size={15} />
                              </button>
                              <span className="spacer" />
                              <button
                                className="small ghost"
                                title="Drop in a course PGN — each distinct Event becomes its own chapter here automatically"
                                onClick={() => setModal({ kind: 'importCoursePgn', openingId: opening.id, courseId: course.id, courseName: course.name })}
                              >
                                <UploadIcon size={14} /> Import PGN
                              </button>
                              <button
                                className={`small${t.due > 0 ? ' primary' : ' ghost'}`}
                                disabled={t.variations === 0}
                                title={t.due > 0
                                  ? `Practice ${course.name} — ${t.due} line${t.due === 1 ? '' : 's'} due across its chapters`
                                  : `Practice everything in ${course.name}`}
                                onClick={() => onPracticeGroup(opening.id, courseChapters)}
                              >
                                <PlayIcon size={14} /> Practice course{t.due > 0 ? ` (${t.due})` : ''}
                              </button>
                              <button
                                className="small ghost danger"
                                title="Delete the course — its chapters move back up to the opening"
                                onClick={() => {
                                  if (window.confirm(`Delete the course "${course.name}"? Its ${courseChapters.length} chapters stay in ${opening.name}.`)) {
                                    dispatch({ type: 'deleteCourse', openingId: opening.id, courseId: course.id });
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </div>
                            <div className="opening-stats">
                              <span><strong>{t.practiced}/{t.variations}</strong> practiced</span>
                              <div className="progress-track opening-progress">
                                <div className={`progress-fill${green ? ' done' : ''}`} style={{ width: `${pct}%` }} />
                              </div>
                              <span>{courseChapters.length} chapter{courseChapters.length === 1 ? '' : 's'}</span>
                              {t.due > 0 && <span className="due-pill"><ClockIcon size={14} /> {t.due} due</span>}
                            </div>
                          </div>
                        </div>
                        {!course.collapsed && (
                          <div className="course-body">{renderGrid(courseChapters, course.id)}</div>
                        )}
                      </div>
                    );
                  })}

                  {renderGrid(chaptersIn(null), null)}

                  <button
                    className="add-course"
                    title="Group chapters by course or author — two Jobava London courses can live side by side"
                    onClick={() => setModal({ kind: 'addCourse', openingId: opening.id })}
                  >
                    + Add course / author
                  </button>
                </>
              );
            })()}
          </section>
        );
      })}

      {modal?.kind === 'addOpening' && (
        <Modal
          title="New opening"
          hint='e.g. "Jobava London", "Caro-Kann", "Slav Defense". You can set your color afterwards by clicking the badge.'
          placeholder="Opening name"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            dispatch({ type: 'addOpening', name, ownerId: scope === 'me' ? null : scope });
            setModal(null);
          }}
        />
      )}
      {modal?.kind === 'renameOpening' && (
        <Modal
          title="Rename opening"
          defaultValue={modal.name}
          placeholder="Opening name"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            dispatch({ type: 'renameOpening', openingId: modal.openingId, name });
            setModal(null);
          }}
        />
      )}
      {modal?.kind === 'tagOpening' && (() => {
        const opening = state.openings.find((o) => o.id === modal.openingId);
        if (!opening) return null;
        return (
          <TagEditor
            title={opening.name}
            tags={opening.tags}
            suggestions={allTags(state)}
            onClose={() => setModal(null)}
            onChange={(tags) => dispatch({ type: 'setOpeningTags', openingId: opening.id, tags })}
          />
        );
      })()}
      {modal?.kind === 'restore' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Restore this backup?</h3>
            <p className="hint">
              Everything on this device is replaced by what's in the file.
            </p>
            <div className="gi-grid" style={{ marginBottom: 12 }}>
              <div><span>Openings</span><strong>{modal.parsed.openings.length}</strong></div>
              <div><span>Variations</span><strong>{modal.summary.variations}</strong></div>
              <div><span>Players</span><strong>{modal.summary.players}</strong></div>
              <div><span>Games</span><strong>{modal.summary.games}</strong></div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  dispatch({ type: 'hydrate', state: modal.parsed });
                  setModal(null);
                }}
              >
                Replace everything
              </button>
            </div>
          </div>
        </div>
      )}
      {modal?.kind === 'groupByAuthor' && (() => {
        const opening = state.openings.find((o) => o.id === modal.openingId);
        if (!opening) return null;
        return (
          <GroupByAuthorModal
            opening={opening}
            authors={detectAuthors(opening)}
            onClose={() => setModal(null)}
            onApply={(chosen, shorten) => {
              applyGrouping(opening.id, chosen, shorten);
              setModal(null);
            }}
          />
        );
      })()}
      {modal?.kind === 'addCourse' && (
        <Modal
          title="New course"
          hint='Whose repertoire is this? e.g. "Bortnyk & Naroditsky", "Midas Ratsma", "My own notes". Chapters you add inside it stay grouped under that name.'
          placeholder="Course or author"
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            dispatch({ type: 'addCourse', openingId: modal.openingId, name });
            setModal(null);
          }}
        />
      )}
      {modal?.kind === 'courseArtwork' && (() => {
        const opening = state.openings.find((o) => o.id === modal.openingId);
        const course = (opening?.courses ?? []).find((c) => c.id === modal.courseId);
        if (!course?.artwork) return null;
        return (
          <div className="modal-overlay" onClick={() => setModal(null)}>
            <div
              className="modal"
              style={{ maxWidth: 700 }}
              onClick={(e) => e.stopPropagation()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { dropCourseArtwork(e, modal.openingId, modal.courseId); setModal(null); }}
            >
              <h3>{course.name}</h3>
              <img className="artwork-medium" src={course.artwork.medium} alt={`${course.name} artwork`} />
              <p className="hint">
                Drop an image here, or use Replace — square JPG/PNG/GIF, at least 650×650, up to 3 MB.
              </p>
              <div className="modal-actions">
                <button
                  className="danger"
                  onClick={() => {
                    dispatch({
                      type: 'setCourseArtwork', openingId: modal.openingId, courseId: modal.courseId, artwork: null,
                    });
                    setModal(null);
                  }}
                >
                  Remove
                </button>
                <button onClick={() => { setModal(null); pickCourseArtwork(modal.openingId, modal.courseId); }}>
                  Replace…
                </button>
                <button className="primary" onClick={() => setModal(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}
      {modal?.kind === 'addChapter' && (
        <AddChapterModal
          opening={state.openings.find((o) => o.id === modal.openingId)}
          onClose={() => setModal(null)}
          onSubmit={(name, section, subsection, thenImport) => {
            const chapterId = uid();
            dispatch({
              type: 'addChapter',
              id: chapterId,
              openingId: modal.openingId,
              courseId: modal.courseId ?? null,
              name,
              section,
              subsection,
            });
            // Naming an empty chapter is rarely the end of the errand — offer
            // the PGN straight away.
            setModal(thenImport
              ? { kind: 'importPgn', openingId: modal.openingId, chapterId, name }
              : null);
          }}
        />
      )}
      {modal?.kind === 'importPgn' && (
        <PgnImport
          chapterName={modal.name}
          onClose={() => setModal(null)}
          onAdd={(variations) => dispatch({
            type: 'addVariations',
            openingId: modal.openingId,
            chapterId: modal.chapterId,
            variations,
          })}
        />
      )}
      {modal?.kind === 'importCoursePgn' && (
        <PgnImport
          courseName={modal.courseName}
          onClose={() => setModal(null)}
          onAdd={(groups) => {
            for (const g of groups) {
              const chapterId = uid();
              dispatch({
                type: 'addChapter', id: chapterId, openingId: modal.openingId, courseId: modal.courseId, name: g.name,
              });
              dispatch({
                type: 'addVariations', openingId: modal.openingId, chapterId, variations: g.variations,
              });
            }
          }}
        />
      )}
      {modal?.kind === 'artwork' && (() => {
        const opening = state.openings.find((o) => o.id === modal.openingId);
        if (!opening?.artwork) return null;
        return (
          <div className="modal-overlay" onClick={() => setModal(null)}>
            <div
              className="modal"
              style={{ maxWidth: 700 }}
              onClick={(e) => e.stopPropagation()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { dropArtwork(e, opening.id); setModal(null); }}
            >
              <h3>{opening.name}</h3>
              <img className="artwork-medium" src={opening.artwork.medium} alt={`${opening.name} artwork`} />
              <p className="hint">
                Drop an image here, or use Replace — square JPG/PNG/GIF, at least 650×650, up to 3 MB.
              </p>
              <div className="modal-actions">
                <button
                  className="danger"
                  onClick={() => {
                    dispatch({ type: 'setOpeningArtwork', openingId: opening.id, artwork: null });
                    setModal(null);
                  }}
                >
                  Remove
                </button>
                <button onClick={() => { setModal(null); pickArtwork(opening.id); }}>Replace…</button>
                <button className="primary" onClick={() => setModal(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
