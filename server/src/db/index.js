/**
 * Database access layer.
 *
 * WHY node:sqlite?
 *   It ships with Node >=22.5. No native compilation, no Prisma engine download,
 *   no codegen step. For a self-contained mini project that must run on any
 *   examiner's laptop, that reliability is worth more than an ORM's conveniences.
 *
 * This module owns:
 *   - opening the single SQLite file and creating `data/` if needed
 *   - applying schema.sql (idempotent: every statement uses IF NOT EXISTS)
 *   - tiny query helpers so modules never touch the raw driver API
 *
 * CONVENTION: helpers return plain JS objects. Booleans are stored as 0/1
 * because SQLite has no boolean type - helpers here do NOT convert them, so
 * modules must treat `is_correct` etc. as integers.
 */

import { DatabaseSync } from './sqlite.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB } from '../config/constants.js';

// Server root = two directories up from src/db/. Used so relative paths in
// config work no matter which directory `npm run` was invoked from.
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Resolve a config-relative path against the server root, creating dirs. */
export function resolveDataPath(relPath) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(SERVER_ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

const dbFile = resolveDataPath(DB.FILE);

export const db = new DatabaseSync(dbFile);

// Foreign keys are OFF by default in SQLite; turn them on before anything else.
db.exec('PRAGMA foreign_keys = ON;');
// WAL gives better read concurrency for the dev server without extra setup.
db.exec('PRAGMA journal_mode = WAL;');

/** Apply the schema. Safe to run on every boot (all statements are idempotent). */
export function migrate() {
  const schema = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'),
    'utf8',
  );
  db.exec(schema);
}

/** Run a statement (INSERT/UPDATE/DELETE). Returns { changes, lastInsertRowid }. */
export function run(sql, ...params) {
  return db.prepare(sql).run(...normalize(params));
}

/** Fetch a single row, or undefined. */
export function get(sql, ...params) {
  return db.prepare(sql).get(...normalize(params));
}

/** Fetch all rows as an array. */
export function all(sql, ...params) {
  return db.prepare(sql).all(...normalize(params));
}

/**
 * Run `fn` inside a transaction. Any thrown error rolls the whole thing back.
 *
 * We use this for the answer-grading path, which writes to THREE tables
 * (answers, topic_mastery, learning_events) - they must succeed or fail together
 * or the mastery cache will disagree with the raw evidence.
 */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * node:sqlite only accepts null/number/bigint/string/Buffer. JS booleans and
 * undefined are common mistakes, so we normalise them here rather than letting
 * a cryptic driver error escape.
 */
function normalize(params) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}
