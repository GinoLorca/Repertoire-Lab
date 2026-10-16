import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useStore, uid } from '../store';
import Avatar from './Avatar';
import { FolderIcon, RecycleIcon } from './Icons';
import { useBackGuard } from '../lib/backGuard';
import {
  positionsFor, folderNames, folderOrderFor, folderOf, alreadyIn, nextLessonName, lessonNamed, recycledCopy,
  listsBytes, LISTS_BYTES_WARN, LISTS_BYTES_MAX,
} from '../lib/savedPositions';
import { canSendLesson } from '../lib/cloud/share';

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// Recycle: where a copy of a saved position goes — or of every position in a
// lesson, in order. The same bottom sheet as Move to folder, in two steps:
// whose (your own positions, or one of your Coaches Corner students), then
// which of their lessons, or a new one. A lesson that already has the
// position asks before adding it a second time.
//
// `sources` are the positions being recycled, in the order they're taught;
// `what` names them in the title ("“Lucena”", "the lesson “Forks”").
// `onDone` hears where they went, with the copies exactly as made — so the
// editor can say so, and send those very copies on to the student's app
// when that was asked for. Copying itself happens here, and nothing about
// the originals changes.
export default function RecycleSheet({
  sources, what, students, me, onClose, onDone,
}) {
  const { state, dispatch } = useStore();
  const all = state.savedPositions ?? [];
  const [step, setStep] = useState('who'); // 'who' | 'lesson' | 'again'
  const [owner, setOwner] = useState(null); // null: your own; otherwise a student's card id
  const [newName, setNewName] = useState(null); // null, or the new lesson's name being typed
  const [send, setSend] = useState(true);
  const [again, setAgain] = useState(null); // { folder, repeats } — already in the lesson picked

  const back = () => {
    if (step === 'again') setStep('lesson');
    else if (step === 'lesson') { setStep('who'); setNewName(null); } else onClose();
  };
  useBackGuard(true, back);

  // A keyboard's way through: each step starts with focus on its first
  // choice (or the new lesson's name, when that's open), and Escape steps
  // back — out of the name field first, then a step, then the sheet.
  const sheetRef = useRef(null);
  useEffect(() => {
    const box = sheetRef.current;
    if (!box || box.contains(document.activeElement)) return;
    box.querySelector('.sheet-rows input, .sheet-rows .sheet-row, .sheet-row')?.focus();
  }, [step]);
  // The new lesson's name closed (Escape): back to the row that opened it.
  const naming = newName !== null;
  const newRowRef = useRef(null);
  useEffect(() => {
    if (!naming && sheetRef.current && !sheetRef.current.contains(document.activeElement)) newRowRef.current?.focus();
  }, [naming]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const student = owner ? students.find((s) => s.id === owner) ?? null : null;
  const whose = student ? student.name : 'My positions';
  // Their app can have it too when their card is linked to their account or
  // names it, the way the Send button on their page finds them — and you're
  // signed in to send.
  const canSend = Boolean(student && me?.uid && canSendLesson(student));
  // Every saved position syncs in one document, and Recycle adds to it.
  const bytes = useMemo(() => listsBytes(state), [state]);

  const lessonsOf = (id) => {
    const theirs = positionsFor(all, id);
    return folderNames(theirs, folderOrderFor(state.settings, id))
      .map((f) => ({ name: f, n: theirs.filter((p) => folderOf(p) === f).length }));
  };
  const lessons = step === 'who' ? [] : lessonsOf(owner);
  const summaryOf = (id) => {
    const l = lessonsOf(id);
    return l.length ? count(l.length, 'lesson') : 'No lessons yet';
  };

  const pickOwner = (id) => {
    setOwner(id);
    setNewName(null);
    setSend(true);
    setStep('lesson');
  };

  const commit = (folder, list) => {
    if (!list.length) { onClose(); return; }
    const now = Date.now();
    const items = list.map((src) => ({ srcId: src.id, id: uid() }));
    dispatch({
      type: 'recyclePositions', items, ownerId: owner, folder, now,
    });
    const copies = items.map(({ id }, i) => recycledCopy(list[i], {
      ownerId: owner, folder, id, now,
    }));
    onDone({
      ownerId: owner, whose, folder, copies, student, send: canSend && send,
    });
  };

  const choose = (typed) => {
    const folder = lessonNamed(all, owner, typed);
    const repeats = sources.filter((src) => alreadyIn(all, src, { ownerId: owner, folder }));
    if (repeats.length) {
      setAgain({ folder, repeats });
      setStep('again');
      return;
    }
    commit(folder, sources);
  };

  let title;
  let body;
  if (step === 'who') {
    title = `Recycle ${what} to…`;
    body = (
      <>
        <button type="button" className="sheet-row" onClick={() => pickOwner(null)}>
          <span className="sheet-icon"><FolderIcon size={16} /></span>
          <span className="sheet-label">
            My positions
            <span className="sheet-hint">{summaryOf(null)}</span>
          </span>
        </button>
        {students.length > 0 && <div className="sheet-sep" role="separator" />}
        {students.map((s) => (
          <button key={s.id} type="button" className="sheet-row" onClick={() => pickOwner(s.id)}>
            <span className="sheet-icon"><Avatar avatar={s.avatar} seed={s.id} size={24} /></span>
            <span className="sheet-label">
              {s.name}
              <span className="sheet-hint">{summaryOf(s.id)}</span>
            </span>
          </button>
        ))}
        {students.length === 0 && (
          <p className="recycle-note">
            Add a student in Coaches Corner and their lessons are offered here too.
          </p>
        )}
        {bytes > LISTS_BYTES_WARN && (
          <p className="recycle-note recycle-full">
            Your saved positions fill {Math.round((bytes / LISTS_BYTES_MAX) * 100)}% of the room they sync
            in. Delete some you no longer teach from before recycling many more: once it’s full, this
            account stops syncing.
          </p>
        )}
      </>
    );
  } else if (step === 'lesson') {
    const offered = nextLessonName(all, owner);
    title = `${whose} — which lesson?`;
    body = (
      <>
        {lessons.map((l) => (
          <button key={l.name} type="button" className="sheet-row" onClick={() => choose(l.name)}>
            <span className="sheet-icon"><FolderIcon size={16} /></span>
            <span className="sheet-label">
              {l.name}
              <span className="sheet-hint">{count(l.n, 'position')}</span>
            </span>
          </button>
        ))}
        {lessons.length > 0 && <div className="sheet-sep" role="separator" />}
        {newName === null ? (
          <button ref={newRowRef} type="button" className="sheet-row" onClick={() => setNewName(offered)}>
            <span className="sheet-icon">+</span>
            <span className="sheet-label">New lesson…</span>
          </button>
        ) : (
          <div className="recycle-new">
            <input
              type="text"
              aria-label="New lesson name"
              placeholder={offered}
              autoFocus
              value={newName}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') choose(newName);
                if (e.key === 'Escape') { e.preventDefault(); setNewName(null); }
              }}
            />
            <button type="button" className="primary" onClick={() => choose(newName)}>
              <RecycleIcon size={15} /> Recycle
            </button>
          </div>
        )}
        <button type="button" className="sheet-row recycle-back" onClick={back}>
          <span className="sheet-icon" aria-hidden="true">‹</span>
          <span className="sheet-label">Someone else</span>
        </button>
      </>
    );
  } else {
    const { folder, repeats } = again;
    const fresh = sources.filter((src) => !repeats.includes(src));
    const one = sources.length === 1;
    // "Again" only when every one of them is a repeat.
    const allLabel = repeats.length === sources.length ? `Add all ${sources.length} again` : `Add all ${sources.length} anyway`;
    title = `Already in ${folder}`;
    body = (
      <>
        <p className="recycle-note">
          {one
            ? `${whose} · ${folder} already has “${sources[0].name}”. Add it again?`
            : `${count(repeats.length, 'position')} of these ${sources.length} ${repeats.length === 1 ? 'is' : 'are'} already in ${whose} · ${folder}.`}
        </p>
        <button type="button" className="sheet-row" onClick={() => commit(folder, sources)}>
          <span className="sheet-icon"><RecycleIcon size={16} /></span>
          <span className="sheet-label">{one ? 'Add it again' : allLabel}</span>
        </button>
        {!one && fresh.length > 0 && (
          <button type="button" className="sheet-row" onClick={() => commit(folder, fresh)}>
            <span className="sheet-icon">+</span>
            <span className="sheet-label">
              {fresh.length === 1 ? 'Add only the new one' : `Add only the ${fresh.length} new ones`}
            </span>
          </button>
        )}
        <button type="button" className="sheet-row recycle-back" onClick={back}>
          <span className="sheet-icon" aria-hidden="true">‹</span>
          <span className="sheet-label">Another lesson</span>
        </button>
      </>
    );
  }

  // Sending is decided before a lesson is: it sits under the title, where
  // it's seen before any lesson is tapped — tapping one recycles, and sends,
  // straight away — however long the list of lessons below it grows.
  const sendBox = canSend && step !== 'who' && (
    <label className="recycle-send">
      <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
      Also send to {student.name}'s Repertoire Lab
    </label>
  );

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-title">{title}</div>
        {sendBox}
        <div className="sheet-rows">{body}</div>
        <button type="button" className="sheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>,
    document.body,
  );
}
