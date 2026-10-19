import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { uid } from '../store';
import { useBackGuard } from '../lib/backGuard';
import { MenuSheet } from './MoreMenu';
import { CheckIcon, PencilIcon } from './Icons';
import {
  PANELS, canDrop, cleanWorkspaces, defaultLayout, DEFAULT_WORKSPACE, MAX_NAME, readDevice, sameLayout,
  savedLayoutOf, uniqueName, writeDevice,
} from '../lib/workspace';

// Studio's workspaces (lib/workspace): the board's cards as docked panels,
// arranged the way you like them and saved under a name.
//
//   useWorkspace   which workspace this device is on, the layout as it
//                  stands, and saving it — the saved ones live in settings,
//                  so they reach every device; which one is in use doesn't
//   DockLayout     the panels laid out from a layout; with `customizing`, a
//                  grip on each to drag it somewhere else — between panels,
//                  in with another as a tab, or out to a column of its own —
//                  a ✕ to put it away, ▾ to fold it, and dividers to drag
//   WorkspaceBar   the Workspace menu and the Customize / Done button

const storage = () => (typeof window !== 'undefined' ? window.localStorage : null);

export function useWorkspace({ enabled, settings, dispatch }) {
  const saved = useMemo(() => cleanWorkspaces(settings.workspaces), [settings.workspaces]);
  const [device, setDevice] = useState(() => (enabled && readDevice(storage())) || { current: DEFAULT_WORKSPACE.id, layout: null });
  // A workspace deleted on another device: back to Default.
  const current = saved.some((w) => w.id === device.current) ? device.current : DEFAULT_WORKSPACE.id;
  // The same object from one render to the next, so nothing downstream (the
  // save to this device below, the classic-or-docked check) runs on every
  // engine update.
  const base = useMemo(() => savedLayoutOf(saved, current), [saved, current]);
  const layout = device.layout ?? base;
  const modified = !sameLayout(layout, base);
  useEffect(() => {
    if (enabled) writeDevice(storage(), { current, layout: modified ? layout : null });
  }, [enabled, current, layout, modified]);

  const setLayout = useCallback((fn) => setDevice((d) => {
    const from = d.layout ?? savedLayoutOf(saved, d.current) ?? defaultLayout();
    return { ...d, layout: typeof fn === 'function' ? fn(from) : fn };
  }), [saved]);
  const write = (list) => dispatch({ type: 'setSettings', settings: { workspaces: list } });
  const name = current === DEFAULT_WORKSPACE.id ? DEFAULT_WORKSPACE.name : saved.find((w) => w.id === current)?.name;

  return {
    saved,
    current,
    name,
    layout,
    modified,
    setLayout,
    switchTo: (id) => setDevice({ current: id, layout: null }),
    reset: () => setDevice((d) => ({ ...d, layout: null })),
    saveAs: (wanted) => {
      const id = uid();
      write([...saved, { id, name: uniqueName(saved, wanted), layout }]);
      setDevice({ current: id, layout: null });
    },
    saveChanges: () => {
      if (current === DEFAULT_WORKSPACE.id) return;
      write(saved.map((w) => (w.id === current ? { ...w, layout } : w)));
      setDevice((d) => ({ ...d, layout: null }));
    },
    rename: (wanted) => {
      if (current === DEFAULT_WORKSPACE.id) return;
      const others = saved.filter((w) => w.id !== current);
      write(saved.map((w) => (w.id === current ? { ...w, name: uniqueName(others, wanted) } : w)));
    },
    remove: () => {
      if (current === DEFAULT_WORKSPACE.id) return;
      write(saved.filter((w) => w.id !== current));
      setDevice({ current: DEFAULT_WORKSPACE.id, layout: null });
    },
  };
}

// ---------- The bar ----------

// One small button in Studio's header — the workspace in use, and a menu of
// the others and what can be done with them — so the header, already full on
// an iPad, doesn't grow a line. Customizing brings up a toolbar of its own,
// floating over the page, so nothing under it moves either.
export function WorkspaceBar({
  ws, customizing, onCustomize, closedPanels, onOpenPanel, narrow,
}) {
  const [menu, setMenu] = useState(null); // { kind: 'workspaces' | 'panels', at }
  // Naming, renaming and deleting ask in a box of the app's own, not the
  // browser's prompt — Safari on an iPad can swallow that without showing it.
  const [asking, setAsking] = useState(null); // 'saveAs' | 'rename' | 'delete'
  const open = (kind) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const right = Math.max(8, r.right - 260);
    setMenu({ kind, at: narrow ? null : { x: kind === 'panels' ? r.left : right, y: kind === 'panels' ? r.top - 8 : r.bottom + 6 } });
  };
  const isDefault = ws.current === DEFAULT_WORKSPACE.id;
  const items = menu?.kind === 'panels'
    ? closedPanels.map((id) => ({
      label: PANELS[id].title,
      hint: id === 'moments' ? 'Inside Annotate for now — open it as a panel of its own' : null,
      onClick: () => onOpenPanel(id),
    }))
    : [
      ...[{ id: DEFAULT_WORKSPACE.id, name: DEFAULT_WORKSPACE.name }, ...ws.saved].map((w) => ({
        label: w.name,
        icon: w.id === ws.current ? <CheckIcon size={15} /> : null,
        onClick: () => ws.switchTo(w.id),
      })),
      { sep: true },
      !customizing && { label: 'Customize panels', icon: <PencilIcon size={15} />, onClick: onCustomize },
      ws.modified && !isDefault && { label: `Save changes to “${ws.name}”`, onClick: ws.saveChanges },
      { label: 'Save as a new workspace…', onClick: () => setAsking('saveAs') },
      ws.modified && { label: `Reset to the saved “${ws.name}”`, onClick: ws.reset },
      { sep: true },
      !isDefault && { label: `Rename “${ws.name}”…`, onClick: () => setAsking('rename') },
      !isDefault && { label: `Delete “${ws.name}”…`, danger: true, onClick: () => setAsking('delete') },
    ];
  return (
    <>
      <button
        type="button"
        className={`small ws-pick${customizing ? ' primary' : ''}`}
        title={`Workspace: ${ws.name}${ws.modified ? ' (changed)' : ''} — Studio’s panels as you arrange them`}
        aria-label={`Workspace: ${ws.name}`}
        aria-haspopup="menu"
        onClick={open('workspaces')}
      >
        <WorkspaceIcon />
        <span className="ws-name">{ws.name}{ws.modified ? '*' : ''}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {customizing && createPortal(
        <div className="ws-customize-bar" role="toolbar" aria-label="Customizing Studio">
          <strong className="ws-customize-title">Customizing</strong>
          <span className="ws-customize-hint muted-note">
            Drag a grip to move a panel — onto another’s title to make tabs, to a column’s edge for a new column.
          </span>
          {closedPanels.length > 0 && (
            <button type="button" className="small" aria-haspopup="menu" onClick={open('panels')}>
              Panels ▾
            </button>
          )}
          <button type="button" className="small" aria-haspopup="menu" onClick={open('workspaces')}>
            <WorkspaceIcon /> {ws.name}{ws.modified ? '*' : ''}
          </button>
          <button type="button" className="small primary" onClick={onCustomize}>
            <CheckIcon size={14} /> Done
          </button>
        </div>,
        document.body,
      )}
      {menu && (
        <MenuSheet
          items={items}
          title={menu.kind === 'panels' ? 'Closed panels' : 'Workspace'}
          at={menu.at}
          onClose={() => setMenu(null)}
        />
      )}
      {asking === 'saveAs' && (
        <WorkspaceDialog
          title="Save as a new workspace"
          hint="Saved with your settings, so it’s there on your other devices too."
          initial={isDefault ? 'My workspace' : ws.name}
          action="Save"
          onDone={(name) => { ws.saveAs(name); setAsking(null); }}
          onClose={() => setAsking(null)}
        />
      )}
      {asking === 'rename' && (
        <WorkspaceDialog
          title={`Rename “${ws.name}”`}
          initial={ws.name}
          action="Rename"
          onDone={(name) => { ws.rename(name); setAsking(null); }}
          onClose={() => setAsking(null)}
        />
      )}
      {asking === 'delete' && (
        <WorkspaceDialog
          title={`Delete “${ws.name}”?`}
          hint="Studio goes back to Default. Your other workspaces stay as they are."
          action="Delete"
          danger
          onDone={() => { ws.remove(); setAsking(null); }}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}

// A name to type (`initial` given), or just a yes — over the page, on <body>
// so the header it's opened from can't clip it.
function WorkspaceDialog({
  title, hint, initial = null, action, danger = false, onDone, onClose,
}) {
  useBackGuard(true, onClose);
  const [value, setValue] = useState(initial ?? '');
  const naming = initial != null;
  const name = value.trim().slice(0, MAX_NAME);
  const ready = !naming || name.length > 0;
  const submit = (e) => {
    e.preventDefault();
    if (ready) onDone(name);
  };
  return createPortal(
    <div className="modal-overlay ws-dialog-overlay" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
      <form className="modal ws-dialog" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        {hint && <p className="hint">{hint}</p>}
        {naming && (
          <input
            type="text"
            autoFocus
            value={value}
            maxLength={MAX_NAME}
            aria-label="Workspace name"
            onFocus={(e) => e.target.select()}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className={danger ? 'danger' : 'primary'} disabled={!ready}>{action}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function WorkspaceIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style={{ verticalAlign: '-2px' }}>
      <rect x="1.5" y="2" width="6" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// ---------- The layout ----------

const EDGE = 26; // px at a column's side that drop a panel into a new column
const TAB_ZONE = 44; // px at a group's top that drop a panel in as a tab
const MOVE_SLOP = 6;

// Where the pointer would drop `item`: { target, guide } — `guide` the box to
// draw the drop line or outline in — or null. Worked out from what's on
// screen: the shown columns (data-dock-col) and groups (data-dock-group).
function dropAt(root, x, y, item, layout, stacked) {
  if (!root) return null;
  const cols = [...root.querySelectorAll('[data-dock-col]')].map((el) => ({ el, id: el.dataset.dockCol, r: el.getBoundingClientRect() }));
  if (!cols.length) return null;
  const top = Math.min(...cols.map((c) => c.r.top));
  const bottom = Math.max(...cols.map((c) => c.r.bottom));
  // The column under the pointer, or the nearest.
  let ci = cols.findIndex((c) => x >= c.r.left && x <= c.r.right);
  if (ci < 0) {
    const dist = cols.map((c) => Math.min(Math.abs(x - c.r.left), Math.abs(x - c.r.right)));
    ci = dist.indexOf(Math.min(...dist));
    // In the gap between two columns: a new column there.
    if (!stacked) {
      const after = cols.findIndex((c) => c.r.left > x);
      if (after > 0 && x > cols[after - 1].r.right) {
        const target = { kind: 'column', beforeColId: cols[after].id };
        const gx = (cols[after - 1].r.right + cols[after].r.left) / 2;
        return canDrop(layout, item, target) ? { target, guide: { kind: 'v', left: gx - 2, top, width: 4, height: bottom - top } } : null;
      }
    }
  }
  const col = cols[ci];
  if (!stacked && (x < col.r.left + EDGE || x > col.r.right - EDGE)) {
    const right = x > col.r.right - EDGE;
    const target = { kind: 'column', beforeColId: right ? (cols[ci + 1]?.id ?? null) : col.id };
    const gx = right ? col.r.right + 4 : col.r.left - 6;
    if (canDrop(layout, item, target)) {
      return { target, guide: { kind: 'v', left: gx, top, width: 4, height: bottom - top } };
    }
  }
  const groups = [...col.el.querySelectorAll(':scope > [data-dock-group]')].map((el) => ({
    el, id: el.dataset.dockGroup, colId: el.dataset.dockHome, r: el.getBoundingClientRect(),
  }));
  const line = (yy) => ({ kind: 'h', left: col.r.left, top: yy - 2, width: col.r.width, height: 4 });
  if (!groups.length) {
    const target = { kind: 'insert', colId: col.id, beforeGroupId: null };
    return canDrop(layout, item, target) ? { target, guide: line(col.r.top + 8) } : null;
  }
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    if (y > g.r.bottom && i < groups.length - 1) continue;
    if (y >= g.r.top && y <= g.r.top + TAB_ZONE) {
      const target = { kind: 'tab', groupId: g.id };
      if (canDrop(layout, item, target)) {
        return { target, guide: { kind: 'box', left: g.r.left, top: g.r.top, width: g.r.width, height: g.r.height } };
      }
    }
    const below = y > (g.r.top + g.r.bottom) / 2;
    if (!below) {
      const prev = groups[i - 1];
      const target = { kind: 'insert', colId: g.colId, beforeGroupId: g.id };
      return canDrop(layout, item, target)
        ? { target, guide: line(prev ? (prev.r.bottom + g.r.top) / 2 : g.r.top - 6) } : null;
    }
    const next = groups[i + 1];
    const target = next && next.colId === g.colId
      ? { kind: 'insert', colId: g.colId, beforeGroupId: next.id }
      : { kind: 'insert', colId: g.colId, beforeGroupId: null };
    return canDrop(layout, item, target)
      ? { target, guide: line(next ? (g.r.bottom + next.r.top) / 2 : g.r.bottom + 6) } : null;
  }
  return null;
}

export function DockLayout({
  layout, columns, widths, fillerId, boardColWidth, gap, stacked, customizing, className, layoutRef, style,
  renderPanel, available, placeholder, tabLabel, activeTab, onActivate, onMove, onClose, onCollapse, onResize,
}) {
  const rootRef = useRef(null);
  const [drag, setDrag] = useState(null); // { label, x, y, hit }
  const setRoot = useCallback((el) => { rootRef.current = el; layoutRef?.(el); }, [layoutRef]);

  // ---- Dragging a panel or a group ----
  const startDrag = (item, label, onTap) => (e) => {
    if (!customizing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    const from = { x: e.clientX, y: e.clientY };
    let moving = false;
    let last = null;
    const onMoveEv = (ev) => {
      if (!moving && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < MOVE_SLOP) return;
      moving = true;
      // The page scrolls under a drag held near its top or bottom edge.
      if (ev.clientY < 60) window.scrollBy(0, -14);
      else if (ev.clientY > window.innerHeight - 60) window.scrollBy(0, 14);
      last = dropAt(rootRef.current, ev.clientX, ev.clientY, item, layout, stacked);
      setDrag({ label, x: ev.clientX, y: ev.clientY, hit: last });
    };
    const done = (apply) => () => {
      window.removeEventListener('pointermove', onMoveEv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setDrag(null);
      if (!apply) return;
      if (moving) { if (last) onMove(item, last.target); } else onTap?.();
    };
    const up = done(true);
    const cancel = done(false);
    window.addEventListener('pointermove', onMoveEv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  // ---- Dragging a divider ----
  const startResize = (leftId, rightId) => (e) => {
    if (!customizing) return;
    e.preventDefault();
    e.stopPropagation();
    const shown = {};
    for (const el of rootRef.current?.querySelectorAll('[data-dock-col]') ?? []) {
      shown[el.dataset.dockCol] = el.getBoundingClientRect().width;
    }
    const from = e.clientX;
    let frame = null;
    const onMoveEv = (ev) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => onResize(leftId, rightId, ev.clientX - from, shown));
    };
    const up = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMoveEv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', onMoveEv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const shownTabs = (group) => group.tabs.filter((t) => customizing || available(t));

  const renderGroup = (group) => {
    const tabs = shownTabs(group);
    if (!tabs.length) return null;
    const wanted = activeTab(group);
    const active = tabs.includes(wanted) ? wanted : tabs[0];
    const many = tabs.length > 1;
    const body = (id, tabbed) => (available(id) ? renderPanel(id, { tabbed }) : placeholder(id));
    const titles = tabs.map((t) => PANELS[t].title).join(' · ');
    const isBoard = group.tabs.includes('board');
    let content;
    if (group.collapsed) {
      content = (
        <button type="button" className="dock-collapsed" onClick={() => onCollapse(group.id, false)} title="Unfold">
          ▸ {titles}
        </button>
      );
    } else if (many) {
      content = (
        <div className="panel side-tabs-panel dock-tabs">
          <div className="side-tabs">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                className={`${t === active ? 'active' : ''}${customizing ? ' dock-tab-grab' : ''}`}
                onClick={customizing ? undefined : () => onActivate(group.id, t)}
                onPointerDown={customizing ? startDrag({ panel: t }, PANELS[t].title, () => onActivate(group.id, t)) : undefined}
                title={customizing ? `Drag ${PANELS[t].title} somewhere else, or tap to show it` : undefined}
              >
                {tabLabel(t)}
              </button>
            ))}
          </div>
          {body(active, true)}
        </div>
      );
    } else {
      content = body(active, false);
    }
    return (
      <div
        key={group.id}
        className={`dock-group${customizing ? ' customizing' : ''}${group.collapsed ? ' folded' : ''}${isBoard ? ' dock-board' : ''}`}
        data-dock-group={group.id}
        data-dock-home={group.colId}
      >
        {customizing && (
          <div className="dock-chrome">
            <button
              type="button"
              className="dock-grip"
              aria-label={`Move ${titles}`}
              title={many ? 'Drag to move these panels together (drag a tab to move just that one)' : `Drag to move ${titles}`}
              onPointerDown={startDrag(many ? { group: group.id } : { panel: tabs[0] }, titles)}
            >
              <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
                {[3, 8, 13].map((cy) => [3, 7].map((cx) => <circle key={`${cx}${cy}`} cx={cx} cy={cy} r="1.4" fill="currentColor" />))}
              </svg>
            </button>
            <span className="dock-title">{many ? PANELS[active].title : titles}</span>
            {!isBoard && (
              <button
                type="button"
                className="dock-btn"
                title={group.collapsed ? 'Unfold' : 'Fold away to its title'}
                aria-label={group.collapsed ? 'Unfold' : 'Fold'}
                onClick={() => onCollapse(group.id, !group.collapsed)}
              >
                {group.collapsed ? '▸' : '▾'}
              </button>
            )}
            {PANELS[active].closable && (
              <button
                type="button"
                className="dock-btn"
                title={`Close ${PANELS[active].title} — the Panels menu brings it back`}
                aria-label={`Close ${PANELS[active].title}`}
                onClick={() => onClose(active)}
              >
                ✕
              </button>
            )}
          </div>
        )}
        {content}
      </div>
    );
  };

  return (
    <div
      ref={setRoot}
      className={`${className} dock${stacked ? ' dock-stacked' : ''}${customizing ? ' dock-customizing' : ''}${drag ? ' dock-dragging' : ''}`}
      style={style}
    >
      {columns.map((col, i) => {
        const w = col.hasBoard ? boardColWidth : widths[col.id];
        const colStyle = stacked ? undefined : {
          flex: col.id === fillerId ? `1 1 ${w}px` : `0 0 ${w}px`,
          width: w,
          minWidth: col.id === fillerId ? Math.min(w, 200) : w,
        };
        const next = columns[i + 1];
        return (
          <React.Fragment key={col.id}>
            <div className={`dock-col${col.hasBoard ? ' has-board' : ''}`} data-dock-col={col.id} style={colStyle}>
              {col.groups.map(renderGroup)}
            </div>
            {next && !stacked && (
              <div
                className={`dock-divider${customizing ? ' live' : ''}`}
                style={{ flex: `0 0 ${gap}px` }}
                onPointerDown={customizing ? startResize(col.id, next.id) : undefined}
                role={customizing ? 'separator' : undefined}
                aria-orientation="vertical"
                title={customizing ? 'Drag to resize the columns' : undefined}
              />
            )}
          </React.Fragment>
        );
      })}
      {drag && (
        <>
          {drag.hit && (
            <div
              className={`dock-guide ${drag.hit.guide.kind}`}
              style={{
                left: drag.hit.guide.left, top: drag.hit.guide.top, width: drag.hit.guide.width, height: drag.hit.guide.height,
              }}
            />
          )}
          <div className="dock-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>{drag.label}</div>
        </>
      )}
    </div>
  );
}
