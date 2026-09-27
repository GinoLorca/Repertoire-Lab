import { useRef } from 'react';

// Press and hold with a finger, or right-click with a mouse, to open a menu.
//
// iPhone and iPad Safari never send a right-click (contextmenu) for a long
// press on something that isn't a link or an image, so a touch is timed
// here. A mouse or trackpad uses the ordinary right-click. The tap that ends
// a long press doesn't also count as a tap on whatever was under the finger —
// a long press on a line's moves opens the menu, not the board.
//
// Handlers go on the element; `onOpen` gets where it happened, { x, y }, for
// a right-click, and null for a long press (a phone's menu is the sheet from
// the bottom rather than a pop-up under the finger).
const HOLD_MS = 500;
const SLOP = 10; // px a finger may drift and still be holding still

export function useLongPress(onOpen, { disabled = false } = {}) {
  const press = useRef(null); // { timer, x, y }
  const fired = useRef(false);

  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  if (disabled) return {};
  return {
    onPointerDown: (e) => {
      fired.current = false;
      // Only presses on the element itself: a dialog or menu it opened is
      // portaled elsewhere in the page, but React still passes its events up.
      if (!e.currentTarget.contains(e.target)) return;
      if (e.pointerType === 'mouse') return;
      // A second finger resting on a card while another card is dragged.
      if (document.body.classList.contains('card-dragging')) return;
      // A long press on a checkbox or a text box is theirs.
      if (e.target.closest('input, textarea, select')) return;
      cancel();
      press.current = {
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => {
          press.current = null;
          fired.current = true;
          navigator.vibrate?.(10);
          onOpen(null);
        }, HOLD_MS),
      };
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu: (e) => {
      if (!e.currentTarget.contains(e.target)) return;
      if (e.target.closest('input, textarea, select')) return;
      e.preventDefault();
      // Android sends a contextmenu for a long press too; the timer has
      // already opened the menu by then.
      if (fired.current || e.pointerType === 'touch') return;
      cancel();
      onOpen({ x: e.clientX, y: e.clientY });
    },
  };
}
