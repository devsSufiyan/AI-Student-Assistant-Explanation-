/**
 * API client — the single place where the browser talks to the server.
 *
 * WHY A SINGLE MODULE
 *   The token is attached in one place, non-2xx responses become thrown Errors
 *   (so views can try/catch instead of checking `res.ok` everywhere), and a 401
 *   can clear the session globally.
 *
 * PURE JAVASCRIPT
 *   No axios, no fetch wrapper library, no React. Just `fetch` + promises.
 */

const BASE = '/api';
const TOKEN_KEY = 'study_assistant_token';

/** Read the JWT from localStorage (persisted login across refreshes). */
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Persist or clear the JWT. */
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private-mode storage failures are non-fatal */
  }
}

/**
 * Core request helper.
 *
 * @param {string} path   e.g. "/subjects" (the "/api" prefix is added here)
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {any}    [options.body]     JSON-serialised unless `raw` is true
 * @param {string} [options.token]    override the stored token
 * @param {boolean}[options.raw]      send `body` as-is (FormData)
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<any>}
 * @throws {Error} with `.status` when the server returns a non-2xx response
 */
export async function api(path, { method = 'GET', body, token, raw = false, signal } = {}) {
  const headers = {};
  if (!raw) headers['Content-Type'] = 'application/json';

  const auth = token ?? getToken();
  if (auth) headers.Authorization = `Bearer ${auth}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  // 204 has no body; guard before calling res.json().
  const payload = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const err = new Error(payload?.error ?? `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return payload;
}

/** Upload a file as multipart form data (the browser sets the boundary). */
export function upload(path, formData, options = {}) {
  return api(path, { ...options, method: 'POST', body: formData, raw: true });
}
