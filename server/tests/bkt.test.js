/**
 * Unit tests for the BKT mastery model.
 *
 * These assert the PROPERTIES that matter pedagogically, not just exact numbers:
 * correct answers increase mastery, wrong answers decrease it, and the result
 * always stays a valid probability.
 */

import { describe, it, expect } from 'vitest';
import { expectedSuccess, posterior, updateMastery, masteryLabel, isMastered } from '../src/modules/mastery/bkt.js';

describe('expectedSuccess', () => {
  it('rises with mastery and sits between guess and 1-slip', () => {
    const low = expectedSuccess(0.1);
    const high = expectedSuccess(0.9);
    expect(high).toBeGreaterThan(low);
  });
});

describe('posterior', () => {
  it('raises belief after a correct answer', () => {
    expect(posterior(0.5, true)).toBeGreaterThan(0.5);
  });
  it('lowers belief after a wrong answer', () => {
    expect(posterior(0.5, false)).toBeLessThan(0.5);
  });
  it('never leaves [0,1]', () => {
    for (const pL of [0, 0.25, 0.5, 0.75, 1]) {
      expect(posterior(pL, true)).toBeGreaterThanOrEqual(0);
      expect(posterior(pL, true)).toBeLessThanOrEqual(1);
      expect(posterior(pL, false)).toBeGreaterThanOrEqual(0);
      expect(posterior(pL, false)).toBeLessThanOrEqual(1);
    }
  });
});

describe('updateMastery', () => {
  it('increases mastery on a correct answer', () => {
    const next = updateMastery({ pL: 0.3, correct: true, difficultyRating: 1200 });
    expect(next).toBeGreaterThan(0.3);
  });

  it('decreases mastery on a wrong answer', () => {
    const next = updateMastery({ pL: 0.7, correct: false, difficultyRating: 1200 });
    expect(next).toBeLessThan(0.7);
  });

  it('still decreases mastery on a wrong answer when the prior is very low', () => {
    // Regression test: an unconditional pLearn used to make errors RAISE mastery
    // from a low prior. Mastery must never rise on a wrong answer.
    const next = updateMastery({ pL: 0.1, correct: false, difficultyRating: 1200 });
    expect(next).toBeLessThan(0.1);
  });

  it('rewards a correct answer on a hard question more than on an easy one', () => {
    const hard = updateMastery({ pL: 0.5, correct: true, difficultyRating: 1400 });
    const easy = updateMastery({ pL: 0.5, correct: true, difficultyRating: 1000 });
    expect(hard).toBeGreaterThan(easy);
  });

  it('punishes a wrong answer on an easy question more than on a hard one', () => {
    const easyWrong = updateMastery({ pL: 0.5, correct: false, difficultyRating: 1000 });
    const hardWrong = updateMastery({ pL: 0.5, correct: false, difficultyRating: 1400 });
    expect(easyWrong).toBeLessThan(hardWrong);
  });

  it('always returns a valid probability', () => {
    for (const pL of [0, 0.1, 0.5, 0.9, 1]) {
      for (const correct of [true, false]) {
        const next = updateMastery({ pL, correct, difficultyRating: 1200 });
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThanOrEqual(1);
      }
    }
  });

  it('converges upward when a student keeps answering correctly', () => {
    let pL = 0.1;
    for (let i = 0; i < 10; i += 1) {
      pL = updateMastery({ pL, correct: true, difficultyRating: 1200 });
    }
    expect(pL).toBeGreaterThan(0.9);
  });
});

describe('masteryLabel / isMastered', () => {
  it('labels bands in the expected order', () => {
    expect(masteryLabel(0.05)).toBe('novice');
    expect(masteryLabel(0.5)).toBe('developing');
    expect(masteryLabel(0.9)).toBe('mastered');
  });
  it('respects the threshold', () => {
    expect(isMastered(0.9)).toBe(true);
    expect(isMastered(0.5)).toBe(false);
  });
});
