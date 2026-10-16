/**
 * LLM provider registry.
 *
 * ONE INTERFACE, SWAPPABLE BACKENDS
 *   Everything above this layer calls `getLLM().answerQuestion(...)` and
 *   `getLLM().generateQuestions(...)`. That means we can demo with zero API keys
 *   (extractive provider) and later flip an env var to use a real model without
 *   touching a single route or business-logic file.
 *
 * THE CONTRACT (both providers must satisfy it):
 *   answerQuestion({ question, chunks }) -> {
 *     answer: string,
 *     citations: [{ chunkId, materialId, page, quote, score }],
 *     refused: boolean,
 *     provider: string
 *   }
 *   generateQuestions({ chunks, count, topicName }) -> [{
 *     stem, options: string[], correctIndex, difficulty, sourceChunkId, explanation
 *   }]
 *
 * IMPORTANT: the LLM is NEVER trusted to produce the recommendation SCORE. It may
 * only phrase reasons (see recommend/reason.js). Scores are deterministic maths.
 */

import { LLM } from '../../config/constants.js';
import { extractiveProvider } from './providers/extractive.js';
import { openaiProvider } from './providers/openai.js';

let cached = null;

/** Return the configured provider instance (memoised). */
export function getLLM() {
  if (cached) return cached;

  if (LLM.PROVIDER === 'openai' && LLM.API_KEY) {
    cached = openaiProvider({ baseUrl: LLM.BASE_URL, apiKey: LLM.API_KEY, model: LLM.MODEL });
  } else {
    if (LLM.PROVIDER === 'openai' && !LLM.API_KEY) {
      console.warn('[llm] LLM_PROVIDER=openai but LLM_API_KEY is empty - using extractive.');
    }
    cached = extractiveProvider();
  }

  return cached;
}
