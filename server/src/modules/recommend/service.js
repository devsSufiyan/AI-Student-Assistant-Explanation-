/**
 * Recommendation service - assembles features from the database, ranks topics,
 * stores the results WITH their breakdown, and returns them to the API.
 *
 * SEPARATION OF CONCERNS
 *   score.js  = pure maths (what should be recommended)
 *   reason.js = pure wording (how we explain it)
 *   this file = I/O only (fetch features, persist, read back)
 */

import { all, get, run } from '../../db/index.js';
import { newId, nowIso, daysSince } from '../../lib/util.js';
import { BKT, ELO, RECOMMEND, ANALYTICS } from '../../config/constants.js';
import { rankTopics } from './score.js';
import { buildReason } from './reason.js';

/** 0..1 urgency from the exam date: 1 when the exam is today, 0 when >60 days away. */
function examUrgency(examDate) {
  if (!examDate) return 0.5; // no date set -> neutral, neither rushed nor ignored
  const days = (new Date(examDate).getTime() - Date.now()) / 86_400_000;
  if (Number.isNaN(days)) return 0.5;
  if (days <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - days / 60));
}

/** Accuracy over the last `limit` answers for a topic. */
function recentAccuracy(userId, topicId, limit = 5) {
  const rows = all(
    `SELECT is_correct FROM answers
      WHERE user_id = ? AND topic_id = ?
      ORDER BY created_at DESC LIMIT ?`,
    userId,
    topicId,
    limit,
  );
  if (rows.length === 0) return { accuracy: 0, attempts: 0 };
  const correct = rows.reduce((s, r) => s + (r.is_correct ? 1 : 0), 0);
  return { accuracy: correct / rows.length, attempts: rows.length };
}

/**
 * Build one feature vector per topic for a user.
 * Exposed (not private) because the evaluation harness reuses it for ablations.
 */
export function buildFeatureVectors(userId, subjectId = null) {
  const user = get(`SELECT exam_date FROM users WHERE id = ?`, userId);
  const urgency = examUrgency(user?.exam_date);

  const topics = subjectId
    ? all(`SELECT * FROM topics WHERE subject_id = ?`, subjectId)
    : all(
        `SELECT t.* FROM topics t JOIN subjects s ON s.id = t.subject_id WHERE s.user_id = ?`,
        userId,
      );

  const masteryRows = all(`SELECT * FROM topic_mastery WHERE user_id = ?`, userId);
  const masteryByTopic = new Map(masteryRows.map((m) => [m.topic_id, m]));
  const topicById = new Map(topics.map((t) => [t.id, t]));

  /** Walk the prerequisite chain and average the knowledge gaps of ancestors. */
  const prerequisiteGapFor = (topic) => {
    const gaps = [];
    let current = topic.parent_topic_id ? topicById.get(topic.parent_topic_id) : null;
    let guard = 0;
    while (current && guard < 10) {
      const m = masteryByTopic.get(current.id);
      gaps.push(1 - (m?.mastery ?? BKT.pL0));
      current = current.parent_topic_id ? topicById.get(current.parent_topic_id) : null;
      guard += 1;
    }
    if (gaps.length === 0) return 0;
    return gaps.reduce((a, b) => a + b, 0) / gaps.length;
  };

  return topics.map((topic) => {
    const m = masteryByTopic.get(topic.id);
    const mastery = m?.mastery ?? BKT.pL0;
    const since = m?.last_practiced_at ? daysSince(m.last_practiced_at) : Infinity;
    const { accuracy, attempts } = recentAccuracy(userId, topic.id);

    return {
      topicId: topic.id,
      topicName: topic.name,
      subjectId: topic.subject_id,
      mastery,
      features: {
        mastery,
        daysSincePractice: since,
        stabilityDays: m?.stability_days ?? 1 + ANALYTICS.STABILITY_PER_MASTERY * mastery,
        prerequisiteGap: prerequisiteGapFor(topic),
        recentAccuracy: accuracy,
        recentAttempts: attempts,
        topicWeight: topic.weight ?? 1,
        examUrgency: urgency,
      },
    };
  });
}

/**
 * Recompute the user's active recommendation set and persist it.
 *
 * We delete only UNCONSUMED recommendations, then insert the fresh top N.
 * Consumed ones are kept forever: they are the ground truth for the
 * "did the student act on our advice?" evaluation (Precision@N).
 */
export function generateRecommendations(userId, subjectId = null, options = {}) {
  const candidates = buildFeatureVectors(userId, subjectId);
  const ranked = rankTopics(candidates, options);

  const now = nowIso();
  run(`DELETE FROM recommendations WHERE user_id = ? AND consumed_at IS NULL`, userId);

  const stored = ranked.map((c) => {
    const reason = buildReason(c.breakdown, {
      topicName: c.topicName,
      mastery: c.mastery,
      daysSincePractice: c.features.daysSincePractice,
    });
    const id = newId();
    run(
      `INSERT INTO recommendations (id, user_id, topic_id, score, reason, breakdown, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      c.topicId,
      c.score,
      reason,
      JSON.stringify(c.breakdown),
      now,
    );
    return {
      id,
      topicId: c.topicId,
      topicName: c.topicName,
      subjectId: c.subjectId,
      score: c.score,
      reason,
      breakdown: c.breakdown,
      mastery: c.mastery,
    };
  });

  return stored;
}

/** Read the current (unconsumed) recommendations, generating them if none exist. */
export function getRecommendations(userId, subjectId = null) {
  // Scope the cache read to the requested subject. Without this, switching
  // subjects in the UI could surface advice generated for a different one.
  const params = [userId];
  let where = 'r.user_id = ? AND r.consumed_at IS NULL';
  if (subjectId) {
    where += ' AND t.subject_id = ?';
    params.push(subjectId);
  }

  const rows = all(
    `SELECT r.*, t.name AS topic_name, t.subject_id
       FROM recommendations r
       JOIN topics t ON t.id = r.topic_id
      WHERE ${where}
      ORDER BY r.score DESC`,
    ...params,
  );

  if (rows.length === 0) return generateRecommendations(userId, subjectId);

  return rows.map((r) => ({
    id: r.id,
    topicId: r.topic_id,
    topicName: r.topic_name,
    subjectId: r.subject_id,
    score: r.score,
    reason: r.reason,
    breakdown: JSON.parse(r.breakdown),
    generatedAt: r.generated_at,
  }));
}

/**
 * Topics that are "due" for spaced review: practised before, not yet mastered,
 * and beyond their memory stability window. The planner uses this for its
 * review block.
 */
export function dueForReview(userId, limit = 5) {
  return all(
    `SELECT m.topic_id, m.mastery, m.last_practiced_at, m.stability_days, t.name AS topic_name
       FROM topic_mastery m JOIN topics t ON t.id = m.topic_id
      WHERE m.user_id = ?
        AND m.last_practiced_at IS NOT NULL
        AND m.mastery < ?
        AND (julianday('now') - julianday(m.last_practiced_at)) > m.stability_days
      ORDER BY (julianday('now') - julianday(m.last_practiced_at)) - m.stability_days DESC
      LIMIT ?`,
    userId,
    RECOMMEND.MASTERY_THRESHOLD,
    limit,
  );
}

export { examUrgency };
