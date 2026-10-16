/**
 * Tests for the adaptive question selector and the study planner.
 */

import { describe, it, expect } from 'vitest';
import { selectNextQuestion } from '../src/modules/quiz/adaptive.js';
import { buildPlan } from '../src/modules/planner/schedule.js';

describe('selectNextQuestion', () => {
  const questions = [
    { id: 'easy', difficulty_rating: 900 },
    { id: 'medium', difficulty_rating: 1200 },
    { id: 'hard', difficulty_rating: 1500 },
  ];

  it('picks the question closest to the ~0.6 success target', () => {
    // An ability of 1200 makes the medium item ~50% and the hard item ~9%,
    // so medium is closest to the 0.6 target.
    expect(selectNextQuestion(questions, 1200).id).toBe('medium');
  });

  it('picks easier questions for a weak student', () => {
    expect(selectNextQuestion(questions, 800).id).toBe('easy');
  });

  it('picks harder questions for a strong student', () => {
    expect(selectNextQuestion(questions, 1600).id).toBe('hard');
  });

  it('never repeats an excluded question', () => {
    const chosen = selectNextQuestion(questions, 1200, ['medium']);
    expect(chosen.id).not.toBe('medium');
  });

  it('returns null when everything is used up', () => {
    expect(selectNextQuestion(questions, 1200, ['easy', 'medium', 'hard'])).toBeNull();
  });
});

describe('buildPlan', () => {
  const recommendations = [
    { topicId: 't1', topicName: 'Normalization', reason: 'weak spot', score: 1.2 },
    { topicId: 't2', topicName: 'Indexing', reason: 'due soon', score: 0.9 },
  ];
  const dueReviews = [{ topic_id: 't3', topic_name: 'Transactions', mastery: 0.4 }];

  it('never exceeds the daily minute budget', () => {
    const plan = buildPlan({ recommendations, dueReviews, dailyMinutes: 60 });
    expect(plan.totalMinutes).toBeLessThanOrEqual(60);
  });

  it('produces at least one block for a normal day', () => {
    const plan = buildPlan({ recommendations, dueReviews, dailyMinutes: 60 });
    expect(plan.items.length).toBeGreaterThan(0);
  });

  it('skips blocks that would be too small to be useful', () => {
    const plan = buildPlan({ recommendations, dueReviews, dailyMinutes: 10 });
    for (const item of plan.items) {
      expect(item.minutes).toBeGreaterThanOrEqual(10);
    }
  });

  it('handles an empty recommendation list without throwing', () => {
    const plan = buildPlan({ recommendations: [], dueReviews: [], dailyMinutes: 60 });
    expect(plan.items).toEqual([]);
    expect(plan.totalMinutes).toBe(0);
  });
});
