import React, {
  useEffect, useLayoutEffect, useRef, useState,
} from 'react';
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
      {open && <MenuSheet items={items} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

// The menu itself, for opening some other way than the ⋯ button — a long
// press on a phone or tablet, a right-click on a computer. Given `at` (where
// the pointer was), it opens there as a small pop-up menu, the way a
// right-click menu does; without it, it's the sheet from the bottom.
export function MenuSheet({ items, title, onClose, at = null }) {
  useBackGuard(true, onClose);
  const popRef = useRef(null);
  const [pos, setPos] = useState(at);
  // Kept on screen: a right-click near the bottom or right edge opens the
  // menu up and to the left of the pointer instead.
  useLayoutEffect(() => {
    if (!at || !popRef.current) return;
    const box = popRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(at.x, window.innerWidth - box.width - 8));
    const y = at.y + box.height > window.innerHeight - 8 ? Math.max(8, at.y - box.height) : at.y;
    if (x !== at.x || y !== at.y) setPos({ x, y });
  }, [at]);
  useEffect(() => {
    if (!at) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, onClose]);
  // Dividers only between real rows: a conditional action falling away can
  // leave two in a row, or one at either end.
  const rows = items.filter(Boolean).filter((item, i, all) => {
    if (!item.sep) return true;
    const prev = all.slice(0, i).reverse().find((x) => !x.sep);
    const next = all.slice(i + 1).find((x) => !x.sep);
    const prevIsSep = all[i - 1]?.sep;
    return prev && next && !prevIsSep;
  });
  const list = rows.map((item, i) => (item.sep ? (
    <div key={`sep-${i}`} className="sheet-sep" role="separator" />
  ) : (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      className={`sheet-row${item.danger ? ' danger' : ''}`}
      disabled={item.disabled}
      onClick={() => { onClose(); item.onClick(); }}
    >
      <span className="sheet-icon">{item.icon}</span>
      <span className="sheet-label">
        {item.label}
        {item.hint && <span className="sheet-hint">{item.hint}</span>}
      </span>
    </button>
  )));
  // Portaled to <body>, but React still hands its events up to whatever
  // opened it — a Library chapter card opens its chapter on a click. None of
  // them are meant for that.
  const own = { onPointerDown: (e) => e.stopPropagation() };
  if (at) {
    return createPortal(
      <div
        className="menu-pop-scrim"
        {...own}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      >
        <div
          ref={popRef}
          className="menu-pop"
          role="menu"
          style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {title && <div className="menu-pop-title">{title}</div>}
          {list}
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div
      className="sheet-scrim"
      {...own}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="sheet" role="menu" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        {title && <div className="sheet-title">{title}</div>}
        <div className="sheet-rows">{list}</div>
        <button type="button" className="sheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>,
    document.body,
  );
}
