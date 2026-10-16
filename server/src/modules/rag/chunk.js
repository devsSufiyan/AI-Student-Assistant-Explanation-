/**
 * Chunking: turning one big document into retrievable pieces.
 *
 * WHY CHUNK AT ALL
 *   An LLM can't be handed a 40-page PDF, and if it were, retrieval would be
 *   meaningless (one giant "chunk" always scores the same). We split on sentence
 *   boundaries and pack sentences up to a word budget, with overlap.
 *
 * WHY OVERLAP
 *   If a definition straddles a boundary it becomes unretrievable. Overlapping
 *   windows guarantee every sentence appears intact in at least one chunk, at the
 *   cost of some duplication (which MMR in retrieval then de-duplicates).
 */

import { CHUNKING } from '../../config/constants.js';

/**
 * Split text into sentences.
 * Intentionally simple: split on . ! ? followed by whitespace + capital, plus
 * the newline-separated bullet/slide style common in lecture notes. Robust
 * sentence splitting needs an NLP model and is not worth the dependency here.
 */
export function splitSentences(text) {
  const normalised = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const rough = normalised
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return rough;
}

/** Count words - our proxy for tokens (avoids a tokenizer dependency). */
export function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Pack sentences into overlapping word-bounded chunks.
 *
 * @param {string} text
 * @returns {Array<{text:string, wordCount:number, index:number}>}
 */
export function chunkText(text) {
  const sentences = splitSentences(text);
  const chunks = [];
  let buffer = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const chunk = buffer.join(' ').trim();
    const wc = wordCount(chunk);
    // Keep tiny trailing fragments: they might still be a useful heading.
    if (wc >= CHUNKING.MIN_WORDS || chunks.length === 0) {
      chunks.push({ text: chunk, wordCount: wc, index: chunks.length });
    }
    // Carry the tail of this chunk into the next one to create overlap.
    // We cap the carry at buffer.length - 1 so a single oversized sentence can
    // never be carried forward whole - otherwise it would be duplicated into
    // every subsequent chunk and the packing loop would never make progress.
    const overlap = [];
    let words = 0;
    const maxCarry = Math.max(0, buffer.length - 1);
    for (let i = buffer.length - 1; i >= 0 && words < CHUNKING.OVERLAP_WORDS; i -= 1) {
      if (overlap.length >= maxCarry) break;
      overlap.unshift(buffer[i]);
      words += wordCount(buffer[i]);
    }
    buffer = overlap;
  };

  for (const sentence of sentences) {
    buffer.push(sentence);
    if (wordCount(buffer.join(' ')) >= CHUNKING.TARGET_WORDS) flush();
  }

  // Final flush. A short document must still yield ONE chunk or it would be
  // uploaded but completely unsearchable - a silent, confusing failure.
  const last = buffer.join(' ').trim();
  if (last && (wordCount(last) >= CHUNKING.MIN_WORDS || chunks.length === 0)) {
    chunks.push({ text: last, wordCount: wordCount(last), index: chunks.length });
  }

  return chunks;
}
