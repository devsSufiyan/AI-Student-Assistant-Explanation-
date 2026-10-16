/**
 * RAG route: ask a question against a subject's indexed material.
 *
 * Side effect: every query is logged as a `learning_event` (query + how many
 * chunks were retrieved). That log is the raw material for the RAG evaluation
 * in PLAN.md section 14A.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { run } from '../db/index.js';
import { newId, nowIso } from '../lib/util.js';
import { requireSubject } from '../modules/subjects/service.js';
import { answerQuestion } from '../modules/rag/index.js';

const router = Router();
router.use(requireAuth);

router.post(
  '/query',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        subjectId: z.string(),
        question: z.string().min(3).max(500),
      })
      .parse(req.body);

    requireSubject(body.subjectId, req.user.id);

    const result = await answerQuestion({ subjectId: body.subjectId, question: body.question });

    // Log for evaluation: did retrieval find anything, and did we refuse?
    run(
      `INSERT INTO learning_events (id, user_id, type, subject_id, topic_id, payload, created_at)
       VALUES (?, ?, 'asked_question', ?, NULL, ?, ?)`,
      newId(),
      req.user.id,
      body.subjectId,
      JSON.stringify({
        question: body.question,
        retrieved: result.retrieved?.length ?? 0,
        refused: result.refused,
        provider: result.provider,
      }),
      nowIso(),
    );

    res.json(result);
  }),
);

export default router;
