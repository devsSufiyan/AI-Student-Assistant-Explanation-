/**
 * Vector maths for retrieval. Pure functions, no dependencies.
 *
 * Vectors are plain JS number arrays (we store them as JSON in SQLite). For a
 * mini-project corpus (hundreds to low-thousands of chunks) a brute-force scan
 * is fast enough - no approximate-nearest-neighbour index needed.
 */

/** Cosine similarity of two equal-length vectors, in [-1, 1]. */
export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Return the `k` items most similar to `queryVec`.
 *
 * @param {number[]} queryVec
 * @param {Array<{embedding:number[]}>} items  each item must expose `embedding`
 * @param {number} k
 * @returns {Array<item & {score:number}>}  sorted by descending score
 */
export function topK(queryVec, items, k) {
  return items
    .map((item) => ({ ...item, score: cosine(queryVec, item.embedding) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}

/**
 * Maximal Marginal Relevance - re-rank results to be relevant AND diverse.
 *
 * WHY: pure top-k often returns five near-identical chunks, wasting the context
 * window. MMR greedily picks the next item that maximises
 *   lambda * relevance(item) - (1 - lambda) * maxSimilarity(item, alreadyPicked)
 * so we keep the best evidence while covering different parts of the material.
 *
 * @param {Array<{embedding:number[], score:number}>} candidates  (already scored)
 * @param {number} k       how many to return
 * @param {number} lambda  1 = ignore diversity, 0 = ignore relevance
 */
export function mmr(candidates, k, lambda = 0.7) {
  const selected = [];
  const pool = [...candidates];

  while (selected.length < k && pool.length > 0) {
    let bestIdx = 0;
    let bestValue = -Infinity;

    for (let i = 0; i < pool.length; i += 1) {
      // Penalty = how similar this candidate is to the most similar pick so far.
      const maxSim = selected.reduce(
        (m, s) => Math.max(m, cosine(pool[i].embedding, s.embedding)),
        0,
      );
      const value = lambda * pool[i].score - (1 - lambda) * maxSim;
      if (value > bestValue) {
        bestValue = value;
        bestIdx = i;
      }
    }

    selected.push(pool[bestIdx]);
    pool.splice(bestIdx, 1);
  }

  return selected;
}
