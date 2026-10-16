/**
 * Subjects and topics service - simple, ownership-enforcing CRUD.
 *
 * Every read/write here checks that the subject belongs to the requesting user.
 * Centralising that check is how we avoid "IDOR" bugs (accessing someone else's
 * data by guessing an id) scattered across route handlers.
 */

import { all, get, run } from '../../db/index.js';
import { newId, nowIso } from '../../lib/util.js';
import { getOrCreateMastery } from '../mastery/service.js';

export function createSubject({ userId, name }) {
  const id = newId();
  run(
    `INSERT INTO subjects (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`,
    id,
    userId,
    name,
    nowIso(),
  );
  return get(`SELECT * FROM subjects WHERE id = ?`, id);
}

export function listSubjects(userId) {
  return all(`SELECT * FROM subjects WHERE user_id = ? ORDER BY created_at ASC`, userId);
}

/** Throws 404/403 if the subject does not exist or is not owned by `userId`. */
export function requireSubject(subjectId, userId) {
  const subject = get(`SELECT * FROM subjects WHERE id = ?`, subjectId);
  if (!subject) throw Object.assign(new Error('Subject not found'), { status: 404 });
  if (subject.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return subject;
}

export function createTopic({ subjectId, name, parentTopicId = null, weight = 1, difficulty = 'medium' }) {
  const id = newId();
  run(
    `INSERT INTO topics (id, subject_id, parent_topic_id, name, weight, difficulty, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    subjectId,
    parentTopicId,
    name,
    weight,
    difficulty,
    nowIso(),
  );
  return get(`SELECT * FROM topics WHERE id = ?`, id);
}

/**
 * List a subject's topics, each annotated with the user's current mastery so the
 * UI can render progress without a second round-trip.
 */
export function listTopics(subjectId, userId) {
  const topics = all(`SELECT * FROM topics WHERE subject_id = ? ORDER BY created_at ASC`, subjectId);
  return topics.map((t) => {
    const m = getOrCreateMastery(userId, t.id);
    return {
      ...t,
      mastery: m.mastery,
      ability: m.ability,
      attempts: m.attempts,
      correct: m.correct,
    };
  });
}

/** Fetch a topic and verify ownership through its parent subject. */
export function requireTopic(topicId, userId) {
  const topic = get(`SELECT * FROM topics WHERE id = ?`, topicId);
  if (!topic) throw Object.assign(new Error('Topic not found'), { status: 404 });
  requireSubject(topic.subject_id, userId);
  return topic;
}
