/**
 * API client - the ONLY place the browser talks to the server.
 *
 * WHY A SINGLE MODULE
 *   Centralising fetch means: the token is attached in one place, errors are
 *   normalised into thrown JS Errors (so components can try/catch instead of
 *   checking res.ok everywhere), and 401s can log the user out globally.
 */

const BASE = '/api';

/** Read the JWT from localStorage (persisted login across refreshes). */
export function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

/**
 * Core request helper.
 * @throws {Error} with a `.status` when the server returns a non-2xx response.
 */
export async function api(path, { method = 'GET', body, token, raw = false } = {}) {
  const headers = {};
  if (!raw) headers['Content-Type'] = 'application/json';
  const auth = token ?? getToken();
  if (auth) headers.Authorization = `Bearer ${auth}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
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

/** Upload a file as multipart form data (browser sets the boundary itself). */
export function upload(path, formData) {
  return api(path, { method: 'POST', body: formData, raw: true });
}
