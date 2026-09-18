import React, { useEffect, useState } from 'react';
import { useCloud } from '../lib/cloud/useCloud';
import { signIn, signUp, sendReset, authMessage } from '../lib/cloud/auth';
import { claimScreenName, loadProfile, screenNameProblem } from '../lib/cloud/profile';

const when = (ms) => {
  if (!ms) return 'never';
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  return new Date(ms).toLocaleString();
};

// Signing in, the screen name other people send lines to, and the state of
// sync. Everything cloud-shaped lives here so the rest of the app can carry
// on knowing nothing about it.
export default function AccountSection() {
  const {
    configured, ready, user, status, detail, lastSync, sync, signOut,
  } = useCloud();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('student');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!user) { setProfile(null); return; }
    loadProfile(user.uid).then((p) => {
      setProfile(p);
      setName(p?.screenName ?? '');
      setRole(p?.role ?? 'student');
    }).catch(() => {});
  }, [user]);

  if (!configured) {
    return (
      <p className="hint">
        Sync isn’t switched on for this build. It needs a Firebase project’s keys in the
        environment — see <code>.env.example</code> — and then this is where you’d sign in.
        Everything works without it; your repertoire just stays on this device, with
        Backup and Restore to move it.
      </p>
    );
  }

  if (!ready) return <p className="hint">Checking…</p>;

  // Two buttons, two actions — rather than one button whose meaning depends on
  // a mode you set earlier. Someone arriving for the first time shouldn't have
  // to find the toggle before they can register.
  const submit = async (action) => {
    setBusy(true); setError(null); setNote(null);
    try {
      if (action === 'up') await signUp(email, password);
      else await signIn(email, password);
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(null); setNote(null);
    if (!email.trim()) { setError('Enter your email first, then press this again.'); return; }
    try {
      await sendReset(email);
      setNote(`Sent a reset link to ${email.trim()}.`);
    } catch (err) { setError(authMessage(err)); }
  };

  const saveName = async () => {
    const problem = screenNameProblem(name);
    if (problem) { setError(problem); return; }
    setSavingName(true); setError(null); setNote(null);
    try {
      const saved = await claimScreenName(user.uid, name, { role });
      setProfile(saved);
      setNote(`You’re “${saved.screenName}”. That’s what a coach types to send you lines.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingName(false);
    }
  };

  if (!user) {
    return (
      <>
        <p className="hint">
          Sign in on every device you use and they keep each other up to date — openings, lines,
          and how far along you are on each. Learn a variation on one and it’s on the others next
          time you open them.
        </p>
        <form
          className="account-form"
          onSubmit={(e) => { e.preventDefault(); submit('in'); }}
        >
          <label className="field-row">
            <span>Email</span>
            <input
              type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            />
          </label>
          <label className="field-row">
            <span>Password</span>
            <input
              type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters"
            />
          </label>
          {error && <p className="hint" style={{ color: 'var(--red)' }}>{error}</p>}
          {note && <p className="hint" style={{ color: 'var(--green)' }}>{note}</p>}
          <div className="settings-row">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Working…' : 'Sign in'}
            </button>
            <button type="button" disabled={busy} onClick={() => submit('up')}>
              Create account
            </button>
            <button type="button" className="small ghost" onClick={reset}>Forgot password</button>
          </div>
          <p className="hint">
            New here? Fill in an email and password, then <strong>Create account</strong>.
          </p>
        </form>
      </>
    );
  }

  return (
    <>
      <div className="settings-row">
        <span><strong>Signed in</strong> as {user.email}</span>
      </div>

      <div className="settings-row">
        <span className="muted-note">
          Last sync: {when(lastSync)}
          {status === 'syncing' && ` · ${detail ?? 'syncing…'}`}
          {status === 'idle' && detail && ` · ${detail}`}
        </span>
      </div>
      {status === 'error' && <p className="hint" style={{ color: 'var(--red)' }}>{detail}</p>}

      <div className="settings-row">
        <button onClick={sync} disabled={status === 'syncing'}>
          {status === 'syncing' ? 'Syncing…' : 'Sync now'}
        </button>
        <button className="small ghost danger" onClick={signOut}>Sign out</button>
      </div>

      <div className="settings-row" style={{ marginTop: 18 }}>
        <span><strong>Screen name</strong></span>
      </div>
      <p className="hint">
        How other people in the app find you. A coach sends new openings and lines to a screen
        name — no files, no email. Yours is{' '}
        {profile?.screenName ? <strong>{profile.screenName}</strong> : <em>not set yet</em>}.
      </p>
      <div className="settings-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. wavy-coach"
          style={{ maxWidth: 260 }}
        />
        <button onClick={saveName} disabled={savingName}>
          {savingName ? 'Saving…' : (profile?.screenName ? 'Change name' : 'Claim name')}
        </button>
      </div>
      <div className="theme-choices" style={{ marginTop: 10 }}>
        {[
          ['coach', 'Coach', 'You send openings and lines to students'],
          ['student', 'Student', 'You receive them'],
        ].map(([value, label, hint]) => (
          <button
            key={value}
            className={`theme-card${role === value ? ' active' : ''}`}
            onClick={() => setRole(value)}
          >
            <strong>{label}</strong>
            <span className="muted-note">{hint}</span>
          </button>
        ))}
      </div>
      <p className="hint">
        Pick one and save the name to record it. It only changes what the app offers you —
        a coach gets a Send button, a student gets the bell. Either can do both.
      </p>
      {error && <p className="hint" style={{ color: 'var(--red)' }}>{error}</p>}
      {note && <p className="hint" style={{ color: 'var(--green)' }}>{note}</p>}
    </>
  );
}
