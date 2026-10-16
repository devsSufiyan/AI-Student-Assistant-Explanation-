/**
 * Central configuration / tunable constants.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every algorithm in this project (BKT, Elo, recommendation scoring, chunking)
 * depends on numbers that are *judgement calls*, not universal truths. Collecting
 * them in one place means:
 *   1. A marker can see every assumption the system makes at a glance.
 *   2. We can run weight-ablation experiments (see docs/eval) by editing one file.
 *   3. Pure algorithm modules stay free of scattered "magic numbers".
 *
 * Everything marked "TUNE HERE" is a knob you are expected to justify in the
 * report. Defaults are conservative and chosen to work on small demo corpora.
 */

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
export const SERVER = {
  PORT: Number(process.env.PORT ?? 4000),
  // JWT secret: MUST be overridden in a real deployment. The fallback exists only
  // so `npm run dev` works out of the box for a demo.
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-only-insecure-secret-change-me',
  JWT_EXPIRES_IN: '7d',
};

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------
// Single SQLite file. node:sqlite is built into Node >=22.5, so there is no
// native module to compile and nothing to download.
export const DB = {
  FILE: process.env.DB_FILE ?? 'data/study.db',
  UPLOAD_DIR: process.env.UPLOAD_DIR ?? 'data/uploads',
};

// ---------------------------------------------------------------------------
// Embeddings (RAG vectorisation)
// ---------------------------------------------------------------------------
export const EMBEDDING = {
  /**
   * 'hashing'      -> dependency-free deterministic hashing-trick embedding.
   *                   Works offline, good enough for small corpora.
   * 'transformers' -> real sentence embeddings via @xenova/transformers
   *                   (optional; only loaded if the package is installed).
   * TUNE HERE: switch to 'transformers' when quality matters more than setup cost.
   */
  PROVIDER: process.env.EMBEDDING_PROVIDER ?? 'hashing',
  // Dimensionality of the hashing embedding. Higher = fewer collisions, more memory.
  // 256 is plenty for a mini-project corpus and keeps cosine scans instant.
  HASH_DIM: 256,
  // Model id used only when PROVIDER === 'transformers'.
  TRANSFORMER_MODEL: process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
};

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------
export const CHUNKING = {
  // Target chunk size in *words* (token proxy; avoids a tokenizer dependency).
  TARGET_WORDS: 180,
  // Words repeated from the previous chunk. Overlap prevents an answer from being
  // split exactly across a chunk boundary and becoming unretrievable.
  OVERLAP_WORDS: 40,
  // Chunks smaller than this are still kept but flagged short (e.g. a stray heading).
  MIN_WORDS: 15,
};

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------
export const RETRIEVAL = {
  TOP_K: 6, // how many chunks to feed the LLM / extractor
  // Low absolute floor only: drops near-orthogonal noise. It is deliberately NOT
  // the "can I answer this?" gate. With the hashing embedder, a short query's
  // best cosine is often only 0.05-0.15 even when the right chunk is ranked #1,
  // so a high threshold here discards correct results. The real grounding gate
  // is the answer provider (see extractive.js), which checks that a retrieved
  // sentence actually shares vocabulary with the question.
  MIN_SCORE: 0.02,
  // Maximal Marginal Relevance trade-off: 1 = pure relevance, 0 = pure diversity.
  // Slight diversity (0.7) stops the context window filling with near-duplicates.
  MMR_LAMBDA: 0.7,
};

// ---------------------------------------------------------------------------
// LLM adapter
// ---------------------------------------------------------------------------
export const LLM = {
  /**
   * 'extractive' -> no network. Builds answers/quizzes directly from retrieved
   *                 chunks. This makes the MVP fully demoable without API keys.
   * 'openai'     -> any OpenAI-compatible endpoint (OpenAI, Groq, Ollama, vLLM).
   * TUNE HERE: set LLM_PROVIDER=openai + LLM_BASE_URL to use a real model.
   */
  PROVIDER: process.env.LLM_PROVIDER ?? 'extractive',
  BASE_URL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
  API_KEY: process.env.LLM_API_KEY ?? '',
  MODEL: process.env.LLM_MODEL ?? 'gpt-4o-mini',
  TEMPERATURE: 0.2, // low: study answers should be factual and repeatable
  MAX_CONTEXT_CHARS: 6000, // hard cap so we never blow the model's context window
};

// ---------------------------------------------------------------------------
// Bayesian Knowledge Tracing (mastery)
// ---------------------------------------------------------------------------
// Reference: Corbett & Anderson (1995). These four parameters describe a
// student's learning of ONE skill. Defaults are the commonly cited values.
export const BKT = {
  pL0: 0.1, // prior P(already knows the topic before any evidence)
  pLearn: 0.15, // P(transitions from not-knowing to knowing) after any practice
  pGuess: 0.2, // P(correct answer | does NOT know)  -> lucky guess
  pSlip: 0.1, // P(wrong answer  | knows)          -> careless slip
  // Difficulty weighting for the evidence. A hard question should move mastery
  // more than an easy one; we blend the BKT posterior toward the observation by
  // this weight. See bkt.js#updateMastery for the exact maths.
  MIN_EVIDENCE_WEIGHT: 0.5,
  MAX_EVIDENCE_WEIGHT: 1.5,
};

// ---------------------------------------------------------------------------
// Elo (item difficulty + student ability, used by the adaptive quiz)
// ---------------------------------------------------------------------------
export const ELO = {
  INITIAL_ABILITY: 1200, // every new student-topic pair starts here
  // Seed item ratings derived from the author's difficulty label.
  DIFFICULTY_SEED: { easy: 1000, medium: 1200, hard: 1400 },
  K_STUDENT: 24, // students move fast (we want adaptivity)
  K_ITEM: 8, // items move slowly (their true difficulty is stable)
  // "Zone of proximal development": aim for questions the student gets right
  // ~60% of the time - hard enough to teach, easy enough to stay motivated.
  TARGET_SUCCESS: 0.6,
};

// ---------------------------------------------------------------------------
// Recommendation scoring
// ---------------------------------------------------------------------------
// priority = w1*knowledgeGap + w2*spacingUrgency + w3*prerequisiteGap
//          + w4*weaknessSignal + w5*goalAlignment - w6*recencyPenalty
// All weights are relative; only their ratios matter. TUNE HERE for ablations.
export const RECOMMEND = {
  WEIGHTS: {
    knowledgeGap: 1.0, // primary driver: you don't know this yet
    spacingUrgency: 0.6, // it is due for review (spaced repetition)
    prerequisiteGap: 0.5, // a foundational topic underneath it is weak
    weaknessSignal: 0.7, // you have recently been getting this wrong
    goalAlignment: 0.4, // heavy topic, exam close by
    recencyPenalty: 0.5, // subtracted: you just studied it
  },
  MIN_PRIORITY: 0.08, // below this a topic is not worth recommending
  TOP_N: 3, // how many recommendations per day
  // Review interval in days at zero mastery; scales up as mastery grows.
  BASE_REVIEW_INTERVAL_DAYS: 2,
  MASTERY_THRESHOLD: 0.85, // above this, a topic counts as "mastered"
};

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------
export const PLANNER = {
  // Split of the day's minutes across the recommendation list + due review.
  SPLIT: { primary: 0.5, secondary: 0.3, review: 0.2 },
  MIN_BLOCK_MINUTES: 10, // don't create micro-tasks nobody will do
  DEFAULT_DAILY_MINUTES: 45,
};

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
export const ANALYTICS = {
  // stabilityDays = 1 + STABILITY_PER_MASTERY * mastery. Higher mastery => memory
  // decays slower => the same gap since practice is less risky.
  STABILITY_PER_MASTERY: 6,
  TREND_DAYS: 14, // window for the accuracy trend chart
};
