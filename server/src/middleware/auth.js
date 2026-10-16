/**
 * Auth middleware - protects routes by requiring a valid Bearer token.
 *
 * On success it attaches `req.user` (a public user object). Route handlers can
 * then trust `req.user.id`; they never parse the token themselves.
 */

import { verifyToken, getUserById } from '../modules/auth/service.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }

  try {
    const payload = verifyToken(token);
    const user = getUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    return next();
  } catch (err) {
    return res.status(err.status ?? 401).json({ error: err.message });
  }
}
