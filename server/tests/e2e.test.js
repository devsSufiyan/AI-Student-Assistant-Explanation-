/**
 * End-to-end integration test: the full product loop over HTTP.
 *
 * This is the test that proves the pieces actually compose:
 *   upload material -> it gets chunked & embedded
 *     -> RAG answers a question WITH citations
 *     -> quiz questions are generated from that material
 *     -> an attempt is played and graded
 *     -> mastery changes and analytics reflect the new evidence
 *
 * It runs against a throwaway database (see the env setup below) so it never
 * touches real data. Correct answers are read from the database directly,
 * because the API intentionally never exposes them before grading.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

// Point at a unique temp DB BEFORE importing anything that opens it. Static ESM
// imports are hoisted, so the database-bearing modules are imported dynamically.
const tmpDb = path.join(os.tmpdir(), `study-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_FILE = tmpDb;
process.env.JWT_SECRET = 'e2e-test-secret';
process.env.LLM_PROVIDER = 'extractive';
process.env.EMBEDDING_PROVIDER = 'hashing';

const { migrate, all } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

const app = createApp();

// Enough definition-rich text that the offline generator has distractor
// vocabulary and can reliably produce questions.
const NOTES = `An index is a data structure that speeds up the retrieval of rows from a table at the cost of additional storage and slower writes. A clustered index determines the physical order of the rows in a table, while a non-clustered index stores a separate structure with pointers back to the data. Database administrators create indexes on columns that appear frequently in WHERE clauses and join conditions.
A B-tree is a self-balancing search tree that keeps data sorted and allows searches, insertions, and deletions in logarithmic time. Every node stores multiple keys and has many children, which keeps the tree shallow and reduces disk input and output.
A transaction is a sequence of operations performed as a single logical unit of work. The ACID properties are atomicity, consistency, isolation, and durability. Atomicity guarantees that a transaction either completes entirely or not at all.
Normalization is the process of organizing data to reduce redundancy and improve data integrity. The third normal form removes transitive dependencies so that non-key attributes do not depend on other non-key attributes.`;

const email = `e2e${Date.now()}@example.com`;
const password = 'password123';

let token = '';
let subjectId = '';
let topicId = '';

const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(() => {
  migrate();
});

describe('end-to-end study loop', () => {
  it('registers a student', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'E2E Student', email, password, dailyMinutes: 40 });
    expect(res.status).toBe(201);
    token = res.body.token;
  });

  it('creates a subject and a topic', async () => {
    const s = await request(app).post('/api/subjects').set(auth()).send({ name: 'Databases' });
    subjectId = s.body.subject.id;

    const t = await request(app)
      .post(`/api/subjects/${subjectId}/topics`)
      .set(auth())
      .send({ name: 'Indexing', weight: 2, difficulty: 'medium' });
    topicId = t.body.topic.id;
    expect(topicId).toBeTruthy();
  });

  it('uploads and indexes material into searchable chunks', async () => {
    const res = await request(app)
      .post(`/api/subjects/${subjectId}/materials`)
      .set(auth())
      .field('topicId', topicId)
      .attach('file', Buffer.from(NOTES), 'notes.txt');

    expect(res.status).toBe(201);
    expect(res.body.material.status).toBe('indexed');
    expect(res.body.chunkCount).toBeGreaterThan(0);
  });

  it('answers a question with citations from the uploaded material', async () => {
    const res = await request(app)
      .post('/api/rag/query')
      .set(auth())
      .send({ subjectId, question: 'What is a B-tree used for?' });

    expect(res.status).toBe(200);
    expect(res.body.refused).toBe(false);
    expect(res.body.citations.length).toBeGreaterThan(0);
    // The answer must be grounded: it comes from the notes, not invented.
    expect(res.body.answer.toLowerCase()).toContain('tree');
  });

  it('still refuses a question the material does not cover', async () => {
    const res = await request(app)
      .post('/api/rag/query')
      .set(auth())
      .send({ subjectId, question: 'How do I bake sourdough bread?' });
    expect(res.body.refused).toBe(true);
    expect(res.body.citations).toEqual([]);
  });

  it('generates quiz questions from the material', async () => {
    const res = await request(app)
      .post('/api/quiz/generate')
      .set(auth())
      .send({ topicId, count: 6 });
    expect(res.status).toBe(201);
    expect(res.body.created).toBeGreaterThan(0);
    // The generate response must not leak the answer key.
    for (const q of res.body.questions) {
      expect(q.correctIndex).toBeUndefined();
      expect(q.options).toHaveLength(4);
    }
  });

  it('plays a full attempt and raises mastery', async () => {
    const started = await request(app)
      .post('/api/quiz/attempts')
      .set(auth())
      .send({ topicId, mode: 'adaptive' });
    const attemptId = started.body.attempt.id;

    // Look up the real answer key from the DB to answer everything correctly.
    // (The API deliberately never sends it.)
    const keys = new Map(
      all(`SELECT id, correct_index FROM questions WHERE topic_id = ?`, topicId).map((r) => [
        r.id,
        r.correct_index,
      ]),
    );

    let answered = 0;
    for (;;) {
      const next = await request(app).get(`/api/quiz/attempts/${attemptId}/next`).set(auth());
      if (next.body.done) break;
      const questionId = next.body.question.id;

      const grade = await request(app)
        .post(`/api/quiz/attempts/${attemptId}/answer`)
        .set(auth())
        .send({ questionId, selectedIndex: keys.get(questionId), timeMs: 8000 });

      expect(grade.status).toBe(200);
      expect(grade.body.feedback.isCorrect).toBe(true);
      answered += 1;
      if (answered > 30) throw new Error('quiz loop did not terminate');
    }

    expect(answered).toBeGreaterThan(0);

    const finished = await request(app).post(`/api/quiz/attempts/${attemptId}/finish`).set(auth());
    expect(finished.body.attempt.accuracy).toBe(1);
  });

  it('reflects the new evidence in topic mastery', async () => {
    const res = await request(app).get(`/api/subjects/${subjectId}/topics`).set(auth());
    const topic = res.body.topics.find((t) => t.id === topicId);
    // Started at the BKT prior of 0.1; all-correct answers must have raised it.
    expect(topic.mastery).toBeGreaterThan(0.1);
    expect(topic.attempts).toBeGreaterThan(0);
  });

  it('reflects the new evidence in analytics and produces a plan', async () => {
    const overview = await request(app).get('/api/analytics/overview').set(auth());
    expect(overview.body.overview.questionsAnswered).toBeGreaterThan(0);
    // We got everything right, so recorded accuracy is 100%.
    expect(overview.body.overview.accuracy).toBeCloseTo(1, 5);

    const plan = await request(app).get('/api/plan').set(auth());
    expect(plan.status).toBe(200);
    expect(Array.isArray(plan.body.plan.items)).toBe(true);
  });

  it('prevents answering the same question twice in one attempt', async () => {
    const started = await request(app)
      .post('/api/quiz/attempts')
      .set(auth())
      .send({ topicId, mode: 'fixed' });
    const attemptId = started.body.attempt.id;

    const next = await request(app).get(`/api/quiz/attempts/${attemptId}/next`).set(auth());
    const questionId = next.body.question.id;

    const first = await request(app)
      .post(`/api/quiz/attempts/${attemptId}/answer`)
      .set(auth())
      .send({ questionId, selectedIndex: 0 });
    expect(first.status).toBe(200);

    // Re-answering must be rejected, otherwise mastery evidence would be doubled.
    const second = await request(app)
      .post(`/api/quiz/attempts/${attemptId}/answer`)
      .set(auth())
      .send({ questionId, selectedIndex: 0 });
    expect(second.status).toBe(409);
  });
});
