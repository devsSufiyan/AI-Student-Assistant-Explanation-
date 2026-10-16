-- ===========================================================================
-- Schema for the AI Study Assistant.
--
-- DESIGN PRINCIPLE (see PLAN.md section 5):
--   raw events  ->  derived attempt metrics  ->  aggregated mastery
--
--   * answers / learning_events are APPEND-ONLY. We never UPDATE them. Every
--     row stores the model state *before* the answer, so any score can be
--     audited or recomputed later.
--   * topic_mastery / recommendations are DERIVED caches. They can be rebuilt
--     from the raw tables if the algorithm changes.
--
-- Raw SQL (not an ORM) because node:sqlite is built into Node and needs no
-- codegen or native build. Queries live in the module that owns the table.
--
-- NOTE: node:sqlite has no BOOLEAN type. Booleans are stored as INTEGER 0/1.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Identity + learning goal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  goal          TEXT,                    -- free-text learning goal, feeds recommendations
  exam_date     TEXT,                    -- ISO date; drives goalAlignment urgency
  daily_minutes INTEGER DEFAULT 45,      -- how much time the student has per day
  created_at    TEXT NOT NULL
);

-- A subject is a study area ("Databases"), owned by one user.
CREATE TABLE IF NOT EXISTS subjects (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subjects_user ON subjects(user_id);

-- Topics form a prerequisite TREE via parent_topic_id. The tree is what lets us
-- compute prerequisiteGap in recommendations (weakness in a foundation blocks
-- progress on children).
CREATE TABLE IF NOT EXISTS topics (
  id              TEXT PRIMARY KEY,
  subject_id      TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  parent_topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  weight          REAL DEFAULT 1.0,      -- syllabus importance, used by goalAlignment
  difficulty      TEXT DEFAULT 'medium', -- 'easy' | 'medium' | 'hard' (seeds item Elo)
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject_id);

-- An uploaded file (notes / slides / PDF).
CREATE TABLE IF NOT EXISTS materials (
  id           TEXT PRIMARY KEY,
  subject_id   TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime_type    TEXT,
  status       TEXT NOT NULL DEFAULT 'uploaded', -- uploaded|indexed|failed
  error        TEXT,
  uploaded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_materials_subject ON materials(subject_id);

-- The unit of retrieval. embedding is stored as a JSON array of numbers.
-- Keeping it as TEXT keeps the schema portable and human-inspectable.
CREATE TABLE IF NOT EXISTS chunks (
  id          TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  subject_id  TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id    TEXT REFERENCES topics(id) ON DELETE SET NULL,
  ord         INTEGER NOT NULL,          -- position within the material
  text        TEXT NOT NULL,
  embedding   TEXT NOT NULL,             -- JSON number[]
  page        INTEGER,
  word_count  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_subject ON chunks(subject_id);

-- A quiz question. difficulty_rating is the LIVE Elo rating (seeded from the
-- author label) and is updated as students answer - so items self-calibrate.
CREATE TABLE IF NOT EXISTS questions (
  id                TEXT PRIMARY KEY,
  subject_id        TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id          TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  stem              TEXT NOT NULL,
  options           TEXT NOT NULL,       -- JSON string[]
  correct_index     INTEGER NOT NULL,
  difficulty        TEXT NOT NULL,       -- easy|medium|hard
  difficulty_rating REAL NOT NULL,
  source            TEXT NOT NULL,       -- 'generated' | 'manual'
  source_chunk_id   TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  explanation       TEXT,                -- shown as feedback after answering
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic_id);

-- One sitting of the quiz. mode distinguishes the experiment condition:
-- 'adaptive' picks the next question at the ZPD; 'fixed' is the control.
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id    TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'adaptive',
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  correct     INTEGER DEFAULT 0,
  total       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_topic ON quiz_attempts(user_id, topic_id);

-- THE most important table for analytics: append-only answer evidence.
-- *_before columns snapshot the model state at answer time so scoring is auditable.
CREATE TABLE IF NOT EXISTS answers (
  id                TEXT PRIMARY KEY,
  attempt_id        TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id          TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  question_id       TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_index    INTEGER NOT NULL,
  is_correct        INTEGER NOT NULL,
  time_ms           INTEGER DEFAULT 0,
  ability_before    REAL NOT NULL,
  difficulty_before REAL NOT NULL,
  mastery_before    REAL NOT NULL,
  mastery_after     REAL NOT NULL,
  expected_before   REAL NOT NULL,       -- Elo expectation, for debugging adaptivity
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_answers_user_topic ON answers(user_id, topic_id);

-- Append-only log of everything the student does. Powers time-on-task and the
-- "did they follow recommendations?" evaluation.
CREATE TABLE IF NOT EXISTS learning_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- asked_question|quiz_started|answered|plan_viewed|...
  subject_id TEXT,
  topic_id   TEXT,
  payload    TEXT,            -- JSON blob, shape depends on type
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user ON learning_events(user_id, created_at);

-- Derived cache: ONE row per (user, topic). mastery = P(knows topic) from BKT.
-- ability = Elo rating. Rebuildable from `answers`.
CREATE TABLE IF NOT EXISTS topic_mastery (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id          TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  mastery           REAL NOT NULL,
  ability           REAL NOT NULL,
  attempts          INTEGER DEFAULT 0,
  correct           INTEGER DEFAULT 0,
  last_practiced_at TEXT,
  stability_days    REAL DEFAULT 1,
  updated_at        TEXT NOT NULL,
  UNIQUE (user_id, topic_id)
);

-- A generated recommendation WITH its score breakdown. Storing the breakdown is
-- what makes recommendations explainable and lets us run weight ablations offline.
CREATE TABLE IF NOT EXISTS recommendations (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id     TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  score        REAL NOT NULL,
  reason       TEXT NOT NULL,
  breakdown    TEXT NOT NULL,   -- JSON of each weighted term
  generated_at TEXT NOT NULL,
  consumed_at  TEXT             -- set when the student actually starts that topic
);

-- The day's schedule, produced by the planner from recommendations + due reviews.
CREATE TABLE IF NOT EXISTS study_plans (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date    TEXT NOT NULL,   -- ISO date (YYYY-MM-DD)
  items        TEXT NOT NULL,   -- JSON [{topicId, minutes, activity, reason}]
  total_minutes INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, plan_date)
);
