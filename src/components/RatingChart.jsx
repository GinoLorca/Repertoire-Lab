import React, { useEffect, useMemo, useRef, useState } from 'react';

// A rating's path over rated events, drawn as SVG (the app carries no chart
// library). Events are spaced evenly — a summer of weekly camps and a quiet
// year then read as what they were, events, rather than a squashed cluster
// and a long flat line. An event with games recorded in the app gets a ring.
//
// `series`: [{ key, date, eventName, pre, post, change }], oldest first.

const H = 220;
const PAD = { top: 18, right: 16, bottom: 30, left: 44 };

function niceTicks(min, max, count = 4) {
  const span = Math.max(1, max - min);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

const shortDate = (iso) => {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ’${y.slice(2)}`;
};

export default function RatingChart({ series, marked, peak, onPick, label = 'Rating' }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const pts = series.filter((p) => p.post != null);
    if (!pts.length) return null;
    const values = pts.flatMap((p) => [p.post, p.pre].filter((v) => v != null));
    const ticks = niceTicks(Math.min(...values) - 20, Math.max(...values) + 20);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const iw = width - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const x = (i) => PAD.left + (pts.length === 1 ? iw / 2 : (i * iw) / (pts.length - 1));
    const y = (v) => PAD.top + ih - ((v - lo) / (hi - lo)) * ih;
    const coords = pts.map((p, i) => ({ ...p, cx: x(i), cy: y(p.post) }));
    const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(' ');
    const area = coords.length > 1
      ? `${line} L${coords[coords.length - 1].cx.toFixed(1)},${PAD.top + ih} L${coords[0].cx.toFixed(1)},${PAD.top + ih} Z`
      : '';
    // A date under the first and last event, and a few between if there's room.
    const every = Math.max(1, Math.ceil(coords.length / Math.max(2, Math.floor(iw / 90))));
    const labels = coords.filter((c, i) => i === 0 || i === coords.length - 1 || i % every === 0);
    return { coords, line, area, ticks, y, labels, ih };
  }, [series, width]);

  if (!geo) return <div className="muted-note">No rated events in this system yet.</div>;

  const onMove = (e) => {
    const box = wrap.current.getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = null;
    for (const c of geo.coords) if (!best || Math.abs(c.cx - px) < Math.abs(best.cx - px)) best = c;
    setHover(best);
  };

  return (
    <div
      className="rating-chart"
      ref={wrap}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label={`${label} over ${geo.coords.length} rated event${geo.coords.length === 1 ? '' : 's'}: from ${geo.coords[0].post} to ${geo.coords[geo.coords.length - 1].post}`}
    >
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`}>
        <defs>
          <linearGradient id="rc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line className="rc-grid" x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} />
            <text className="rc-axis" x={PAD.left - 8} y={geo.y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {peak != null && geo.coords.length > 1 && (
          <g>
            <line className="rc-peak" x1={PAD.left} x2={width - PAD.right} y1={geo.y(peak)} y2={geo.y(peak)} />
            <text className="rc-peak-label" x={width - PAD.right} y={geo.y(peak) - 5} textAnchor="end">peak {peak}</text>
          </g>
        )}
        {geo.area && <path d={geo.area} fill="url(#rc-fill)" />}
        <path d={geo.line} className="rc-line" />
        {geo.coords.map((c) => (
          <g key={c.key} className="rc-point" onClick={() => onPick?.(c.key)}>
            {marked?.has(c.key) && <circle cx={c.cx} cy={c.cy} r="8.5" className="rc-ring" />}
            <circle cx={c.cx} cy={c.cy} r={hover?.key === c.key ? 5.5 : 4} className={`rc-dot${(c.change ?? 0) < 0 ? ' down' : ''}`} />
          </g>
        ))}
        {geo.labels.map((c) => (
          <text key={`d${c.key}`} className="rc-axis" x={c.cx} y={H - 8} textAnchor="middle">{shortDate(c.date)}</text>
        ))}
        {hover && <line className="rc-cursor" x1={hover.cx} x2={hover.cx} y1={PAD.top} y2={PAD.top + geo.ih} />}
      </svg>
      {hover && (
        <div
          className="rc-tip"
          style={{ left: Math.min(Math.max(hover.cx, 90), width - 90), top: Math.max(4, hover.cy - 78) }}
        >
          <strong>{hover.eventName}</strong>
          <span>{hover.date}</span>
          <span className="rc-tip-rating">
            {hover.pre != null ? `${hover.pre} → ` : ''}<b>{hover.post}</b>
            {hover.change != null && (
              <em className={hover.change >= 0 ? 'up' : 'down'}>{hover.change >= 0 ? '+' : ''}{hover.change}</em>
            )}
          </span>
          {marked?.has(hover.key) && <span className="rc-tip-note">Games recorded in the app</span>}
        </div>
      )}
    </div>
  );
}
