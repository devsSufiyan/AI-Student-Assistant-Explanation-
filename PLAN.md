# AI-Based Student Study Assistant — Mini Project Plan

> Status: planning only. No code yet.
> Goal: a demoable, explainable MVP that shows all four pillars without over-engineering.

---

## 1. One-line product definition

A web app where a student uploads their own course material, asks questions
grounded in that material (RAG), takes generated quizzes, and gets a daily plan
that adapts to what they have actually learned.

---

## 2. The four pillars (what each one means in *this* project)

| Pillar | Concrete meaning here | Where it lives |
|---|---|---|
| **RAG-based academic assistant** | Answers questions using *only* the student's uploaded notes/PDFs, with citations back to the source chunk. | `modules/rag` |
| **Personalized learning** | A daily plan built from the student's goals, available time, syllabus coverage, and their own mastery state. | `modules/planner` |
| **Learning analytics** | Dashboard of mastery heatmap, accuracy trend, time-on-task, forgetting risk, exam-readiness score. | `modules/analytics` |
| **Adaptive tutoring** | Quiz engine picks the *next question* at the student's zone of proximal development and revises its estimate of ability after every answer. | `modules/quiz` + `modules/mastery` |

---

## 3. Focused MVP (the only thing we build first)

**MVP = "Upload → Ask → Quiz → See progress".**

In scope:
1. Student logs in (single role, no admin panel).
2. Upload one subject's material (PDF / TXT / MD).
3. Ask a question in chat → grounded answer + citations.
4. Generate a 5–10 question MCQ quiz from selected topics.
5. Take quiz → each answer logged.
6. Mastery updated per topic after each answer.
7. Dashboard shows mastery per topic + exam-readiness score.
8. "Today's plan" lists 3 recommended topics with a reason for each.

Explicitly **out of scope for MVP** (write these down so scope doesn't creep):
- Multi-tenant classrooms, teacher dashboards, grading.
- Voice, mobile app, real-time collaboration.
- Fine-tuning any model.
- Spaced-repetition flashcard UI (the scheduler exists in the engine, UI comes later).

---

## 4. Tech stack (JavaScript only)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js (LTS) | one language across stack |
| API | Express | boring, well-known, easy to defend in a viva |
| ORM / DB | `node:sqlite` (built-in) + raw SQL | zero infra, no native build step, easy to seed/demo |
| Vector store | `vectra` (local) or embeddings in SQLite + cosine in JS | no external service needed for a mini project |
| Embeddings | `@xenova/transformers` (`all-MiniLM-L6-v2`) | runs locally, free, no API key |
| LLM | provider adapter (Ollama local **or** OpenAI/Groq) | one interface, swap providers with a config flag |
| PDF parsing | `pdf-parse` | simple text extraction |
| Auth | JWT + bcrypt | minimal but realistic |
| Frontend | Sneat Bootstrap 5 template + vanilla JS | no build step, one process serves API + UI, pure JS end to end |
| Tests | Vitest | tests the pure algorithm functions |

**Why SQLite + local embeddings:** a mini project must run on the examiner's
laptop with no cloud keys. Keep the LLM swappable so it also works offline.

---

## 5. Data model (this is the backbone — lock it first)

Layered design: **raw events → derived attempt metrics → aggregated mastery.**
This separation is what makes the analytics defensible.

```
User            (id, name, email, passwordHash, goal, examDate, dailyMinutes, createdAt)
Subject         (id, userId, name)
Topic           (id, subjectId, name, parentTopicId?, weight, difficultyPrior)
                  -- parentTopicId gives a prerequisite/knowledge-graph tree

Material        (id, subjectId, filename, mimeType, status, uploadedAt)
Chunk           (id, materialId, topicId?, text, embedding, page, tokenCount)
                  -- RAG unit; embedding stored as blob/JSON

Question        (id, topicId, stem, options[], correctIndex, difficulty, source)
                  -- source = 'generated' | 'manual'; difficulty = Elo rating R_item
QuizAttempt     (id, userId, topicId, startedAt, finishedAt, score, mode)  -- mode: 'adaptive'|'fixed'
Answer          (id, attemptId, questionId, selectedIndex, isCorrect,
                 timeMs, abilityBefore, difficultyBefore, masteryBefore, masteryAfter)

LearningEvent   (id, userId, type, topicId?, payload, createdAt)
                  -- append-only raw log: asked_question, opened_material,
                  -- quiz_started, answered, plan_viewed, recommendation_clicked

TopicMastery    (id, userId, topicId, mastery, attempts, correct, lastPracticedAt,
                 stabilityDays, ability, updatedAt)   -- one row per (user, topic)

Recommendation  (id, userId, topicId, score, reason, breakdown, generatedAt, consumedAt)
StudyPlan       (id, userId, date, items[])          -- items = [{topicId, minutes, activity}]
```

Rules:
- `Answer` and `LearningEvent` are **append-only**. Never UPDATE them. This keeps
  the history trustworthy for analytics and makes recomputation possible.
- `TopicMastery`, `Recommendation` are **derived caches**; they can be rebuilt
  from raw events. That is the safety net if the model changes.

---

## 6. How student performance is stored & evaluated

Three layers, in order:

### Layer 1 — Raw evidence
Every answer is stored with the context *at the time of the answer*:
`isCorrect, timeMs, difficultyBefore, masteryBefore`. Storing "before" values
means we can later replay/audit how a score was produced.

### Layer 2 — Topic mastery via Bayesian Knowledge Tracing (BKT)
One explainable number per (student, topic): `P(knows topic)`, default 0.0–1.0.
Four tunable parameters (document them in comments):
- `pL0` = 0.1 (prior chance of already knowing it)
- `pLearn` = 0.15 (chance of learning after any practice)
- `pGuess` = 0.20 (correct without knowing)
- `pSlip` = 0.10 (wrong despite knowing)

Update after each answer:
```
# posterior given the observation
if correct:  pL_obs = pL*(1-pSlip) / ( pL*(1-pSlip) + (1-pL)*pGuess )
if wrong:    pL_obs = pL*pSlip     / ( pL*pSlip     + (1-pL)*(1-pGuess) )
# learning transition (practice can teach you)
pL_new = pL_obs + (1 - pL_obs) * pLearn
```
Then weight by difficulty: answers on hard questions count more
(`evidenceWeight = clamp(0.5 + difficulty, 0.5, 1.5)`), applied by blending the
update toward the observation proportionally to that weight.

### Layer 3 — Item difficulty & student ability via Elo (for adaptivity)
- Each question has a rating `R_item` (seeded from author label: easy 1000 / med 1200 / hard 1400).
- Each student–topic pair has an ability `R_student` (seeded 1200).
- Expected success: `E = 1 / (1 + 10^((R_item - R_student)/400))`
- After an answer: `R_student += K*(actual - E)`, `R_item += K*(E - actual)`, with `K = 16` (lower for items as they accumulate answers).

### Aggregated analytics (computed, not stored raw)
- **Accuracy trend** = correct/total bucketed by day or by attempt.
- **Forgetting risk** = `daysSinceLastPractice / stabilityDays`
  where `stabilityDays = 1 + 6*mastery` (higher mastery decays slower).
- **Exam readiness** = `Σ(mastery_t * weight_t) / Σ(weight_t)` over syllabus topics,
  optional penalty for topics never practiced.
- **Time-on-task** = sum of `timeMs` on answers + dwell on material.

---

## 7. How recommendations are generated

A **transparent scoring function** (no black box) over every topic the student
has *not* mastered. For each candidate topic compute:

```
priority =
    w1 * knowledgeGap          # (1 - mastery)         -> what they don't know
  + w2 * spacingUrgency        # overdue vs optimal review interval (Ebbinghaus)
  + w3 * prerequisiteGap       # prerequisite topics with low mastery
  + w4 * weaknessSignal        # recent wrong answers / low accuracy on this topic
  + w5 * goalAlignment         # weight * syllabus coverage, exam proximity
  - w6 * recencyPenalty        # avoid repeating what was just studied
```

Then:
1. Drop candidates below a `minPriority` threshold.
2. Sort desc, take top N (default 3 per day).
3. **Explain each one**: turn the numeric `breakdown` object into a human
   sentence with a template (fast, deterministic), e.g.
   *"Recommended because your mastery is 32% and you have not reviewed this in 6 days."*
   The LLM is only allowed to phrase the reason, never to invent the score.
4. Persist as a `Recommendation` with the full `breakdown` so the "why" is auditable.

### Study planner (turns recommendations into a schedule)
Greedy bin-packing for MVP:
- Input: available minutes today, due spaced-repetition topics, top recommendations.
- Allocate: 50% to weakest recommended topic, 30% next, 20% review of due items.
- Never exceed `dailyMinutes`; carry overflow to next day.
- (A full constraint solver is a "future work" line, not MVP.)

---

## 8. RAG pipeline (step by step)

1. **Ingest** upload → extract text (`pdf-parse`) → normalize whitespace.
2. **Chunk** ~800 tokens with ~150 overlap; keep `materialId`, `page`, `topicId`.
3. **Embed** each chunk locally (`all-MiniLM-L6-v2`) → store vector + text.
4. **Retrieve** on question: embed query → cosine top-k (k≈6) → optional MMR for diversity.
5. **Assemble prompt**: system = "answer only from context, cite chunk ids, say
   I don't know if absent"; user = retrieved chunks + question.
6. **Answer**: LLM returns answer + cited chunk ids → UI shows inline citations.
7. **Log** the interaction as a `LearningEvent` (query + retrieved ids + rating) for evaluation.
8. **Quiz generation** reuses the same chunks: prompt the LLM for MCQs *with the
   chunk id as source*, then validate that `correctIndex` is in range before saving.

Guardrails (comment these clearly in code):
- Refuse to answer if max retrieval score < threshold (prevents hallucination).
- Cap context size to stay within token budget.
- Validate all LLM JSON with a schema before DB writes.

---

## 9. Adaptive tutoring (next-question selection)

Given candidate questions for a topic, pick the one whose **predicted success is
closest to 0.6** (the zone of proximal development) using the Elo expectation:

```
target = 0.6
nextQuestion = argmin_q | E(q) - target |
```

Effect: correct answers raise difficulty, wrong answers lower it — automatic
scaffolding. `QuizAttempt.mode = 'adaptive'`; keep a `'fixed'` mode as the
control condition for evaluation.

---

## 10. API surface (REST, MVP)

```
POST /auth/register | /auth/login
POST /subjects
POST /subjects/:id/materials        (upload -> triggers ingest)
POST /subjects/:id/materials/:mid/index   (chunk+embed, can be a background job)

POST /rag/query                     { subjectId, question } -> { answer, citations[] }
POST /quiz/generate                 { topicId, count, mode } -> questions[]
POST /quiz/attempts                 start attempt
POST /quiz/attempts/:id/answer      { questionId, selectedIndex, timeMs } -> feedback
POST /quiz/attempts/:id/finish

GET  /analytics/overview            mastery, readiness, trend, time-on-task
GET  /analytics/topics              per-topic mastery + forgetting risk
GET  /recommendations/today         top N with reasons
GET  /plan/today | POST /plan/regenerate
```

---

## 11. Folder structure

```
study-assistant/
├─ server/
│  ├─ prisma/schema.prisma           # data model from section 5
│  ├─ src/
│  │  ├─ config/                     # env, model names, algorithm constants
│  │  ├─ db/                         # prisma client, seed script
│  │  ├─ modules/
│  │  │  ├─ auth/
│  │  │  ├─ materials/               # upload + parse
│  │  │  ├─ rag/                     # chunk, embed, retrieve, prompt
│  │  │  ├─ quiz/                    # generate, attempt, adaptive selection
│  │  │  ├─ mastery/                 # bkt.js, elo.js  (pure functions)
│  │  │  ├─ recommend/               # priority scoring + reason builder
│  │  │  ├─ planner/                 # greedy scheduler
│  │  │  └─ analytics/               # aggregations
│  │  ├─ services/llm/               # provider adapter + JSON validation
│  │  ├─ middleware/                 # auth, errors, validation
│  │  └─ index.js
│  └─ tests/                         # unit tests for pure algorithms
├─ client/                           # static SPA: Sneat template + vanilla JS
│  ├─ assets/                        # vendored Sneat template (MIT)
│  ├─ css/app.css                    # app styles on top of Sneat
│  └─ js/                            # api.js, ui.js, app.js, views/
└─ docs/                             # this plan, model card, eval results
```

**Rule of thumb:** `mastery`, `recommend`, `planner` hold **pure functions**
(no DB, no LLM) so they are instantly unit-testable. Modules fetch data and
call the pure functions. This is the single most important architectural choice.

---

## 12. Commenting convention (as requested — every piece of code explained)

- **Module header (JSDoc block)** on every file: what it does, why it exists,
  and what it must *not* do.
- **Every exported function**: JSDoc with `@param`, `@returns`, and a plain-English
  "why" line. For algorithm functions, also state the formula reference (e.g. "BKT posterior").
- **Inline comments** for: all non-obvious math (BKT, Elo, priority weights),
  every magic constant (with the tuning rationale), and every guardrail
  (why we refuse to answer, why we validate LLM JSON).
- **Comment fixed constants with a "tune here" marker** so markers don't hunt through logic.
- No commented-out code, no obvious `// increment i` noise — comments explain *why*, not *what*.

Example of the intended density:
```js
/**
 * Update a student's mastery of one topic after a single graded answer.
 *
 * Uses Bayesian Knowledge Tracing: first compute the posterior P(knows | observed),
 * then apply the learning-transition step because practice itself can teach.
 * Reference: Corbett & Anderson (1995).
 *
 * @param {number} pL   Current P(knows), 0..1
 * @param {boolean} correct  Whether the answer was right
 * @param {object} params  {pSlip, pGuess, pLearn} - see config/mastery.js
 * @returns {number} Updated P(knows), 0..1
 */
```

---

## 13. Build plan (8 milestones, ~8 weeks part-time)

| # | Milestone | Deliverable | Done when |
|---|---|---|---|
| 0 | Skeleton | Express + `node:sqlite` + static client running, schema created, seed data | server and client talk to each other |
| 1 | Auth + subjects | register/login, create subject | token-protected route works |
| 2 | Ingest + RAG core | upload → chunk → embed → retrieve | `/rag/query` returns cited answer |
| 3 | Quiz | generate MCQs from chunks, take & score attempt | score persisted to `Answer` |
| 4 | Mastery engine | BKT + Elo pure functions + tests | quiz answers move mastery correctly |
| 5 | Recommendations + planner | scored topics with reasons, today's plan | plan regenerates from real data |
| 6 | Adaptive quiz | ZPD question selection | difficulty visibly adapts |
| 7 | Analytics dashboard | mastery heatmap, trend, readiness | charts read from aggregates |
| 8 | Evaluation + writeup | golden set, metrics, docs, demo | report has numbers, not just claims |

Suggested commit discipline: pure algorithms land **with their unit tests in the
same commit**. Frontend work lands behind the API, never calling the LLM directly.

---

## 14. How we evaluate the SYSTEM (for the report — this is the "evaluate" part)

Do not claim quality; measure it. Keep a `docs/eval/` folder with reproducible scripts.

**A. RAG quality**
- Build a golden set: 20–50 questions with known correct answers + source pages.
- Retrieval metrics: **Recall@k**, **MRR**, **nDCG@k** (does it find the right chunk?).
- Answer metrics: **faithfulness/groundedness** (is every claim in the answer
  supported by a cited chunk?), **answer relevance**, **citation accuracy**.
- Baseline comparison: RAG answer vs. LLM-without-RAG, to prove RAG adds value.

**B. Recommendation quality**
- Offline: **Precision@N** — did the student actually practice a recommended topic next?
- Ablation: run the scoring with each weight zeroed to show each term contributes.
- Sanity: never recommend a topic already mastered > 0.9 (violation rate = 0).

**C. Adaptive tutoring quality**
- A/B: adaptive selection vs. random selection over a fixed set.
- Metrics: questions-to-mastery, mastery gain per answer, error rate stability.
- If real students are unavailable, use a **synthetic student simulator** with
  known ground-truth knowledge to show adaptive converges faster.

**D. Student-outcome view (the product analytics)**
- Pre/post assessment score delta.
- Average time-to-mastery per topic.
- Plan adherence (% of planned items completed).

Keep a short **Model Card** in `docs/` documenting BKT/Elo parameters, their
defaults, and their limitations (e.g., assumes one latent skill per topic).

---

## 15. Risks & honest limitations (put these in the report early)

| Risk | Mitigation |
|---|---|
| LLM hallucinates despite context | strict "answer only from context" prompt + low-score refusal + citations shown |
| Local embeddings weaker than paid | acceptable for MVP; provider adapter allows upgrade |
| BKT assumes independence of topics | model prerequisite edges separately; state as limitation |
| Cold-start (new user, no data) | seed mastery from a short diagnostic quiz |
| LLM cost/rate limits | cache embeddings; batch generation; local model fallback |
| Scope creep | the explicit out-of-scope list in section 3 |

---

## 16. Suggested next step

1. Approve this plan and the data model in section 5.
2. Then build **Milestone 0 → 4** first (schema + RAG + quiz + mastery), because
   recommendations and analytics are only meaningful once real answer data exists.
3. Every module gets a JSDoc header and a matching unit test before the next one starts.

---

## 17. Implementation status (built)

The plan above was implemented in full. Mapping from each milestone to the code,
so the report can point at files rather than describe intentions:

| Milestone | Where it lives |
|---|---|
| 0 Skeleton | `server/src/{app,index}.js`, `server/src/db/schema.sql` |
| 1 Auth + subjects | `server/src/modules/auth/service.js`, `modules/subjects/service.js` |
| 2 Ingest + RAG | `server/src/modules/rag/{chunk,embed,index}.js`, `modules/materials/parse.js` |
| 3 Quiz | `server/src/modules/quiz/{generate,service}.js` |
| 4 Mastery engine | `server/src/modules/mastery/{bkt,elo,service}.js` |
| 5 Recommendations + planner | `server/src/modules/recommend/*`, `modules/planner/*` |
| 6 Adaptive quiz | `server/src/modules/quiz/adaptive.js` |
| 7 Analytics dashboard | `server/src/modules/analytics/service.js`, `client/src/views/DashboardView.jsx` |
| 8 Evaluation | `server/src/eval/run.js`, `tests/*`, `docs/MODEL_CARD.md` |

### Deviations from the plan (and why)

1. **`node:sqlite` instead of Prisma + SQLite.** Prisma needs a generated engine
   binary and a codegen step. Node 22.5+ ships SQLite, so the project installs
   and runs with no native build and no engine download. Raw SQL lives in the
   `service.js` files that own each table.
2. **Offline-first providers.** Embeddings default to a dependency-free hashing
   embedder and the LLM defaults to an *extractive* provider, so the whole app
   demos and is evaluated with no API key and no internet. Both are swappable via
   `EMBEDDING_PROVIDER` / `LLM_PROVIDER`.
3. **BKT learning transition gated on correct answers.** Textbook BKT applies
   `pLearn` unconditionally, which makes a *wrong* answer *raise* mastery at a low
   prior. Gating it preserves the two properties a mastery model must have. This
   is documented in `docs/MODEL_CARD.md` and pinned by a regression test.
4. **No charting library.** The dashboard's sparkline and bars are hand-drawn SVG/CSS,
   keeping the client dependency-free.
5. **`.env` loaded via Node's `--env-file-if-exists`.** No `dotenv` dependency.

### Test coverage (99 tests, 9 files)

Pure algorithms are unit-tested (`bkt`, `elo`, `recommend`, `adaptive`/`planner`,
`rag`, `llm`, `materials-parse`). The HTTP layer is covered by an integration test
(`api.test.js`) and a full upload-to-mastery loop (`e2e.test.js`). Run `npm test`
in `server/`.

### Post-MVP additions

- **Any document type.** A dependency-free ZIP reader (`modules/materials/zip.js`)
  extracts DOCX/PPTX/XLSX/ODT text; HTML, RTF, CSV/JSON and plain text are handled
  directly. Binary files are rejected explicitly instead of being indexed as noise.
- **Post-quiz review.** `GET /api/quiz/attempts/:id/review` returns each question
  with the student's choice, the correct answer, the reason (source sentence) and
  the per-question mastery change. It is only available after finishing, so the
  answer key never reaches the browser mid-quiz.
- **Redesigned UI.** A token-based design system with toasts, skeletons, empty
  states, drag-and-drop upload, a results screen with a score ring, and a
  responsive layout.
- **Boot robustness.** `busy_timeout` plus non-fatal WAL so a transiently locked
  database no longer crashes the server on start.
