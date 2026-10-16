/**
 * Bayesian Knowledge Tracing (BKT) - the mastery model.
 *
 * WHAT IT ANSWERS
 *   "What is the probability this student knows this topic right now?"
 *   One number in [0,1] per (student, topic). 0 = no idea, 1 = certainly knows.
 *
 * WHY BKT
 *   It is the textbook model for modelling a single latent skill from noisy
 *   correct/incorrect observations, it is fully explainable (four parameters),
 *   and it updates online after every single answer - perfect for a study app.
 *   Reference: Corbett & Anderson (1995), "Knowledge tracing: Modeling the
 *   acquisition of procedural knowledge."
 *
 * PURITY
 *   This file has NO database, network, or framework imports. It is a pure
 *   function library so it can be unit-tested instantly and reasoned about in
 *   isolation. `service.js` is what wires it to storage.
 */

import { BKT } from '../../config/constants.js';
import { clamp } from '../../lib/util.js';

/** Probability of a correct answer given P(knows) and the guess/slip rates. */
export function expectedSuccess(pL, { pGuess = BKT.pGuess, pSlip = BKT.pSlip } = {}) {
  return pL * (1 - pSlip) + (1 - pL) * pGuess;
}

/**
 * The BKT "posterior" step: P(knows | observed answer).
 *
 *   correct:  pL*(1-slip) / ( pL*(1-slip) + (1-pL)*guess )
 *   wrong:    pL*slip     / ( pL*slip     + (1-pL)*(1-guess) )
 *
 * Both formulas are just Bayes' rule with the two observation likelihoods.
 */
export function posterior(pL, correct, { pGuess = BKT.pGuess, pSlip = BKT.pSlip } = {}) {
  const know = pL * (correct ? 1 - pSlip : pSlip);
  const notKnow = (1 - pL) * (correct ? pGuess : 1 - pGuess);
  const denom = know + notKnow;
  // denom can only be 0 if the parameters are degenerate (e.g. guess=slip=0
  // with pL=0); guard anyway so a misconfiguration cannot produce NaN in the DB.
  return denom <= 0 ? pL : know / denom;
}

// --- log-odds helpers -------------------------------------------------------
// BKT's posterior is always inside [0,1], but we want to let question difficulty
// AMPLIFY or DAMPEN how far an answer moves our belief. Doing that on raw
// probabilities can push values outside [0,1]; doing it in log-odds space is
// naturally bounded and is the standard trick for weighted Bayesian updates.
const logit = (p) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)));
const expit = (x) => 1 / (1 + Math.exp(-x));

/**
 * Turn an item's live Elo rating into a 0..1 difficulty factor, using the
 * author-label seed ratings (easy 1000 / medium 1200 / hard 1400) as anchors.
 */
export function difficultyFactor(rating) {
  const EASY_SEED = 1000;
  const HARD_SEED = 1400;
  return clamp((rating - EASY_SEED) / (HARD_SEED - EASY_SEED), 0, 1);
}

/**
 * Update mastery after ONE graded answer.
 *
 * Steps:
 *   1. Compute the plain BKT posterior P(knows | answer).
 *   2. Weight the evidence by question difficulty - but the direction of the
 *      weighting flips with correctness:
 *         correct on a HARD question  => strong evidence you know it
 *         wrong   on a HARD question  => weak evidence (hard for anyone)
 *         correct on an EASY question => weak evidence (could be a guess)
 *         wrong   on an EASY question => strong evidence you do NOT know it
 *      We implement that as `strength = 0.5 + (correct ? d : 1-d)` where d is
 *      the difficulty factor, then apply it as a multiplier on the log-odds
 *      shift between prior and posterior.
 *   3. Apply the learning transition: practising can teach you, so P(knows) is
 *      nudged toward 1 by pLearn - but ONLY after a correct answer.
 *
 *      This is a deliberate, documented deviation from textbook BKT, which
 *      applies pLearn unconditionally. With a low prior, unconditional pLearn
 *      makes a WRONG answer *raise* mastery (the small posterior is swamped by
 *      the +pLearn push), which is both counter-intuitive to students and
 *      indefensible in a report. Gating it on correct answers guarantees the two
 *      properties a mastery model must have:
 *         correct answer => mastery strictly rises
 *         wrong   answer => mastery strictly falls
 *      The tests in tests/bkt.test.js pin this behaviour.
 *
 * @param {object} args
 * @param {number}  args.pL               current P(knows), 0..1
 * @param {boolean} args.correct          was the answer right?
 * @param {number}  args.difficultyRating item's Elo rating (R_item)
 * @param {object} [args.params]          override pLearn/pGuess/pSlip (for tests)
 * @returns {number} new P(knows), 0..1
 */
export function updateMastery({
  pL,
  correct,
  difficultyRating,
  params = BKT,
}) {
  const prior = clamp(pL, 0, 1);
  const obs = posterior(prior, correct, params);

  // Step 2: difficulty-weighted move in log-odds space.
  const d = difficultyFactor(difficultyRating);
  const strength = 0.5 + (correct ? d : 1 - d);
  const weight = clamp(strength, params.MIN_EVIDENCE_WEIGHT, params.MAX_EVIDENCE_WEIGHT);
  const weighted = expit(logit(prior) + weight * (logit(obs) - logit(prior)));

  // Step 3: learning transition - only a correct answer demonstrates learning,
  // so only then do we nudge P(knows) toward 1 by pLearn.
  const learned = correct ? weighted + (1 - weighted) * params.pLearn : weighted;

  // Clamp once more so floating-point drift can never store 1.0000000002.
  return clamp(learned, 0, 1);
}

/** Human-readable band for a mastery value (used by the UI and reason text). */
export function masteryLabel(pL) {
  if (pL >= 0.85) return 'mastered';
  if (pL >= 0.65) return 'proficient';
  if (pL >= 0.4) return 'developing';
  if (pL >= 0.15) return 'beginner';
  return 'novice';
}

/** Convenience predicate so callers don't re-implement the threshold. */
export function isMastered(pL, threshold = 0.85) {
  return pL >= threshold;
}
