import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hasShareSheet, lineMessage, shareMessage } from '../lib/shareLine';
import { copyText } from '../lib/clipboard';

// Sharing one repertoire line (lib/shareLine.js), in one tap: the device's
// share sheet with the line's name, moves and a Lichess link — or, where
// there's no share sheet (most desktop browsers), the same message copied,
// ready to paste. `share(opening, variation)` from the tap itself, and
// `ui` rendered somewhere for the word on how it went.
export function useShareLine() {
  const [toast, setToast] = useState(null);
  const [byHand, setByHand] = useState(null); // the message, when it couldn't be copied for you
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const copy = (text) => copyText(text).then((ok) => {
    if (ok) setToast('Copied: the moves and a Lichess link, ready to paste.');
    else setByHand(text);
  });
  const share = (opening, variation) => {
    const text = lineMessage(opening, variation);
    if (!hasShareSheet()) { copy(text); return; }
    shareMessage(text).then((how) => { if (how === 'failed') copy(text); });
  };

  const ui = (
    <>
      {toast && createPortal(
        <div className="coach-toast share-toast" role="status">
          <span>{toast}</span>
          <button type="button" className="small ghost" onClick={() => setToast(null)}>OK</button>
        </div>,
        document.body,
      )}
      {byHand && <CopyByHand text={byHand} onClose={() => setByHand(null)} />}
    </>
  );
  return { share, ui };
}

// Where the clipboard is out of reach (some in-app browsers): the message,
// selected, to copy by hand.
function CopyByHand({ text, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal share-by-hand" onClick={(e) => e.stopPropagation()}>
        <h3>Copy the line</h3>
        <p className="hint">This browser wouldn’t copy it for you — select it all and copy.</p>
        <textarea ref={ref} readOnly value={text} rows={10} />
        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
