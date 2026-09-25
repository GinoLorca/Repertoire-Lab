import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackGuard } from '../lib/backGuard';

// The "⋯" button on a phone, and the sheet it opens.
//
// A phone can't fit a card's dozen edit controls as a strip of tiny icons and
// still be usable, so on a phone each card shows one of these instead and
// every secondary action lives in the sheet behind it — rename, themes,
// artwork, import, export, move up / down, delete — as full-height rows a
// thumb can actually hit. It slides up from the bottom, where the thumb
// already is, rather than popping open under the button.
//
// `items` is a list of { label, onClick, icon?, hint?, disabled?, danger? },
// with { sep: true } for a divider between groups; false/null entries are
// skipped, so callers can list conditional actions inline.
// Portaled to <body>: with a custom background on, ancestors carry a
// backdrop-filter, which would pin a `fixed` sheet to the card instead of
// the screen.
export default function MoreMenu({ items, title, label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  useBackGuard(open, () => setOpen(false));
  // Dividers only between real rows: a conditional action falling away can
  // leave two in a row, or one at either end.
  const rows = items.filter(Boolean).filter((item, i, all) => {
    if (!item.sep) return true;
    const prev = all.slice(0, i).reverse().find((x) => !x.sep);
    const next = all.slice(i + 1).find((x) => !x.sep);
    const prevIsSep = all[i - 1]?.sep;
    return prev && next && !prevIsSep;
  });
  return (
    <>
      <button
        type="button"
        className="more-btn"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle cx="5" cy="12" r="2" fill="currentColor" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="19" cy="12" r="2" fill="currentColor" />
        </svg>
      </button>
      {open && createPortal(
        <div className="sheet-scrim" onClick={() => setOpen(false)}>
          <div className="sheet" role="menu" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" aria-hidden="true" />
            {title && <div className="sheet-title">{title}</div>}
            <div className="sheet-rows">
              {rows.map((item, i) => (item.sep ? (
                <div key={`sep-${i}`} className="sheet-sep" role="separator" />
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={`sheet-row${item.danger ? ' danger' : ''}`}
                  disabled={item.disabled}
                  onClick={() => { setOpen(false); item.onClick(); }}
                >
                  <span className="sheet-icon">{item.icon}</span>
                  <span className="sheet-label">
                    {item.label}
                    {item.hint && <span className="sheet-hint">{item.hint}</span>}
                  </span>
                </button>
              )))}
            </div>
            <button type="button" className="sheet-cancel" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
