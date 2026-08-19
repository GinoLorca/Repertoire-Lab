import React, { useEffect, useRef, useState } from 'react';

// The clock on the move you owe.
//
// It keeps its own ticking state so the session around it doesn't re-render ten
// times a second — the board, the engine arrows and the line list all sit in
// that tree, and none of them care what the clock says.
//
// `deadline` is a timestamp, or null when nothing is being timed. Changing it
// re-arms the clock; `onExpire` fires exactly once per arming.
export default function MoveTimer({ deadline, duration, onExpire, warnAt = 3000 }) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    fired.current = false;
    if (!deadline) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [deadline]);

  useEffect(() => {
    if (!deadline || fired.current || now < deadline) return;
    fired.current = true;
    expire.current?.();
  }, [now, deadline]);

  if (!deadline) return null;

  const left = Math.max(0, deadline - now);
  const pct = Math.max(0, Math.min(100, (left / duration) * 100));
  const urgent = left <= warnAt;

  return (
    <div className={`move-timer${urgent ? ' urgent' : ''}`}>
      <div className="mt-track">
        <div className="mt-fill" style={{ width: `${pct}%` }} />
      </div>
      {/* Round up, so a clock reading "1s" still has time on it and the jump to
          zero lands with the move rather than a moment before it. */}
      <span className="mt-count">{Math.ceil(left / 1000)}s</span>
    </div>
  );
}
