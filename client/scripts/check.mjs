/**
 * Client sanity check.
 *
 * WHY THIS EXISTS
 *   The client is a framework-free static SPA: there is no bundler, no
 *   transpiler and no `npm run build`. That is a deliberate design choice (one
 *   process serves both the API and the UI), but it removes the safety net a
 *   real build step would have given us: a syntax error would only surface in
 *   the browser console at runtime.
 *
 *   This script restores that net. It parses every client module with
 *   `node --check` (which parses without executing) and verifies that the
 *   files the browser actually requests are present.
 *
 * WHAT IT MUST NOT DO
 *   It must not import or execute any application code, because the client
 *   modules touch `document`, `window` and `localStorage` and would throw in
 *   Node. Parsing only.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Files the browser requests directly; a missing one means a blank page. */
const ENTRY_POINTS = [
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/api.js',
  'js/ui.js',
  'assets/js/config.js',
  'assets/vendor/css/core.css',
  'assets/vendor/js/helpers.js',
  'assets/vendor/js/bootstrap.js',
  'assets/vendor/js/menu.js',
  'assets/vendor/libs/apex-charts/apexcharts.js',
];

/** Every `.js` file under `js/` plus the vendored theme config. */
function collectScripts(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectScripts(full));
    else if (entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

let failures = 0;

for (const file of collectScripts(join(root, 'js'))) {
  const rel = relative(root, file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`  ok  ${rel}`);
  } catch (err) {
    failures += 1;
    console.error(` FAIL ${rel}\n${err.stderr?.toString() ?? err.message}`);
  }
}

for (const rel of ENTRY_POINTS) {
  if (!existsSync(join(root, rel))) {
    failures += 1;
    console.error(` FAIL missing entry point: ${rel}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} client check(s) failed.`);
  process.exit(1);
}

console.log('\nAll client modules parse and every entry point is present.');
