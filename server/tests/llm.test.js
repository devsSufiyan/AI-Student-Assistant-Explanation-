/**
 * Tests for the offline (extractive) LLM provider.
 *
 * These pin the GROUNDING behaviour, which is the whole point of the provider:
 *   - in-domain questions are answered from the supplied chunks, with citations
 *   - out-of-domain questions are refused even when chunks were retrieved
 *
 * The refusal test is the important regression guard: the provider must not
 * return a sentence just because it was retrieved.
 */

import { describe, it, expect } from 'vitest';
import { extractiveProvider } from '../src/services/llm/providers/extractive.js';

// A minimal retrieved-chunk shape. `score` mimics a real retrieval score.
const chunks = [
  {
    id: 'c1',
    materialId: 'm1',
    page: 1,
    score: 0.2,
    text: 'A deadlock occurs when two transactions each hold a lock that the other transaction needs.',
  },
  {
    id: 'c2',
    materialId: 'm1',
    page: 2,
    score: 0.15,
    text: 'Database normalization is the process of organizing data to reduce redundancy.',
  },
];

describe('extractiveProvider.answerQuestion', () => {
  const llm = extractiveProvider();

  it('answers an in-domain question from the chunks and cites the source', async () => {
    const res = await llm.answerQuestion({ question: 'What is a deadlock?', chunks });
    expect(res.refused).toBe(false);
    expect(res.answer.toLowerCase()).toContain('deadlock');
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.citations[0].chunkId).toBe('c1');
  });

  it('refuses an out-of-domain question even when chunks were retrieved', async () => {
    // No token from this question appears in the chunks, so there is no grounded
    // answer - the provider must refuse rather than return the closest sentence.
    const res = await llm.answerQuestion({ question: 'How do I bake sourdough bread?', chunks });
    expect(res.refused).toBe(true);
    expect(res.citations).toEqual([]);
  });

  it('refuses when there are no chunks at all', async () => {
    const res = await llm.answerQuestion({ question: 'What is a deadlock?', chunks: [] });
    expect(res.refused).toBe(true);
  });

  it('reports its provider name', () => {
    expect(llm.name).toBe('extractive');
  });
});

describe('extractiveProvider.generateQuestions', () => {
  const llm = extractiveProvider();

  it('generates well-formed 4-option questions sourced from a chunk', async () => {
    const passthrough = chunks.map((c) => ({ ...c, score: 1 }));
    const questions = await llm.generateQuestions({
      chunks: passthrough,
      count: 5,
      topicName: 'Concurrency',
    });

    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(q.options).toHaveLength(4);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(4);
      // The stem blanks out the answer, so it must contain the placeholder.
      expect(q.stem).toContain('_____');
      // Every question must be traceable back to a source chunk.
      expect(['c1', 'c2']).toContain(q.sourceChunkId);
      expect(['easy', 'medium', 'hard']).toContain(q.difficulty);
    }
  });

  it('is deterministic for the same input', async () => {
    const passthrough = chunks.map((c) => ({ ...c, score: 1 }));
    const a = await llm.generateQuestions({ chunks: passthrough, count: 3, topicName: 'X' });
    const b = await llm.generateQuestions({ chunks: passthrough, count: 3, topicName: 'X' });
    expect(a).toEqual(b);
  });

  it('returns an empty list when there is no material', async () => {
    const questions = await llm.generateQuestions({ chunks: [], count: 5, topicName: 'X' });
    expect(questions).toEqual([]);
  });
});
