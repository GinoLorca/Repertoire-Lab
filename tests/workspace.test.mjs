// Studio workspaces — src/lib/workspace.js: the layout, moving panels about,
// fitting it to a screen, and the saved ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PANEL_IDS, DEFAULT_LAYOUT, defaultLayout, normalizeLayout, sameLayout, findPanel, isOpen, groupOf,
  boardColumnId, canDrop, moveItem, closePanel, openPanel, setCollapsed, resizeBetween, foldLayout,
  solveDock, preferredWidth, cleanWorkspaces, savedLayoutOf, uniqueName, readDevice, writeDevice,
  SIDE_GROUP, DEVICE_KEY,
} from '../src/lib/workspace.js';

const where = (layout, id) => {
  const at = findPanel(layout, id);
  return at && `${layout.columns[at.col].id}/${layout.columns[at.col].groups[at.group].id}#${at.tab}`;
};
const shape = (layout) => layout.columns.map((c) => c.groups.map((g) => g.tabs.join('+')).join(' | '));

test('the default is the screen as it always was, every panel accounted for', () => {
  const d = defaultLayout();
  assert.deepEqual(shape(d), [
    'board | notes | controls | position | lab',
    'movenote | game | repertoire | engine+explorer+annotate',
    'moves',
  ]);
  assert.deepEqual(d.closed, ['moments']);
  assert.equal(groupOf(d, 'engine').id, SIDE_GROUP);
  const all = [...d.columns.flatMap((c) => c.groups.flatMap((g) => g.tabs)), ...d.closed].sort();
  assert.deepEqual(all, [...PANEL_IDS].sort());
  assert.ok(sameLayout(d, DEFAULT_LAYOUT));
  assert.equal(boardColumnId(d), 'c-board');
});

test('a layout from anywhere is rebuilt from what’s allowed', () => {
  assert.deepEqual(normalizeLayout(null), defaultLayout());
  assert.deepEqual(normalizeLayout({ columns: 'x' }), defaultLayout());
  const odd = normalizeLayout({
    columns: [
      { id: 'a', width: 50, groups: [{ id: 'x', tabs: ['engine', 'board', 'nonsense', 'engine'], collapsed: true }] },
      { id: 'a', groups: [{ id: 'x', tabs: ['moves', 'controls'] }, { tabs: [] }, 'junk'] },
      { id: 'empty', groups: [] },
    ],
    closed: ['board', 'lab', 'moves', 'ghost'],
  });
  // Board and the button strip get groups of their own; each panel once.
  assert.deepEqual(shape(odd), ['engine | board', 'moves | controls']);
  assert.equal(odd.columns[0].width, 200); // clamped to the floor
  assert.equal(new Set(odd.columns.map((c) => c.id)).size, 2);
  assert.equal(new Set(odd.columns.flatMap((c) => c.groups.map((g) => g.id))).size, 4);
  assert.ok(odd.columns[0].groups[0].collapsed);
  // Everything it didn't mention is closed (the board can't be).
  assert.ok(odd.closed.includes('lab') && odd.closed.includes('notes') && !odd.closed.includes('board'));
  // No board anywhere: it's put back, top left.
  const noBoard = normalizeLayout({ columns: [{ id: 'c', groups: [{ id: 'g', tabs: ['moves'] }] }], closed: [] });
  assert.equal(where(noBoard, 'board'), 'c/g-board#0');
});

test('moving a panel: between groups, into a group as a tab, into a new column', () => {
  let l = defaultLayout();
  // Moves under the board.
  l = moveItem(l, { panel: 'moves' }, { kind: 'insert', colId: 'c-board', beforeGroupId: 'g-notes' });
  assert.deepEqual(shape(l)[0].split(' | ').slice(0, 2), ['board', 'moves']);
  assert.equal(l.columns.length, 2); // its column, now empty, is gone
  // Explorer out of the tabs into a column of its own on the right.
  l = moveItem(l, { panel: 'explorer' }, { kind: 'column', beforeColId: null });
  assert.equal(shape(l)[2], 'explorer');
  assert.equal(groupOf(l, 'engine').tabs.join('+'), 'engine+annotate');
  // Lab notes in with Engine as a tab.
  l = moveItem(l, { panel: 'lab' }, { kind: 'tab', groupId: SIDE_GROUP });
  assert.equal(groupOf(l, 'lab').tabs.join('+'), 'engine+annotate+lab');
  // A column to the left of the board.
  l = moveItem(l, { panel: 'game' }, { kind: 'column', beforeColId: 'c-board' });
  assert.equal(shape(l)[0], 'game');
  assert.equal(boardColumnId(l), 'c-board');
  assert.equal([...l.columns.flatMap((c) => c.groups.flatMap((g) => g.tabs)), ...l.closed].sort().join(), [...PANEL_IDS].sort().join());
});

test('moving a whole group keeps its tabs together', () => {
  let l = moveItem(defaultLayout(), { group: SIDE_GROUP }, { kind: 'column', beforeColId: null });
  assert.equal(shape(l)[l.columns.length - 1], 'engine+explorer+annotate');
  assert.equal(groupOf(l, 'explorer').id, SIDE_GROUP);
  // …and into another group as tabs.
  l = moveItem(l, { group: SIDE_GROUP }, { kind: 'tab', groupId: 'g-moves' });
  assert.equal(groupOf(l, 'moves').tabs.join('+'), 'moves+engine+explorer+annotate');
});

test('what can’t be done isn’t', () => {
  const d = defaultLayout();
  // The board and the strips can't become tabs, or take them.
  assert.ok(!canDrop(d, { panel: 'board' }, { kind: 'tab', groupId: SIDE_GROUP }));
  assert.ok(!canDrop(d, { panel: 'engine' }, { kind: 'tab', groupId: 'g-board' }));
  assert.ok(!canDrop(d, { panel: 'controls' }, { kind: 'tab', groupId: 'g-moves' }));
  assert.ok(!canDrop(d, { group: SIDE_GROUP }, { kind: 'tab', groupId: SIDE_GROUP }));
  assert.ok(!canDrop(d, { panel: 'moves' }, { kind: 'tab', groupId: 'g-moves' }));
  assert.ok(!canDrop(d, { panel: 'moves' }, { kind: 'insert', colId: 'nope', beforeGroupId: null }));
  assert.ok(!canDrop(d, { panel: 'moves' }, null));
  assert.equal(moveItem(d, { panel: 'board' }, { kind: 'tab', groupId: SIDE_GROUP }), d);
  // Dropped where it already is: the same layout.
  assert.ok(sameLayout(moveItem(d, { group: 'g-notes' }, { kind: 'insert', colId: 'c-board', beforeGroupId: 'g-notes' }), d));
  assert.ok(sameLayout(moveItem(d, { group: 'g-moves' }, { kind: 'insert', colId: 'c-moves', beforeGroupId: null }), d));
});

test('the board can move to another column, and the column it leaves keeps the rest', () => {
  const l = moveItem(defaultLayout(), { panel: 'board' }, { kind: 'insert', colId: 'c-side', beforeGroupId: SIDE_GROUP });
  assert.equal(boardColumnId(l), 'c-side');
  assert.equal(shape(l)[0], 'notes | controls | position | lab');
});

test('closing and opening panels; the board stays', () => {
  let l = closePanel(defaultLayout(), 'explorer');
  assert.ok(!isOpen(l, 'explorer') && l.closed.includes('explorer'));
  assert.equal(groupOf(l, 'engine').tabs.join('+'), 'engine+annotate');
  assert.equal(closePanel(l, 'board'), l);
  l = closePanel(l, 'moves');
  assert.equal(l.columns.length, 2);
  l = openPanel(l, 'moves');
  assert.equal(where(l, 'moves').startsWith('c-side/'), true); // the last column that isn't the board's
  // Before & After, opened, docks as a panel of its own.
  l = openPanel(l, 'moments');
  assert.ok(isOpen(l, 'moments') && !l.closed.includes('moments'));
  // With only the board's column, an opened panel gets a column of its own.
  let only = normalizeLayout({ columns: [{ id: 'c', groups: [{ id: 'g', tabs: ['board'] }] }], closed: [] });
  only = openPanel(only, 'engine');
  assert.equal(only.columns.length, 2);
  assert.equal(openPanel(only, 'engine'), only);
});

test('collapsing a group, never the board', () => {
  let l = setCollapsed(defaultLayout(), SIDE_GROUP, true);
  assert.equal(groupOf(l, 'engine').collapsed, true);
  assert.ok(!sameLayout(l, defaultLayout()));
  l = setCollapsed(l, SIDE_GROUP, false);
  assert.ok(sameLayout(l, defaultLayout()));
  assert.equal(setCollapsed(defaultLayout(), 'g-board', true).columns[0].groups[0].collapsed, undefined);
});

test('dragging a divider: the board’s side gives or takes, the others get widths', () => {
  const shown = { 'c-side': 340, 'c-moves': 260 };
  // Board | side divider moved right 40: the side column gives 40.
  let l = resizeBetween(defaultLayout(), 'c-board', 'c-side', 40, shown);
  assert.equal(l.columns[1].width, 300);
  assert.equal(l.columns[0].width, undefined);
  // Side | moves divider moved left 60.
  l = resizeBetween(l, 'c-side', 'c-moves', -60, { 'c-side': 300, 'c-moves': 260 });
  assert.deepEqual([l.columns[1].width, l.columns[2].width], [240, 320]);
  // Never under the floor.
  l = resizeBetween(l, 'c-side', 'c-moves', -500, { 'c-side': 240, 'c-moves': 320 });
  assert.equal(l.columns[1].width, 200);
});

test('fitting columns to a screen: as is when there’s room, folded when there isn’t, one on a phone', () => {
  const d = defaultLayout();
  const wide = foldLayout(d, { room: 1232, evalW: 26 });
  assert.equal(wide.length, 3);
  assert.ok(wide[0].hasBoard);
  // A 1024-wide iPad: the moves fold in under the engine's column.
  const ipad = foldLayout(d, { room: 976, evalW: 26 });
  assert.equal(ipad.length, 2);
  assert.deepEqual(ipad[1].groups.map((g) => g.tabs[0]).slice(-1), ['moves']);
  assert.equal(ipad[1].groups.at(-1).colId, 'c-moves'); // still knows where it belongs
  // A phone: one column, the board's first.
  const moved = moveItem(d, { panel: 'board' }, { kind: 'insert', colId: 'c-moves', beforeGroupId: null });
  const phone = foldLayout(moved, { room: 358, stacked: true });
  assert.equal(phone.length, 1);
  assert.equal(phone[0].groups[1].tabs[0], 'board');
  assert.ok(phone[0].hasBoard);
  // A column left of the board folds in under the board, not above it.
  const left = moveItem(d, { panel: 'game' }, { kind: 'column', beforeColId: 'c-board' });
  const folded = foldLayout(left, { room: 800, evalW: 26 });
  const boardCol = folded.find((c) => c.hasBoard);
  assert.equal(boardCol.groups[0].tabs[0], 'board');
});

test('widths: the board gets what’s left; squeezed columns keep a floor', () => {
  const cols = foldLayout(defaultLayout(), { room: 1232, evalW: 26 });
  const s = solveDock(cols, { room: 1232, evalW: 26 });
  assert.deepEqual(s.widths, { 'c-side': 340, 'c-moves': 260 });
  assert.equal(s.boardRoom, 1232 - 44 - 26 - 600);
  assert.equal(s.fillerId, 'c-side');
  const tight = solveDock(cols, { room: 1132, gap: 14, evalW: 26, tight: true, growing: true });
  assert.deepEqual(tight.widths, { 'c-side': 296, 'c-moves': 210 });
  // Not enough room: the others give way, down to 200 each.
  const squeezed = solveDock(cols, { room: 800, evalW: 26 });
  assert.ok(squeezed.widths['c-side'] >= 200 && squeezed.widths['c-moves'] >= 200);
  assert.ok(squeezed.boardRoom >= 280 || squeezed.widths['c-side'] === 200);
  assert.equal(preferredWidth({ width: 333 }, 0), 333);
  // A second column beside the board: narrow for moves, the engine's width for a card.
  assert.equal(preferredWidth({ groups: [{ tabs: ['moves'] }] }, 1), 260);
  assert.equal(preferredWidth({ groups: [{ tabs: ['moves'] }, { tabs: ['explorer'] }] }, 1), 340);
  assert.equal(preferredWidth({ groups: [{ tabs: ['explorer'] }] }, 1, { tight: true, growing: true }), 296);
});

test('saved workspaces: cleaned, named once, Default built in', () => {
  const list = cleanWorkspaces([
    { id: 'w1', name: '  Class  ', layout: defaultLayout() },
    { id: 'w1', name: 'Dup' },
    { id: 'default', name: 'Sneaky' },
    { id: 'bad id!', name: 'x' },
    { id: 'w2', name: '' },
    { id: 'w3', name: 'x'.repeat(60), layout: { columns: [] } },
    'junk',
  ]);
  assert.deepEqual(list.map((w) => w.id), ['w1', 'w3']);
  assert.equal(list[0].name, 'Class');
  assert.equal(list[1].name.length, 40);
  assert.ok(sameLayout(list[1].layout, normalizeLayout({ columns: [] })));
  assert.ok(sameLayout(savedLayoutOf(list, 'default'), defaultLayout()));
  assert.equal(savedLayoutOf(list, 'nope'), null);
  assert.equal(uniqueName(list, 'Class'), 'Class 2');
  assert.equal(uniqueName(list, 'default'), 'default 2');
  assert.equal(uniqueName(list, '  '), 'Workspace');
  assert.deepEqual(cleanWorkspaces('x'), []);
});

test('this device’s own: which workspace, and the layout as it stands', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(readDevice(storage), null);
  writeDevice(storage, { current: 'w1', layout: closePanel(defaultLayout(), 'lab') });
  const back = readDevice(storage);
  assert.equal(back.current, 'w1');
  assert.ok(!isOpen(back.layout, 'lab'));
  mem.set(DEVICE_KEY, '{nonsense');
  assert.equal(readDevice(storage), null);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.equal(readDevice(broken), null);
  writeDevice(broken, { current: 'x', layout: null }); // doesn't throw
});
