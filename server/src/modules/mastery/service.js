/**
 * Mastery service - the bridge between pure algorithms and the database.
 *
 * This is the ONLY place that writes a student's mastery. It is deliberately
 * centralised so that every answer follows the exact same auditable path:
 *
 *   read prior state -> BKT update -> Elo updates -> write answer + mastery
 *   (all inside ONE transaction)
 *
 * If the transaction fails, the mastery cache and the raw evidence stay
 * consistent - we never end up with an `answers` row whose mastery change was
 * lost.
 */

import { all, get, run, tx } from '../../db/index.js';
import { newId, nowIso } from '../../lib/util.js';
import { BKT, ELO, ANALYTICS } from '../../config/constants.js';
import { updateMastery } from './bkt.js';
import { expectedScore, updateAbility, updateDifficulty } from './elo.js';

/**
 * Mastery memory stability: how many days of "not practised" the student can
 * tolerate before the risk of forgetting becomes material. Grows with mastery,
 * which is the intuition behind spaced repetition.
 */
function stabilityDays(mastery) {
  return 1 + ANALYTICS.STABILITY_PER_MASTERY * mastery;
}

/**
 * Get the (user, topic) mastery row, creating a cold-start default if absent.
 * A brand-new student starts at pL0 with the initial Elo ability.
 */
export function getOrCreateMastery(userId, topicId) {
  const existing = get(
    `SELECT * FROM topic_mastery WHERE user_id = ? AND topic_id = ?`,
    userId,
    topicId,
  );
  if (existing) return existing;

  const row = {
    id: newId(),
    user_id: userId,
    topic_id: topicId,
    mastery: BKT.pL0,
    ability: ELO.INITIAL_ABILITY,
    attempts: 0,
    correct: 0,
    last_practiced_at: null,
    stability_days: stabilityDays(BKT.pL0),
    updated_at: nowIso(),
  };

  run(
    `INSERT INTO topic_mastery
       (id, user_id, topic_id, mastery, ability, attempts, correct, last_practiced_at, stability_days, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.user_id,
    row.topic_id,
    row.mastery,
    row.ability,
    row.attempts,
    row.correct,
    row.last_practiced_at,
    row.stability_days,
    row.updated_at,
  );

  return row;
}

/** List a user's mastery rows joined with topic + subject names. */
export function listMastery(userId, subjectId = null) {
  const base = `
    SELECT m.*, t.name AS topic_name, t.weight, t.parent_topic_id, t.subject_id,
           s.name AS subject_name
    FROM topic_mastery m
    JOIN topics t ON t.id = m.topic_id
    JOIN subjects s ON s.id = t.subject_id
    WHERE m.user_id = ?`;
  return subjectId
    ? all(base + ` AND t.subject_id = ?`, userId, subjectId)
    : all(base, userId);
}

/**
 * Grade one answer and update every derived value.
 *
 * @param {object} args
 * @param {string}  args.attemptId
 * @param {string}  args.userId
 * @param {string}  args.topicId
 * @param {string}  args.questionId
 * @param {number}  args.selectedIndex    what the student chose
 * @param {number}  args.timeMs           time spent on the question
 * @param {object}  args.question         { correct_index, difficulty_rating }
 * @returns {{isCorrect:boolean, masteryBefore:number, masteryAfter:number,
 *            ability:number, expected:number}}
 */
export function recordAnswer({
  attemptId,
  userId,
  topicId,
  questionId,
  selectedIndex,
  timeMs = 0,
  question,
}) {
  return tx(() => {
    const mastery = getOrCreateMastery(userId, topicId);

    const abilityBefore = mastery.ability;
    const difficultyBefore = question.difficulty_rating;
    const masteryBefore = mastery.mastery;
    const isCorrect = Number(selectedIndex) === Number(question.correct_index);

    // Elo expectation BEFORE the answer - stored so adaptivity can be debugged.
    const expected = expectedScore(abilityBefore, difficultyBefore);

    // 1. BKT: difficulty-weighted knowledge update.
    const masteryAfter = updateMastery({
      pL: masteryBefore,
      correct: isCorrect,
      difficultyRating: difficultyBefore,
    });

    // 2. Elo: student ability moves; item difficulty self-calibrates (slowly).
    const abilityAfter = updateAbility(abilityBefore, difficultyBefore, isCorrect);
    const difficultyAfter = updateDifficulty(difficultyBefore, abilityBefore, isCorrect);

    const now = nowIso();

    // 3. Append-only evidence row (the audit trail).
    run(
      `INSERT INTO answers
         (id, attempt_id, user_id, topic_id, question_id, selected_index, is_correct,
          time_ms, ability_before, difficulty_before, mastery_before, mastery_after,
          expected_before, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      attemptId,
      userId,
      topicId,
      questionId,
      selectedIndex,
      isCorrect ? 1 : 0,
      timeMs,
      abilityBefore,
      difficultyBefore,
      masteryBefore,
      masteryAfter,
      expected,
      now,
    );

    // 4. Update the derived mastery cache.
    run(
      `UPDATE topic_mastery
         SET mastery = ?, ability = ?, attempts = attempts + 1,
             correct = correct + ?, last_practiced_at = ?, stability_days = ?, updated_at = ?
       WHERE user_id = ? AND topic_id = ?`,
      masteryAfter,
      abilityAfter,
      isCorrect ? 1 : 0,
      now,
      stabilityDays(masteryAfter),
      now,
      userId,
      topicId,
    );

    // 5. Update the item's live rating so future quizzes get better calibrated.
    run(`UPDATE questions SET difficulty_rating = ? WHERE id = ?`, difficultyAfter, questionId);

    // 6. Raw event log (feeds time-on-task analytics and recommendation follow-through).
    run(
      `INSERT INTO learning_events (id, user_id, type, subject_id, topic_id, payload, created_at)
       VALUES (?, ?, 'answered', NULL, ?, ?, ?)`,
      newId(),
      userId,
      topicId,
      JSON.stringify({ questionId, isCorrect, timeMs, masteryAfter }),
      now,
    );

    return {
      isCorrect,
      masteryBefore,
      masteryAfter,
      ability: abilityAfter,
      expected,
    };
  });
}

/** Aggregate counts for a user, used by the analytics overview. */
export function answerStats(userId) {
  const row = get(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(is_correct), 0) AS correct,
            COALESCE(SUM(time_ms), 0) AS time_ms
     FROM answers WHERE user_id = ?`,
    userId,
  );
  const total = row?.total ?? 0;
  return {
    total,
    correct: row?.correct ?? 0,
    accuracy: total > 0 ? row.correct / total : 0,
    timeMs: row?.time_ms ?? 0,
  };
}
