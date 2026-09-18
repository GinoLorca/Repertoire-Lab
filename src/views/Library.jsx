import React, { useEffect, useRef, useState } from 'react';
import { useStore, uid } from '../store';
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
  UsersIcon,
  FolderIcon,
  SendIcon,
} from '../components/Icons';
import SendToStudent from '../components/SendToStudent';
import { cloudConfigured } from '../lib/cloud/config';
import { watchAuth } from '../lib/cloud/auth';
import { loadProfile } from '../lib/cloud/profile';

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
function FolderCard({ title, chapters, chips, open, onToggle, actions, practiceLabel, onPractice, onSave }) {
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
        {/* Icon-only here: a folder card's action row is far narrower than a
            course's, and the label would push the rest of the row off it. */}
        {onSave}
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

  // Who's signed in, for the Send button. Null when sync isn't configured or
  // nobody has signed in, which is what hides the button entirely.
  const [me, setMe] = useState(null);
  const [sending, setSending] = useState(null); // the openings being sent
  useEffect(() => {
    if (!cloudConfigured) return undefined;
    let stop = () => {};
    watchAuth(async (u) => {
      if (!u) { setMe(null); return; }
      const profile = await loadProfile(u.uid).catch(() => null);
      setMe({ uid: u.uid, ...(profile ?? {}) });
    }).then((fn) => { stop = fn; });
    return () => stop();
  }, []);

  // 'me' or a student's player id — which slice of state.openings is on
  // screen. Whichever is active when you add an opening is who it's for.
  const [scope, setScope] = useState('me');
  useEffect(() => { if (initialScope) setScope(initialScope); }, [initialScope]);
  const students = state.players.filter((p) => p.kind === 'student');
  // Your own openings stay in view regardless of which repertoire is on screen —
  // they're the source when handing lines to a student.
  const myOpenings = state.openings.filter((o) => (o.ownerId ?? null) === null);
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


  // Scoped to whichever tab is open — exporting a student's repertoire
  // shouldn't silently bundle in your own.
  const exportAll = () => {
    const pgn = openings.map(openingToPgn).join('\n');
    const stamp = scopedStudent ? safeFilename(scopedStudent.name) : 'all';
    downloadText(`repertoire-${stamp}.pgn`, pgn);
  };



  // A small one-course export — just what you've learned and how each line's
  // due, for whichever course you were just working through — so carrying
  // progress to another device after a session doesn't mean digging up a
  // full backup. `kind: 'progress'` marks it as partial: the restore screen
  // only offers Merge for one of these, never Replace everything (a file
  // this small "replacing" a whole device's repertoire would be a disaster).
  // Save what's been learned in one slice of the library to a small file, to be
  // Restored on another device. Any grouping that can be practiced can be saved
  // — a whole opening, a section, a sub-section or a course — so it doesn't
  // matter how a repertoire happens to be organised.
  const saveProgress = (openingId, chapters, label) => {
    const opening = state.openings.find((o) => o.id === openingId);
    if (!opening) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const payload = {
      app: 'repertoire-lab',
      version: 2,
      kind: 'progress',
      savedAt: new Date().toISOString(),
      openings: [{ ...opening, chapters }],
      players: [],
      categories: [],
      playlists: [],
      settings: state.settings,
    };
    downloadText(`progress-${safeFilename(label)}-${stamp}.json`, JSON.stringify(payload));
  };

  // The button itself, so every grouping gets an identical one rather than four
  // near-copies that drift apart.
  const SaveProgressButton = ({ openingId, chapters, label, compact }) => (
    <button
      className="small ghost"
      disabled={tallyChapters(chapters).variations === 0}
      title={`Save just what you've learned in ${label} to a small file — Restore it on another device to merge this progress in`}
      onClick={(e) => { e.stopPropagation(); saveProgress(openingId, chapters, label); }}
    >
      <DownloadIcon size={14} />{compact ? '' : ' Save progress'}
    </button>
  );

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
        {/* Backup, Restore and Reset used to live here. They moved to
            Settings → Backup & files: with sync running they're the fallback
            rather than the front door, and a coach handing work to a student
            now does it from Coaches Corner instead of by sending a file. */}
        {/* Students who play their coach's lines shouldn't need them typed in
            again. From your own page this hands openings to any number of
            students at once; from a student's page it pulls yours in. */}
        {(myOpenings.length > 0 && students.length > 0) && (
          <button
            className="ghost"
            title={scopedStudent
              ? `Copy openings from your own repertoire into ${scopedStudent.name}'s`
              : 'Copy openings from your repertoire into one or more students’'}
            onClick={() => setModal({ kind: 'shareRepertoire', target: scopedStudent?.id ?? null })}
          >
            <UsersIcon size={15} /> {scopedStudent ? 'Copy from mine' : 'Give to students'}
          </button>
        )}
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
                      ? `Themes: ${opening.tags.join(', ')} — chapters and variations inside inherit them`
                      : 'Add this opening to a theme'}
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
                    className="small ghost"
                    title="Drop in a whole course PGN — each distinct Event becomes its own chapter under this opening, with its lines inside"
                    onClick={() => setModal({
                      kind: 'importCoursePgn', openingId: opening.id, courseId: null, courseName: opening.name,
                    })}
                  >
                    <UploadIcon size={15} /> Import PGN
                  </button>
                  <button
                    className="small ghost"
                    title="Group chapters by course or author — two Jobava London courses can live side by side"
                    onClick={() => setModal({ kind: 'addCourse', openingId: opening.id })}
                  >
                    + Course
                  </button>
                  <button
                    className="small"
                    title="Add a chapter to this opening"
                    onClick={() => setModal({ kind: 'addChapter', openingId: opening.id, courseId: null })}
                  >
                    + Chapter
                  </button>
                  {/* The whole point of accounts: a coach hands an opening
                      to a student without either of them touching a file.
                      Hidden until there's an account to send it from. */}
                  {me && (
                    <button
                      className="small ghost"
                      disabled={opening.chapters.length === 0}
                      title="Send this opening to a student's app"
                      onClick={() => setSending([opening])}
                    >
                      <SendIcon size={15} /> Send to student
                    </button>
                  )}
                  <button
                    className="small ghost"
                    disabled={opening.chapters.length === 0}
                    onClick={() => downloadText(`${safeFilename(opening.name)}.pgn`, openingToPgn(opening))}
                  >
                    <DownloadIcon size={15} /> Export opening
                  </button>
                  <SaveProgressButton
                    openingId={opening.id}
                    chapters={opening.chapters}
                    label={opening.name}
                  />
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
                          onSave={<SaveProgressButton openingId={opening.id} chapters={chapters} label={section} compact />}
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
                                        onSave={<SaveProgressButton openingId={opening.id} chapters={subChapters} label={subsection} compact />}
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
                              <SaveProgressButton
                                openingId={opening.id}
                                chapters={courseChapters}
                                label={course.name}
                              />
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

                  {/* Chapters that belong to no course. Each course carries its
                      own "+ Add Chapter" inside the part that collapses, so when
                      every chapter lives in a course this grid holds nothing but
                      a stray add tile — one that reads as belonging to the course
                      above it and stays put when that course is collapsed. It
                      still shows when there are no courses at all, otherwise a
                      fresh opening would have no way to take its first chapter. */}
                  {(chaptersIn(null).length > 0 || courses.length === 0)
                    && renderGrid(chaptersIn(null), null)}

                  {/* Same reasoning as the add-chapter tile above: this belongs
                      to the opening, but it renders last, so it lands flush
                      under whatever the final course happens to be and reads as
                      part of it. What matters is only that final course — with
                      two courses, folding the bottom one shut still left this
                      trailing it, because a different course further up was
                      open. So the test is the last course specifically, not any
                      course. Adding one stays possible either way: "+ Course"
                      sits in the opening's own header row. */}
                  {(courses.length === 0
                    || !courses[courses.length - 1].collapsed
                    || chaptersIn(null).length > 0) && (
                  <button
                    className="add-course"
                    title="Group chapters by course or author — two Jobava London courses can live side by side"
                    onClick={() => setModal({ kind: 'addCourse', openingId: opening.id })}
                  >
                    + Add course / author
                  </button>
                  )}
                </>
              );
            })()}
          </section>
        );
      })}

      {modal?.kind === 'shareRepertoire' && (
        <ShareRepertoire
          myOpenings={myOpenings}
          students={students}
          allOpenings={state.openings}
          lockedTo={modal.target}
          onClose={() => setModal(null)}
          onCopy={({ variationIds, playerIds }) => {
            dispatch({ type: 'copyOpeningsToPlayers', variationIds, playerIds });
            setModal(null);
          }}
        />
      )}

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

      {sending && me && (
        <SendToStudent
          openings={sending}
          from={me}
          preselectAll
          onClose={() => setSending(null)}
        />
      )}
    </div>
  );
}

// Handing a coach's lines to students who play the same repertoire.
//
// It copies rather than links, because the two have to be able to diverge: a
// student's notes, their progress and any edits made for them are theirs, and
// nothing done on either side reaches the other afterwards.
//
// The unit is the individual line. An opening or a chapter is just a convenient
// way to tick a lot of them at once, which is why the checkboxes above them are
// derived from what's selected underneath rather than being selections of their
// own.
function ShareRepertoire({ myOpenings, students, allOpenings, lockedTo, onClose, onCopy }) {
  const everyLine = React.useMemo(() => myOpenings.flatMap(
    (o) => o.chapters.flatMap((c) => c.variations.map((v) => v.id)),
  ), [myOpenings]);
  const [selected, setSelected] = useState(() => new Set(everyLine));
  const [playerIds, setPlayerIds] = useState(() => (lockedTo ? [lockedTo] : []));
  const [open, setOpen] = useState({}); // which openings/chapters are expanded
  useBackGuard(true, onClose);

  const setMany = (ids, on) => setSelected((prev) => {
    const next = new Set(prev);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  });

  // none / some / all — drives the tri-state boxes on openings and chapters.
  const stateOf = (ids) => {
    const hits = ids.filter((id) => selected.has(id)).length;
    if (hits === 0) return 'none';
    return hits === ids.length ? 'all' : 'some';
  };

  const Tri = ({ ids }) => {
    const st = stateOf(ids);
    return (
      <input
        type="checkbox"
        checked={st === 'all'}
        ref={(el) => { if (el) el.indeterminate = st === 'some'; }}
        onChange={() => setMany(ids, st !== 'all')}
        onClick={(e) => e.stopPropagation()}
      />
    );
  };

  const toggleOpen = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  // What each student will actually receive, counted the same way the reducer
  // does it, so the button isn't a leap of faith.
  const summary = playerIds.map((pid) => {
    const student = students.find((s) => s.id === pid);
    const theirs = allOpenings.filter((o) => (o.ownerId ?? null) === pid);
    const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    let lines = 0;
    for (const o of myOpenings) {
      const mine = theirs.find((t) => same(t.name, o.name));
      for (const c of o.chapters) {
        const picked = c.variations.filter((v) => selected.has(v.id));
        if (picked.length === 0) continue;
        const theirChapter = mine?.chapters.find((x) => same(x.name, c.name));
        if (!theirChapter) { lines += picked.length; continue; }
        const have = new Set(theirChapter.variations.map((v) => v.name.trim().toLowerCase()));
        lines += picked.filter((v) => !have.has(v.name.trim().toLowerCase())).length;
      }
    }
    return { name: student?.name ?? 'Student', lines };
  });

  const ready = selected.size > 0 && playerIds.length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Give your lines to students</h3>
        <p className="hint">
          Tick a whole opening, a chapter, or single lines. The moves, comments and badges are
          copied across; progress isn't — recall belongs to whoever does the practising. After this
          the two repertoires are completely separate: editing one never touches the other.
        </p>

        <div className="share-cols">
          <div className="share-col">
            <div className="share-col-head">
              <strong>Lines</strong>
              <span className="muted-note">{selected.size} of {everyLine.length}</span>
              <button
                className="small ghost"
                onClick={() => setSelected(selected.size === everyLine.length ? new Set() : new Set(everyLine))}
              >
                {selected.size === everyLine.length ? 'None' : 'All'}
              </button>
            </div>
            <div className="share-list share-tree">
              {myOpenings.map((o) => {
                const openingLines = o.chapters.flatMap((c) => c.variations.map((v) => v.id));
                if (openingLines.length === 0) return null;
                const oKey = `o:${o.id}`;
                return (
                  <div key={o.id} className="tree-opening">
                    <div className="tree-row">
                      <button className="tree-caret" onClick={() => toggleOpen(oKey)}>
                        {open[oKey] ? '▾' : '▸'}
                      </button>
                      <Tri ids={openingLines} />
                      <span className="tree-name"><strong>{o.name}</strong></span>
                      <span className="muted-note">{openingLines.length}</span>
                    </div>
                    {open[oKey] && o.chapters.map((c) => {
                      const chapterLines = c.variations.map((v) => v.id);
                      if (chapterLines.length === 0) return null;
                      const cKey = `c:${c.id}`;
                      return (
                        <div key={c.id} className="tree-chapter">
                          <div className="tree-row">
                            <button className="tree-caret" onClick={() => toggleOpen(cKey)}>
                              {open[cKey] ? '▾' : '▸'}
                            </button>
                            <Tri ids={chapterLines} />
                            <span className="tree-name">{c.name}</span>
                            <span className="muted-note">{chapterLines.length}</span>
                          </div>
                          {open[cKey] && c.variations.map((v) => (
                            <label key={v.id} className="tree-row tree-line">
                              <input
                                type="checkbox"
                                checked={selected.has(v.id)}
                                onChange={() => setMany([v.id], !selected.has(v.id))}
                              />
                              <span className="tree-name">{v.name}</span>
                              <span className="muted-note">{v.moves.length}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="share-col">
            <div className="share-col-head">
              <strong>Students</strong>
              {!lockedTo && (
                <button
                  className="small ghost"
                  onClick={() => setPlayerIds(
                    playerIds.length === students.length ? [] : students.map((s) => s.id),
                  )}
                >
                  {playerIds.length === students.length ? 'None' : 'All'}
                </button>
              )}
            </div>
            <div className="share-list">
              {students.map((s) => (
                <label key={s.id} className={`share-item${lockedTo && lockedTo !== s.id ? ' dimmed' : ''}`}>
                  <input
                    type="checkbox"
                    checked={playerIds.includes(s.id)}
                    disabled={!!lockedTo && lockedTo !== s.id}
                    onChange={() => setPlayerIds(
                      playerIds.includes(s.id)
                        ? playerIds.filter((x) => x !== s.id)
                        : [...playerIds, s.id],
                    )}
                  />
                  <span><strong>{s.name}</strong></span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {summary.length > 0 && (
          <div className="share-summary">
            {summary.map((s) => (
              <div key={s.name}>
                <strong>{s.name}</strong>{' '}
                <span className="muted-note">
                  {s.lines === 0
                    ? 'already has every line you\u2019ve picked'
                    : `gets ${s.lines} new line${s.lines === 1 ? '' : 's'}`}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!ready}
            onClick={() => onCopy({ variationIds: [...selected], playerIds })}
          >
            Copy across
          </button>
        </div>
      </div>
    </div>
  );
}
