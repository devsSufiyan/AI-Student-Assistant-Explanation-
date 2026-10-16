/**
 * Planner service - persistence around the pure scheduler.
 *
 * The plan is stored per (user, day) so that opening the app twice does not
 * reshuffle the student's day. `regenerate` forces a rebuild on demand.
 */

import { get, run } from '../../db/index.js';
import { newId, nowIso, todayIso } from '../../lib/util.js';
import { PLANNER } from '../../config/constants.js';
import { buildPlan } from './schedule.js';
import { getRecommendations, dueForReview } from '../recommend/service.js';

/** Read the stored plan for today, if one exists. */
export function getTodayPlan(userId) {
  const row = get(
    `SELECT * FROM study_plans WHERE user_id = ? AND plan_date = ?`,
    userId,
    todayIso(),
  );
  if (!row) return null;
  return { ...row, items: JSON.parse(row.items) };
}

/**
 * Build (or rebuild) today's plan from live recommendations + due reviews.
 * @returns {object} the stored plan
 */
export function generateTodayPlan(userId, subjectId = null) {
  const user = get(`SELECT daily_minutes FROM users WHERE id = ?`, userId);
  const recommendations = getRecommendations(userId, subjectId);
  const dueReviews = dueForReview(userId);
  const dailyMinutes = user?.daily_minutes ?? PLANNER.DEFAULT_DAILY_MINUTES;

  const { items, totalMinutes } = buildPlan({ recommendations, dueReviews, dailyMinutes });

  const date = todayIso();
  const existing = get(
    `SELECT id FROM study_plans WHERE user_id = ? AND plan_date = ?`,
    userId,
    date,
  );

  const id = existing?.id ?? newId();
  if (existing) {
    run(
      `UPDATE study_plans SET items = ?, total_minutes = ?, created_at = ? WHERE id = ?`,
      JSON.stringify(items),
      totalMinutes,
      nowIso(),
      id,
    );
  } else {
    run(
      `INSERT INTO study_plans (id, user_id, plan_date, items, total_minutes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      date,
      JSON.stringify(items),
      totalMinutes,
      nowIso(),
    );
  }

  return { id, user_id: userId, plan_date: date, items, total_minutes: totalMinutes };
}
