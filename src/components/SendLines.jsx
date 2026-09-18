import React, { useState } from 'react';
import { findByScreenName } from '../lib/cloud/profile';
import { sendLines, describePayload, deliveryPayload } from '../lib/cloud/share';

// The coach's half: type a student's screen name, say what this is about,
// send. No file, no export, no email.
export default function SendLines({ openings, from, onClose }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [found, setFound] = useState(null);
  const [state, setState] = useState('idle'); // idle | looking | ready | sending | sent
  const [error, setError] = useState(null);

  const summary = describePayload(deliveryPayload(openings));

  const look = async () => {
    setError(null); setFound(null);
    if (!name.trim()) { setError('Type their screen name.'); return; }
    setState('looking');
    try {
      const who = await findByScreenName(name);
      if (!who) {
        setError(`No one is using “${name.trim()}”. Check the spelling with them — it’s the name in their Settings → Account.`);
        setState('idle');
        return;
      }
      if (who.uid === from.uid) {
        setError('That’s you.');
        setState('idle');
        return;
      }
      setFound(who);
      setState('ready');
    } catch (err) {
      setError(err.message);
      setState('idle');
    }
  };

  const send = async () => {
    setState('sending'); setError(null);
    try {
      await sendLines({ to: found, from, openings, message });
      setState('sent');
    } catch (err) {
      setError(err.message);
      setState('ready');
    }
  };

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="page-head"><h2>Send to a student</h2></div>

        {state === 'sent' ? (
          <>
            <p className="hint">
              Sent to <strong>{found.name}</strong>. It’s waiting under their bell — they’ll see it
              next time they open the app, on whichever device they use.
            </p>
            <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            <p className="hint">
              Sending <strong>{summary}</strong>. Their own progress on anything they already have
              is left alone — new lines arrive unlearned, and corrections to a line they’re working
              on don’t reset it.
            </p>

            <div className="settings-row">
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setState('idle'); setFound(null); }}
                placeholder="Their screen name"
                style={{ maxWidth: 240 }}
              />
              <button onClick={look} disabled={state === 'looking'}>
                {state === 'looking' ? 'Looking…' : 'Find'}
              </button>
            </div>

            {found && (
              <p className="hint" style={{ color: 'var(--green)' }}>
                Found <strong>{found.name}</strong>{found.role ? ` · ${found.role}` : ''}.
              </p>
            )}
            {error && <p className="hint" style={{ color: 'var(--red)' }}>{error}</p>}

            <label className="field-row" style={{ marginTop: 10 }}>
              <span>Message <span className="muted-note">(what this update is about)</span></span>
              <textarea
                rows={3}
                value={message}
                maxLength={500}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="e.g. Here's the Jobava line we looked at — drill the 4.Nb5 sideline before Saturday."
              />
            </label>

            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={!found || state === 'sending'} onClick={send}>
                {state === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
