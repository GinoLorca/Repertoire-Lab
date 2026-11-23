// Which Chess Arcade page scripts/sync-pieces.mjs and scripts/check-pieces.mjs
// read, and how they name it: the Game Review copy src/lib/arcadeBuild.js
// points at, or `--from <file>` (a Chess Arcade index.html, or a copy). The
// name is a commit and a file name, never a path on this machine, since it
// goes into a committed file.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCADE_REVIEW_URL, ARCADE_FROM } from '../../src/lib/arcadeBuild.js';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function flagValue(args, name) {
  const i = args.indexOf(name);
  return i < 0 ? null : (args[i + 1] ?? '');
}

export function pieceSource(from) {
  if (from) {
    const file = resolve(from);
    let label = `${basename(file)} (not a git checkout)`;
    try {
      const git = (...a) => execFileSync('git', ['-C', dirname(file), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const commit = git('log', '-1', '--format=%h %s');
      const dirty = git('status', '--porcelain', '--', file);
      label = `${commit}${dirty ? ' + uncommitted changes' : ''} (${basename(file)})`;
    } catch { /* not a git checkout */ }
    return { html: readFileSync(file, 'utf8'), label, file, dirty: label.includes(' + uncommitted changes') };
  }
  const file = join(root, 'public', ARCADE_REVIEW_URL);
  return { html: readFileSync(file, 'utf8'), label: `${ARCADE_FROM} (${basename(ARCADE_REVIEW_URL)})`, file, dirty: false };
}
