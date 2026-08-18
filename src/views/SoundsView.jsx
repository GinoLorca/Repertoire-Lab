import React, { useRef, useState } from 'react';
import { useStore } from '../store';
import {
  SOUND_EVENTS, DEFAULT_SOUNDS, playMoveSound, playEventSound,
} from '../lib/sound';
import { SoundOnIcon, SoundOffIcon, VolumeIcon } from '../components/Icons';

const MAX_BYTES = 1.5 * 1024 * 1024;

// iOS greys out files in the Files app when `accept` only lists MIME types it
// can't match, so spell out the extensions too.
const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.aiff,.aif,.caf,.ogg,.oga,.opus,.flac';
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aiff?|caf|ogg|oga|opus|flac)$/i;

const SAMPLE_SAN = {
  move: 'e4', capture: 'Bxf7', castle: 'O-O', check: 'Qh5+', checkmate: 'Qxf7#',
};

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

// `bare` drops the section's own heading, for when Settings already provides
// one (it groups everything under collapsible headings).
export default function SoundsSection({ bare }) {
  const { state, dispatch } = useStore();
  const sounds = state.settings.customSounds ?? {};
  const soundOn = state.settings.soundEnabled ?? true;
  const volume = state.settings.volume ?? 1;
  const [error, setError] = useState(null);
  const inputs = useRef({});

  const setSound = (key, value) => {
    const next = { ...sounds };
    if (value) next[key] = value;
    else delete next[key];
    dispatch({ type: 'setSettings', settings: { customSounds: next } });
  };

  const onFile = async (key, file) => {
    setError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep sounds under 1.5 MB.`);
      return;
    }
    // iOS often reports an empty type; trust the extension in that case.
    const looksAudio = (file.type && file.type.startsWith('audio/')) || AUDIO_EXT.test(file.name || '');
    if (!looksAudio) {
      setError(`"${file.name}" doesn't look like an audio file (use MP3, M4A, WAV or OGG).`);
      return;
    }
    try {
      setSound(key, await readAsDataUrl(file));
    } catch (err) {
      setError(err.message);
    }
  };

  const preview = (key) => {
    if (SAMPLE_SAN[key]) playMoveSound(SAMPLE_SAN[key]);
    else playEventSound(key);
  };

  const totalKB = Math.round(
    Object.values(sounds).reduce((a, s) => a + s.length * 0.75, 0) / 1024,
  );

  return (
    <div className={bare ? '' : 'settings-section'}>
      <div className="page-head">
        {!bare && <h2>Sounds</h2>}
        <button
          className={soundOn ? '' : 'primary'}
          onClick={() => dispatch({ type: 'setSettings', settings: { soundEnabled: !soundOn } })}
        >
          {soundOn ? <><SoundOnIcon size={15} /> Sound is on</> : <><SoundOffIcon size={15} /> Sound is off</>}
        </button>
      </div>

      <div className="volume-row">
        <span className="vol-icon"><VolumeIcon size={16} /></span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(volume * 100)}
          onChange={(e) => dispatch({
            type: 'setSettings', settings: { volume: Number(e.target.value) / 100 },
          })}
          onMouseUp={() => playMoveSound('e4')}
          onTouchEnd={() => playMoveSound('e4')}
        />
        <span className="vol-value">{Math.round(volume * 100)}%</span>
        <button className="small" onClick={() => playMoveSound('e4')}>▶ Test</button>
      </div>

      <p style={{ color: 'var(--muted)' }}>
        Replace any sound with your own audio file — MP3, M4A, WAV or OGG, under 1.5 MB each.
        Anything you leave empty uses the built-in sound. Files are stored on this device only,
        and travel with your Backup file.
      </p>

      {error && (
        <div className="status-line" style={{ marginBottom: 12 }}>
          <span className="status-bad">✗ {error}</span>
        </div>
      )}

      <div className="sound-list">
        {SOUND_EVENTS.map(({ key, label, hint }) => {
          const custom = sounds[key];
          return (
            <div key={key} className="sound-row">
              <div className="sound-info">
                <strong>{label}</strong>
                <span className="muted-note">{hint}</span>
              </div>
              <span className={`sound-tag ${custom ? 'custom' : ''}`}>
                {/* Built-in covers both a real shipped recording and (castle
                    only) the synthesized fallback — either way, something
                    plays without you uploading anything. */}
                {custom ? 'Custom' : ((DEFAULT_SOUNDS[key] || key in SAMPLE_SAN) ? 'Built-in' : 'Silent')}
              </span>
              <button className="small" onClick={() => preview(key)}>▶ Play</button>
              <button className="small" onClick={() => inputs.current[key]?.click()}>
                {custom ? 'Replace…' : 'Upload…'}
              </button>
              {custom && (
                <button className="small ghost danger" onClick={() => setSound(key, null)}>Remove</button>
              )}
              <input
                ref={(el) => { inputs.current[key] = el; }}
                type="file"
                accept={AUDIO_ACCEPT}
                hidden
                onChange={(e) => { onFile(key, e.target.files[0]); e.target.value = ''; }}
              />
            </div>
          );
        })}
      </div>

      {Object.keys(sounds).length > 0 && (
        <div className="settings-row" style={{ marginTop: 16 }}>
          <span className="muted-note">{Object.keys(sounds).length} custom sound(s) · about {totalKB} KB</span>
          <span style={{ flex: 1 }} />
          <button
            className="ghost danger"
            onClick={() => {
              if (window.confirm('Remove all custom sounds and go back to the built-in ones?')) {
                dispatch({ type: 'setSettings', settings: { customSounds: {} } });
              }
            }}
          >
            Reset all to built-in
          </button>
        </div>
      )}
    </div>
  );
}
