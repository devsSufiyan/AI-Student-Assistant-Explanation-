/**
 * Reason templating - turning a numeric breakdown into one honest sentence.
 *
 * WHY A TEMPLATE AND NOT AN LLM
 *   The reason must be *true*. If an LLM phrased it, it could invent a cause
 *   ("because you failed last week") that the data never supported. A template
 *   can only say what the breakdown actually contains, and it costs nothing and
 *   never fails. This is the correct place for determinism.
 *
 *   (If you later want nicer phrasing, pass the breakdown to an LLM but keep the
 *   template as the fallback and forbid new facts - a "controlled generation"
 *   pattern. That is deliberately left out of the MVP.)
 */

import { masteryLabel } from '../mastery/bkt.js';

/** Percent helper. */
const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * Build a human sentence explaining why a topic is recommended.
 *
 * @param {object} breakdown  from computePriority: { terms, features }
 * @param {object} context    { topicName, mastery, daysSincePractice }
 * @returns {string}
 */
export function buildReason(breakdown, context) {
  const { features } = breakdown;
  const clauses = [];

  // Lead with the strongest, most concrete signal.
  if (features.knowledgeGap >= 0.6) {
    clauses.push(`your mastery is only ${pct(context.mastery)}`);
  } else if (features.knowledgeGap >= 0.3) {
    clauses.push(`you're at ${pct(context.mastery)} mastery, so it's not solid yet`);
  }

  // Spacing: only mention time if it is genuinely due, so the sentence stays honest.
  if (features.spacingUrgency >= 0.5) {
    const days = Number.isFinite(context.daysSincePractice)
      ? Math.round(context.daysSincePractice)
      : null;
    clauses.push(
      days === null ? `you haven't practised it yet` : `it's been ${days} day${days === 1 ? '' : 's'} since you reviewed it`,
    );
  }

  if (features.weaknessSignal >= 0.6) {
    clauses.push('you have been getting questions on it wrong recently');
  }

  if (features.prerequisiteGap >= 0.5) {
    clauses.push('a foundational topic underneath it is still weak');
  }

  if (features.goalAlignment >= 0.4) {
    clauses.push('it is a high-weight topic for your upcoming exam');
  }

  if (clauses.length === 0) {
    // Fallback: never return an empty reason, but stay truthful.
    return `Recommended for review to strengthen "${context.topicName}" (currently ${masteryLabel(context.mastery)}).`;
  }

  return `Recommended because ${clauses.join(' and ')}.`;
}
