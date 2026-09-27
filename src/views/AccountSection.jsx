import React, { useEffect, useState } from 'react';
import { useCloud } from '../lib/cloud/useCloud';
import { BUILD, watchDevices } from '../lib/cloud/devices';
import { signIn, signUp, sendReset, authMessage } from '../lib/cloud/auth';
import {
  claimScreenName, loadProfile, screenNameProblem, setRealName,
} from '../lib/cloud/profile';

const when = (ms) => {
  if (!ms) return 'never';
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  return new Date(ms).toLocaleString();
};

// Signing in, the account name other people send lines to, and the state of
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
  const [realName, setRealNameText] = useState('');
  const [savingReal, setSavingReal] = useState(false);

  useEffect(() => {
    if (!user) { setProfile(null); return; }
    loadProfile(user.uid).then((p) => {
      setProfile(p);
      setName(p?.screenName ?? '');
      setRealNameText(p?.realName ?? '');
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

  const saveRealName = async () => {
    setSavingReal(true); setError(null); setNote(null);
    try {
      await setRealName(user.uid, realName);
      setProfile((p) => ({ ...(p ?? {}), realName: realName.trim() }));
      setNote(realName.trim()
        ? 'Saved. A coach linked to your account sees this name instead of your account name.'
        : 'Removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingReal(false);
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

      <YourDevices uid={user.uid} />

      <div className="settings-row" style={{ marginTop: 18 }}>
        <span><strong>Account name</strong></span>
      </div>
      <p className="hint">
        How other people in the app find you. A coach sends new openings and lines to an account
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
      <div className="settings-row" style={{ marginTop: 18 }}>
        <span><strong>Your real name</strong></span>
      </div>
      <p className="hint">
        Optional. Your account name stays what people type to find you; this is what a coach you're
        linked with sees on their card for you. Only you and coaches linked to your account can see it.
      </p>
      <div className="settings-row">
        <input
          value={realName}
          onChange={(e) => setRealNameText(e.target.value)}
          placeholder="Your first and last name"
          style={{ maxWidth: 260 }}
        />
        <button onClick={saveRealName} disabled={savingReal || realName.trim() === (profile?.realName ?? '')}>
          {savingReal ? 'Saving…' : 'Save'}
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

const version = (iso) => (iso
  ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : 'an older version');

// Every device syncing this account, its version of the app and its last
// sync. A device behind this one is flagged: it keeps running the code it
// last loaded until it reloads, and old code can undo newer devices' work.
function YourDevices({ uid }) {
  const [devices, setDevices] = useState(null);
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    watchDevices(uid, setDevices).then((fn) => { if (cancelled) fn(); else stop = fn; });
    return () => { cancelled = true; stop(); };
  }, [uid]);
  const list = [...(devices ?? [])].sort((a, b) => (b.me - a.me) || ((b.lastSync ?? 0) - (a.lastSync ?? 0)));
  return (
    <div style={{ marginTop: 18 }}>
      <div className="settings-row"><span><strong>Your devices</strong></span></div>
      <p className="hint">
        This one runs the version from {version(BUILD)}. A device marked <em>older version</em> hasn’t
        loaded the latest app yet: open it, then close it fully (swipe it away) and open it again.
      </p>
      {devices === null && <p className="muted-note">Checking…</p>}
      {list.length > 0 && (
        <ul className="device-list">
          {list.map((d) => {
            const behind = BUILD && (!d.build || d.build < BUILD);
            return (
              <li key={d.id}>
                <strong>{d.me ? 'This device' : d.name}</strong>
                {d.me && <span className="muted-note"> ({d.name})</span>}
                <span className="muted-note">
                  {' · '}version {version(d.build)} · synced {when(d.lastSync)}
                </span>
                {behind && !d.me && <span className="link-pill bad" style={{ marginLeft: 6 }}>older version</span>}
              </li>
            );
          })}
        </ul>
      )}
      {devices && devices.length < 2 && (
        <p className="muted-note">Other devices appear here once they’ve synced with this version of the app.</p>
      )}
    </div>
  );
}

