/**
 * Quiz generation: turn retrieved chunks into stored, gradeable questions.
 *
 * FLOW
 *   1. Load the topic's chunks (fall back to the whole subject if the topic has
 *      none mapped yet - tolerant of a rough upload/annotation in the MVP).
 *   2. Ask the configured provider for questions (offline extractive by default).
 *   3. Validate + persist. Difficulty rating is SEEDED from the label but is a
 *      live Elo value from then on.
 *
 * Guardrails: invalid source chunk ids become NULL (FK safety), and questions
 * with an out-of-range correctIndex are rejected before they can corrupt grading.
 */

import { all, get, run } from '../../db/index.js';
import { newId, nowIso } from '../../lib/util.js';
import { getLLM } from '../../services/llm/index.js';
import { seedDifficulty } from '../mastery/elo.js';

/** Chunks for a topic, or the whole subject when no topic-specific chunks exist. */
function loadContextChunks(subjectId, topicId) {
  const topicChunks = topicId
    ? all(`SELECT id, material_id, page, text FROM chunks WHERE topic_id = ?`, topicId)
    : [];
  if (topicChunks.length > 0) return topicChunks;
  return all(`SELECT id, material_id, page, text FROM chunks WHERE subject_id = ?`, subjectId);
}

/**
 * Generate and persist `count` questions for a topic.
 * @returns {Promise<Array>} the stored question rows
 */
export async function generateQuestions({ subjectId, topicId, count = 5 }) {
  const topic = get(`SELECT * FROM topics WHERE id = ?`, topicId);
  if (!topic) throw new Error('Topic not found');

  const chunks = loadContextChunks(subjectId, topicId);
  if (chunks.length === 0) {
    return { created: 0, questions: [], reason: 'No indexed material for this topic yet.' };
  }

  const chunkIds = new Set(chunks.map((c) => c.id));
  const llm = getLLM();
  const generated = await llm.generateQuestions({
    chunks: chunks.map((c) => ({ ...c, score: 1 })), // score unused for generation
    count,
    topicName: topic.name,
  });

  // De-duplicate against questions already stored for this topic. The offline
  // generator is deterministic, so pressing "Generate" twice would otherwise
  // insert identical stems - and a repeated question is a false second data
  // point that would distort the mastery estimate.
  const existingStems = new Set(
    all(`SELECT stem FROM questions WHERE topic_id = ?`, topicId).map((r) => r.stem),
  );

  const stored = [];
  let skipped = 0;
  for (const q of generated) {
    const id = newId();
    // Reject anything that would break grading.
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      continue;
    }
    // Skip duplicates of existing questions (and of earlier items in this batch).
    if (existingStems.has(q.stem)) {
      skipped += 1;
      continue;
    }
    existingStems.add(q.stem);

    const sourceChunkId = q.sourceChunkId && chunkIds.has(q.sourceChunkId) ? q.sourceChunkId : null;
    const rating = seedDifficulty(q.difficulty);

    run(
      `INSERT INTO questions
         (id, subject_id, topic_id, stem, options, correct_index, difficulty, difficulty_rating,
          source, source_chunk_id, explanation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?)`,
      id,
      subjectId,
      topicId,
      q.stem,
      JSON.stringify(q.options),
      q.correctIndex,
      q.difficulty,
      rating,
      sourceChunkId,
      q.explanation ?? null,
      nowIso(),
    );

    stored.push(get(`SELECT * FROM questions WHERE id = ?`, id));
  }

  // Give the caller an honest explanation when nothing new was added.
  const reason =
    stored.length === 0 && generated.length > 0
      ? 'All generated questions already exist for this topic.'
      : undefined;

  return { created: stored.length, skipped, questions: stored, provider: llm.name, reason };
}

/** Parse the JSON `options` column into a real array. */
export function hydrateQuestion(row) {
  if (!row) return null;
  return { ...row, options: JSON.parse(row.options) };
}
