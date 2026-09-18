import React, { useMemo, useState } from 'react';
import { findByScreenName } from '../lib/cloud/profile';
import {
  sendLines, describePayload, deliveryPayload, subsetOf, lineIdsUnder, tickState,
} from '../lib/cloud/share';
import { SendIcon, CheckIcon } from './Icons';

// A checkbox that can also say "some of this".
function Tick({ state, onChange, label, sub }) {
  return (
    <label className={`pick-row pick-${state}`}>
      <input
        type="checkbox"
        checked={state === 'all'}
        ref={(el) => { if (el) el.indeterminate = state === 'some'; }}
        onChange={() => onChange(state !== 'all')}
      />
      <span className="pick-label">{label}</span>
      {sub && <span className="muted-note">{sub}</span>}
    </label>
  );
}

// Hand-picking what a student gets, and sending it to their app.
//
// The unit a coach thinks in changes week to week — a whole opening, one
// chapter, or the three lines they got wrong on Saturday — so every level
// ticks, and a parent shows a dash when only part of it is chosen. Chapters
// start collapsed: a coach with 833 lines shouldn't have to scroll past them
// to find the one they mean.
// `preselectAll` is for the caller that already means "this one": the Send
// button on an opening in the Library arrives with everything ticked and the
// tree open, so it's one press to send — but narrowing to two chapters is
// still just unticking the rest.
export default function SendToStudent({
  openings, from, student, savedScreenName, onSaveScreenName, onClose, preselectAll = false,
}) {
  const [chosen, setChosen] = useState(
    () => new Set(preselectAll ? openings.flatMap(lineIdsUnder) : []),
  );
  const [open, setOpen] = useState(
    () => new Set(preselectAll && openings.length === 1 ? [openings[0].id] : []),
  );
  const [name, setName] = useState(savedScreenName ?? '');
  const [found, setFound] = useState(null);
  const [message, setMessage] = useState('');
  const [state, setState] = useState('idle'); // idle | looking | sending | sent
  const [error, setError] = useState(null);

  const picked = useMemo(() => subsetOf(openings, chosen), [openings, chosen]);
  const summary = describePayload(picked);
  const nothingPicked = picked.length === 0;

  const setMany = (ids, on) => setChosen((prev) => {
    const next = new Set(prev);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  });

  const look = async (silent = false) => {
    setError(null);
    if (!name.trim()) { if (!silent) setError('Type their screen name.'); return null; }
    setState('looking');
    try {
      const who = await findByScreenName(name);
      setState('idle');
      if (!who) {
        setError(`Nobody is using “${name.trim()}”. It's the name in their Settings → Account.`);
        return null;
      }
      if (who.uid === from.uid) { setError('That’s your own screen name.'); return null; }
      setFound(who);
      onSaveScreenName?.(who.name);
      return who;
    } catch (err) {
      setState('idle');
      setError(err.message);
      return null;
    }
  };

  const send = async () => {
    const who = found ?? await look();
    if (!who) return;
    setState('sending');
    setError(null);
    try {
      await sendLines({ to: who, from, openings: picked, message });
      setState('sent');
    } catch (err) {
      setError(err.message);
      setState('idle');
    }
  };

  if (state === 'sent') {
    return (
      <div className="viewer-overlay" onClick={onClose}>
        <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
          <div className="page-head"><h2><CheckIcon size={18} /> Sent</h2></div>
          <p className="hint">
            <strong>{summary}</strong> sent to <strong>{found.name}</strong>. It’s waiting under the
            bell in their app — they tap it and it’s in their repertoire. Nothing they’ve already
            learned is reset.
          </p>
          <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="modal send-modal" onClick={(e) => e.stopPropagation()}>
        <div className="page-head">
          <h2>Send to {student?.name ?? 'a student'}</h2>
        </div>

        <div className="settings-row">
          <span className="muted-note">Their screen name</span>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setFound(null); }}
            placeholder="e.g. wavy-jr"
            style={{ maxWidth: 220 }}
          />
          <button onClick={() => look()} disabled={state === 'looking'}>
            {state === 'looking' ? 'Checking…' : 'Check'}
          </button>
          {found && <span className="practiced-pill"><CheckIcon size={12} /> {found.name}</span>}
        </div>
        {savedScreenName && !found && (
          <p className="hint">Saved from last time — press Send and it’ll check before it goes.</p>
        )}

        <div className="pick-tree">
          {openings.length === 0 && (
            <p className="hint">No openings to send yet. Build one in the Library first.</p>
          )}
          {openings.map((opening) => {
            const openingLines = lineIdsUnder(opening);
            const openingState = tickState(openingLines, chosen);
            const isOpen = open.has(opening.id);
            return (
              <div key={opening.id} className="pick-opening">
                <div className="pick-head">
                  <button
                    className="collapse-btn"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                    onClick={() => setOpen((p) => {
                      const next = new Set(p);
                      if (next.has(opening.id)) next.delete(opening.id); else next.add(opening.id);
                      return next;
                    })}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                  <Tick
                    state={openingState}
                    onChange={(on) => setMany(openingLines, on)}
                    label={opening.name}
                    sub={`${opening.chapters.length} chapter${opening.chapters.length === 1 ? '' : 's'} · ${openingLines.length} line${openingLines.length === 1 ? '' : 's'}`}
                  />
                </div>

                {isOpen && opening.chapters.map((chapter) => {
                  const chapterLines = lineIdsUnder(chapter);
                  const chapterOpen = open.has(chapter.id);
                  return (
                    <div key={chapter.id} className="pick-chapter">
                      <div className="pick-head">
                        <button
                          className="collapse-btn"
                          aria-label={chapterOpen ? 'Collapse' : 'Expand'}
                          onClick={() => setOpen((p) => {
                            const next = new Set(p);
                            if (next.has(chapter.id)) next.delete(chapter.id); else next.add(chapter.id);
                            return next;
                          })}
                        >
                          {chapterOpen ? '▾' : '▸'}
                        </button>
                        <Tick
                          state={tickState(chapterLines, chosen)}
                          onChange={(on) => setMany(chapterLines, on)}
                          label={chapter.name}
                          sub={`${chapterLines.length} line${chapterLines.length === 1 ? '' : 's'}`}
                        />
                      </div>
                      {chapterOpen && (chapter.variations ?? []).map((v) => (
                        <div key={v.id} className="pick-line">
                          <Tick
                            state={chosen.has(v.id) ? 'all' : 'none'}
                            onChange={(on) => setMany([v.id], on)}
                            label={v.name}
                            sub={(v.moves ?? []).slice(0, 6).join(' ')}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <label className="field-row" style={{ marginTop: 6 }}>
          <span>Message <span className="muted-note">— what this is about</span></span>
          <textarea
            rows={2}
            value={message}
            maxLength={500}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Here's the Jobava line from today — drill the 4.Nb5 sideline before Saturday."
          />
        </label>

        {error && <p className="hint" style={{ color: 'var(--red)' }}>{error}</p>}

        <div className="modal-actions">
          <span className="muted-note" style={{ flex: 1 }}>
            {nothingPicked ? 'Nothing picked yet' : `Sending ${summary}`}
          </span>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={nothingPicked || state === 'sending'}
            onClick={send}
          >
            {state === 'sending' ? 'Sending…' : <><SendIcon size={15} /> Send</>}
          </button>
        </div>
      </div>
    </div>
  );
}
