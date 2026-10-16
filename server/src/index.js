/**
 * Server entry point.
 *
 * Boot order matters: migrate the database BEFORE the app starts accepting
 * requests, otherwise the first query against a fresh install fails.
 */

import { createApp } from './app.js';
import { migrate } from './db/index.js';
import { SERVER, LLM, EMBEDDING } from './config/constants.js';

migrate();

const app = createApp();

app.listen(SERVER.PORT, () => {
  // A single startup banner makes it obvious which providers are active - the
  // number one question when a demo behaves unexpectedly is "which model ran?".
  console.log('──────────────────────────────────────────────');
  console.log(`  AI Study Assistant API`);
  console.log(`  http://localhost:${SERVER.PORT}`);
  console.log(`  LLM provider        : ${LLM.PROVIDER}`);
  console.log(`  Embedding provider  : ${EMBEDDING.PROVIDER}`);
  console.log('──────────────────────────────────────────────');
});
