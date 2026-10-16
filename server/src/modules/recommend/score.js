/**
 * Recommendation scoring - PURE function, no database.
 *
 * PHILOSOPHY
 *   Recommendations must be explainable, not a black box. This is a transparent
 *   linear model: every term has a name, a clear pedagogical meaning, and a
 *   weight in config/constants.js. That design choice pays off twice:
 *     1. The UI can literally show the student WHY a topic was suggested.
 *     2. We can run weight-ablation experiments offline (see PLAN.md section 14B).
 *
 *   The LLM is deliberately NOT involved in producing the score. It may only
 *   phrase the reason (see reason.js). A hallucinating model must never be able
 *   to change what a student is told to study.
 *
 * SIGN CONVENTION
 *   Five terms push a topic UP the list; `recencyPenalty` pulls it DOWN.
 */

import { RECOMMEND } from '../../config/constants.js';
import { clamp } from '../../lib/util.js';

/**
 * Compute the priority score and full breakdown for one topic.
 *
 * @param {object} f  normalised features (all 0..1 unless noted)
 * @param {number} f.mastery             BKT P(knows), 0..1
 * @param {number} f.daysSincePractice    days since last attempt (Infinity if never)
 * @param {number} f.stabilityDays        how long memory lasts at this mastery
 * @param {number} f.prerequisiteGap      avg (1-mastery) of ancestor topics, 0..1
 * @param {number} f.recentAccuracy       accuracy over last few answers, 0..1
 * @param {number} f.recentAttempts       how many recent attempts we measured
 * @param {number} f.topicWeight          syllabus importance (>=0, ~1 typical)
 * @param {number} f.examUrgency          0..1 (near exam => 1), 0.5 if no exam date
 * @param {object} [weights]              override for ablation studies
 * @returns {{score:number, breakdown:object}}
 */
export function computePriority(f, weights = RECOMMEND.WEIGHTS) {
  // 1. Knowledge gap: the single most important signal - you don't know this yet.
  const knowledgeGap = clamp(1 - f.mastery, 0, 1);

  // 2. Spacing urgency: forgetting-curve pressure. Ratio of elapsed time to the
  //    topic's memory stability; 2x overdue saturates the term.
  const elapsed = Number.isFinite(f.daysSincePractice) ? f.daysSincePractice : 999;
  const spacingUrgency = clamp(elapsed / Math.max(f.stabilityDays, 0.5) / 2, 0, 1);

  // 3. Prerequisite gap: a weak foundation under this topic (Khan-style knowledge
  //    graph). Studying a topic whose parent is shaky is usually wasted effort.
  const prerequisiteGap = clamp(f.prerequisiteGap ?? 0, 0, 1);

  // 4. Weakness signal: recent incorrect answers. With no attempts we are simply
  //    uncertain, so we use 0.5 rather than 0 (neutral, not "you're fine").
  const weaknessSignal = f.recentAttempts > 0 ? clamp(1 - f.recentAccuracy, 0, 1) : 0.5;

  // 5. Goal alignment: important topics as the exam approaches. Weight is
  //    halved into 0..1 so a "double importance" topic does not dominate.
  const goalAlignment = clamp(f.topicWeight / 2, 0, 1) * clamp(f.examUrgency, 0, 1);

  // 6. Recency penalty (subtracted): don't tell a student to immediately redo
  //    what they just did - that feels broken and wastes their time.
  const recencyPenalty = clamp(1 - elapsed / 2, 0, 1);

  const terms = {
    knowledgeGap: weights.knowledgeGap * knowledgeGap,
    spacingUrgency: weights.spacingUrgency * spacingUrgency,
    prerequisiteGap: weights.prerequisiteGap * prerequisiteGap,
    weaknessSignal: weights.weaknessSignal * weaknessSignal,
    goalAlignment: weights.goalAlignment * goalAlignment,
    recencyPenalty: -weights.recencyPenalty * recencyPenalty,
  };

  const score = Object.values(terms).reduce((sum, v) => sum + v, 0);

  // Keep the RAW 0..1 features too: they are what the reason text talks about,
  // whereas `terms` are the weighted contributions used for ablation.
  return {
    score: Number(score.toFixed(4)),
    breakdown: {
      terms,
      features: {
        knowledgeGap,
        spacingUrgency,
        prerequisiteGap,
        weaknessSignal,
        goalAlignment,
        recencyPenalty,
      },
    },
  };
}

/**
 * Rank candidate topics and return the top N above the minimum threshold.
 * Pure: takes an array, returns an array. No I/O.
 */
export function rankTopics(candidates, { topN = RECOMMEND.TOP_N, minPriority = RECOMMEND.MIN_PRIORITY, weights } = {}) {
  return candidates
    .map((c) => {
      const { score, breakdown } = computePriority(c.features, weights);
      return { ...c, score, breakdown };
    })
    .filter((c) => c.score >= minPriority)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
