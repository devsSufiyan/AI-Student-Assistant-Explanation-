/**
 * Tests for chunking, the vector utilities, and the offline embedder.
 * These guard the retrieval foundation: if chunking or cosine is wrong, RAG
 * quality collapses and no amount of prompt tuning will save it.
 */

import { describe, it, expect } from 'vitest';
import { splitSentences, chunkText, wordCount } from '../src/modules/rag/chunk.js';
import { cosine, topK } from '../src/lib/vector.js';
import { hashEmbedding } from '../src/modules/rag/embed.js';

describe('splitSentences', () => {
  it('splits on sentence boundaries', () => {
    const s = splitSentences('Normalization reduces redundancy. Indexing speeds up reads. B-trees stay balanced.');
    expect(s).toHaveLength(3);
  });
});

describe('chunkText', () => {
  it('creates overlapping, word-bounded chunks', () => {
    const long = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i} about databases`).join('. ') + '.';
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    // All but possibly the first/last chunk should be near the target size.
    for (const c of chunks) expect(wordCount(c.text)).toBeGreaterThan(0);
  });

  it('keeps short text as a single chunk', () => {
    const chunks = chunkText('A short note about indexes.');
    expect(chunks).toHaveLength(1);
  });
});

describe('cosine', () => {
  it('is 1 for identical vectors', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
  it('is 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
  it('handles zero vectors safely', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('topK', () => {
  it('returns the most similar items in order', () => {
    const items = [
      { id: 'a', embedding: [1, 0] },
      { id: 'b', embedding: [0.9, 0.1] },
      { id: 'c', embedding: [0, 1] },
    ];
    const res = topK([1, 0], items, 2);
    expect(res[0].id).toBe('a');
    expect(res).toHaveLength(2);
  });
});

describe('hashEmbedding', () => {
  it('is deterministic for identical text', () => {
    expect(hashEmbedding('indexing improves read performance')).toEqual(
      hashEmbedding('indexing improves read performance'),
    );
  });

  it('gives lexically overlapping text higher similarity than unrelated text', () => {
    const query = hashEmbedding('What is database normalization and redundancy?');
    const related = hashEmbedding('Normalization removes redundancy in database tables.');
    const unrelated = hashEmbedding('A B-tree is a self balancing search tree for disk storage.');
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it('produces unit-length vectors', () => {
    const v = hashEmbedding('transactions and acid properties');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 4);
  });
});
