/**
 * Quiz routes: generate questions, run an attempt, answer, and finish.
 *
 * The attempt flow mirrors real adaptive testing:
 *   start  -> GET next (repeatedly) -> POST answer -> GET next -> finish
 * The server always decides the next question (client never picks it), and the
 * answer key never leaves the server until the question has been answered.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { all } from '../db/index.js';
import { requireTopic } from '../modules/subjects/service.js';
import { generateQuestions } from '../modules/quiz/generate.js';
import {
  startAttempt,
  nextQuestion,
  submitAnswer,
  finishAttempt,
  getAttempt,
} from '../modules/quiz/service.js';

const router = Router();
router.use(requireAuth);

/** Generate (and persist) fresh questions for a topic from its material. */
router.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        topicId: z.string(),
        count: z.number().int().min(1).max(20).optional(),
      })
      .parse(req.body);

    const topic = requireTopic(body.topicId, req.user.id);
    const result = await generateQuestions({
      subjectId: topic.subject_id,
      topicId: topic.id,
      count: body.count ?? 5,
    });

    // Don't leak correct_index in the generate response either.
    res.status(201).json({
      created: result.created,
      skipped: result.skipped ?? 0,
      provider: result.provider,
      reason: result.reason ?? null,
      questions: (result.questions ?? []).map((q) => ({
        id: q.id,
        stem: q.stem,
        options: JSON.parse(q.options),
        difficulty: q.difficulty,
      })),
    });
  }),
);

/** Number of stored questions for a topic, so the UI can prompt to generate. */
router.get(
  '/topics/:topicId/questions/count',
  asyncHandler(async (req, res) => {
    requireTopic(req.params.topicId, req.user.id);
    const rows = all(`SELECT id FROM questions WHERE topic_id = ?`, req.params.topicId);
    res.json({ count: rows.length });
  }),
);

/** Start an attempt. `mode` selects adaptive (default) or the fixed control. */
router.post(
  '/attempts',
  asyncHandler((req, res) => {
    const body = z
      .object({ topicId: z.string(), mode: z.enum(['adaptive', 'fixed']).optional() })
      .parse(req.body);
    requireTopic(body.topicId, req.user.id);
    res.status(201).json({ attempt: startAttempt({ userId: req.user.id, ...body }) });
  }),
);

/** Get the next question for an attempt. */
router.get(
  '/attempts/:id/next',
  asyncHandler((req, res) => {
    res.json(nextQuestion({ attemptId: req.params.id, userId: req.user.id }));
  }),
);

/** Grade one answer and return immediate teaching feedback. */
router.post(
  '/attempts/:id/answer',
  asyncHandler((req, res) => {
    const body = z
      .object({
        questionId: z.string(),
        selectedIndex: z.number().int().min(0).max(3),
        timeMs: z.number().int().min(0).max(3_600_000).optional(),
      })
      .parse(req.body);

    const feedback = submitAnswer({ attemptId: req.params.id, userId: req.user.id, ...body });
    res.json({ feedback });
  }),
);

/** Finish the attempt; returns the final score. */
router.post(
  '/attempts/:id/finish',
  asyncHandler((req, res) => {
    res.json({ attempt: finishAttempt({ attemptId: req.params.id, userId: req.user.id }) });
  }),
);

/** Read an attempt (used to resume or review). */
router.get(
  '/attempts/:id',
  asyncHandler((req, res) => {
    res.json({ attempt: getAttempt(req.params.id, req.user.id) });
  }),
);

export default router;
