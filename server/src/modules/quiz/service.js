/**
 * Quiz attempt service - orchestrates starting, serving, grading, and finishing.
 *
 * KEY SECURITY/INTEGRITY RULE
 *   `nextQuestion` strips `correct_index` before the question leaves the server.
 *   If we sent the answer to the browser, grading would be trivially fakeable and
 *   every downstream mastery score would be meaningless.
 *
 * KEY CONSISTENCY RULE
 *   Grading delegates to mastery/service.recordAnswer, which is transactional.
 *   This module never writes to `answers` or `topic_mastery` itself.
 */

import { all, get, run } from '../../db/index.js';
import { newId, nowIso } from '../../lib/util.js';
import { getOrCreateMastery } from '../mastery/service.js';
import { recordAnswer } from '../mastery/service.js';
import { selectNextQuestion, explainSelection } from './adaptive.js';
import { hydrateQuestion } from './generate.js';

/** Strip the answer key and parse options - the safe shape for the client. */
function publicQuestion(row) {
  return {
    id: row.id,
    stem: row.stem,
    options: JSON.parse(row.options),
    difficulty: row.difficulty,
    topicId: row.topic_id,
  };
}

/** Load an attempt, enforcing that it belongs to the requesting user. */
export function getAttempt(attemptId, userId) {
  const attempt = get(`SELECT * FROM quiz_attempts WHERE id = ?`, attemptId);
  if (!attempt) throw Object.assign(new Error('Attempt not found'), { status: 404 });
  if (attempt.user_id !== userId) {
    throw Object.assign(new Error('Not your attempt'), { status: 403 });
  }
  return attempt;
}

/** Begin a new attempt for a topic. */
export function startAttempt({ userId, topicId, mode = 'adaptive' }) {
  const topic = get(`SELECT * FROM topics WHERE id = ?`, topicId);
  if (!topic) throw Object.assign(new Error('Topic not found'), { status: 404 });

  const id = newId();
  const now = nowIso();
  run(
    `INSERT INTO quiz_attempts (id, user_id, topic_id, mode, started_at)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    userId,
    topicId,
    mode === 'fixed' ? 'fixed' : 'adaptive',
    now,
  );

  run(
    `INSERT INTO learning_events (id, user_id, type, subject_id, topic_id, payload, created_at)
     VALUES (?, ?, 'quiz_started', ?, ?, ?, ?)`,
    newId(),
    userId,
    topic.subject_id,
    topicId,
    JSON.stringify({ mode }),
    now,
  );

  return get(`SELECT * FROM quiz_attempts WHERE id = ?`, id);
}

/** Ids of questions already answered within one attempt. */
function answeredIds(attemptId) {
  return all(`SELECT question_id FROM answers WHERE attempt_id = ?`, attemptId).map(
    (r) => r.question_id,
  );
}

/**
 * Serve the next question for an attempt.
 *
 * adaptive: pick the candidate whose predicted success is closest to 0.6.
 * fixed:    serve questions in insertion order (the control condition for
 *           comparing adaptive vs non-adaptive in the evaluation).
 *
 * @returns {object|null} `{ question, meta }`, or null when the quiz is exhausted
 */
export function nextQuestion({ attemptId, userId }) {
  const attempt = getAttempt(attemptId, userId);
  if (attempt.finished_at) return { done: true, question: null };

  const rows = all(
    `SELECT * FROM questions WHERE topic_id = ? ORDER BY created_at ASC`,
    attempt.topic_id,
  );
  if (rows.length === 0) return { done: true, question: null, reason: 'No questions for this topic yet.' };

  const answered = answeredIds(attemptId);
  const mastery = getOrCreateMastery(userId, attempt.topic_id);

  let chosen = null;
  if (attempt.mode === 'adaptive') {
    chosen = selectNextQuestion(rows, mastery.ability, answered);
  } else {
    chosen = rows.find((r) => !answered.includes(r.id)) ?? null;
  }

  if (!chosen) return { done: true, question: null };

  return {
    done: false,
    question: publicQuestion(chosen),
    meta: explainSelection(chosen, mastery.ability),
    progress: { answered: answered.length, total: rows.length },
  };
}

/**
 * Grade one answer and return immediate feedback.
 *
 * The feedback includes the correct option and explanation - this is a study
 * tool, not an exam, so we teach right after the mistake.
 */
export function submitAnswer({ attemptId, userId, questionId, selectedIndex, timeMs = 0 }) {
  const attempt = getAttempt(attemptId, userId);
  if (attempt.finished_at) {
    throw Object.assign(new Error('Attempt already finished'), { status: 400 });
  }

  const question = get(`SELECT * FROM questions WHERE id = ?`, questionId);
  if (!question || question.topic_id !== attempt.topic_id) {
    throw Object.assign(new Error('Question does not belong to this attempt'), { status: 400 });
  }

  // Idempotency guard: re-answering the same question would double-count the
  // evidence and inflate mastery. Reject duplicates outright.
  const already = get(
    `SELECT id FROM answers WHERE attempt_id = ? AND question_id = ?`,
    attemptId,
    questionId,
  );
  if (already) {
    throw Object.assign(new Error('Question already answered in this attempt'), { status: 409 });
  }

  const result = recordAnswer({
    attemptId,
    userId,
    topicId: attempt.topic_id,
    questionId,
    selectedIndex,
    timeMs,
    question,
  });

  // Keep the attempt's running score in sync for cheap listing in the UI.
  run(
    `UPDATE quiz_attempts SET total = total + 1, correct = correct + ? WHERE id = ?`,
    result.isCorrect ? 1 : 0,
    attemptId,
  );

  return {
    isCorrect: result.isCorrect,
    correctIndex: question.correct_index,
    explanation: question.explanation ?? null,
    masteryBefore: Number(result.masteryBefore.toFixed(4)),
    masteryAfter: Number(result.masteryAfter.toFixed(4)),
    masteryDelta: Number((result.masteryAfter - result.masteryBefore).toFixed(4)),
  };
}

/**
 * Build a full post-quiz review: every question, what the student chose, the
 * correct answer, and WHY - plus the source sentence from their own material.
 *
 * This is what turns a score into a learning moment, so the payload is
 * deliberately rich: the explanation and the source excerpt let the student see
 * where the answer came from rather than just being told they were wrong.
 */
export function reviewAttempt({ attemptId, userId }) {
  const attempt = getAttempt(attemptId, userId);

  const rows = all(
    `SELECT a.selected_index, a.is_correct, a.time_ms,
            a.mastery_before, a.mastery_after, a.created_at,
            q.id AS question_id, q.stem, q.options, q.correct_index,
            q.explanation, q.difficulty, q.source_chunk_id,
            c.text AS source_text
       FROM answers a
       JOIN questions q ON q.id = a.question_id
       LEFT JOIN chunks c ON c.id = q.source_chunk_id
      WHERE a.attempt_id = ?
      ORDER BY a.created_at ASC, a.rowid ASC`,
    attemptId,
  );

  const questions = rows.map((r) => ({
    questionId: r.question_id,
    stem: r.stem,
    options: JSON.parse(r.options),
    correctIndex: r.correct_index,
    selectedIndex: r.selected_index,
    isCorrect: Boolean(r.is_correct),
    difficulty: r.difficulty,
    // The reason: generated by the provider from the source sentence. May be
    // null for manually authored questions, so the UI falls back to sourceText.
    explanation: r.explanation ?? null,
    sourceText: r.source_text ? r.source_text.slice(0, 420) : null,
    masteryBefore: Number(Number(r.mastery_before).toFixed(4)),
    masteryAfter: Number(Number(r.mastery_after).toFixed(4)),
    timeMs: r.time_ms,
  }));

  const total = questions.length;
  const correct = questions.filter((q) => q.isCorrect).length;

  // Mastery journey across the attempt: from before the first answer to after
  // the last, which is the number that actually matters to the student.
  const masteryStart = total > 0 ? questions[0].masteryBefore : null;
  const masteryEnd = total > 0 ? questions[total - 1].masteryAfter : null;

  // Per-difficulty breakdown, so "I got the easy ones but missed the hard ones"
  // is visible at a glance instead of hidden inside one aggregate score.
  const byDifficulty = {};
  for (const q of questions) {
    const bucket = byDifficulty[q.difficulty] ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (q.isCorrect) bucket.correct += 1;
    byDifficulty[q.difficulty] = bucket;
  }

  return {
    attempt: {
      id: attempt.id,
      topicId: attempt.topic_id,
      mode: attempt.mode,
      startedAt: attempt.started_at,
      finishedAt: attempt.finished_at,
    },
    questions,
    summary: {
      correct,
      total,
      accuracy: total > 0 ? Number((correct / total).toFixed(4)) : 0,
      masteryStart,
      masteryEnd,
      masteryGain:
        masteryStart !== null && masteryEnd !== null
          ? Number((masteryEnd - masteryStart).toFixed(4))
          : null,
      byDifficulty,
    },
  };
}

/** Finish the attempt and mark any matching recommendation as consumed. */
export function finishAttempt({ attemptId, userId }) {
  const attempt = getAttempt(attemptId, userId);
  const now = nowIso();

  run(`UPDATE quiz_attempts SET finished_at = ? WHERE id = ?`, now, attemptId);

  // "Consumed" = the recommendation actually led to study. This is exactly the
  // signal the recommendation evaluation (Precision@N) is measured against.
  run(
    `UPDATE recommendations
       SET consumed_at = ?
     WHERE user_id = ? AND topic_id = ? AND consumed_at IS NULL`,
    now,
    userId,
    attempt.topic_id,
  );

  run(
    `INSERT INTO learning_events (id, user_id, type, subject_id, topic_id, payload, created_at)
     VALUES (?, ?, 'quiz_finished', NULL, ?, ?, ?)`,
    newId(),
    userId,
    attempt.topic_id,
    JSON.stringify({ correct: attempt.correct, total: attempt.total }),
    now,
  );

  const fresh = get(`SELECT * FROM quiz_attempts WHERE id = ?`, attemptId);
  const accuracy = fresh.total > 0 ? fresh.correct / fresh.total : 0;
  return { ...fresh, accuracy: Number(accuracy.toFixed(4)) };
}
