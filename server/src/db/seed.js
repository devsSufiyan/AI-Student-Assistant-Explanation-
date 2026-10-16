/**
 * Demo seed script.
 *
 * Creates one ready-to-explore account with a subject, a prerequisite topic
 * tree, an indexed document, generated quiz questions, and a little answer
 * history so the analytics dashboard is not empty on first login.
 *
 * Run with:  npm run seed
 * Login with: demo@example.com / password123
 *
 * It is IDEMPOTENT: if the demo user already exists it exits without touching
 * anything, so it is safe to re-run.
 */

import { migrate, get, all, run } from './index.js';
import { registerUser } from '../modules/auth/service.js';
import { createSubject, createTopic } from '../modules/subjects/service.js';
import { ingestMaterial } from '../modules/rag/index.js';
import { generateQuestions } from '../modules/quiz/generate.js';
import { startAttempt, submitAnswer, finishAttempt } from '../modules/quiz/service.js';
import { generateRecommendations } from '../modules/recommend/service.js';
import { generateTodayPlan } from '../modules/planner/service.js';
import { newId, nowIso } from '../lib/util.js';

/**
 * The study material we ingest. Deliberately definition-rich so the offline
 * cloze-question generator produces sensible questions from it.
 */
const SAMPLE_NOTES = `
Database normalization is the process of organizing data to reduce redundancy and improve data integrity. The first normal form requires that every column holds atomic values and that each record is unique. The second normal form removes partial dependencies by ensuring that every non-key attribute depends on the whole primary key. The third normal form removes transitive dependencies so that non-key attributes do not depend on other non-key attributes.

A functional dependency describes a relationship where one attribute uniquely determines another attribute. Decomposition is the process of breaking a relation into smaller relations to eliminate redundancy. A candidate key is a minimal set of attributes that can uniquely identify a row. The primary key is the candidate key chosen by the designer to identify records.

An index is a data structure that speeds up the retrieval of rows from a table at the cost of additional storage and slower writes. A clustered index determines the physical order of the rows in a table, while a non-clustered index stores a separate structure with pointers back to the data. Database administrators create indexes on columns that appear frequently in WHERE clauses and join conditions.

A B-tree is a self-balancing search tree that keeps data sorted and allows searches, insertions, and deletions in logarithmic time. In a B-tree every node stores multiple keys and has many children, which keeps the tree shallow and reduces disk input and output. A B-plus tree stores all values in the leaf nodes and links the leaves together, which makes range queries efficient.

A database transaction is a sequence of operations performed as a single logical unit of work. The ACID properties are atomicity, consistency, isolation, and durability. Atomicity guarantees that a transaction either completes entirely or not at all. Isolation ensures that concurrent transactions do not interfere with each other and produce the same result as if they ran sequentially.

A deadlock occurs when two transactions each hold a lock that the other transaction needs. The database management system detects deadlocks and aborts one of the transactions to break the cycle. Locking is a concurrency control mechanism that prevents multiple transactions from modifying the same data simultaneously.

Query optimization is the process of choosing the most efficient execution plan for a query. The query planner estimates the cost of different plans using statistics about the data. A full table scan reads every row and is expensive on large tables, whereas an index scan reads only the matching rows. Selectivity is the fraction of rows that satisfy a predicate and it guides the planner toward the best plan.
`;

async function seed() {
  migrate();

  const existing = get(`SELECT id FROM users WHERE email = ?`, 'demo@example.com');
  if (existing) {
    console.log('[seed] Demo user already exists - nothing to do. Login: demo@example.com / password123');
    return;
  }

  // 1. User with a goal, an exam in ~3 weeks, and 60 minutes a day.
  const examDate = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
  const user = registerUser({
    name: 'Demo Student',
    email: 'demo@example.com',
    password: 'password123',
    goal: 'Pass the Database Systems final exam',
    examDate,
    dailyMinutes: 60,
  });
  console.log(`[seed] Created user ${user.email}`);

  // 2. Subject + a prerequisite tree. "Fundamentals" is the parent of both
  //    advanced topics, which exercises the prerequisiteGap recommendation term.
  const subject = createSubject({ userId: user.id, name: 'Database Systems' });
  const fundamentals = createTopic({
    subjectId: subject.id,
    name: 'Relational Fundamentals',
    weight: 2, // high syllabus weight -> lifts goalAlignment
    difficulty: 'easy',
  });
  const normalization = createTopic({
    subjectId: subject.id,
    name: 'Normalization',
    parentTopicId: fundamentals.id,
    weight: 1.5,
    difficulty: 'medium',
  });
  const indexing = createTopic({
    subjectId: subject.id,
    name: 'Indexing',
    parentTopicId: fundamentals.id,
    weight: 1.5,
    difficulty: 'hard',
  });
  console.log('[seed] Created 3 topics');

  // 3. Register and index the sample material against "Indexing".
  const materialId = newId();
  run(
    `INSERT INTO materials (id, subject_id, filename, mime_type, status, uploaded_at)
     VALUES (?, ?, ?, 'text/plain', 'uploaded', ?)`,
    materialId,
    subject.id,
    'database-notes.txt',
    nowIso(),
  );
  const chunkCount = await ingestMaterial({
    materialId,
    subjectId: subject.id,
    topicId: indexing.id,
    text: SAMPLE_NOTES,
  });
  console.log(`[seed] Indexed sample notes into ${chunkCount} chunks`);

  // 4. Generate questions for two topics from the indexed material.
  const indexingQuestions = await generateQuestions({
    subjectId: subject.id,
    topicId: indexing.id,
    count: 6,
  });
  const normalizationQuestions = await generateQuestions({
    subjectId: subject.id,
    topicId: normalization.id,
    count: 6,
  });
  console.log(
    `[seed] Generated ${indexingQuestions.created} indexing + ${normalizationQuestions.created} normalization questions`,
  );

  // 5. Simulate a student who is decent at indexing but shaky at normalization.
  //    This gives the dashboard, recommendations, and forgetting-risk chart
  //    realistic, non-uniform data to display.
  await simulateAttempt({
    userId: user.id,
    topicId: indexing.id,
    accuracy: 0.75,
  });
  await simulateAttempt({
    userId: user.id,
    topicId: normalization.id,
    accuracy: 0.35,
  });

  // 6. Precompute recommendations and today's plan so the UI is populated.
  generateRecommendations(user.id);
  generateTodayPlan(user.id, subject.id);

  console.log('\n[seed] Done. Login with demo@example.com / password123\n');
}

/**
 * Play a synthetic quiz attempt at a target accuracy.
 * Deterministic (no randomness) so seeded analytics are reproducible.
 */
async function simulateAttempt({ userId, topicId, accuracy }) {
  const questions = all(`SELECT id, correct_index FROM questions WHERE topic_id = ?`, topicId);
  if (questions.length === 0) return;

  const attempt = startAttempt({ userId, topicId, mode: 'adaptive' });
  const targetCorrect = Math.round(questions.length * accuracy);

  questions.forEach((q, i) => {
    const shouldBeCorrect = i < targetCorrect;
    // Choose the correct index, or the next index when we want a wrong answer.
    const selected = shouldBeCorrect ? q.correct_index : (q.correct_index + 1) % 4;
    try {
      submitAnswer({
        attemptId: attempt.id,
        userId,
        questionId: q.id,
        selectedIndex: selected,
        timeMs: 15_000 + i * 1000,
      });
    } catch {
      // Ignore duplicate-answer guards during simulation.
    }
  });

  finishAttempt({ attemptId: attempt.id, userId });
  console.log(`[seed] Simulated attempt on topic ${topicId} (~${Math.round(accuracy * 100)}% accuracy)`);
}

seed().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
