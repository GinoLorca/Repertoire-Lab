import React, { useRef, useState } from 'react';
import { useStore, emptyState } from '../store';
import { downloadText } from '../lib/pgn';
import {
  fullBackup, studyPack, readBackupFile, mergeBackup,
} from '../lib/backup';
import { DownloadIcon, UploadIcon } from '../components/Icons';

// Files: the way in and out that doesn't need an account, a network, or
// anyone else's cooperation. Sync handles moving your own work between your
// own devices, and Coaches Corner hands lines to a student without either of
// you touching a file — so this isn't the front door any more. It's here for
// the cases those don't cover: keeping a copy of your own, moving to a fresh
// install offline, or handing someone a repertoire who doesn't use accounts.
export default function DataSection() {
  const { state, dispatch } = useStore();
  const restoreRef = useRef(null);
  const packRef = useRef(null);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [restoring, setRestoring] = useState(null); // { parsed, summary }
  const students = (state.players ?? []).filter((p) => p.kind === 'student');
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');

  const save = ({ name, text }) => {
    downloadText(name, text);
    setError(null);
    setNote(`Saved ${name}`);
  };

  // Show what's in the file, and what each choice would do, before anything
  // happens — rather than asking a yes/no question about contents nobody has
  // seen. Moved here wholesale from the Library's front page.
  const summarise = (parsed) => {
    const variations = (parsed.openings ?? []).reduce(
      (a, o) => a + (o.chapters ?? []).reduce((b, c) => b + (c.variations?.length ?? 0), 0), 0,
    );
    const players = parsed.players ?? [];
    return {
      variations,
      players: players.length,
      games: players.reduce((a, pl) => a + (pl.games?.length ?? 0), 0),
    };
  };

  const onRestore = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setNote(null); setError(null);
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.openings) || typeof parsed.settings !== 'object') {
        throw new Error('That file is not a Repertoire Lab backup.');
      }
      setRestoring({ parsed, summary: summarise(parsed) });
    } catch (err) {
      setError(err.message || 'Could not read that backup file.');
    }
  };

  // A study pack only ever adds to one student. Nothing else on the device is
  // touched — not your own repertoire, not your other students.
  const onPack = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    const student = students.find((s) => s.id === studentId);
    if (!file || !student) return;
    setNote(null); setError(null);
    try {
      const { openings, lines } = readBackupFile(await file.text());
      if (openings.length === 0) { setError('That file has no openings in it.'); return; }
      const ok = window.confirm(
        `Add ${openings.length} opening${openings.length === 1 ? '' : 's'} `
        + `(${lines} line${lines === 1 ? '' : 's'}) to ${student.name}'s repertoire?\n\n`
        + 'Nothing else on this device is touched.',
      );
      if (!ok) return;
      dispatch({ type: 'importOpeningsForPlayer', playerId: student.id, openings });
      setNote(`Added to ${student.name}'s repertoire.`);
    } catch {
      setError('That file couldn’t be read as a study pack.');
    }
  };

  return (
    <>
      <p className="hint">
        With an account signed in, your devices keep each other up to date on their own, and a
        coach sends lines straight to a student from Coaches Corner. These are the fallbacks:
        a copy you keep yourself, a move to a fresh install with no network, or a repertoire
        handed to someone who doesn’t use an account.
      </p>

      <div className="settings-row" style={{ marginTop: 16 }}>
        <span><strong>Everything on this device</strong></span>
      </div>
      <p className="hint">
        Every opening including your students’, progress, artwork, player profiles, games and
        settings — one file.
      </p>
      <div className="settings-row">
        <button onClick={() => save(fullBackup(state))}>
          <DownloadIcon size={15} /> Backup
        </button>
        <button onClick={() => restoreRef.current?.click()}>
          <UploadIcon size={15} /> Restore…
        </button>
        <input ref={restoreRef} type="file" accept="application/json,.json" hidden onChange={onRestore} />
      </div>

      {students.length > 0 && (
        <>
          <div className="settings-row" style={{ marginTop: 18 }}>
            <span><strong>One student’s study pack</strong></span>
          </div>
          <p className="hint">
            Just that student’s openings, with your own settings and other students left out.
            Superseded by <strong>Send</strong> in Coaches Corner, which needs no file at all —
            keep this for a student who isn’t signed in.
          </p>
          <div className="settings-row">
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button
              disabled={!studentId}
              onClick={() => {
                const student = students.find((s) => s.id === studentId);
                const pack = studyPack(state, student);
                if (pack.openings.length === 0) {
                  setError(`${student.name} has no openings yet.`);
                  return;
                }
                save(pack);
              }}
            >
              <DownloadIcon size={15} /> Save pack
            </button>
            <button disabled={!studentId} onClick={() => packRef.current?.click()}>
              <UploadIcon size={15} /> Load pack…
            </button>
            <input ref={packRef} type="file" accept="application/json,.json" hidden onChange={onPack} />
          </div>
        </>
      )}

      {restoring && (
        <div className="modal-overlay" onClick={() => setRestoring(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {restoring.parsed.kind === 'study-pack'
                ? 'Add this study pack?'
                : (restoring.parsed.kind === 'progress' ? 'Restore this progress file?' : 'Restore this backup?')}
            </h3>
            {/* A pack from a coach was exported without an owner, so it arrives
                as this person's own repertoire rather than filed under a coach
                or a student who doesn't exist on this device. */}
            {restoring.parsed.kind === 'study-pack' ? (
              <p className="hint">
                Study material{restoring.parsed.preparedFor ? ` prepared for ${restoring.parsed.preparedFor}` : ''} by
                a coach. It goes straight into <strong>your own library</strong> alongside anything
                already there — nothing here is removed, and progress you’ve made stays as it is.
              </p>
            ) : restoring.parsed.kind === 'progress' ? (
              <p className="hint">
                A one-course progress update — merges straight into whatever’s already here.
                Anything learned on either side stays learned; nothing else on this device is touched.
              </p>
            ) : (
              <p className="hint">
                <strong>Merge</strong> keeps whatever’s already on this device too — a line learned
                or practiced on either side stays learned, and nothing here gets deleted just because
                the file doesn’t have it. <strong>Replace everything</strong> wipes this device
                first, so anything you’ve done here since your last backup is lost.
              </p>
            )}
            <div className="gi-grid" style={{ marginBottom: 12 }}>
              <div><span>Openings</span><strong>{restoring.parsed.openings.length}</strong></div>
              <div><span>Variations</span><strong>{restoring.summary.variations}</strong></div>
              <div><span>Players</span><strong>{restoring.summary.players}</strong></div>
              <div><span>Games</span><strong>{restoring.summary.games}</strong></div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setRestoring(null)}>Cancel</button>
              {restoring.parsed.kind !== 'progress' && (
                <button
                  className="ghost danger"
                  title="Discards anything on this device the file doesn't already have, including progress"
                  onClick={() => {
                    dispatch({ type: 'hydrate', state: restoring.parsed });
                    setRestoring(null);
                    setNote('Replaced everything on this device.');
                  }}
                >
                  Replace everything
                </button>
              )}
              <button
                className="primary"
                title="Combines the file with what's already here, keeping progress from both sides"
                onClick={() => {
                  dispatch({ type: 'hydrate', state: mergeBackup(state, restoring.parsed) });
                  setRestoring(null);
                  setNote('Merged in — progress from both sides was kept.');
                }}
              >
                Merge
              </button>
            </div>
          </div>
        </div>
      )}

      {note && <p className="hint" style={{ color: 'var(--green)' }}>{note}</p>}
      {error && <p className="hint" style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="settings-row" style={{ marginTop: 22 }}>
        <span><strong>Start over</strong></span>
      </div>
      <p className="hint">
        Erases every opening, game and piece of progress on this device. If you’re signed in, the
        next sync will bring back whatever is in your account — sign out first if you mean to
        clear this device for good.
      </p>
      <div className="settings-row">
        <button
          className="ghost danger"
          onClick={() => {
            if (window.confirm(
              'Erase ALL openings, games and progress on this device?\n\n'
              + 'This cannot be undone — take a Backup first if you might want it back.',
            )) {
              dispatch({ type: 'hydrate', state: { ...emptyState(), settings: state.settings } });
              setNote('Cleared.');
            }
          }}
        >
          Reset this device
        </button>
      </div>
    </>
  );
}
