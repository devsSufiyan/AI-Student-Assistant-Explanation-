/**
 * Vite configuration.
 *
 * The `proxy` is the important part: during development the client runs on 5173
 * and the API on 4000. Proxying `/api` means the browser sees a single origin,
 * so there are no CORS headaches and no environment-specific base URL baked into
 * the client code.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
