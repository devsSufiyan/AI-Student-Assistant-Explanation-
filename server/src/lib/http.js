/**
 * Tiny HTTP helpers shared by routes.
 *
 * `asyncHandler` exists because Express 4 does NOT catch rejected promises from
 * async handlers - an unhandled rejection would hang the request. Wrapping every
 * async route forwards errors to the central error middleware instead.
 */

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
