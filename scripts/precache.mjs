// Runs after `vite build`. Lists what the app needs to start and writes that
// list into dist/sw.js, so the service worker can cache the whole shell during
// install instead of waiting for the page to report what it loaded. That is the
// difference between the app opening underground and not opening at all.
//
// The big optional payloads (Stockfish, Tesseract) stay out of the install:
// they're tens of megabytes, only some screens need them, and a failed install
// would mean no offline app at all. They're still cached on first use by the
// worker's runtime rules.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname: a project path with a space in it arrives
// percent-encoded otherwise.
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const SKIP_DIRS = new Set(['stockfish', 'tesseract', 'netlify']);
const SKIP_FILES = new Set(['sw.js', 'netlify.toml']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(dist, full);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) out.push(...walk(full));
    } else if (!SKIP_FILES.has(rel)) {
      out.push(`/${rel}`);
    }
  }
  return out;
}

const files = walk(dist).sort();
// '/' and '/index.html' are the same document; both are asked for in practice.
const urls = ['/', ...files];
const version = `v${Date.now().toString(36)}`;

const swPath = join(dist, 'sw.js');
const source = readFileSync(swPath, 'utf8');
const patched = source
  .replace('__PRECACHE_URLS__', JSON.stringify(urls))
  .replace('__CACHE_VERSION__', version);

if (patched === source) {
  console.error('precache: placeholders not found in sw.js — offline shell NOT updated');
  process.exit(1);
}

writeFileSync(swPath, patched);
console.log(`precache: ${urls.length} files pinned for offline (${version})`);
