import React, { useRef, useState } from 'react';
import { processScoresheetPhoto } from '../lib/scoresheet';
import { useBackGuard } from '../lib/backGuard';
import { CameraIcon, UploadIcon, AlertIcon } from './Icons';

// A thumbnail of a game's scoresheet photo, click to enlarge — or, with none
// attached yet, a button to add one straight from the camera. Purely a
// picture for reference; there's no OCR here (that's the separate, still
// unreliable, Import -> Scoresheet photo flow).
export default function ScoresheetPhoto({ photo, onChange }) {
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  useBackGuard(viewing, () => setViewing(false));

  const onFile = async (file) => {
    if (!file) return;
    setError(null);
    try {
      onChange(await processScoresheetPhoto(file));
    } catch (err) {
      setError(err.message);
    }
  };

  const stop = (e) => e.stopPropagation();

  return (
    <>
      {photo ? (
        <button
          className="scoresheet-thumb"
          title="View the scoresheet photo"
          onClick={(e) => { stop(e); setViewing(true); }}
        >
          <img src={photo} alt="Scoresheet" />
        </button>
      ) : (
        <button
          className="small ghost"
          title="Attach a photo of the scoresheet"
          onClick={(e) => { stop(e); inputRef.current?.click(); }}
        >
          <CameraIcon size={14} /> Photo
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onClick={stop}
        onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }}
      />
      {error && (
        <span className="import-warn" onClick={stop}><AlertIcon size={12} /> {error}</span>
      )}
      {viewing && (
        <div className="modal-overlay" onClick={(e) => { stop(e); setViewing(false); }}>
          <div className="modal scoresheet-modal" onClick={stop}>
            <img src={photo} alt="Scoresheet" />
            <div className="modal-actions">
              <button className="ghost" onClick={(e) => { stop(e); inputRef.current?.click(); }}>
                <UploadIcon size={14} /> Replace
              </button>
              <button
                className="ghost danger"
                onClick={(e) => { stop(e); onChange(null); setViewing(false); }}
              >
                Remove
              </button>
              <span style={{ flex: 1 }} />
              <button className="primary" onClick={(e) => { stop(e); setViewing(false); }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
