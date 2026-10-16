/**
 * Authentication service - registration, login, and token handling.
 *
 * Choices worth defending in a report:
 *   - bcrypt for password hashing (adaptive cost, salted per user). We never
 *     store or log the plaintext password, and we never return password_hash.
 *   - JWT (stateless) rather than server sessions, so the API and a separately
 *     hosted client can be deployed independently. For a mini project that keeps
 *     the two halves decoupled.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { get, run } from '../../db/index.js';
import { newId, nowIso } from '../../lib/util.js';
import { SERVER } from '../../config/constants.js';

const BCRYPT_ROUNDS = 10; // cost factor; ~100ms on a laptop, good enough for a demo

/** Strip secrets before a user object leaves the server. */
export function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

/** Create a user. Throws a 409-shaped error if the email is taken. */
export function registerUser({ name, email, password, goal = null, examDate = null, dailyMinutes = 45 }) {
  const normalisedEmail = String(email).trim().toLowerCase();
  const existing = get(`SELECT id FROM users WHERE email = ?`, normalisedEmail);
  if (existing) {
    throw Object.assign(new Error('Email already registered'), { status: 409 });
  }

  const id = newId();
  run(
    `INSERT INTO users (id, name, email, password_hash, goal, exam_date, daily_minutes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    normalisedEmail,
    bcrypt.hashSync(password, BCRYPT_ROUNDS),
    goal,
    examDate,
    dailyMinutes,
    nowIso(),
  );

  return publicUser(get(`SELECT * FROM users WHERE id = ?`, id));
}

/** Verify credentials and return the user, or throw a 401-shaped error. */
export function authenticateUser({ email, password }) {
  const user = get(`SELECT * FROM users WHERE email = ?`, String(email).trim().toLowerCase());
  // Same generic error whether the email is unknown or the password is wrong,
  // so the endpoint cannot be used to enumerate registered emails.
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }
  return publicUser(user);
}

/** Issue a signed JWT whose subject is the user id. */
export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, SERVER.JWT_SECRET, {
    expiresIn: SERVER.JWT_EXPIRES_IN,
  });
}

/** Verify a token and return its payload, or throw a 401-shaped error. */
export function verifyToken(token) {
  try {
    return jwt.verify(token, SERVER.JWT_SECRET);
  } catch {
    throw Object.assign(new Error('Invalid or expired token'), { status: 401 });
  }
}

/** Load a user by id (used by the auth middleware on every request). */
export function getUserById(id) {
  return publicUser(get(`SELECT * FROM users WHERE id = ?`, id));
}
