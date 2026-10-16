/**
 * Extractive (offline) LLM provider.
 *
 * WHY THIS EXISTS
 *   A mini project must demo on a laptop with no API key and possibly no
 *   internet. This provider needs neither. It does NOT hallucinate because it
 *   can only ever copy sentences that exist in the retrieved chunks - every
 *   answer is, by construction, grounded and citable.
 *
 * TRADE-OFFS (state these honestly in the report)
 *   + zero cost, zero latency variance, fully offline, provably grounded
 *   - answers are less fluent than an LLM's
 *   - it cannot synthesise across sources or paraphrase
 *   This is the correct default for a reproducible evaluation baseline.
 */

import { tokenize } from '../../../modules/rag/embed.js';
import { splitSentences, wordCount } from '../../../modules/rag/chunk.js';

// --- deterministic pseudo-randomness ---------------------------------------
// Quiz options must not shuffle differently on every request, or the same
// question would be a different question each time it is served.
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG - tiny, fast, and seedable with a string hash. */
function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle driven by a seeded RNG. */
function shuffle(array, rng) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build a 4-option MCQ and report where the correct answer landed after
 * shuffling. Always 4 options (3 distractors + 1 answer) so the UI is uniform.
 */
function buildOptions(correct, distractors, seedText) {
  const uniq = [];
  for (const d of distractors) {
    if (d && d !== correct && !uniq.includes(d)) uniq.push(d);
  }
  const options = shuffle([correct, ...uniq.slice(0, 3)], seededRng(hashString(seedText)));
  return { options, correctIndex: options.indexOf(correct) };
}

// --- answer generation ------------------------------------------------------
export function extractiveProvider() {
  return {
    name: 'extractive',

    /**
     * Answer a question by selecting the most relevant sentences from the
     * retrieved chunks. Returns citations so the UI can show provenance.
     */
    async answerQuestion({ question, chunks }) {
      if (!chunks || chunks.length === 0) {
        return {
          answer: "I couldn't find anything relevant in your uploaded material.",
          citations: [],
          refused: true,
          provider: this.name,
        };
      }

      const questionTokens = tokenize(question);
      const candidates = [];

      for (const chunk of chunks) {
        for (const sentence of splitSentences(chunk.text)) {
          const wc = wordCount(sentence);
          if (wc < 4) continue; // fragments make bad answers
          // Lexical overlap is the GROUNDING signal: how many question terms
          // this sentence actually contains. We keep it separate from the
          // blended ranking score below, because the grounding decision must not
          // be satisfiable by a merely high retrieval score.
          const tokens = new Set(tokenize(sentence));
          let overlap = 0;
          for (const t of questionTokens) if (tokens.has(t)) overlap += 1;

          // Ranking score blends lexical match with the chunk's retrieval score
          // so we prefer sentences from chunks that matched the question well.
          const score = overlap / Math.sqrt(tokens.size || 1) + chunk.score * 0.5;
          candidates.push({ sentence, chunk, score, overlap });
        }
      }

      candidates.sort((a, b) => b.score - a.score);

      // REFUSAL GATE: if no sentence in any retrieved chunk shares even one
      // content word with the question, we have no grounded answer. This is what
      // stops the extractive provider from returning irrelevant sentences for
      // off-topic questions. (Without this, the blended score is always positive
      // for any retrieved chunk, so the gate would never fire.)
      if (candidates.length === 0 || candidates[0].overlap === 0) {
        return {
          answer:
            "Your material doesn't appear to cover that. Try rephrasing, or upload a source that does.",
          citations: [],
          refused: true,
          provider: this.name,
        };
      }
      // Take the best sentence from each distinct chunk (diversity) up to 3.
      // We skip sentences with zero vocabulary overlap: a sentence that shares no
      // content word with the question cannot be supporting evidence, and citing
      // it would make the answer look padded or misleading.
      const picked = [];
      const usedChunks = new Set();
      for (const c of candidates) {
        if (c.overlap === 0) continue;
        if (usedChunks.has(c.chunk.id)) continue;
        picked.push(c);
        usedChunks.add(c.chunk.id);
        if (picked.length >= 3) break;
      }

      // If nothing scored above zero, be honest rather than returning noise.
      if (picked.length === 0) {
        return {
          answer: "Your material doesn't appear to cover that. Try rephrasing, or upload a source that does.",
          citations: [],
          refused: true,
          provider: this.name,
        };
      }

      return {
        answer: picked.map((p) => p.sentence).join(' '),
        citations: picked.map((p) => ({
          chunkId: p.chunk.id,
          materialId: p.chunk.materialId,
          page: p.chunk.page ?? null,
          quote: p.sentence,
          score: Number(p.score.toFixed(4)),
        })),
        refused: false,
        provider: this.name,
      };
    },

    /**
     * Generate cloze (fill-in-the-blank) and definition MCQs from chunks.
     *
     * Every question is traceable to `sourceChunkId`, so a generated quiz can
     * always be checked against the student's own material.
     */
    async generateQuestions({ chunks, count, topicName }) {
      if (!chunks || chunks.length === 0) return [];

      // Pass 1: corpus vocabulary + document frequency, for IDF-style salience.
      const vocabCount = new Map(); // token -> occurrences
      const docFreq = new Map(); // token -> number of chunks containing it
      for (const chunk of chunks) {
        const tokens = new Set(tokenize(chunk.text));
        for (const t of tokenize(chunk.text)) vocabCount.set(t, (vocabCount.get(t) ?? 0) + 1);
        for (const t of tokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
      }
      const nChunks = chunks.length;
      const idf = (token) => Math.log((1 + nChunks) / (1 + (docFreq.get(token) ?? 0)));

      // Global list of plausible distractor words (content words, decent length).
      const distractorPool = [...vocabCount.keys()].filter((t) => t.length >= 5);

      // Pass 2: propose candidate questions.
      const candidates = [];

      for (const chunk of chunks) {
        for (const sentence of splitSentences(chunk.text)) {
          const words = wordCount(sentence);
          if (words < 6 || words > 45) continue; // too short/long to be a good stem

          const tokens = tokenize(sentence);
          if (tokens.length < 4) continue;

          // The answer is the most "informative" (rarest) meaningful word.
          const answerToken = tokens.reduce(
            (best, t) => (idf(t) > idf(best) ? t : best),
            tokens[0],
          );
          if (answerToken.length < 5) continue;

          // Only blank words that appear once so the stem has a unique answer.
          const occurrences = (sentence.toLowerCase().match(new RegExp(`\\b${answerToken}\\b`, 'g')) ?? []).length;
          if (occurrences !== 1) continue;

          // Distractors: same-ish length so they are not obviously wrong.
          const distractors = distractorPool
            .filter((t) => t !== answerToken && Math.abs(t.length - answerToken.length) <= 3)
            .sort((a, b) => (vocabCount.get(b) ?? 0) - (vocabCount.get(a) ?? 0))
            .slice(0, 12);

          if (distractors.length < 3) continue;

          // Blank out the answer word (case-insensitive, whole word).
          const stem = sentence.replace(new RegExp(`\\b${answerToken}\\b`, 'i'), '_____');
          const rng = seededRng(hashString(stem));
          const chosen = shuffle(distractors, rng).slice(0, 3);
          const { options, correctIndex } = buildOptions(answerToken, chosen, stem);

          candidates.push({
            stem,
            options,
            correctIndex,
            // Salience drives difficulty: rarer + longer sentence => harder.
            salience: idf(answerToken) * (1 + words / 50),
            sourceChunkId: chunk.id,
            explanation: sentence.trim(),
          });
        }
      }

      if (candidates.length === 0) return [];

      // Pass 3: assign difficulty by tercile of the salience distribution.
      const sorted = [...candidates].sort((a, b) => a.salience - b.salience);
      const p33 = sorted[Math.floor(sorted.length * 0.33)]?.salience ?? 0;
      const p66 = sorted[Math.floor(sorted.length * 0.66)]?.salience ?? 0;

      const withDifficulty = candidates.map((c) => ({
        ...c,
        difficulty: c.salience <= p33 ? 'easy' : c.salience <= p66 ? 'medium' : 'hard',
      }));

      // Pass 4: de-duplicate by stem and take the requested number.
      // Prefer harder, more informative questions first, then sort back.
      const seen = new Set();
      const unique = [];
      for (const c of withDifficulty.sort((a, b) => b.salience - a.salience)) {
        if (seen.has(c.stem)) continue;
        seen.add(c.stem);
        unique.push(c);
        if (unique.length >= count) break;
      }

      return unique.map(({ salience, ...q }) => q);
    },
  };
}
