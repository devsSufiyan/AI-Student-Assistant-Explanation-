/**
 * Subject + topic routes.
 *
 * Topics form the prerequisite tree that feeds the recommendation engine, so
 * `parentTopicId` is a first-class input here rather than an afterthought.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createSubject,
  listSubjects,
  requireSubject,
  createTopic,
  listTopics,
} from '../modules/subjects/service.js';

const router = Router();
router.use(requireAuth); // every route below requires a logged-in user

router.get(
  '/',
  asyncHandler((req, res) => {
    res.json({ subjects: listSubjects(req.user.id) });
  }),
);

router.post(
  '/',
  asyncHandler((req, res) => {
    const { name } = z.object({ name: z.string().min(1).max(120) }).parse(req.body);
    res.status(201).json({ subject: createSubject({ userId: req.user.id, name }) });
  }),
);

router.get(
  '/:id/topics',
  asyncHandler((req, res) => {
    requireSubject(req.params.id, req.user.id);
    res.json({ topics: listTopics(req.params.id, req.user.id) });
  }),
);

router.post(
  '/:id/topics',
  asyncHandler((req, res) => {
    requireSubject(req.params.id, req.user.id);
    const body = z
      .object({
        name: z.string().min(1).max(160),
        parentTopicId: z.string().nullable().optional(),
        weight: z.number().min(0).max(10).optional(),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
      })
      .parse(req.body);
    res.status(201).json({ topic: createTopic({ subjectId: req.params.id, ...body }) });
  }),
);

export default router;
