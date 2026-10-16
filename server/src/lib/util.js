/**
 * Small shared utilities.
 *
 * Deliberately tiny and dependency-free: a two-year engineer keeps the toolbox
 * small so reviewers can read every line.
 */

import crypto from 'node:crypto';

/** Primary keys are random UUIDs - no auto-increment guessing, safe to merge. */
export function newId() {
  return crypto.randomUUID();
}

/** Current time as an ISO string (the storage format for every timestamp). */
export function nowIso() {
  return new Date().toISOString();
}

/** Date-only string (YYYY-MM-DD), used as the study-plan key. */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Clamp a number into [min, max]. Used by every scoring/weighting function. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Days between an ISO timestamp and now (fractional). Null-safe. */
export function daysSince(iso) {
  if (!iso) return Number.POSITIVE_INFINITY; // never practised => "infinitely overdue"
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 86_400_000;
}

/** Round to `dp` decimals - keeps API payloads and DB floats tidy. */
export function round(value, dp = 4) {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
