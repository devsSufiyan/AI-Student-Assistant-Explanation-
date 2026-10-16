/**
 * Study planner - turns recommendations + due reviews into a concrete timetable.
 *
 * ALGORITHM
 *   Greedy bin-packing, which is the right call for an MVP: it is O(n log n),
 *   trivially explainable, and produces a plan nobody can object to. A full
 *   constraint solver would be over-engineering at this stage (noted as future
 *   work). The plan respects a single hard constraint: total minutes must not
 *   exceed the student's daily budget.
 *
 * PURE: takes recommendations + settings, returns a schedule. No I/O.
 */

import { PLANNER } from '../../config/constants.js';

/**
 * Allocate the day's study minutes.
 *
 * @param {object} args
 * @param {Array<{topicId:string, topicName:string, reason:string, score:number}>} args.recommendations
 * @param {Array<{topic_id:string, topic_name:string, mastery:number}>} args.dueReviews
 * @param {number} args.dailyMinutes
 * @returns {{items:Array, totalMinutes:number}}
 */
export function buildPlan({ recommendations, dueReviews = [], dailyMinutes = PLANNER.DEFAULT_DAILY_MINUTES }) {
  const items = [];
  let remaining = dailyMinutes;

  // Helper: add a block if it clears the minimum useful block size and fits.
  const addBlock = (topicId, topicName, activity, minutes, reason) => {
    const capped = Math.min(minutes, remaining);
    if (capped < PLANNER.MIN_BLOCK_MINUTES) return; // too small to bother the student
    items.push({ topicId, topicName, activity, minutes: Math.round(capped), reason });
    remaining -= capped;
  };

  // 1. Primary recommendation gets the largest slice.
  if (recommendations[0]) {
    addBlock(
      recommendations[0].topicId,
      recommendations[0].topicName,
      'quiz',
      dailyMinutes * PLANNER.SPLIT.primary,
      recommendations[0].reason,
    );
  }

  // 2. Review block for topics that are genuinely overdue (spaced repetition).
  if (dueReviews.length > 0) {
    const perReview = (dailyMinutes * PLANNER.SPLIT.review) / Math.min(dueReviews.length, 2);
    for (const review of dueReviews.slice(0, 2)) {
      addBlock(
        review.topic_id,
        review.topic_name,
        'review',
        perReview,
        'Due for spaced review - it has been longer than your memory stability window.',
      );
    }
  }

  // 3. Secondary recommendation takes whatever budget is left.
  if (recommendations[1]) {
    addBlock(
      recommendations[1].topicId,
      recommendations[1].topicName,
      'read',
      dailyMinutes * PLANNER.SPLIT.secondary,
      recommendations[1].reason,
    );
  }

  const totalMinutes = items.reduce((sum, it) => sum + it.minutes, 0);
  return { items, totalMinutes };
}
