/**
 * Adaptive question selection - the "adaptive tutoring" core.
 *
 * THE IDEA (zone of proximal development)
 *   Questions a student always gets right teach nothing; questions they always
 *   get wrong are demoralising. Learning is fastest when predicted success sits
 *   around 0.6. Using the Elo expectation we can *predict* success for every
 *   candidate question and pick the closest to that target.
 *
 *   Correct answer  -> ability rises -> next question is harder.
 *   Wrong answer    -> ability falls -> next question is easier.
 *   That feedback loop is the entire adaptation mechanism; no ML needed.
 *
 * PURITY: no DB, no framework. Fully unit-testable.
 */

import { expectedScore } from '../mastery/elo.js';
import { ELO } from '../../config/constants.js';

/**
 * @param {Array<{id:string, difficulty_rating:number}>} questions  candidates
 * @param {number} ability            student's Elo rating on this topic
 * @param {Set<string>|string[]} [exclude]  question ids already used in the attempt
 * @param {number} [target]           desired success probability (default 0.6)
 * @returns {object|null} the chosen question, or null if none remain
 */
export function selectNextQuestion(questions, ability, exclude = [], target = ELO.TARGET_SUCCESS) {
  const used = new Set(exclude);

  let best = null;
  let bestDistance = Infinity;

  for (const q of questions) {
    if (used.has(q.id)) continue;
    const expected = expectedScore(ability, q.difficulty_rating);
    const distance = Math.abs(expected - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = q;
    }
  }

  return best;
}

/**
 * Explain a selection decision. Used by the API response and the UI so the
 * adaptivity is visible rather than a black box.
 */
export function explainSelection(question, ability, target = ELO.TARGET_SUCCESS) {
  if (!question) return null;
  const expected = expectedScore(ability, question.difficulty_rating);
  return {
    predictedSuccess: Number(expected.toFixed(3)),
    target,
    ability: Number(ability.toFixed(1)),
    itemDifficulty: question.difficulty_rating,
  };
}
