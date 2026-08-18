// Zips dist/ into repertoire-lab-site.zip at the repo root — a ready-to-drop
// bundle for Netlify's manual deploy (drag a folder/zip onto app.netlify.com).
// Run via `npm run zip` (which builds first) any time dist/ changes.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const zipPath = fileURLToPath(new URL('../repertoire-lab-site.zip', import.meta.url));

if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

if (existsSync(zipPath)) rmSync(zipPath);

// COPYFILE_DISABLE keeps macOS from writing AppleDouble "._*" resource-fork
// files into the archive; -X drops extended attrs for the same reason.
execFileSync('zip', ['-rXq', zipPath, '.', '-x', '.DS_Store'], {
  cwd: dist,
  env: { ...process.env, COPYFILE_DISABLE: '1' },
  stdio: 'inherit',
});

console.log(`Wrote ${zipPath.replace(root, '')}`);
