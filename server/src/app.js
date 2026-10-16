/**
 * Express application assembly.
 *
 * Kept separate from `index.js` (which starts the server) so tests can import
 * the app and hit it with supertest WITHOUT binding a port. This is the standard
 * split that makes an HTTP API testable.
 */

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.routes.js';
import subjectRoutes from './routes/subjects.routes.js';
import materialRoutes from './routes/materials.routes.js';
import ragRoutes from './routes/rag.routes.js';
import quizRoutes from './routes/quiz.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import { notFound, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  // CORS is enabled for local development (Vite runs on a different port). In a
  // real deployment you would restrict this to your own origin.
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // Liveness probe - used by the client to show "server connected" and by tests.
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/subjects', subjectRoutes);
  // Material uploads are nested under a subject, so they share that prefix.
  app.use('/api/subjects', materialRoutes);
  app.use('/api/rag', ragRoutes);
  app.use('/api/quiz', quizRoutes);
  app.use('/api', analyticsRoutes);

  // Optionally serve a built client (npm run build in ../client). During
  // development the Vite dev server proxies /api here instead.
  const clientDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'client',
    'dist',
  );
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // SPA fallback: any non-API GET returns index.html so client routing works.
    app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
