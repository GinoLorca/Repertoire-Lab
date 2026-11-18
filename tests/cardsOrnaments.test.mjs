// Court Cards' card ornaments: the @cards:ornaments block in src/styles.css, written by
// test-kits/repertoire-lab/ornaments/gen_rl_orn.py (from Chess Arcade's generator). These read the block as text: it
// sits where it should, it is still exactly what the generator wrote (its sha256 stamp), every rule is Court Cards'
// alone, nothing in it can move or size anything, and every drawing is written once in a day and a night form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const STYLES = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const BEGIN = '/* @cards:ornaments */';
const END = '/* @cards:ornaments:end */';
const SK = ':root[data-skin="cards"]';

const block = () => {
  const a = STYLES.indexOf(BEGIN);
  const b = STYLES.indexOf(END);
  assert.ok(a > 0 && b > a, 'the block is in styles.css');
  return STYLES.slice(a, b + END.length);
};
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
// every rule as [media or null, selector, declarations], @media unwrapped
function rules(css) {
  const out = [];
  let rest = noComments(css);
  rest = rest.replace(/@media([^{]+)\{((?:[^{}]*\{[^}]*\})*)\s*\}/g, (m, media, inner) => {
    for (const r of inner.matchAll(/([^{}]+)\{([^}]*)\}/g)) out.push([media.trim(), r[1].trim(), r[2]]);
    return '';
  });
  for (const r of rest.matchAll(/([^{}]+)\{([^}]*)\}/g)) out.push([null, r[1].trim(), r[2]]);
  return out;
}
const splitTop = (sel) => {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
};
const props = (decl) => decl.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean);

test('the block sits right after the board\'s, once, and is still what the generator wrote (its sha256 stamp)', () => {
  assert.equal(STYLES.split(BEGIN).length, 2, 'one block');
  assert.equal(STYLES.split(END).length, 2, 'one end');
  const after = STYLES.indexOf('/* @cards:board:end */\n') + '/* @cards:board:end */\n'.length;
  assert.equal(STYLES.indexOf(BEGIN), after, 'right after @cards:board:end');
  const lines = block().split('\n');
  const stamp = lines[lines.length - 2].match(/sha256 of the lines above, from the opening comment: ([0-9a-f]{64}) \*\/$/);
  assert.ok(stamp, 'the generator\'s stamp is the block\'s last line');
  const body = lines.slice(1, -2).join('\n') + '\n';
  assert.equal(createHash('sha256').update(body).digest('hex'), stamp[1], 'the block was edited by hand: change gen_rl_orn.py and run it');
});

test('ASCII only, and every selector is Court Cards\' alone, written out (no :is() or :where(); :has() only for a next sibling)', () => {
  const css = block();
  assert.ok(!/[^\x00-\x7F]/.test(css), 'ASCII only');
  const all = rules(css);
  assert.ok(all.length > 20, 'the rules are there');
  for (const [, sel] of all) {
    for (const part of splitTop(sel)) {
      assert.ok(part.startsWith(SK), 'unscoped: ' + part);
      assert.ok(!/:is\(|:where\(/.test(part), 'a selector list behind :is()/:where(): ' + part);
      for (const h of part.matchAll(/:has\(\s*(.)/g)) assert.equal(h[1], '+', ':has() other than the next-sibling form: ' + part);
    }
  }
});

test('paint only: no card gets a property that could move or size it; background longhands only; position only on the analysed game\'s card', () => {
  const MOVE = /^(display|padding|margin|font|line-height|z-index|isolation|overflow|width|height|top|left|right|bottom|transform|flex|grid|gap|inset|order|float|clear|contain|zoom|scale|translate|border-(width|style|radius)|border$|border-(top|right|bottom|left)$|outline$|outline-(width|offset|style)|box-sizing|min-|max-)/;
  const positioned = [];
  for (const [, sel, decl] of rules(block())) {
    // no outline on a card either: it paints over the content, and on the move list's card it cost paint (fix round)
    assert.ok(!props(decl).some((q) => q.startsWith('outline')), 'an outline in ' + sel);
    const pseudo = /::(before|after)/.test(sel);
    const ps = props(decl);
    if (pseudo) {
      if (/content:\s*""/.test(decl)) {
        assert.ok(/pointer-events:\s*none/.test(decl), 'a drawn pseudo-element must let clicks through: ' + sel);
        assert.ok(/position:\s*absolute/.test(decl), 'a drawn pseudo-element takes no room: ' + sel);
      }
      continue;
    }
    for (const p of ps) {
      if (p.startsWith('--')) continue;
      if (p === 'position') { positioned.push(sel); continue; }
      assert.ok(!MOVE.test(p), `${p} in ${sel}`);
      if (p.startsWith('background')) assert.ok(/^background-(image|position|size|repeat|origin|attachment)$/.test(p), `${p} in ${sel} (a card keeps its own colour)`);
      if (p.startsWith('border')) assert.equal(p, 'border-color', `${p} in ${sel}`);
    }
  }
  assert.deepEqual(positioned, [SK + ' .panel.analysed-game']);
  assert.ok(/\.panel\.analysed-game \{ position: relative; \}/.test(block()));
});

test('nothing on a list row or a chapter card (the corners there cost paint on a long Library)', () => {
  for (const [, sel] of rules(block())) {
    for (const row of ['.vl-item', '.tree-row', '.variation-row', '.opening-row', '.sheet-row', '.chapter-card']) {
      if (row === '.variation-row') continue;      // (a line's move numbers are coloured inside it: below)
      assert.ok(!sel.includes(row), `${row} in ${sel}`);
    }
    // a variation row's own box is never dressed: only the move numbers inside its moves
    for (const part of splitTop(sel)) if (part.includes('.variation-')) assert.ok(/\.variation-moves \.mvnum$/.test(part), part);
  }
});

test('every drawing written once, a day and a night form of each, and the live names point day at -d, night at -n', () => {
  const css = block();
  const uris = [...css.matchAll(/url\("data:image\/svg\+xml,[^"]+"\)/g)].map((m) => m[0]);
  assert.equal(new Set(uris).size, uris.length, 'each drawing once');
  const defs = [...css.matchAll(/(--cc-orn-[a-z]+)-(d|n): url\("data:image\/svg\+xml,%3Csvg id='o-([a-z]+)-(d|n)'/g)];
  assert.equal(defs.length, uris.length, 'every drawing is a -d or -n token named after its own id');
  for (const m of defs) assert.equal(m[1].slice('--cc-orn-'.length) + '-' + m[2], m[3] + '-' + m[4], 'token and drawing agree');
  const names = [...new Set(defs.map((m) => m[3]))].sort();
  for (const n of names) {
    assert.ok(defs.some((m) => m[3] === n && m[4] === 'd') && defs.some((m) => m[3] === n && m[4] === 'n'), n + ' has both forms');
  }
  const night = css.slice(css.indexOf(SK + ' {'), css.indexOf('}', css.indexOf(SK + ' {')));
  const day = css.slice(css.indexOf(SK + '[data-theme="light"] {'), css.indexOf('}', css.indexOf(SK + '[data-theme="light"] {')));
  for (const n of names) {
    assert.ok(night.includes(`--cc-orn-${n}: var(--cc-orn-${n}-n);`), n + ' at night');
    assert.ok(day.includes(`--cc-orn-${n}: var(--cc-orn-${n}-d);`), n + ' by day');
  }
  // every drawing a rule wears is defined, and nothing is defined that no rule wears
  const worn = new Set([...noComments(css).matchAll(/var\(--cc-orn-([a-z]+)\)/g)].map((m) => m[1]).filter((n) => names.includes(n) || /^(b|r)?(tl|tr|bl|br)$|^crest/.test(n)));
  assert.deepEqual([...worn].sort(), names);
});

test('the frame and the corners: on the cards planned, never on a dock\'s placeholder or a panel drawn flat inside a group of tabs', () => {
  const css = noComments(block());
  for (const host of ['.panel:not(.dock-placeholder)', '.practice-status', '.settings-section', '.modal', '.sheet']) {
    assert.ok(new RegExp(SK.replace(/[[\]"]/g, '\\$&') + ' ' + host.replace(/[.()]/g, '\\$&') + '[,\\s{]').test(css), host + ' has the frame');
  }
  const flat = SK + ' .dock-tabs .panel { border-color: currentcolor; box-shadow: none; background-image: none; }';
  assert.ok(css.includes(flat));
  // it wins over the panels' frame and corners by coming after them (the same strength)
  const corners = css.indexOf(SK + ' .panel:not(.dock-placeholder) { background-image:');
  assert.ok(corners > 0 && css.indexOf(flat) > corners, 'the flat-panel rule comes after the panels\' corners');
  // the sheet takes the frame alone
  for (const [, sel, decl] of rules(block())) if (splitTop(sel).some((p) => p === SK + ' .sheet')) assert.ok(!/background-image/.test(decl), 'no corners on a sheet');
});

test('over a custom wallpaper: a see-through card keeps its edge light and corners, no band and no rule (no ring); dialogs and sheets keep the frame', () => {
  const all = rules(block());
  const BG = SK + '.has-custom-bg';
  const find = (part) => all.find(([media, sel]) => !media && splitTop(sel).includes(part));
  for (const host of ['.panel:not(.dock-placeholder)', '.practice-status', '.settings-section']) {
    const r = find(BG + ' ' + host);
    assert.ok(r, host + ' has a wallpaper rule');
    assert.match(r[2], /box-shadow: var\(--cc-orn-frame-x\), 0 6px 22px var\(--shadow\);/, host + ': the edge light and the lift, no 5 px shadow ring under a see-through band');
    assert.match(r[2], /border-color: var\(--outline\)/, host + ': the wallpaper\'s high-contrast edge');
  }
  for (const host of ['.modal', '.sheet']) assert.match(find(BG + ' ' + host)[2], /var\(--cc-orn-frame-p\)/, host + ' stays opaque: the frame as it is');
  // the x tokens carry no 5 px rule and no 4 px band, day or night
  const css = block();
  const night = css.slice(css.indexOf(SK + ' {'), css.indexOf('}', css.indexOf(SK + ' {')));
  const day = css.slice(css.indexOf(SK + '[data-theme="light"] {'), css.indexOf('}', css.indexOf(SK + '[data-theme="light"] {')));
  for (const t of [night, day]) {
    const x = t.match(/--cc-orn-frame-x: ([^;]+);/)[1];
    assert.ok(!/5px/.test(x) && !/4px/.test(x), 'no rule or band over a wallpaper: ' + x);
  }
  // a panel drawn flat inside a group of tabs keeps the wallpaper's edge and lift alone
  assert.match(find(BG + ' .dock-tabs .panel')[2], /^\s*border-color: var\(--outline\); box-shadow: 0 6px 22px var\(--shadow\);\s*$/);
});

test('a matched repertoire card keeps its green edge (the gilt edge on an unmatched one only)', () => {
  const all = rules(block());
  const edge = all.filter(([, , decl]) => /border-color: var\(--cc-orn-edge\)/.test(decl));
  const parts = edge.flatMap(([, sel]) => splitTop(sel));
  assert.ok(parts.includes(SK + ' .panel:not(.dock-placeholder, .book-panel-summary)'));
  assert.ok(parts.includes(SK + ' .book-panel-summary.unmatched'));
  for (const p of parts) if (/\.panel\b/.test(p)) assert.ok(/\.book-panel-summary\)/.test(p) || /\.dock-/.test(p), 'a gilt edge that would cover the green one: ' + p);
});

test('the analysed game\'s crest: none where nothing is free above that card (a tight Analysis page, customizing Studio, a tab group)', () => {
  const all = rules(block());
  const off = all.filter(([, , decl]) => /display: none/.test(decl)).flatMap(([, sel]) => splitTop(sel));
  for (const w of ['.tight-page', '.dock-group.customizing', '.dock-tabs']) assert.ok(off.includes(`${SK} ${w} .panel.analysed-game::before`), w);
  const css = noComments(block());
  assert.ok(css.indexOf(SK + ' .tight-page .panel.analysed-game::before') > css.indexOf(SK + ' .panel.analysed-game::before {'), 'after the crest itself');
});
