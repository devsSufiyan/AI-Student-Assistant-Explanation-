/**
 * Learning analytics service.
 *
 * Everything here is DERIVED from raw tables (`answers`, `learning_events`).
 * That is intentional: if we ever change a formula, the dashboards can be
 * recomputed from history rather than being stuck with stale stored numbers.
 *
 * Metrics exposed (see PLAN.md section 6 "aggregated analytics"):
 *   - mastered / total topics
 *   - exam readiness  = weighted average mastery across the syllabus
 *   - accuracy trend  = per-day accuracy over the last N days
 *   - time on task    = minutes spent answering
 *   - forgetting risk = days-since-practice / memory-stability, per topic
 */

import { all, get } from '../../db/index.js';
import { daysSince, clamp } from '../../lib/util.js';
import { BKT, ANALYTICS } from '../../config/constants.js';
import { masteryLabel } from '../mastery/bkt.js';
import { answerStats } from '../mastery/service.js';

/**
 * Overall study snapshot for the dashboard header cards.
 */
export function overview(userId, subjectId = null) {
  const stats = answerStats(userId);

  const topics = subjectId
    ? all(`SELECT * FROM topics WHERE subject_id = ?`, subjectId)
    : all(
        `SELECT t.* FROM topics t JOIN subjects s ON s.id = t.subject_id WHERE s.user_id = ?`,
        userId,
      );

  const masteryRows = all(`SELECT * FROM topic_mastery WHERE user_id = ?`, userId);
  const masteryByTopic = new Map(masteryRows.map((m) => [m.topic_id, m]));

  // Exam readiness: weighted average mastery over ALL syllabus topics. Topics
  // never practised count as pL0, so ignoring part of the syllabus is penalised.
  let weightedSum = 0;
  let weightTotal = 0;
  let mastered = 0;
  for (const topic of topics) {
    const m = masteryByTopic.get(topic.id);
    const mastery = m?.mastery ?? BKT.pL0;
    const weight = topic.weight ?? 1;
    weightedSum += mastery * weight;
    weightTotal += weight;
    if (mastery >= 0.85) mastered += 1;
  }

  return {
    topicsTotal: topics.length,
    topicsMastered: mastered,
    examReadiness: weightTotal > 0 ? Number((weightedSum / weightTotal).toFixed(4)) : 0,
    accuracy: Number(stats.accuracy.toFixed(4)),
    questionsAnswered: stats.total,
    minutesOnTask: Math.round(stats.timeMs / 60000),
  };
}

/**
 * Per-topic analytics: mastery, label, and a forgetting-risk ratio.
 * risk > 1 means the memory stability window has been exceeded.
 */
export function topicAnalytics(userId, subjectId = null) {
  const base = `
    SELECT t.id AS topic_id, t.name AS topic_name, t.subject_id, t.weight,
           s.name AS subject_name,
           m.mastery, m.ability, m.attempts, m.correct, m.last_practiced_at, m.stability_days
      FROM topics t
      JOIN subjects s ON s.id = t.subject_id
      LEFT JOIN topic_mastery m ON m.topic_id = t.id AND m.user_id = ?
     WHERE s.user_id = ?`;
  const rows = subjectId ? all(base + ` AND t.subject_id = ?`, userId, userId, subjectId) : all(base, userId, userId);

  return rows.map((r) => {
    const mastery = r.mastery ?? BKT.pL0;
    const stability = r.stability_days ?? 1 + ANALYTICS.STABILITY_PER_MASTERY * mastery;
    const since = r.last_practiced_at ? daysSince(r.last_practiced_at) : Infinity;
    // Forgetting risk is bounded so a never-practised topic reads as "1" (max
    // urgency) rather than Infinity on the chart.
    const risk = Number.isFinite(since) ? clamp(since / Math.max(stability, 0.5), 0, 3) : 1;

    return {
      topicId: r.topic_id,
      topicName: r.topic_name,
      subjectId: r.subject_id,
      subjectName: r.subject_name,
      mastery: Number(mastery.toFixed(4)),
      label: masteryLabel(mastery),
      accuracy: r.attempts > 0 ? Number((r.correct / r.attempts).toFixed(4)) : null,
      attempts: r.attempts ?? 0,
      daysSincePractice: Number.isFinite(since) ? Number(since.toFixed(1)) : null,
      forgettingRisk: Number(risk.toFixed(2)),
      dueForReview: risk >= 1 && mastery < 0.85,
    };
  });
}

/**
 * Accuracy per day for the trend chart. SQLite's date() plus a join against a
 * generated day list would be heavier than needed, so we compute in JS from the
 * (small) set of recent answers.
 */
export function accuracyTrend(userId, days = ANALYTICS.TREND_DAYS) {
  const rows = all(
    `SELECT is_correct, created_at FROM answers
      WHERE user_id = ? AND created_at >= datetime('now', ?)
      ORDER BY created_at ASC`,
    userId,
    `-${days} days`,
  );

  const buckets = new Map();
  for (const r of rows) {
    const day = String(r.created_at).slice(0, 10);
    const b = buckets.get(day) ?? { day, total: 0, correct: 0 };
    b.total += 1;
    b.correct += r.is_correct ? 1 : 0;
    buckets.set(day, b);
  }

  return [...buckets.values()].map((b) => ({
    day: b.day,
    total: b.total,
    accuracy: Number((b.correct / b.total).toFixed(4)),
  }));
}

/**
 * Follow-through on recommendations: of the recommendations the student saw,
 * how many did they actually act on? This is Precision@N for the live system
 * (the offline version lives in the evaluation harness).
 */
export function recommendationFollowThrough(userId) {
  const row = get(
    `SELECT COUNT(*) AS shown, COALESCE(SUM(CASE WHEN consumed_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS consumed
       FROM recommendations WHERE user_id = ?`,
    userId,
  );
  const shown = row?.shown ?? 0;
  return {
    shown,
    consumed: row?.consumed ?? 0,
    rate: shown > 0 ? Number(((row.consumed ?? 0) / shown).toFixed(4)) : null,
  };
}
