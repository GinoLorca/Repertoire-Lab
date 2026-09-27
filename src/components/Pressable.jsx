import React from 'react';
import { useLongPress } from './useLongPress';

// A <div> that opens a menu on a long press or a right-click — see
// useLongPress. A component so it can be used for each row of a list.
export default function Pressable({ onMenu, disabled = false, children, ...rest }) {
  const handlers = useLongPress(onMenu, { disabled });
  return <div {...rest} {...handlers}>{children}</div>;
}
