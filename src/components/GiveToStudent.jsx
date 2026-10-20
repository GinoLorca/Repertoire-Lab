import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { useBackGuard } from '../lib/backGuard';
import { useMe } from '../lib/cloud/useMe';
import { sendLines, subsetOf } from '../lib/cloud/share';
import { fen4 } from '../lib/startPos';
import Avatar from './Avatar';
import { UsersIcon, CheckIcon } from './Icons';

// One line of your repertoire, handed to one student in one tap — from the
// line on a chapter page, or from the board while practicing it.
//
// It goes through the same copy as the Library's "Give to students"
// (copyOpeningsToPlayers in store.jsx): the student gets the opening (same
// name and side), its course, the chapter (same name) and the line with your
// notes, badges and arrows, and their own fresh progress. An opening or
// chapter they already have by that name is added to, not doubled, and a line
// they already have is shown as such instead of sent again.
//
// For a student linked to your account, "Also send to their app" delivers
// the same line to their own device in the same step (lib/cloud/share.js).

const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
// The reducer's own test for "they already have this line" — the same name,
// start and moves anywhere in the opening, or the same name in that chapter.
const lineKey = (v) => `${String(v.name ?? '').trim().toLowerCase()}|${v.startFen ? fen4(v.startFen) : ''}|${(v.moves ?? []).join(' ')}`;

export function hasLine(openings, studentId, opening, chapter, variation) {
  const theirs = openings.find((o) => o.ownerId === studentId && sameName(o.name, opening.name));
  if (!theirs) return false;
  const key = lineKey(variation);
  if (theirs.chapters.some((c) => c.variations.some((v) => lineKey(v) === key))) return true;
  const ch = theirs.chapters.find((c) => sameName(c.name, chapter.name));
  return !!ch?.variations.some((v) => sameName(v.name, variation.name));
}

export default function GiveToStudent({ openingId, chapterId, variationId, onClose }) {
  const { state, dispatch } = useStore();
  const me = useMe();
  useBackGuard(true, onClose);
  const opening = state.openings.find((o) => o.id === openingId);
  const chapter = opening?.chapters.find((c) => c.id === chapterId);
  const variation = chapter?.variations.find((v) => v.id === variationId);
  const students = useMemo(() => state.players.filter((p) => p.kind === 'student'), [state.players]);
  const anyLinked = !!me?.uid && students.some((s) => s.profile?.linkedUid);
  const [toApp, setToApp] = useState(true);
  const [given, setGiven] = useState(null); // { student, app: null | 'sending' | 'sent' | error message }

  if (!opening || !chapter || !variation) return null;

  const give = async (student) => {
    dispatch({ type: 'copyOpeningsToPlayers', variationIds: [variation.id], playerIds: [student.id] });
    const linkedUid = student.profile?.linkedUid;
    const sendIt = toApp && !!me?.uid && !!linkedUid;
    setGiven({ student, app: sendIt ? 'sending' : null });
    if (!sendIt) return;
    try {
      const mine = state.openings.filter((o) => (o.ownerId ?? null) === null);
      await sendLines({
        to: { uid: linkedUid, name: student.profile?.accountName || student.profile?.screenName || student.name },
        from: me,
        openings: subsetOf(mine, new Set([variation.id])),
        message: '',
      });
      setGiven((g) => (g ? { ...g, app: 'sent' } : g));
    } catch (err) {
      setGiven((g) => (g ? { ...g, app: err?.message || 'it didn’t go through' } : g));
    }
  };

  const openTheirs = (student) => {
    onClose();
    window.dispatchEvent(new CustomEvent('repertoire-open-library', { detail: student.id }));
  };

  const where = `${opening.name} → ${chapter.name}`;

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet give-sheet" role="dialog" aria-label="Give to a student" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        {given ? (
          <div className="give-done">
            <p className="give-done-head"><CheckIcon size={18} /> Added to {given.student.name}’s repertoire</p>
            <p className="muted-note">{where} · {variation.name}</p>
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
        ) : (
          <>
            <div className="sheet-title">Give “{variation.name}” to…</div>
            <p className="muted-note give-where">{where}</p>
            {students.length === 0 ? (
              <p className="muted-note give-empty">No students yet — add one in Coaches Corner first.</p>
            ) : (
              <div className="sheet-rows">
                {students.map((s) => {
                  const has = hasLine(state.openings, s.id, opening, chapter, variation);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className="sheet-row give-row"
                      disabled={has}
                      onClick={() => give(s)}
                    >
                      <Avatar avatar={s.avatar} seed={s.id} size={34} />
                      <span className="sheet-label">
                        {s.name}
                        {s.profile?.linkedUid && <span className="sheet-hint">linked account</span>}
                      </span>
                      {has && <span className="give-has">Has it</span>}
                    </button>
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
        )}
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
      title="Give this line to a student — it lands in their repertoire, in the same opening and chapter"
      aria-label="Give to a student"
      onClick={onClick}
    >
      <UsersIcon size={15} />{label && <span className="btn-label"> Give to student</span>}
    </button>
  );
}
