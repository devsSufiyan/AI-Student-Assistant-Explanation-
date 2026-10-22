/**
 * Auth routes: register, login, and "who am I".
 * These are the ONLY routes that are not behind `requireAuth`.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import {
  registerUser,
  authenticateUser,
  signToken,
  updateUserProfile,
} from '../modules/auth/service.js';

const router = Router();

// Validation at the edge: reject malformed input before it reaches the service,
// so business logic can assume well-formed data.
const registerSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  goal: z.string().max(200).optional().nullable(),
  examDate: z.string().optional().nullable(),
  dailyMinutes: z.number().int().min(5).max(600).optional(),
});

router.post(
  '/register',
  asyncHandler((req, res) => {
    const body = registerSchema.parse(req.body);
    const user = registerUser(body);
    res.status(201).json({ user, token: signToken(user) });
  }),
);

router.post(
  '/login',
  asyncHandler((req, res) => {
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const user = authenticateUser(body);
    res.json({ user, token: signToken(user) });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler((req, res) => {
    res.json({ user: req.user });
  }),
);

/**
 * Update the student's profile settings.
 *
 * Everything here feeds another subsystem: `examDate` drives recommendation
 * urgency, `dailyMinutes` drives the planner's minute budget, and `goal` is
 * surfaced in the dashboard. Keeping them editable is what makes the system
 * feel personalised rather than hard-coded at registration.
 */
router.patch(
  '/me',
  requireAuth,
  asyncHandler((req, res) => {
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        goal: z.string().max(200).nullable().optional(),
        // Accept an ISO date (YYYY-MM-DD) or null to clear it.
        examDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'examDate must be YYYY-MM-DD')
          .nullable()
          .optional(),
        dailyMinutes: z.number().int().min(5).max(600).optional(),
      })
      .strict()
      .parse(req.body);

    res.json({ user: updateUserProfile(req.user.id, body) });
  }),
);

export default router;
