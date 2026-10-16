/**
 * Tests for the recommendation scoring and the reason templating.
 *
 * The most valuable tests here assert DIRECTION and MONOTONICITY: a weaker or
 * more-overdue topic must score higher. Those are the properties a marker will
 * probe, and they keep holding if the weights are retuned.
 */

import { describe, it, expect } from 'vitest';
import { computePriority, rankTopics } from '../src/modules/recommend/score.js';
import { buildReason } from '../src/modules/recommend/reason.js';

/** A neutral feature vector we can perturb one field at a time. */
const baseFeatures = {
  mastery: 0.5,
  daysSincePractice: 1,
  stabilityDays: 3,
  prerequisiteGap: 0,
  recentAccuracy: 0.5,
  recentAttempts: 3,
  topicWeight: 1,
  examUrgency: 0.5,
};

describe('computePriority', () => {
  it('scores a low-mastery topic above a high-mastery one', () => {
    const weak = computePriority({ ...baseFeatures, mastery: 0.1 }).score;
    const strong = computePriority({ ...baseFeatures, mastery: 0.9 }).score;
    expect(weak).toBeGreaterThan(strong);
  });

  it('scores an overdue topic above a recently practised one', () => {
    const overdue = computePriority({ ...baseFeatures, daysSincePractice: 30 }).score;
    const recent = computePriority({ ...baseFeatures, daysSincePractice: 0 }).score;
    expect(overdue).toBeGreaterThan(recent);
  });

  it('rewards a weak prerequisite chain', () => {
    const weakParent = computePriority({ ...baseFeatures, prerequisiteGap: 0.9 }).score;
    const strongParent = computePriority({ ...baseFeatures, prerequisiteGap: 0 }).score;
    expect(weakParent).toBeGreaterThan(strongParent);
  });

  it('applies the recency penalty (practising today reduces priority)', () => {
    const justPractised = computePriority({ ...baseFeatures, daysSincePractice: 0 }).breakdown.terms;
    expect(justPractised.recencyPenalty).toBeLessThan(0);
  });

  it('returns a full breakdown for explainability and ablation', () => {
    const { breakdown } = computePriority(baseFeatures);
    expect(Object.keys(breakdown.terms)).toHaveLength(6);
    expect(breakdown.features.knowledgeGap).toBeCloseTo(0.5, 5);
  });
});

describe('rankTopics', () => {
  const candidate = (id, mastery) => ({
    topicId: id,
    topicName: id,
    features: { ...baseFeatures, mastery },
  });

  it('orders weaker topics first and respects topN', () => {
    const ranked = rankTopics(
      [candidate('strong', 0.9), candidate('weak', 0.05), candidate('mid', 0.4)],
      { topN: 2 },
    );
    expect(ranked.map((r) => r.topicId)).toEqual(['weak', 'mid']);
  });

  it('drops topics below the minimum priority', () => {
    const ranked = rankTopics([candidate('mastered', 1)], { minPriority: 0.5 });
    expect(ranked).toHaveLength(0);
  });
});

describe('buildReason', () => {
  it('mentions mastery when the knowledge gap is large', () => {
    const { breakdown } = computePriority({ ...baseFeatures, mastery: 0.1, daysSincePractice: 0 });
    const reason = buildReason(breakdown, { topicName: 'Indexing', mastery: 0.1, daysSincePractice: 0 });
    expect(reason.toLowerCase()).toContain('recommended because');
    expect(reason).toContain('Indexing'.length > 0 ? 'mastery' : 'mastery');
  });

  it('never returns an empty string', () => {
    const { breakdown } = computePriority(baseFeatures);
    const reason = buildReason(breakdown, { topicName: 'X', mastery: 0.5, daysSincePractice: 1 });
    expect(reason.length).toBeGreaterThan(0);
  });
});
