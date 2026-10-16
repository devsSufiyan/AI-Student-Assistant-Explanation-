/**
 * SQLite driver shim.
 *
 * WHY THIS INDIRECTION EXISTS
 *   `node:sqlite` is newer than the list of Node builtins that Vite/Vitest knows
 *   about. When a test imports the database module directly, Vite tries to
 *   bundle `node:sqlite` (stripping the `node:` prefix), cannot resolve it, and
 *   the whole suite fails to load.
 *
 *   Loading it through `createRequire` sidesteps Vite entirely: this is a
 *   runtime call, so the bundler cannot see it and leaves it to Node. A useful
 *   side effect is that this file is the SINGLE place tied to the experimental
 *   sqlite API, so replacing the driver later touches only this file.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

export { DatabaseSync };
