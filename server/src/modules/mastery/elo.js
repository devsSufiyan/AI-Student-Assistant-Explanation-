/**
 * Elo rating - the adaptivity model.
 *
 * WHAT IT ANSWERS
 *   Two questions at once:
 *     - How strong is this student on this topic?      (R_student, "ability")
 *     - How hard is this particular question?          (R_item, "difficulty")
 *
 * WHY ELO
 *   BKT tells us how much a student KNOWS (a stable latent state). Elo tells us
 *   how a student and an item COMPARE, which is exactly what you need to pick
 *   the next question at the right difficulty. Borrowed from chess; same maths
 *   as modern item-response / adaptive-testing systems.
 *
 *   The classic Elo update is symmetric: when two players meet, one gains what
 *   the other loses. Here "student beats item" means a correct answer.
 *
 * PURITY
 *   Pure functions only - no storage, no network. Trivially unit-testable.
 */

import { ELO } from '../../config/constants.js';
import { clamp } from '../../lib/util.js';

/**
 * Elo expectation: probability the student answers correctly.
 *
 *   E = 1 / (1 + 10 ^ ((R_item - R_student) / 400))
 *
 * Intuition: equal ratings => 0.5. A 400-point advantage => ~0.91 (10:1 odds).
 * The 400 constant is the historical Elo scale; changing it only stretches the
 * rating range, not the behaviour.
 */
export function expectedScore(ability, difficulty) {
  return 1 / (1 + 10 ** ((difficulty - ability) / 400));
}

/** Move the student's ability after an answer. Correct answers push it up. */
export function updateAbility(ability, difficulty, correct, k = ELO.K_STUDENT) {
  const expected = expectedScore(ability, difficulty);
  const actual = correct ? 1 : 0;
  return ability + k * (actual - expected);
}

/**
 * Re-calibrate the item's difficulty after an answer. Note the SIGN FLIP:
 * if the student beat expectations (actual > expected) the item is easier than
 * we thought, so its rating goes DOWN. K is smaller than the student's so item
 * ratings drift slowly and stay stable across many students.
 */
export function updateDifficulty(difficulty, ability, correct, k = ELO.K_ITEM) {
  const expected = expectedScore(ability, difficulty);
  const actual = correct ? 1 : 0;
  return difficulty + k * (expected - actual);
}

/** Seed a new item's rating from its author-assigned label. */
export function seedDifficulty(label) {
  return ELO.DIFFICULTY_SEED[label] ?? ELO.DIFFICULTY_SEED.medium;
}

/** Map a live rating back to a coarse label (for display / seeding questions). */
export function difficultyLabel(rating) {
  if (rating < 1100) return 'easy';
  if (rating < 1300) return 'medium';
  return 'hard';
}
