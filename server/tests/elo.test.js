/**
 * Unit tests for the Elo adaptivity model.
 * We assert the symmetric-update and self-calibration properties.
 */

import { describe, it, expect } from 'vitest';
import { expectedScore, updateAbility, updateDifficulty, seedDifficulty, difficultyLabel } from '../src/modules/mastery/elo.js';

describe('expectedScore', () => {
  it('is 0.5 for equal ratings', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 5);
  });
  it('exceeds 0.5 when the student outranks the item', () => {
    expect(expectedScore(1400, 1200)).toBeGreaterThan(0.5);
  });
  it('stays within [0,1]', () => {
    expect(expectedScore(0, 5000)).toBeGreaterThanOrEqual(0);
    expect(expectedScore(5000, 0)).toBeLessThanOrEqual(1);
  });
});

describe('updateAbility', () => {
  it('rises after a correct answer', () => {
    expect(updateAbility(1200, 1200, true)).toBeGreaterThan(1200);
  });
  it('falls after a wrong answer', () => {
    expect(updateAbility(1200, 1200, false)).toBeLessThan(1200);
  });
  it('moves less when the outcome was expected', () => {
    // Beating a much harder item should move ability more than beating an easy one.
    const beatHard = updateAbility(1200, 1600, true) - 1200;
    const beatEasy = updateAbility(1200, 900, true) - 1200;
    expect(beatHard).toBeGreaterThan(beatEasy);
  });
});

describe('updateDifficulty', () => {
  it('decreases when the student beats expectations (item is easier than thought)', () => {
    expect(updateDifficulty(1200, 1200, true)).toBeLessThan(1200);
  });
  it('increases when the student underperforms', () => {
    expect(updateDifficulty(1200, 1200, false)).toBeGreaterThan(1200);
  });
});

describe('seeding + labels', () => {
  it('seeds from the author label', () => {
    expect(seedDifficulty('easy')).toBe(1000);
    expect(seedDifficulty('hard')).toBe(1400);
    expect(seedDifficulty('unknown')).toBe(1200); // falls back to medium
  });
  it('maps ratings back to labels', () => {
    expect(difficultyLabel(1000)).toBe('easy');
    expect(difficultyLabel(1200)).toBe('medium');
    expect(difficultyLabel(1500)).toBe('hard');
  });
});
