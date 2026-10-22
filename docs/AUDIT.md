# Project Audit — AI-Based Student Study Assistant

Date: 2026-06-XX
Scope: full repository (server + client + tests + docs)

---

## 1. Executive summary

The project is a working full-stack study assistant with a well-designed,
test-covered backend. The backend is already **pure JavaScript** (Node 22 + ESM,
Express, `node:sqlite`) and passes **99/99 tests**.

The main gap is the **frontend**: it is a React + Vite SPA with a bespoke visual
design. The requirement is to use the **Sneat Bootstrap 5 admin template** and to
keep all application logic and the backend in **pure JavaScript**. The frontend
therefore needs to be rebuilt as a framework-free, static HTML/CSS/JS SPA that
consumes the existing REST API.

**Verdict: the backend is kept and extended slightly; the client is replaced.**

---

## 2. Current stack

| Layer | Technology | Assessment |
|---|---|---|
| Runtime | Node 22.23.3 | Good — required by `node:sqlite` |
| Backend | Express 4, ESM, `node:sqlite`, Zod, JWT, bcrypt | Good, pure JS |
| Database | SQLite (built-in, file `server/data/study.db`) | Good for a mini project |
| AI | Offline `hashing` embeddings + `extractive` LLM by default; optional OpenAI-compatible provider | Good — zero-key demo |
| Frontend | React 18 + Vite 5 + hand-written CSS | **To be replaced** |
| Tests | Vitest + Supertest, 9 files / 99 tests | Good |
| CI | GitHub Actions | Present |

---

## 3. What works

- **Auth**: register, login, JWT, bcrypt, ownership checks on every resource.
- **Subjects / topics**: prerequisite tree, syllabus weights, difficulty.
- **Materials**: upload, format detection (PDF/DOCX/PPTX/XLSX/ODT/RTF/HTML/CSV/…),
  text extraction, chunking, indexing.
- **RAG**: chunk → embed → cosine top-k → MMR → grounded answer with citations
  and a refusal path when retrieval is weak.
- **Quiz**: question generation, adaptive selection at ~0.6 target success
  (Elo), fixed control mode, live feedback, post-quiz review with reasons.
- **Mastery**: BKT posterior + Elo updates, snapshots stored per answer.
- **Recommendations**: transparent weighted score, stored breakdown, template
  reasons.
- **Planner**: greedy minute-budget schedule from recommendations + due reviews.
- **Analytics**: readiness, accuracy trend, mastery heatmap, forgetting risk,
  recommendation follow-through.
- **Evaluation harness** (`npm run eval`) and model card.

---

## 4. Findings and risks

### Critical / high

1. **Frontend does not use the requested template.** React SPA with custom CSS.
   → Rebuild as static Sneat-based SPA in pure JS.
2. **No client-side XSS discipline.** React escaped by default; a vanilla-JS
   rewrite must explicitly escape every server/user string before `innerHTML`.
   → Central `escapeHtml()` helper and no raw interpolation of API data.
3. **Default JWT secret** (`dev-only-insecure-secret-change-me`) is used when
   `JWT_SECRET` is unset. A warning exists but it is still a production risk.
   → Keep warning, document prominently, recommend changing it.
4. **CORS is fully open** (`cors()`), acceptable for local dev but unsafe if the
   API is public. → Restrict via env in production (documented).

### Medium

5. **No client build after the rewrite** — this is a benefit: one process serves
   both API and UI. Need to ensure static serving + SPA fallback is correct.
6. **No profile-editing endpoint**, so the UI cannot let the student change their
   goal, exam date, or daily minutes (all of which feed recommendations and the
   planner). → Add `PATCH /api/auth/me`.
7. **No analytics view** in the old client (dashboard mixed metrics). → Add a
   dedicated Analytics page using the existing endpoints.
8. **No subject management UI beyond create** (rename/delete absent). → Out of
   scope for this iteration; note as future work.
9. **No rate limiting** on auth or RAG endpoints. → Note as future work / demo
   limitation.
10. **Material upload is synchronous**; indexing large files blocks the request.
    → Already documented in code; acceptable for MVP.
11. **Uploads accept any file type by design**; parser rejects binary/no-text
    files with a clear 422. Good.

### Low

12. `server/data/` and `server/server.log` are tracked artefacts. → Keep DB for
    demo convenience but consider ignoring `server.log` (already in `.gitignore`?
    verify).
13. `.env.example` is good, but README still describes the React/Vite workflow.
    → Update.
14. Old `client/dist` build artefacts are stale. → Remove.

---

## 5. API surface (verified)

All non-auth routes require `Authorization: Bearer <token>`.

```
POST /api/auth/register | /api/auth/login
GET  /api/auth/me
GET  /api/subjects                     POST /api/subjects
GET  /api/subjects/:id/topics          POST /api/subjects/:id/topics
GET  /api/subjects/:id/materials       POST /api/subjects/:id/materials (multipart)
POST /api/rag/query
POST /api/quiz/generate
GET  /api/quiz/topics/:topicId/questions/count
POST /api/quiz/attempts
GET  /api/quiz/attempts/:id/next
POST /api/quiz/attempts/:id/answer
POST /api/quiz/attempts/:id/finish
GET  /api/quiz/attempts/:id
GET  /api/quiz/attempts/:id/review
GET  /api/analytics/overview | /api/analytics/topics
GET  /api/recommendations              POST /api/recommendations/regenerate
GET  /api/plan                         POST /api/plan/regenerate
GET  /api/health
```

---

## 6. Test baseline

```
Test Files  9 passed (9)
Tests       99 passed (99)
Duration    ~7.5s
```

Run before and after the UI work to confirm the backend was not regressed.

---

## 7. Rebuild plan

1. Vendor the **Sneat free Bootstrap 5 template** (MIT) into `client/`.
2. Replace React with a **hash-routed, vanilla-JS SPA**:
   - `client/js/api.js` — fetch client, token, uploads.
   - `client/js/ui.js` — escaping, toasts, cards, badges, helpers.
   - `client/js/app.js` — auth shell, layout, routing, subject selection.
   - `client/js/views/*.js` — auth, dashboard, plan, chat, quiz, materials,
     analytics, settings.
3. Keep the visual language of Sneat: fixed vertical menu, detached navbar,
   cards, Bootstrap components, ApexCharts, Boxicons.
4. Add `PATCH /api/auth/me` for profile settings.
5. Serve the static client directly from Express (no build step).
6. Update README/docs and remove Vite/React files and stale `dist`.
7. Re-run tests + smoke-test every endpoint and page.

---

## 8. Definition of done

- [x] No React, Vite, JSX, npm build step in `client/`.
- [x] UI matches Sneat layout/components.
- [x] Login/register, dashboard, plan, chat, quiz, materials, analytics,
      settings all work against the real API.
- [x] All server tests still pass (103, up from 99 — 4 new profile-route
      tests); new profile route tested.
- [x] XSS-safe rendering (all interpolated data escaped).
- [x] README updated to the single-process workflow.

### 8.1 Follow-up gaps left open (deliberate)

These were identified during the rebuild and are **not** fixed here. They are
scoped as future work rather than silently dropped:

| # | Gap | Why it was left |
|---|---|---|
| 1 | Subject rename / delete UI | The API only exposes create + list. Adding delete means deciding what happens to the chunks, mastery rows and recommendations that point at a subject — a data-lifecycle decision, not a UI one. |
| 2 | Rate limiting on `/api/auth/*` and `/api/rag/query` | Needs a store (in-memory is not enough for more than one process). Deliberately out of scope for a single-process demo. |
| 3 | Open CORS in production | `cors()` is open by default. Should be restricted by env var when `NODE_ENV=production`. The server already warns about this at boot. |
| 4 | Default `JWT_SECRET` fallback | Still falls back to a development secret when `JWT_SECRET` is unset, but now logs a loud warning. Must be set in any real deployment. |
| 5 | Synchronous material indexing | Uploading a large file blocks the request thread. Acceptable for an MVP with small notes files. |
| 6 | Email / password change | `PATCH /api/auth/me` deliberately rejects both. Changing an email needs a verification flow; changing a password needs the current one. |
