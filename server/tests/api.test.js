/**
 * HTTP integration test - exercises the Express layer end to end.
 *
 * Runs against a THROWAWAY database: we point DB_FILE at a temp file BEFORE
 * importing anything that opens the database, so the test never touches the
 * developer's real data. This is why the imports below are dynamic - ESM hoists
 * static imports, which would load the DB before we could set the env var.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

// Configure an isolated database and secret prior to any module import.
const tmpDb = path.join(os.tmpdir(), `study-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_FILE = tmpDb;
process.env.JWT_SECRET = 'integration-test-secret';

const { migrate } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

const app = createApp();

// Unique email per run so the test is repeatable against a fresh temp DB.
const email = `t${Date.now()}@example.com`;
const password = 'password123';
let token = '';
let subjectId = '';
let topicId = '';

beforeAll(() => {
  migrate();
});

describe('health', () => {
  it('responds ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('auth', () => {
  it('registers a user and returns a token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test Student', email, password, dailyMinutes: 30 });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.password_hash).toBeUndefined(); // never leak the hash
  });

  it('logs in with the same credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    token = res.body.token;
  });

  it('rejects a bad password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('blocks protected routes without a token', async () => {
    const res = await request(app).get('/api/subjects');
    expect(res.status).toBe(401);
  });
});

describe('subjects and topics', () => {
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('creates a subject', async () => {
    const res = await request(app).post('/api/subjects').set(auth()).send({ name: 'Databases' });
    expect(res.status).toBe(201);
    subjectId = res.body.subject.id;
  });

  it('creates a topic', async () => {
    const res = await request(app)
      .post(`/api/subjects/${subjectId}/topics`)
      .set(auth())
      .send({ name: 'Normalization', weight: 2, difficulty: 'medium' });
    expect(res.status).toBe(201);
    topicId = res.body.topic.id;
  });

  it('lists the topic with a default mastery of pL0', async () => {
    const res = await request(app).get(`/api/subjects/${subjectId}/topics`).set(auth());
    expect(res.status).toBe(200);
    const topic = res.body.topics.find((t) => t.id === topicId);
    expect(topic.mastery).toBeCloseTo(0.1, 5);
  });
});

describe('analytics and planning on an empty account', () => {
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('returns an overview without throwing', async () => {
    const res = await request(app).get('/api/analytics/overview').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.overview.topicsTotal).toBeGreaterThanOrEqual(1);
  });

  it('produces a plan object even with no attempt history', async () => {
    const res = await request(app).get('/api/plan').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.plan.items)).toBe(true);
  });
});

describe('rag query guardrail', () => {
  it('refuses to answer when a subject has no indexed material', async () => {
    const res = await request(app)
      .post('/api/rag/query')
      .set({ Authorization: `Bearer ${token}` })
      .send({ subjectId, question: 'What is normalization?' });
    expect(res.status).toBe(200);
    // No chunks -> must refuse rather than hallucinate.
    expect(res.body.refused).toBe(true);
    expect(res.body.citations).toEqual([]);
  });
});
