/**
 * Text embedding service.
 *
 * WHY A PLUGGABLE PROVIDER
 *   The single biggest source of "it works on my machine" pain in RAG projects
 *   is a hard dependency on a cloud embedding API. We default to a dependency-
 *   free local embedder so the whole app runs offline and for free, and expose
 *   an optional real sentence-transformer provider for when quality matters.
 *
 * PROVIDERS
 *   'hashing'      - the hashing trick / random projection over word + bigram
 *                    features. Deterministic, instant, no downloads. Approximates
 *                    lexical overlap, which is enough to retrieve the right
 *                    chunk from a few hundred pages of course notes.
 *   'transformers' - real semantic embeddings via @xenova/transformers. Only
 *                    loaded lazily; if the package is not installed we fall back
 *                    to 'hashing' with a warning rather than crashing.
 */

import { EMBEDDING } from '../../config/constants.js';

// Common English words carry almost no retrieval signal. Removing them stops
// "the", "is", "of" from dominating the hashing vector. Kept short on purpose.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'of', 'to',
  'in', 'on', 'at', 'by', 'for', 'with', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'from', 'into',
  'we', 'you', 'they', 'he', 'she', 'them', 'his', 'her', 'our', 'your', 'their',
  'can', 'could', 'should', 'would', 'may', 'might', 'will', 'shall', 'not', 'no',
]);

/** Split text into lowercase alphanumeric tokens. */
export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * FNV-1a 32-bit hash. We only need a stable bucket index for the hashing trick;
 * cryptographic strength is irrelevant, speed and stability are not.
 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic embedding via the hashing trick.
 *
 * Each token (and the bigrams around it, which capture a little word order) is
 * hashed to a bucket and added with a hashed sign. The result is L2-normalised
 * so cosine similarity is stable regardless of text length.
 *
 * Properties that matter here: no dependencies, no training, identical output
 * for identical text, and lexical overlap => high cosine similarity.
 */
export function hashEmbedding(text, dim = EMBEDDING.HASH_DIM) {
  const vec = new Float64Array(dim);
  const tokens = tokenize(text);

  const add = (term, weight) => {
    const h = fnv1a(term);
    const idx = h % dim;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    vec[idx] += sign * weight;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    add(tokens[i], 1);
    // Bigram feature: gives a small reward to matching phrases, not just words.
    if (i + 1 < tokens.length) add(`${tokens[i]}_${tokens[i + 1]}`, 0.5);
  }

  // L2 normalise (guard against the all-zero vector for stopword-only text).
  let norm = 0;
  for (let i = 0; i < dim; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

// ---------------------------------------------------------------------------
// Transformers provider (optional, lazily loaded)
// ---------------------------------------------------------------------------
let transformerPipeline = null;

/** Load @xenova/transformers on first use. Returns null if unavailable. */
async function loadTransformer() {
  if (transformerPipeline) return transformerPipeline;
  try {
    const mod = await import('@xenova/transformers');
    transformerPipeline = await mod.pipeline('feature-extraction', EMBEDDING.TRANSFORMER_MODEL);
    return transformerPipeline;
  } catch {
    console.warn(
      '[embed] @xenova/transformers not installed - falling back to hashing embeddings.',
    );
    return null;
  }
}

/**
 * Embed a single string. Always async so the provider can be swapped without
 * changing calling code.
 * @returns {Promise<number[]>}
 */
export async function embed(text) {
  if (EMBEDDING.PROVIDER === 'transformers') {
    const pipe = await loadTransformer();
    if (pipe) {
      const out = await pipe(text, { pooling: 'mean', normalize: true });
      return Array.from(out.data);
    }
  }
  return hashEmbedding(text);
}

/** Embed many strings (sequential is fine at this scale and avoids API bursts). */
export async function embedBatch(texts) {
  const out = [];
  for (const t of texts) out.push(await embed(t));
  return out;
}

/** Stable name+dimension descriptor, handy for logging and the model card. */
export function embedderInfo() {
  if (EMBEDDING.PROVIDER === 'transformers' && transformerPipeline) {
    return { name: `transformers:${EMBEDDING.TRANSFORMER_MODEL}` };
  }
  return { name: 'hashing', dim: EMBEDDING.HASH_DIM };
}
