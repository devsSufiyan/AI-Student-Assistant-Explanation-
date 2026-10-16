/**
 * Vitest configuration.
 *
 * WHY THIS FILE EXISTS
 *   Vitest transforms test files with Vite. Vite keeps a list of "known" Node
 *   builtins to externalise, and `node:sqlite` (newer than Vite 5's list) is not
 *   on it - so Vite tries to bundle it and fails with "Failed to load url
 *   sqlite". We explicitly externalise every `node:` builtin here so the runtime
 *   provides it, exactly as it does in production.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Let the real Node runtime load builtins instead of Vite bundling them.
    server: { deps: { external: [/^node:/] } },
    // The API tests write a throwaway SQLite file, so keep runs sequential and
    // avoid two workers racing on the same temp paths.
    fileParallelism: false,
  },
  ssr: {
    external: [/^node:/],
  },
});
