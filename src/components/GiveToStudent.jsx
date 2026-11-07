import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, uid } from '../store';
import { useBackGuard } from '../lib/backGuard';
import { useMe } from '../lib/cloud/useMe';
import { sendLines, subsetOf } from '../lib/cloud/share';
import { whereHas, curatedTarget, curateInto } from '../lib/curate';
import Avatar from './Avatar';
import { UsersIcon, CheckIcon } from './Icons';

// Lines of a repertoire — yours, or a student's — handed to a student in one
// tap: one line, from a chapter page or the board while practicing it, or
// the lines ticked in a chapter.
//
// Where they land: a student whose opening of that name is laid out as
// curated chapters (a Quickstarter Guide) gets them in that chapter — asked
// which, when there are several (lib/curate curateInto). Anyone else gets the
// usual copy (copyOpeningsToPlayers in store.jsx): the opening (same name and
// side), its course, the chapter (same name) and the line. Either way: your
// notes, badges and arrows, their own fresh progress, and a line they already
// have isn't sent again — the sheet says where they have it, and opens it.
//
// For a student linked to your account, "Also send to their app" delivers
// what was just added — their copy, from their repertoire here, so it lands
// in the same chapter on their device (lib/cloud/share.js).

// Every line id in a student's repertoire — what was there before a give.
const theirLineIds = (openings, studentId) => new Set(openings
  .filter((o) => o.ownerId === studentId)
  .flatMap((o) => o.chapters.flatMap((c) => c.variations.map((v) => v.id))));

export function hasLine(openings, studentId, opening, chapter, variation) {
  return Boolean(whereHas(openings, studentId, opening.name, chapter.name, variation));
}

export default function GiveToStudent({
  openingId, chapterId, variationId = null, variationIds = null, onClose,
}) {
  const { state, dispatch } = useStore();
  const me = useMe();
  useBackGuard(true, onClose);
  const opening = state.openings.find((o) => o.id === openingId);
  const chapter = opening?.chapters.find((c) => c.id === chapterId);
  const ids = variationIds ?? (variationId ? [variationId] : []);
  const lines = (chapter?.variations ?? []).filter((v) => ids.includes(v.id));
  // Everyone but whose lines these are.
  const students = useMemo(
    () => state.players.filter((p) => p.kind === 'student' && p.id !== (opening?.ownerId ?? null)),
    [state.players, opening?.ownerId],
  );
  const anyLinked = !!me?.uid && students.some((s) => s.profile?.linkedUid);
  const [toApp, setToApp] = useState(true);
  const [choosing, setChoosing] = useState(null); // a student, picking which curated chapter
  const [given, setGiven] = useState(null); // { student, into, added, had, app }
  const pending = useRef(null); // { student, before } — to send once the copy is in

  // What was just added to their repertoire, to their app — once it's there.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const theirs = state.openings.filter((o) => o.ownerId === p.student.id);
    const added = new Set([...theirLineIds(state.openings, p.student.id)].filter((id) => !p.before.has(id)));
    if (!added.size) { setGiven((g) => (g ? { ...g, app: null } : g)); return; }
    sendLines({
      to: { uid: p.student.profile.linkedUid, name: p.student.profile?.accountName || p.student.profile?.screenName || p.student.name },
      from: me,
      openings: subsetOf(theirs, added),
      message: '',
    })
      .then(() => setGiven((g) => (g ? { ...g, app: 'sent' } : g)))
      .catch((err) => setGiven((g) => (g ? { ...g, app: err?.message || 'it didn’t go through' } : g)));
  }, [state.openings]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!opening || !chapter || !lines.length) return null;

  const statusOf = (student) => {
    const where = lines.map((v) => whereHas(state.openings, student.id, opening.name, chapter.name, v));
    const had = where.filter(Boolean);
    return {
      had: had.length,
      all: had.length === lines.length,
      first: had[0] ?? null,
      curated: curatedTarget(state.openings, student.id, opening.name),
    };
  };

  const give = (student, intoChapter = null) => {
    const before = theirLineIds(state.openings, student.id);
    const st = statusOf(student);
    let added;
    let into;
    if (intoChapter) {
      const args = { toOpeningId: st.curated.opening.id, toChapterId: intoChapter.id, variationIds: lines.map((v) => v.id) };
      added = curateInto(state.openings, args, uid).added;
      dispatch({ type: 'curateLines', ...args });
      into = `${st.curated.opening.name} → ${intoChapter.name}`;
    } else {
      added = lines.length - st.had;
      dispatch({ type: 'copyOpeningsToPlayers', variationIds: lines.map((v) => v.id), playerIds: [student.id] });
      into = `${opening.name} → ${chapter.name}`;
    }
    const sendIt = toApp && !!me?.uid && !!student.profile?.linkedUid && added > 0;
    if (sendIt) pending.current = { student, before };
    setChoosing(null);
    setGiven({ student, into, added, had: lines.length - added, app: sendIt ? 'sending' : null });
  };

  const pick = (student) => {
    const st = statusOf(student);
    if (st.all) return;
    if (st.curated) {
      if (st.curated.chapters.length === 1) give(student, st.curated.chapters[0]);
      else setChoosing(student);
      return;
    }
    give(student);
  };

  const openChapterOf = (o, c) => {
    onClose();
    window.dispatchEvent(new CustomEvent('repertoire-open-line', { detail: { openingId: o.id, chapterId: c.id } }));
  };
  const openTheirs = (student) => {
    onClose();
    window.dispatchEvent(new CustomEvent('repertoire-open-library', { detail: student.id }));
  };

  const what = lines.length === 1 ? `“${lines[0].name}”` : `${lines.length} lines`;
  const whose = opening.ownerId ? state.players.find((p) => p.id === opening.ownerId)?.name : null;
  const where = `${whose ? `${whose}’s ` : ''}${opening.name} → ${chapter.name}`;

  let body;
  if (given) {
    body = (
      <div className="give-done">
        <p className="give-done-head">
          <CheckIcon size={18} />
          {given.added
            ? ` Added ${given.added === 1 ? 'a line' : `${given.added} lines`} to ${given.student.name}’s repertoire`
            : ` ${given.student.name} already had ${lines.length === 1 ? 'it' : 'them all'}`}
        </p>
        <p className="muted-note">
          {given.into}
          {given.added > 0 && given.had > 0 && ` · ${given.had} they already had stayed as they were`}
        </p>
        {given.app === 'sending' && <p className="muted-note">Sending to {given.student.name}’s app…</p>}
        {given.app === 'sent' && <p className="give-sent"><CheckIcon size={14} /> Sent to {given.student.name}’s app too</p>}
        {given.app && given.app !== 'sending' && given.app !== 'sent' && (
          <p className="annotate-error">Couldn’t send it to their app — {given.app}. It’s still in their repertoire here.</p>
        )}
        <div className="give-actions">
          <button className="small" onClick={() => openTheirs(given.student)}>
            Open {given.student.name}’s repertoire
          </button>
          <button className="small primary" onClick={onClose}>Done</button>
        </div>
      </div>
    );
  } else if (choosing) {
    const st = statusOf(choosing);
    body = (
      <>
        <div className="sheet-title">Which of {choosing.name}’s chapters?</div>
        <p className="muted-note give-where">{st.curated.opening.name} — the chapters you curated for them</p>
        <div className="sheet-rows">
          {st.curated.chapters.map((c) => (
            <button key={c.id} type="button" className="sheet-row give-row" onClick={() => give(choosing, c)}>
              <span className="sheet-label">
                {c.name}
                <span className="sheet-hint">{c.variations.length} line{c.variations.length === 1 ? '' : 's'}</span>
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="sheet-cancel" onClick={() => setChoosing(null)}>Back</button>
      </>
    );
  } else {
    body = (
      <>
        <div className="sheet-title">Give {what} to…</div>
        <p className="muted-note give-where">{where}</p>
        {students.length === 0 ? (
          <p className="muted-note give-empty">No {opening.ownerId ? 'other ' : ''}students yet — add one in Coaches Corner first.</p>
        ) : (
          <div className="sheet-rows">
            {students.map((s) => {
              const st = statusOf(s);
              const lands = st.curated
                ? (st.curated.chapters.length === 1 ? `into ${st.curated.chapters[0].name}` : 'into one of their curated chapters')
                : null;
              const hint = [
                s.profile?.linkedUid && 'linked account',
                !st.all && lands,
                st.had > 0 && !st.all && `has ${st.had} of ${lines.length} already`,
              ].filter(Boolean).join(' · ');
              return (
                <div key={s.id} className={`give-row-wrap${st.all ? ' has' : ''}`}>
                  <button
                    type="button"
                    className="sheet-row give-row"
                    disabled={st.all}
                    onClick={() => pick(s)}
                  >
                    <Avatar avatar={s.avatar} seed={s.id} size={34} />
                    <span className="sheet-label">
                      {s.name}
                      {hint && <span className="sheet-hint">{hint}</span>}
                    </span>
                  </button>
                  {st.all && (
                    <button
                      type="button"
                      className="give-has"
                      title={`Open ${st.first.chapter.name} in ${s.name}’s repertoire`}
                      onClick={() => openChapterOf(st.first.opening, st.first.chapter)}
                    >
                      Has it · {st.first.chapter.name} ›
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {anyLinked && (
          <label className="give-app">
            <input type="checkbox" checked={toApp} onChange={(e) => setToApp(e.target.checked)} />
            Also send to their app (students linked to your account)
          </label>
        )}
        <button type="button" className="sheet-cancel" onClick={onClose}>Cancel</button>
      </>
    );
  }

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet give-sheet" role="dialog" aria-label="Give to a student" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        {body}
      </div>
    </div>,
    document.body,
  );
}

// The button that opens it, the same everywhere a line is shown.
export function GiveToStudentButton({ onClick, label = true, className = 'small ghost' }) {
  return (
    <button
      type="button"
      className={className}
      title="Give this line to a student — into their Quickstarter Guide if they have one, otherwise the same opening and chapter"
      aria-label="Give to a student"
      onClick={onClick}
    >
      <UsersIcon size={15} />{label && <span className="btn-label"> Give to student</span>}
    </button>
  );
}
