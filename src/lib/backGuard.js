import { useEffect, useRef } from 'react';

// Anything covering the page — a modal, an editor, the search panel — registers
// here while it's open. The phone's back gesture then closes the top one
// instead of navigating away and throwing away the work inside it.
const stack = [];

export function runTopGuard() {
  const guard = stack[stack.length - 1];
  if (!guard) return false;
  guard();
  return true;
}

export function hasGuard() {
  return stack.length > 0;
}

export function useBackGuard(active, onBack) {
  const cb = useRef(onBack);
  cb.current = onBack; // always call the latest handler

  useEffect(() => {
    if (!active) return undefined;
    const guard = () => cb.current?.();
    stack.push(guard);
    return () => {
      const i = stack.indexOf(guard);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
