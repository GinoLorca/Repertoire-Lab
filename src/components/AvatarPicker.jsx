import React, { useRef, useState } from 'react';
import { MONSTERS } from '../lib/monsters';
import { processPhoto } from '../lib/avatar';
import { useBackGuard } from '../lib/backGuard';
import { UploadIcon, AlertIcon } from './Icons';
import MonsterAvatar from './MonsterAvatar';

// The cast of monsters, plus a drop-a-photo option — picking either calls
// onPick and closes.
export default function AvatarPicker({ current, onPick, onClose }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drop, setDrop] = useState(false);
  const fileRef = useRef(null);
  useBackGuard(true, onClose);

  const onFile = async (file) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const data = await processPhoto(file);
      onPick({ kind: 'photo', data });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal avatar-picker" onClick={(e) => e.stopPropagation()}>
        <h3>Choose an avatar</h3>
        <div className="avatar-grid">
          {MONSTERS.map((m) => (
            <button
              key={m.id}
              className={`avatar-choice${current?.kind === 'monster' && current.variant === m.id ? ' active' : ''}`}
              title={m.name}
              onClick={() => { onPick({ kind: 'monster', variant: m.id }); onClose(); }}
            >
              <MonsterAvatar variant={m.id} size={56} />
            </button>
          ))}
        </div>

        <p className="hint" style={{ marginTop: 2 }}>…or upload a real photo instead</p>
        <div
          className={`dropzone${drop ? ' over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrop(true); }}
          onDragLeave={() => setDrop(false)}
          onDrop={(e) => { e.preventDefault(); setDrop(false); onFile(e.dataTransfer.files?.[0]); }}
        >
          <UploadIcon size={18} />
          <strong>{busy ? 'Processing…' : 'Choose a photo'}</strong>
          <span className="muted-note">or drop one here — any shape, it's cropped to a square</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            hidden
            onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }}
          />
        </div>
        {error && <div className="import-warn"><AlertIcon size={14} /> {error}</div>}

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
