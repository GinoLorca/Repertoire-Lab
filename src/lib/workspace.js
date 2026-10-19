// Studio workspaces: the analysis board's cards as panels you arrange — the
// way After Effects docks its panels. A layout is columns, each a stack of
// groups, each group one panel or several as tabs:
//
//   { v: 1,
//     columns: [{ id, width?, groups: [{ id, tabs: [panelId], collapsed? }] }],
//     closed: [panelId] }      put away; the Panels menu brings them back
//
// `width` is a column's width in px once its divider has been dragged —
// absent, it takes its usual one. The board's column has no width of its
// own: it's the board, sized from the room the others leave (solveDock).
//
// Pure, so tests/workspace.test.mjs covers it. The screen that draws it is
// components/Workspace.jsx; the panels themselves live in AnalysisView.

export const LAYOUT_VERSION = 1;

// Every panel there is. `tabbable`: can share a group as a tab — the board
// and the two strips under it can't. `closable`: the board can't be put away.
export const PANELS = {
  board: { title: 'Board', tabbable: false, closable: false },
  notes: { title: 'Game notes', tabbable: true, closable: true },
  controls: { title: 'Move buttons', tabbable: false, closable: true },
  position: { title: 'Position (FEN)', tabbable: false, closable: true },
  lab: { title: 'Lab notes', tabbable: true, closable: true },
  movenote: { title: 'Move note', tabbable: true, closable: true },
  game: { title: 'Game', tabbable: true, closable: true },
  repertoire: { title: 'Your repertoire', tabbable: true, closable: true },
  engine: { title: 'Engine', tabbable: true, closable: true },
  explorer: { title: 'Explorer', tabbable: true, closable: true },
  annotate: { title: 'Annotate', tabbable: true, closable: true },
  moments: { title: 'Before & After', tabbable: true, closable: true },
  moves: { title: 'Moves', tabbable: true, closable: true },
};
export const PANEL_IDS = Object.keys(PANELS);

// The Engine / Explorer / Annotate tabs: the group the analysis board's own
// tab state (sidePane) belongs to, wherever it's moved.
export const SIDE_GROUP = 'side';

// Studio as it has always been: the board's column, the engine's, the moves'.
// Before & After starts inside the Annotate panel (closed as a panel of its
// own); opening it docks it separately.
export const DEFAULT_LAYOUT = Object.freeze({
  v: LAYOUT_VERSION,
  columns: [
    {
      id: 'c-board',
      groups: [
        { id: 'g-board', tabs: ['board'] },
        { id: 'g-notes', tabs: ['notes'] },
        { id: 'g-controls', tabs: ['controls'] },
        { id: 'g-position', tabs: ['position'] },
        { id: 'g-lab', tabs: ['lab'] },
      ],
    },
    {
      id: 'c-side',
      groups: [
        { id: 'g-movenote', tabs: ['movenote'] },
        { id: 'g-game', tabs: ['game'] },
        { id: 'g-repertoire', tabs: ['repertoire'] },
        { id: SIDE_GROUP, tabs: ['engine', 'explorer', 'annotate'] },
      ],
    },
    { id: 'c-moves', groups: [{ id: 'g-moves', tabs: ['moves'] }] },
  ],
  closed: ['moments'],
});
export const defaultLayout = () => JSON.parse(JSON.stringify(DEFAULT_LAYOUT));

const MIN_COL = 200;
const MAX_COL = 900;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clampWidth = (w) => Math.round(Math.max(MIN_COL, Math.min(MAX_COL, w)));
const tabbable = (id) => PANELS[id]?.tabbable === true;

// ---------- Reading one ----------

// A layout from storage, a sync or an older app, rebuilt from what's allowed:
// unknown panels dropped, each panel once, the board alone in its own group
// and always somewhere, nothing empty left standing. A panel the layout
// doesn't mention at all (one added to the app since it was saved) comes in
// closed — the Panels menu has it — rather than moving everything around.
export function normalizeLayout(raw) {
  if (!isObj(raw) || !Array.isArray(raw.columns)) return defaultLayout();
  const seen = new Set();
  const ids = new Set();
  const fresh = (base) => {
    let id = ID.test(base) && !ids.has(base) ? base : null;
    for (let n = 2; !id; n += 1) if (!ids.has(`${base}-${n}`)) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };
  const columns = [];
  for (const c of raw.columns.slice(0, 8)) {
    if (!isObj(c) || !Array.isArray(c.groups)) continue;
    const groups = [];
    for (const g of c.groups.slice(0, 24)) {
      if (!isObj(g) || !Array.isArray(g.tabs)) continue;
      const tabs = [];
      for (const t of g.tabs) {
        if (typeof t !== 'string' || !PANELS[t] || seen.has(t)) continue;
        seen.add(t);
        tabs.push(t);
      }
      if (!tabs.length) continue;
      // Panels that can't be tabs each get a group of their own.
      const loose = tabs.filter((t) => !tabbable(t));
      const together = tabs.filter(tabbable);
      const make = (list, base) => {
        const group = { id: fresh(typeof base === 'string' ? base : `g-${list[0]}`), tabs: list };
        if (g.collapsed === true) group.collapsed = true;
        return group;
      };
      if (together.length) groups.push(make(together, g.id));
      for (const t of loose) groups.push(make([t], together.length ? `g-${t}` : g.id));
    }
    if (!groups.length) continue;
    const col = { id: fresh(typeof c.id === 'string' ? c.id : 'c'), groups };
    if (Number.isFinite(c.width)) col.width = clampWidth(c.width);
    columns.push(col);
  }
  const closed = (Array.isArray(raw.closed) ? raw.closed : [])
    .filter((t) => typeof t === 'string' && PANELS[t] && PANELS[t].closable && !seen.has(t));
  closed.forEach((t) => seen.add(t));
  if (!seen.has('board')) {
    if (!columns.length) columns.push({ id: fresh('c-board'), groups: [] });
    columns[0].groups.unshift({ id: fresh('g-board'), tabs: ['board'] });
    seen.add('board');
  }
  for (const id of PANEL_IDS) if (!seen.has(id)) closed.push(id);
  return { v: LAYOUT_VERSION, columns, closed };
}

// The same arrangement — what "changed since it was saved" is measured by.
export const layoutKey = (layout) => JSON.stringify(normalizeLayout(layout));
export const sameLayout = (a, b) => layoutKey(a) === layoutKey(b);

// Where a panel is: { col, group, tab } indexes, or null when it's closed.
export function findPanel(layout, panelId) {
  for (let c = 0; c < layout.columns.length; c += 1) {
    const { groups } = layout.columns[c];
    for (let g = 0; g < groups.length; g += 1) {
      const tab = groups[g].tabs.indexOf(panelId);
      if (tab >= 0) return { col: c, group: g, tab };
    }
  }
  return null;
}
export const isOpen = (layout, panelId) => Boolean(findPanel(layout, panelId));
export const groupOf = (layout, panelId) => {
  const at = findPanel(layout, panelId);
  return at ? layout.columns[at.col].groups[at.group] : null;
};
export const boardColumnId = (layout) => layout.columns[findPanel(layout, 'board')?.col ?? 0]?.id ?? null;

// ---------- Changing one ----------

const copy = (layout) => JSON.parse(JSON.stringify(normalizeLayout(layout)));
const tidy = (layout) => ({
  ...layout,
  columns: layout.columns
    .map((c) => ({ ...c, groups: c.groups.filter((g) => g.tabs.length || g.id === DROP) }))
    .filter((c) => c.groups.length),
});
const DROP = '__drop';
const newId = (layout, base, kind) => {
  const taken = new Set(kind === 'col'
    ? layout.columns.map((c) => c.id)
    : layout.columns.flatMap((c) => c.groups.map((g) => g.id)));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
};

// Where something dragged can land:
//   { kind: 'insert', colId, beforeGroupId }   in a column, above that group
//                                              (null: at the bottom)
//   { kind: 'tab', groupId }                   as a tab in that group
//   { kind: 'column', beforeColId }            a column of its own, left of
//                                              that one (null: at the right)
// `item` is { panel } — one panel, out of whatever group it's in — or
// { group } — a whole group, its tabs together.
export function canDrop(layout, item, target) {
  if (!target) return false;
  const tabs = item.panel ? [item.panel] : (findGroup(layout, item.group)?.tabs ?? []);
  if (!tabs.length) return false;
  if (target.kind === 'tab') {
    const g = findGroup(layout, target.groupId);
    if (!g || g.id === item.group || (item.panel && g.tabs.includes(item.panel) && g.tabs.length === 1)) return false;
    return tabs.every(tabbable) && g.tabs.every(tabbable);
  }
  if (target.kind === 'insert') return Boolean(layout.columns.find((c) => c.id === target.colId));
  return target.kind === 'column';
}
export function findGroup(layout, groupId) {
  for (const c of layout.columns) for (const g of c.groups) if (g.id === groupId) return g;
  return null;
}

// Moves a panel or a group to `target`. Unchanged when it can't go there, or
// when it's being dropped where it already is.
export function moveItem(layout, item, target) {
  if (!canDrop(layout, item, target)) return layout;
  let next = copy(layout);
  const moving = item.panel ? null : findGroup(next, item.group);
  const tabs = item.panel ? [item.panel] : [...(moving?.tabs ?? [])];
  // A marker where it lands, put in before anything is taken out — so the
  // place is right however the move reshuffles the columns.
  if (target.kind === 'insert') {
    const col = next.columns.find((c) => c.id === target.colId);
    const at = target.beforeGroupId ? col.groups.findIndex((g) => g.id === target.beforeGroupId) : -1;
    col.groups.splice(at < 0 ? col.groups.length : at, 0, { id: DROP, tabs: [] });
  } else if (target.kind === 'column') {
    const at = target.beforeColId ? next.columns.findIndex((c) => c.id === target.beforeColId) : -1;
    next.columns.splice(at < 0 ? next.columns.length : at, 0, {
      id: newId(next, 'c', 'col'), groups: [{ id: DROP, tabs: [] }],
    });
  }
  // Out of where it was.
  for (const c of next.columns) {
    for (const g of c.groups) {
      if (moving && g === moving) g.tabs = [];
      else if (g.id !== DROP) g.tabs = g.tabs.filter((t) => !tabs.includes(t));
    }
  }
  if (target.kind === 'tab') {
    const g = findGroup(next, target.groupId);
    if (!g) return layout;
    g.tabs = [...g.tabs, ...tabs];
  } else {
    for (const c of next.columns) {
      const i = c.groups.findIndex((g) => g.id === DROP);
      if (i < 0) continue;
      const group = moving
        ? { ...moving, tabs }
        : { id: newId(next, `g-${tabs[0]}`, 'group'), tabs };
      c.groups[i] = group;
    }
  }
  next = tidy(next);
  return normalizeLayout(next);
}

// Put away, and back. A panel comes back at the bottom of the last column that
// isn't the board's — or a column of its own when there's only the board's.
export function closePanel(layout, panelId) {
  if (!PANELS[panelId]?.closable || !isOpen(layout, panelId)) return layout;
  const next = copy(layout);
  for (const c of next.columns) for (const g of c.groups) g.tabs = g.tabs.filter((t) => t !== panelId);
  next.closed = [...next.closed, panelId];
  return normalizeLayout(tidy(next));
}
export function openPanel(layout, panelId) {
  if (!PANELS[panelId] || isOpen(layout, panelId)) return layout;
  const next = copy(layout);
  next.closed = next.closed.filter((t) => t !== panelId);
  const boardCol = findPanel(next, 'board')?.col ?? 0;
  let col = next.columns.length - 1;
  if (col === boardCol) {
    next.columns.push({ id: newId(next, 'c', 'col'), groups: [] });
    col = next.columns.length - 1;
  }
  next.columns[col].groups.push({ id: newId(next, `g-${panelId}`, 'group'), tabs: [panelId] });
  return normalizeLayout(next);
}

export function setCollapsed(layout, groupId, collapsed) {
  const next = copy(layout);
  const g = findGroup(next, groupId);
  if (!g || g.tabs.includes('board')) return layout;
  if (collapsed) g.collapsed = true; else delete g.collapsed;
  return normalizeLayout(next);
}

// Dragging the divider between two columns by `dx` px (right is positive),
// from the widths they have on screen right now (`shown`, { colId: px }).
// The board's column is never given a width: it's the other side of the
// divider that gives or takes the room, and the board follows.
export function resizeBetween(layout, leftId, rightId, dx, shown) {
  const next = copy(layout);
  const board = boardColumnId(next);
  const left = next.columns.find((c) => c.id === leftId);
  const right = next.columns.find((c) => c.id === rightId);
  if (!left || !right) return layout;
  if (left.id !== board) left.width = clampWidth((shown[left.id] ?? left.width ?? MIN_COL) + dx);
  if (right.id !== board) right.width = clampWidth((shown[right.id] ?? right.width ?? MIN_COL) - dx);
  return normalizeLayout(next);
}

// ---------- Fitting it to a screen ----------

// Panels that read fine in a narrow column — a list of moves, a strip.
const NARROW = new Set(['moves', 'movenote', 'controls', 'position']);

// The width a column takes when nobody has dragged its divider: the first
// column beside the board takes the engine's (and whatever room is left
// over), as the screen always had it; any other the moves' when that's all
// it holds, and the engine's when it holds a card that needs the room.
export function preferredWidth(col, index, { tight = false, growing = false } = {}) {
  if (Number.isFinite(col.width)) return col.width;
  const wide = tight ? (growing ? 296 : 310) : 340;
  if (index === 0) return wide;
  const narrow = (col.groups ?? []).every((g) => g.tabs.every((t) => NARROW.has(t)));
  return narrow ? (tight ? 210 : 260) : wide;
}

// The columns as they'll be shown: on a phone, one column, the board's first;
// on a screen too narrow for them all, the rightmost folds in under the one
// beside it until the board has room. Each group keeps the id of the column it
// really belongs to (`colId`), so dropping next to it lands in the right
// place. `room` is the width there is to fill.
export function foldLayout(layout, {
  room, gap = 22, evalW = 0, stacked = false, boardComfort = 400, tight = false, growing = false,
}) {
  const boardAt = findPanel(layout, 'board')?.col ?? 0;
  let cols = layout.columns.map((c, i) => ({
    id: c.id,
    width: c.width,
    hasBoard: i === boardAt,
    groups: c.groups.map((g) => ({ ...g, colId: c.id })),
  }));
  if (stacked) {
    const board = cols.find((c) => c.hasBoard);
    const rest = cols.filter((c) => !c.hasBoard);
    return [{ ...board, groups: [...board.groups, ...rest.flatMap((c) => c.groups)] }];
  }
  const boardRoom = (list) => {
    const others = list.filter((c) => !c.hasBoard);
    const widths = others.reduce((sum, c, i) => sum + preferredWidth(c, i, { tight, growing }), 0);
    return room - gap * (list.length - 1) - evalW - widths;
  };
  while (cols.length > 1 && boardRoom(cols) < boardComfort) {
    // The rightmost column that isn't the board's folds into its neighbour.
    let i = cols.length - 1;
    if (cols[i].hasBoard) i -= 1;
    const into = i > 0 ? i - 1 : i + 1;
    // Underneath what's there — under the board, never above it.
    const merged = { ...cols[into], groups: [...cols[into].groups, ...cols[i].groups] };
    cols = cols.map((c, k) => (k === into ? merged : c)).filter((_, k) => k !== i);
  }
  return cols;
}

// The widths the shown columns get, and the room left for the board:
// { boardRoom, widths: { colId: px } } — the board's column isn't in
// `widths` (it's the board's own width plus its evaluation bar). Columns
// squeezed below their preferred width, when the screen is short of it, keep
// at least MIN_COL. The first column beside the board takes any room the
// board can't use (the screen's CSS does that, flex: 1).
export function solveDock(cols, {
  room, gap = 22, evalW = 0, boardMin = 280, tight = false, growing = false,
}) {
  const others = cols.filter((c) => !c.hasBoard);
  const widths = {};
  others.forEach((c, i) => { widths[c.id] = preferredWidth(c, i, { tight, growing }); });
  const fixed = gap * (cols.length - 1) + evalW;
  let total = others.reduce((s, c) => s + widths[c.id], 0);
  let boardRoom = room - fixed - total;
  if (boardRoom < boardMin && others.length) {
    // Squeeze the others, each in proportion to what it has above the floor.
    const spare = others.reduce((s, c) => s + Math.max(0, widths[c.id] - MIN_COL), 0);
    const need = Math.min(spare, boardMin - boardRoom);
    if (spare > 0) {
      for (const c of others) {
        widths[c.id] = Math.round(widths[c.id] - (need * Math.max(0, widths[c.id] - MIN_COL)) / spare);
      }
    }
    total = others.reduce((s, c) => s + widths[c.id], 0);
    boardRoom = room - fixed - total;
  }
  return { boardRoom, widths, fillerId: others[0]?.id ?? null };
}

// ---------- Saved workspaces ----------

export const DEFAULT_WORKSPACE = { id: 'default', name: 'Default', builtIn: true };
export const MAX_WORKSPACES = 20;
export const MAX_NAME = 40;

// The saved ones (settings.workspaces), from wherever they came from: each
// { id, name, layout }, readable, named, and once each.
export function cleanWorkspaces(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const ids = new Set([DEFAULT_WORKSPACE.id]);
  for (const w of raw) {
    if (out.length >= MAX_WORKSPACES) break;
    if (!isObj(w) || typeof w.id !== 'string' || !ID.test(w.id) || ids.has(w.id)) continue;
    const name = typeof w.name === 'string' ? w.name.trim().slice(0, MAX_NAME) : '';
    if (!name) continue;
    ids.add(w.id);
    out.push({ id: w.id, name, layout: normalizeLayout(w.layout) });
  }
  return out;
}

// A workspace's saved layout: Default's is the app's own.
export const savedLayoutOf = (workspaces, id) => (id === DEFAULT_WORKSPACE.id
  ? defaultLayout()
  : (workspaces.find((w) => w.id === id)?.layout ?? null));

// A name not already taken: "Class", then "Class 2"…
export function uniqueName(workspaces, name) {
  const base = String(name ?? '').trim().slice(0, MAX_NAME) || 'Workspace';
  const taken = new Set([DEFAULT_WORKSPACE.name, ...workspaces.map((w) => w.name)].map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const next = `${base.slice(0, MAX_NAME - 3)} ${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}

// This device's own: which workspace it's on, and the layout as it stands
// (changed since it was saved, perhaps). Kept on the device — a Mac and an
// iPad each pick their own — and read back as nothing when unreadable.
export const DEVICE_KEY = 'repertoire-lab-workspace-v1';
export function readDevice(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(DEVICE_KEY) ?? 'null');
    if (!isObj(raw) || typeof raw.current !== 'string') return null;
    return { current: raw.current, layout: raw.layout ? normalizeLayout(raw.layout) : null };
  } catch {
    return null;
  }
}
export function writeDevice(storage, { current, layout }) {
  try { storage?.setItem(DEVICE_KEY, JSON.stringify({ current, layout })); } catch { /* private mode, full */ }
}
