import { useSyncExternalStore } from 'react';
import { pressedOn, subscribePressed } from './pressed';

// The square being pressed on board `id` (lib/pressed), or null — and null
// for no id, so a part that doesn't want it doesn't redraw for it.
const none = () => null;
export function usePressed(id) {
  return useSyncExternalStore(subscribePressed, id == null ? none : () => pressedOn(id), none);
}
