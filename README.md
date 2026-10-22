# AI-Based Student Study Assistant

![CI](https://github.com/devsSufiyan/AI-Student-Assistant-Explanation-/actions/workflows/ci.yml/badge.svg)

A full-stack JavaScript mini project that combines **RAG**, **personalized
learning**, **learning analytics**, and **adaptive tutoring** in one small,
runnable app. Zero cloud keys required — it ships with offline embeddings and an
offline question generator, and can be pointed at a real LLM with one env var.

> Design rationale and the full plan live in [`PLAN.md`](./PLAN.md).
> Model parameters and limitations live in [`docs/MODEL_CARD.md`](./docs/MODEL_CARD.md).

---

## What it does

A student uploads their own course notes, then:

1. **Asks questions** and gets answers grounded **only** in their material, with
   citations back to the exact source chunk (RAG).
2. **Takes quizzes** whose questions are generated from that material. The engine
   picks the next question at the student's zone of proximal development, and the
   results screen reviews **every question with the correct answer and the reason**
   (the source sentence) after you finish.
3. **Builds a mastery model** of each topic using Bayesian Knowledge Tracing
   (BKT) and Elo — updated after every single answer.
4. **Gets a daily plan** and ranked recommendations, each with a plain-English
   reason derived from a transparent scoring formula.
5. **Sees analytics** — mastery heatmap, accuracy trend, forgetting risk, and an
   exam-readiness score.

---

## Quick start

**One process.** The client is a framework-free static SPA (plain HTML/CSS/JS
with the Sneat Bootstrap 5 template), so Express serves both the API and the
UI. Node **22.5+** is required (for the built-in `node:sqlite`).

```bash
cd server
npm install
cp .env.example .env    # optional: tweak providers/ports
npm run seed            # creates the demo account + sample data
npm run dev             # http://localhost:4000
```

Open <http://localhost:4000> and sign in with:

```
demo@example.com / password123
```

There is **no client build step and no second terminal** — open the URL above
and the app is running. The whole client is ~4,400 lines of plain JavaScript.

For a production run:

```bash
cd server && npm start     # same server, NODE_ENV=production
```

---

## Tests and evaluation

```bash
cd server
npm test     # 99 unit + integration tests (pure algorithms + HTTP flow + full e2e)
npm run eval # reproducible metrics for the report
```

`npm run eval` prints three results: RAG retrieval **Recall@k / MRR** on a golden
set, a **recommendation weight ablation**, and an **adaptive vs fixed** quiz
simulation. See `docs/` and `PLAN.md` §14 for how to interpret them.

---

## Supported document types

Uploads accept **any file**, and the extractor picks the right parser. Office
formats work through a small built-in ZIP reader, so there is nothing extra to
install:

| Type | Formats |
|---|---|
| Documents | `.pdf`*, `.docx`, `.odt`, `.rtf`, `.txt`, `.md` |
| Slides / sheets | `.pptx`, `.xlsx`, `.odp`, `.ods` |
| Web / data / code | `.html`, `.csv`, `.tsv`, `.json`, `.xml`, `.yml`, `.log`, `.js`, `.py`, … |

\* PDF needs `npm i pdf-parse`. Formats with no text layer (images, scanned PDFs)
are rejected with a clear message rather than silently indexing binary noise.

---

## Architecture

```
client/                     framework-free SPA (Sneat Bootstrap 5 template)
  index.html                the only HTML file; the app renders into #app
  assets/                   vendored Sneat template (MIT) - css, js, fonts
  css/app.css               app-specific styles on top of Sneat
  js/api.js                 the single place the browser talks to the server
  js/ui.js                  escaping, toasts, cards, badges, chart helpers
  js/app.js                 app shell: auth state, layout, hash routing
  js/views/                 one file per product feature
server/
  src/config/constants.js   EVERY tunable number, documented ("TUNE HERE")
  src/db/                   node:sqlite setup, schema.sql, seed
  src/lib/                  pure helpers (util, vector, http)
  src/modules/
    auth/  subjects/        identity and ownership
    materials/  rag/        ingest -> chunk -> embed -> retrieve -> answer
    mastery/                bkt.js + elo.js (pure) and service.js (I/O)
    quiz/                   generation, adaptive selection, attempts
    recommend/              score.js + reason.js (pure) and service.js (I/O)
    planner/                schedule.js (pure) and service.js (I/O)
    analytics/              derived metrics
  src/services/llm/         provider adapters (offline extractive + OpenAI)
  src/eval/run.js           the evaluation harness
  tests/                    unit + integration tests
```

### The one architectural rule that matters

**Algorithms are pure functions; modules own the I/O.** `bkt.js`, `elo.js`,
`score.js`, `schedule.js`, `adaptive.js`, and `vector.js` have no database,
network, or framework imports. They are instantly unit-testable, and the
`service.js` files next to them do nothing but fetch data, call the pure
functions, and persist results.

---

## The four pillars (where to look)

| Pillar | Key files | The algorithm |
|---|---|---|
| **RAG assistant** | `modules/rag/*`, `services/llm/*` | chunk → embed → cosine top-k → MMR → grounded answer with citations; refuses when retrieval is weak |
| **Adaptive tutoring** | `modules/mastery/elo.js`, `modules/quiz/adaptive.js` | Elo expectation `E = 1/(1+10^((R_item−R_ability)/400))`; serve the item whose `E` is closest to `0.6` |
| **Personalized learning** | `modules/recommend/*`, `modules/planner/*` | transparent weighted priority score → top-N with a stored breakdown → greedy minute-budget schedule |
| **Learning analytics** | `modules/analytics/service.js` | readiness = weighted avg mastery; forgetting risk = days-since-practice / memory stability |

### How mastery is stored and evaluated

Layered, so every number is auditable:

1. **Raw evidence** — `answers` and `learning_events` are *append-only*, and each
   answer stores the model state *before* it (`mastery_before`, `ability_before`,
   `difficulty_before`).
2. **Derived mastery** — `topic_mastery` holds `P(knows topic)` from BKT. It is a
   cache that can be rebuilt from the raw evidence at any time.
3. **Adaptivity** — Elo ratings for the student and for each question, updated
   after every answer so items self-calibrate.

### How recommendations are generated

```
priority = w1·knowledgeGap + w2·spacingUrgency + w3·prerequisiteGap
         + w4·weaknessSignal + w5·goalAlignment − w6·recencyPenalty
```

Every term is a normalised 0–1 feature and every weight lives in
`config/constants.js`. The full weighted breakdown is stored with each
recommendation, and the reason text is built from the breakdown by a **template**
— the LLM is never allowed to invent a score or a cause.

---

## Configuration

Copy `server/.env.example` to `server/.env`. The defaults run fully offline:

- `EMBEDDING_PROVIDER=hashing` — dependency-free hashing-trick embeddings.
- `LLM_PROVIDER=extractive` — builds answers and cloze questions from retrieved
  chunks, so it provably cannot hallucinate.

To use real models:

```bash
EMBEDDING_PROVIDER=transformers
npm i @xenova/transformers          # downloads all-MiniLM-L6-v2 locally

LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1   # or a Groq / Ollama OpenAI-compatible URL
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

---

## API

All routes except `/api/auth/*` and `/api/health` require `Authorization: Bearer <token>`.

```
POST /api/auth/register | /api/auth/login        GET /api/auth/me
PATCH /api/auth/me                               # name, goal, examDate, dailyMinutes

GET  /api/subjects                               POST /api/subjects
GET  /api/subjects/:id/topics                     POST /api/subjects/:id/topics
GET  /api/subjects/:id/materials                  POST /api/subjects/:id/materials   (multipart "file")

POST /api/rag/query                              { subjectId, question }

POST /api/quiz/generate                          { topicId, count }
POST /api/quiz/attempts                          { topicId, mode }
GET  /api/quiz/attempts/:id/next
POST /api/quiz/attempts/:id/answer               { questionId, selectedIndex, timeMs }
POST /api/quiz/attempts/:id/finish
GET  /api/quiz/attempts/:id/review               # only after finishing: answers + reasons

GET  /api/analytics/overview | /api/analytics/topics
GET  /api/recommendations                        POST /api/recommendations/regenerate
GET  /api/plan                                   POST /api/plan/regenerate
```

---

## Code style

Every module opens with a block comment explaining **why it exists and what it
must not do**. Every exported function has a JSDoc header. All non-obvious maths
(BKT, Elo, the priority formula), every magic constant, and every guardrail is
commented with its rationale rather than restating the code.
