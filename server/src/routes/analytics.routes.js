/**
 * Analytics, recommendation, and plan routes - the "insight" endpoints.
 *
 * These are read-mostly; the only mutating one is plan regeneration. Grouping
 * them keeps the mapping from product feature -> endpoint obvious:
 *   /analytics/*       -> learning analytics pillar
 *   /recommendations   -> personalized learning pillar
 *   /plan/*            -> personalized learning pillar (concrete schedule)
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSubject } from '../modules/subjects/service.js';
import { overview, topicAnalytics, accuracyTrend, recommendationFollowThrough } from '../modules/analytics/service.js';
import { getRecommendations, generateRecommendations } from '../modules/recommend/service.js';
import { getTodayPlan, generateTodayPlan } from '../modules/planner/service.js';

const router = Router();
// NOTE: this router is mounted at bare `/api` (it serves /analytics, /recommendations
// and /plan). A blanket `router.use(requireAuth)` here would also intercept
// UNMATCHED /api paths and turn them into 401s instead of 404s, so auth is
// applied per-route below.

router.get(
  '/analytics/overview',
  requireAuth,
  asyncHandler((req, res) => {
    const subjectId = req.query.subjectId ? String(req.query.subjectId) : null;
    if (subjectId) requireSubject(subjectId, req.user.id);
    res.json({
      overview: overview(req.user.id, subjectId),
      trend: accuracyTrend(req.user.id),
      recommendations: recommendationFollowThrough(req.user.id),
    });
  }),
);

router.get(
  '/analytics/topics',
  requireAuth,
  asyncHandler((req, res) => {
    const subjectId = req.query.subjectId ? String(req.query.subjectId) : null;
    if (subjectId) requireSubject(subjectId, req.user.id);
    res.json({ topics: topicAnalytics(req.user.id, subjectId) });
  }),
);

router.get(
  '/recommendations',
  requireAuth,
  asyncHandler((req, res) => {
    const subjectId = req.query.subjectId ? String(req.query.subjectId) : null;
    if (subjectId) requireSubject(subjectId, req.user.id);
    res.json({ recommendations: getRecommendations(req.user.id, subjectId) });
  }),
);

/** Force a recomputation (used after new quiz data lands). */
router.post(
  '/recommendations/regenerate',
  requireAuth,
  asyncHandler((req, res) => {
    const body = z.object({ subjectId: z.string().nullable().optional() }).parse(req.body ?? {});
    res.json({ recommendations: generateRecommendations(req.user.id, body.subjectId ?? null) });
  }),
);

router.get(
  '/plan',
  requireAuth,
  asyncHandler((req, res) => {
    const plan = getTodayPlan(req.user.id) ?? generateTodayPlan(req.user.id);
    res.json({ plan });
  }),
);

router.post(
  '/plan/regenerate',
  requireAuth,
  asyncHandler((req, res) => {
    const body = z.object({ subjectId: z.string().nullable().optional() }).parse(req.body ?? {});
    res.json({ plan: generateTodayPlan(req.user.id, body.subjectId ?? null) });
  }),
);

export default router;
