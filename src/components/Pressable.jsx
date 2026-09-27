import React from 'react';
import { useLongPress } from './useLongPress';

// A <div> that opens a menu on a long press or a right-click — see
// useLongPress. A component so it can be used for each row of a list.
// Pointer handlers passed in (a card that can also be dragged) run as well
// as the long press's own, not instead of them.
export default function Pressable({ onMenu, disabled = false, children, ...rest }) {
  const handlers = useLongPress(onMenu, { disabled });
  const merged = { ...rest };
  for (const [name, fn] of Object.entries(handlers)) {
    const theirs = rest[name];
    merged[name] = theirs ? (e) => { theirs(e); fn(e); } : fn;
  }
  return <div {...merged}>{children}</div>;
}
