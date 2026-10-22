/**
 * Error handling middleware.
 *
 * Two jobs:
 *   1. `notFound` - turn an unmatched route into a clean JSON 404 (not Express's
 *      default HTML page, which would break a JSON client).
 *   2. `errorHandler` - a single place that maps thrown errors to status codes.
 *      Services throw errors carrying a `.status`, so business logic never has to
 *      know about HTTP response objects. That is what keeps the algorithm
 *      modules testable.
 *
 * Validation errors are the one exception: Zod throws a `ZodError` with an
 * `issues` array, not a `.status`. Mapping it here (rather than in every route)
 * means a malformed request is always a 400 with a readable field-level message,
 * never a 500.
 */

import { ZodError } from 'zod';

export function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args)
export function errorHandler(err, req, res, next) {
  const isValidationError = err instanceof ZodError;
  const status = isValidationError ? 400 : err.status ?? 500;

  // Only leak stack traces for unexpected 500s during development; never for
  // expected 4xx client errors where the message is already user-facing.
  if (status >= 500) {
    console.error('[error]', err);
  }

  const message = isValidationError
    ? err.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ')
    : err.message ?? 'Internal server error';

  res.status(status).json({
    error: message,
    ...(isValidationError ? { issues: err.issues } : {}),
    ...(status >= 500 && process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  });
}
