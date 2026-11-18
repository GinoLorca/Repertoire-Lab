import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { useBackGuard } from '../lib/backGuard';
import { useMe } from '../lib/cloud/useMe';
import { sendLines, subsetOf } from '../lib/cloud/share';
import { collectionLines, collectionPlan, missingByPlace } from '../lib/collectionCopy';
import Avatar from './Avatar';
import { CheckIcon, TagIcon } from './Icons';

// A collection — a theme on lines — copied from one repertoire to another:
// yours to a student's, a student's to yours, one student's to another's
// (lib/collectionCopy, the store's copyCollection).
//
// Pick where it goes; see what it'll do there first — how many of its lines
// are there already, and where the rest would go — then copy. Lines there
// already join the collection; the rest are copied in (unless you'd rather
// not) with your notes, badges and arrows, fresh progress, and only this
// theme. A student linked to your account gets it in their app too: every
// line of the collection, their copy, so it lands where it is here.

const MAX_NAMES = 6;

export default function CopyCollection({ tag, from = null, onClose, onShowScope }) {
  const { state, dispatch } = useStore();
  const me = useMe();
  useBackGuard(true, onClose);
  const students = useMemo(() => state.players.filter((p) => p.kind === 'student'), [state.players]);
  const nameOf = (id) => (id == null ? 'you' : students.find((s) => s.id === id)?.name ?? 'them');
  const fromName = from == null ? 'your collections' : `${nameOf(from)}’s collections`;
  // Yours, when it's a student's; every student but whose it is.
  const targets = useMemo(() => [
    ...(from != null ? [{ id: null, name: 'My collections' }] : []),
    ...students.filter((s) => s.id !== from).map((s) => ({ id: s.id, name: s.name, student: s })),
  ], [students, from]);

  const count = collectionLines(state.openings, from, tag).length;
  const [target, setTarget] = useState(undefined); // undefined: picking; null: you; else a student's id
  const [addMissing, setAddMissing] = useState(true);
  const [toApp, setToApp] = useState(true);
  const [done, setDone] = useState(null); // { to, name, added, joined, app }
  const pending = useRef(null); // { student } — to send once the copy is in

  const linked = (student) => !!me?.uid && !!student?.profile?.linkedUid;

  // Every line of the collection in their repertoire, to their app — once
  // the copy is in.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const theirs = state.openings.filter((o) => o.ownerId === p.student.id);
    const ids = new Set(collectionLines(state.openings, p.student.id, tag).map((l) => l.variation.id));
    if (!ids.size) { setDone((d) => (d ? { ...d, app: null } : d)); return; }
    sendLines({
      to: { uid: p.student.profile.linkedUid, name: p.student.profile?.accountName || p.student.profile?.screenName || p.student.name },
      from: me,
      openings: subsetOf(theirs, ids),
      message: `The “${tag}” collection`,
    })
      .then(() => setDone((d) => (d ? { ...d, app: 'sent' } : d)))
      .catch((err) => setDone((d) => (d ? { ...d, app: err?.message || 'it didn’t go through' } : d)));
  }, [state.openings]); // eslint-disable-line react-hooks/exhaustive-deps

  const planFor = (to) => collectionPlan(state.openings, { tag, from, to });

  const copy = () => {
    const t = targets.find((x) => x.id === target);
    const plan = planFor(target);
    const added = addMissing ? plan.missing : 0;
    const joined = plan.have - plan.already;
    const sendIt = toApp && !!t?.student && linked(t.student) && (added > 0 || joined > 0);
    if (sendIt) pending.current = { student: t.student };
    dispatch({ type: 'copyCollection', tag, from, to: target, addMissing });
    setDone({ to: target, name: t?.name, added, joined, app: sendIt ? 'sending' : null });
  };

  let body;
  if (done) {
    const whose = done.to == null ? 'your' : `${done.name}’s`;
    const bits = [
      done.added > 0 && `${done.added === 1 ? 'a line' : `${done.added} lines`} added`,
      done.joined > 0 && `${done.joined === 1 ? 'a line' : `${done.joined} lines`} ${done.to == null ? 'you' : 'they'} had joined it`,
    ].filter(Boolean);
    body = (
      <div className="give-done">
        <p className="give-done-head">
          <CheckIcon size={18} />
          {bits.length ? ` “${tag}” is in ${whose} collections` : ` Nothing to copy — it was all there`}
        </p>
        {bits.length > 0 && <p className="muted-note">{bits.join(' · ')}</p>}
        {done.app === 'sending' && <p className="muted-note">Sending to {done.name}’s app…</p>}
        {done.app === 'sent' && <p className="give-sent"><CheckIcon size={14} /> Sent to {done.name}’s app too</p>}
        {done.app && done.app !== 'sending' && done.app !== 'sent' && (
          <p className="annotate-error">Couldn’t send it to their app — {done.app}. It’s still in their collections here.</p>
        )}
        <div className="give-actions">
          <button className="small" onClick={() => { onClose(); onShowScope?.(done.to == null ? 'me' : done.to); }}>
            Open {done.to == null ? 'My collections' : `${done.name}’s collections`}
          </button>
          <button className="small primary" onClick={onClose}>Done</button>
        </div>
      </div>
    );
  } else if (target !== undefined) {
    const t = targets.find((x) => x.id === target);
    const plan = planFor(target);
    const you = target == null;
    const places = missingByPlace(plan);
    const joins = collectionLines(state.openings, target, tag).length;
    const nothing = plan.have - plan.already === 0 && (!addMissing || plan.missing === 0);
    body = (
      <>
        <div className="sheet-title">Copy “{tag}” to {you ? 'My collections' : t?.name}</div>
        <div className="copy-coll-body">
          <p className="copy-coll-sum">
            {plan.lines.length} line{plan.lines.length === 1 ? '' : 's'}:{' '}
            {plan.have} already in {you ? 'your' : 'their'} repertoire, {plan.missing} to add
          </p>
          {plan.already > 0 && (
            <p className="muted-note">{plan.already === plan.have ? (plan.already === 1 ? 'It’s' : 'All of them are') : `${plan.already} of them are`} in “{tag}” there already.</p>
          )}
          {joins > 0 && (
            <p className="muted-note">Joins the “{tag}” collection {you ? 'you have' : 'they have'} ({joins} line{joins === 1 ? '' : 's'}).</p>
          )}
          {plan.missing > 0 && (
            <label className="give-app copy-coll-add">
              <input type="checkbox" checked={addMissing} onChange={(e) => setAddMissing(e.target.checked)} />
              Also add the {plan.missing === 1 ? 'line' : `${plan.missing} lines`} {you ? 'you don’t' : 'they don’t'} have
            </label>
          )}
          {plan.missing > 0 && addMissing && (
            <ul className="copy-coll-places">
              {places.map((p) => (
                <li key={`${p.opening}|${p.chapter}`}>
                  <span className="copy-coll-where">
                    {p.opening} → {p.chapter}
                    {(p.newOpening || p.newChapter) && (
                      <span className="copy-coll-new">{p.newOpening ? 'new opening' : 'new chapter'}</span>
                    )}
                  </span>
                  <span className="copy-coll-names">
                    {p.lines.slice(0, MAX_NAMES).join(', ')}
                    {p.lines.length > MAX_NAMES && ` +${p.lines.length - MAX_NAMES} more`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {plan.missing > 0 && addMissing && (
            <p className="muted-note">Notes, badges and arrows come with them, with fresh progress. Of their themes, only this one.</p>
          )}
          {t?.student && linked(t.student) && !nothing && (
            <label className="give-app">
              <input type="checkbox" checked={toApp} onChange={(e) => setToApp(e.target.checked)} />
              Also send to {t.name}’s app
            </label>
          )}
        </div>
        <div className="give-actions copy-coll-actions">
          <button type="button" className="small" onClick={() => setTarget(undefined)}>Back</button>
          <button type="button" className="small primary" disabled={nothing} onClick={copy}>
            {nothing ? 'Nothing to copy' : 'Copy'}
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="sheet-title">Copy “{tag}” to…</div>
        <p className="muted-note give-where">{count} line{count === 1 ? '' : 's'} from {fromName}</p>
        {targets.length === 0 ? (
          <p className="muted-note give-empty">No students yet — add one in Coaches Corner first.</p>
        ) : (
          <div className="sheet-rows">
            {targets.map((t) => {
              const plan = planFor(t.id);
              const all = plan.lines.length > 0 && plan.already === plan.lines.length;
              const you = t.id == null;
              const hint = all
                ? `${you ? 'You have' : 'Has'} it already`
                : [
                  t.student && linked(t.student) && 'linked account',
                  plan.have > 0 && `${plan.have} of ${plan.lines.length} already in ${you ? 'yours' : 'theirs'}`,
                  plan.missing > 0 && `${plan.missing} to add`,
                ].filter(Boolean).join(' · ');
              return (
                <button
                  key={t.id ?? 'me'}
                  type="button"
                  className="sheet-row give-row"
                  disabled={all}
                  onClick={() => { setAddMissing(true); setTarget(t.id); }}
                >
                  {t.student
                    ? <Avatar avatar={t.student.avatar} seed={t.student.id} size={34} />
                    : <span className="copy-coll-me" aria-hidden="true"><TagIcon size={17} /></span>}
                  <span className="sheet-label">
                    {t.name}
                    {hint && <span className="sheet-hint">{hint}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <button type="button" className="sheet-cancel" onClick={onClose}>Cancel</button>
      </>
    );
  }

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet give-sheet copy-coll-sheet" role="dialog" aria-label={`Copy ${tag}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        {body}
      </div>
    </div>,
    document.body,
  );
}
