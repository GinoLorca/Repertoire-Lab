import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MenuSheet } from './MoreMenu';
import { ShareIcon, ClipboardIcon, DownloadIcon, LinkIcon } from './Icons';
import {
  linePgn, hasShareSheet, sharePgn, lichessUrl,
} from '../lib/shareLine';
import { downloadText } from '../lib/pgn';
import { copyText } from '../lib/clipboard';

// Sharing one repertoire line (lib/shareLine.js): a menu of the ways — the
// device's share sheet where there is one, Copy PGN, Download .pgn, Open in
// Lichess — then a word on how it went. Given `at`, it opens as a small menu
// there (under the button that opened it); without, as the sheet from the
// bottom, as on a phone. `onDone` when it's all over.
export default function ShareLine({
  opening, chapter, variation, at = null, onDone,
}) {
  const [menu, setMenu] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [byHand, setByHand] = useState(null); // the PGN, when it couldn't be copied for you
  const item = linePgn(opening, chapter, variation);

  useEffect(() => {
    if (!menu && !busy && !toast && !byHand) onDone();
  }, [menu, busy, toast, byHand]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const items = [
    hasShareSheet() && {
      label: 'Share…',
      hint: 'Messages, Mail, AirDrop, Files — as a .pgn file',
      icon: <ShareIcon size={16} />,
      onClick: () => {
        setBusy(true);
        sharePgn(item).then((how) => {
          setBusy(false);
          if (how === 'failed') setToast('The share sheet didn’t open — Copy PGN or Download .pgn instead.');
        });
      },
    },
    {
      label: 'Copy PGN',
      hint: 'to paste into Lichess, ChessBase, a message or an email',
      icon: <ClipboardIcon size={16} />,
      onClick: () => {
        setBusy(true);
        copyText(item.pgn).then((ok) => {
          setBusy(false);
          if (ok) setToast('PGN copied.');
          else setByHand(item.pgn);
        });
      },
    },
    {
      label: 'Download .pgn',
      hint: item.filename,
      icon: <DownloadIcon size={16} />,
      onClick: () => downloadText(item.filename, item.pgn),
    },
    {
      label: 'Open in Lichess',
      hint: 'on its analysis board — a link anyone can open',
      icon: <LinkIcon size={16} />,
      onClick: () => window.open(lichessUrl(opening, variation), '_blank', 'noopener'),
    },
  ];

  return (
    <>
      {menu && (
        <MenuSheet
          items={items}
          title={`Share “${variation.name}”`}
          at={at}
          onClose={() => setMenu(false)}
        />
      )}
      {toast && createPortal(
        <div className="coach-toast share-toast" role="status">
          <span>{toast}</span>
          <button type="button" className="small ghost" onClick={() => setToast(null)}>OK</button>
        </div>,
        document.body,
      )}
      {byHand && <CopyByHand pgn={byHand} onClose={() => setByHand(null)} />}
    </>
  );
}

// Where the clipboard is out of reach (some in-app browsers): the PGN,
// selected, to copy by hand.
function CopyByHand({ pgn, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal share-by-hand" onClick={(e) => e.stopPropagation()}>
        <h3>Copy the PGN</h3>
        <p className="hint">This browser wouldn’t copy it for you — select it all and copy.</p>
        <textarea ref={ref} readOnly value={pgn} rows={10} />
        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
