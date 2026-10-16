/**
 * RAG service - ingestion, retrieval, and grounded answering.
 *
 * PIPELINE (see PLAN.md section 8)
 *   ingest:  raw text -> chunk -> embed -> store in `chunks`
 *   query:   question -> embed -> cosine top-k -> MMR -> LLM/extractor -> cited answer
 *
 * This module owns the `chunks` and `materials` tables. Routes call these
 * functions and never touch retrieval internals.
 */

import { all, get, run, tx } from '../../db/index.js';
import { newId, nowIso } from '../../lib/util.js';
import { topK, mmr } from '../../lib/vector.js';
import { RETRIEVAL } from '../../config/constants.js';
import { chunkText } from './chunk.js';
import { embed } from './embed.js';
import { getLLM } from '../../services/llm/index.js';

/** Rows stored an embedding as JSON text; parse it back to a number[]. */
function hydrateChunk(row) {
  let embedding = [];
  try {
    embedding = JSON.parse(row.embedding);
  } catch {
    embedding = [];
  }
  return { ...row, embedding };
}

/**
 * Chunk, embed, and persist a material's text. Marks the material `indexed`.
 *
 * Runs inside a transaction: either the whole document is searchable, or none of
 * it is. A half-indexed document would make retrieval silently incomplete.
 *
 * @param {object} args
 * @param {string} args.materialId
 * @param {string} args.subjectId
 * @param {string|null} args.topicId
 * @param {string} args.text
 * @returns {Promise<number>} number of chunks stored
 */
export async function ingestMaterial({ materialId, subjectId, topicId = null, text }) {
  const chunks = chunkText(text);

  // Embedding is async, so do it BEFORE opening the (synchronous) transaction.
  // Nested async work inside a sync SQLite transaction is a classic footgun.
  const embeddings = [];
  for (const chunk of chunks) {
    embeddings.push(await embed(chunk.text));
  }

  tx(() => {
    for (let i = 0; i < chunks.length; i += 1) {
      const c = chunks[i];
      run(
        `INSERT INTO chunks (id, material_id, subject_id, topic_id, ord, text, embedding, page, word_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        materialId,
        subjectId,
        topicId,
        c.index,
        c.text,
        JSON.stringify(embeddings[i]),
        null, // page tracking needs per-page parsing; left null for the MVP
        c.wordCount,
      );
    }
    run(`UPDATE materials SET status = 'indexed', error = NULL WHERE id = ?`, materialId);
  });

  return chunks.length;
}

/** Fetch and hydrate every chunk in a subject. */
export function loadSubjectChunks(subjectId) {
  return all(`SELECT * FROM chunks WHERE subject_id = ?`, subjectId).map(hydrateChunk);
}

/**
 * Retrieve the most relevant chunks for a query.
 *
 * @returns {Promise<Array>} chunks with a `score`, best first, above MIN_SCORE
 */
export async function retrieve({ subjectId, query, k = RETRIEVAL.TOP_K }) {
  const chunks = loadSubjectChunks(subjectId);
  if (chunks.length === 0) return [];

  const queryVec = await embed(query);
  // Over-fetch so MMR has something to diversify, then cut back to k.
  const scored = topK(queryVec, chunks, Math.max(k * 3, k));
  const diversified = mmr(scored, k, RETRIEVAL.MMR_LAMBDA);

  // Guardrail: drop weak matches. If everything is dropped we return [], and the
  // caller refuses to answer rather than fabricating something.
  return diversified.filter((c) => c.score >= RETRIEVAL.MIN_SCORE);
}

/**
 * Full question-answering flow: retrieve, then ask the configured provider.
 * `chunks` are included in the response so the UI can show sources even when
 * the provider refuses.
 */
export async function answerQuestion({ subjectId, question }) {
  const chunks = await retrieve({ subjectId, query: question });
  const llm = getLLM();

  if (chunks.length === 0) {
    return {
      answer: "I couldn't find anything about that in this subject's material.",
      citations: [],
      refused: true,
      provider: llm.name,
      retrieved: [],
    };
  }

  const result = await llm.answerQuestion({ question, chunks });

  return {
    ...result,
    retrieved: chunks.map((c) => ({
      chunkId: c.id,
      materialId: c.materialId,
      score: Number(c.score.toFixed(4)),
      preview: c.text.slice(0, 160),
    })),
  };
}

/** Look up one chunk's metadata (used to show a source in the UI). */
export function getChunk(chunkId) {
  return get(`SELECT id, material_id, subject_id, page, text FROM chunks WHERE id = ?`, chunkId);
}
