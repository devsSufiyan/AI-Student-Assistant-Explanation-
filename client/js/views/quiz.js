/**
 * Practice Quiz — the adaptive tutoring pillar, end to end.
 *
 * THREE PHASES
 *   setup  -> choose topic, mode, generate/start
 *   quiz   -> the server serves the next question; the client grades via API
 *   review -> after finishing: every question, your answer, the correct answer,
 *             WHY (the source sentence), and the mastery change per question
 *
 * INTEGRITY
 *   The answer key never reaches the browser during the quiz: `/next` strips
 *   `correct_index`, and the review payload is only available after `/finish`.
 *   That is enforced server-side, not in this file.
 */

import { api } from '../api.js';
import {
  esc,
  pct,
  signedPct,
  pageHeader,
  cardShell,
  emptyState,
  progressBar,
  badge,
  icon,
  toast,
  alertBox,
  skeleton,
  difficultyTone,
} from '../ui.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TIMER_TICK_MS = 1000;

/** One instance of an attempt, kept out of the DOM so re-renders cannot lose it. */
const session = {
  phase: 'setup',
  attempt: null,
  current: null,
  feedback: null,
  review: null,
  questionCount: 0,
};

let timerHandle = null;
let startedAt = 0;

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

export function mount(root, ctx) {
  let destroyed = false;
  const subject = ctx.activeSubject;

  // Fresh session on every navigation into the view.
  Object.assign(session, {
    phase: 'setup',
    attempt: null,
    current: null,
    feedback: null,
    review: null,
    questionCount: 0,
  });
  stopTimer();

  let topics = [];
  let topicId = '';
  let mode = 'adaptive';

  (async () => {
    root.innerHTML = skeleton(240);
    try {
      const { topics: list } = await api(`/subjects/${subject.id}/topics`);
      if (destroyed || !root.isConnected) return;
      topics = list;
      // Prefer a topic that already has questions: landing on an empty topic
      // would show a disabled Start button and look broken on first visit.
      topicId = await firstTopicWithQuestions(list);
      await refreshCount();
      paintSetup();
    } catch (err) {
      if (!destroyed) root.innerHTML = alertBox(err.message);
    }
  })();

  /**
   * Pick the topic the student most likely wants to practise.
   * Counts are fetched in parallel; a failure for one topic is ignored so a
   * single bad id can never block the whole screen.
   */
  async function firstTopicWithQuestions(list) {
    if (list.length === 0) return '';
    const counts = await Promise.all(
      list.map((t) =>
        api(`/quiz/topics/${t.id}/questions/count`)
          .then((r) => r.count)
          .catch(() => 0),
      ),
    );
    const index = counts.findIndex((c) => c > 0);
    return list[index === -1 ? 0 : index].id;
  }

  async function refreshCount() {
    if (!topicId) {
      session.questionCount = 0;
      return;
    }
    try {
      const { count } = await api(`/quiz/topics/${topicId}/questions/count`);
      session.questionCount = count;
    } catch {
      session.questionCount = 0;
    }
  }

  /* ------------------------------------------------------------- setup --- */

  function paintSetup() {
    if (destroyed || !root.isConnected) return;
    session.phase = 'setup';
    const activeTopic = topics.find((t) => t.id === topicId);

    root.innerHTML = `
      ${pageHeader('Practice Quiz', 'Adaptive questions generated from your own material',
        `<button class="btn btn-label-primary" id="gen-questions">${icon('bxs-magic-wand', 'me-1')} Generate questions</button>`)}

      ${topics.length === 0
        ? `<div class="card"><div class="card-body">${emptyState(
            'No topics yet',
            'Add topics under Materials, then upload notes so questions can be generated.',
            'list-check',
            `<a href="#/materials" class="btn btn-primary btn-sm">Go to Materials</a>`,
          )}</div></div>`
        : `<div class="row g-4">
            <div class="col-xl-8">
              <div class="card">
                <div class="card-body">
                  <div class="row g-4">
                    <div class="col-md-5">
                      <label class="form-label" for="quiz-topic">Topic</label>
                      <select class="form-select" id="quiz-topic">
                        ${topics
                          .map(
                            (t) => `<option value="${esc(t.id)}" ${t.id === topicId ? 'selected' : ''}>
                              ${esc(t.name)} — ${pct(t.mastery)}
                            </option>`,
                          )
                          .join('')}
                      </select>
                      <div class="form-text">
                        ${activeTopic ? `Current mastery ${pct(activeTopic.mastery)} · ${activeTopic.attempts} answer(s) recorded` : ''}
                      </div>
                    </div>
                    <div class="col-md-4">
                      <label class="form-label" for="quiz-mode">Question mode</label>
                      <select class="form-select" id="quiz-mode">
                        <option value="adaptive" ${mode === 'adaptive' ? 'selected' : ''}>Adaptive — targets your level</option>
                        <option value="fixed" ${mode === 'fixed' ? 'selected' : ''}>Fixed order — control mode</option>
                      </select>
                      <div class="form-text">Adaptive aims for ~60% predicted success.</div>
                    </div>
                    <div class="col-md-3">
                      <label class="form-label">Available</label>
                      <div class="d-flex align-items-center gap-2" style="height:38px">
                        <span class="badge bg-label-${session.questionCount > 0 ? 'success' : 'warning'}">
                          ${session.questionCount} ready
                        </span>
                      </div>
                      <div class="form-text">Questions stored for this topic.</div>
                    </div>
                  </div>

                  <hr class="my-4" />

                  <div class="d-flex flex-wrap align-items-center gap-2">
                    <button class="btn btn-primary" id="start-quiz" ${session.questionCount === 0 ? 'disabled' : ''}>
                      ${icon('list-check', 'me-1')} Start quiz
                    </button>
                    <button class="btn btn-label-primary" id="gen-inline">${icon('bxs-magic-wand', 'me-1')} Generate more</button>
                    ${session.questionCount === 0
                      ? `<span class="text-body-secondary small">Generate questions first — they are created from your uploaded material.</span>`
                      : `<span class="text-body-secondary small">The server picks each next question; the answer key never reaches the browser.</span>`}
                  </div>
                </div>
              </div>

              <div class="card mt-4">
                <div class="card-header"><h5 class="card-title mb-0">How adaptive mode works</h5></div>
                <div class="card-body text-body-secondary">
                  <p class="mb-2">
                    Each question is chosen so your predicted chance of answering it correctly is close to
                    <strong class="text-heading">60%</strong> — hard enough to teach you something, easy enough to stay motivating.
                  </p>
                  <p class="mb-0">
                    Answer correctly and the next items get harder; miss one and they ease off. Your mastery of the
                    topic updates after every single answer using Bayesian Knowledge Tracing and Elo.
                  </p>
                </div>
              </div>
            </div>

            <div class="col-xl-4">
              ${cardShell({
                title: 'Topic readiness',
                subtitle: 'Mastery per topic in this subject',
                body:
                  topics.length === 0
                    ? `<p class="text-body-secondary mb-0">No topics yet.</p>`
                    : `<div class="d-flex flex-column gap-3">
                        ${topics
                          .map(
                            (t) => `<div>
                              <div class="d-flex justify-content-between align-items-center mb-1">
                                <span class="small ${t.id === topicId ? 'fw-medium' : 'text-body-secondary'}">${esc(t.name)}</span>
                                ${badge(pct(t.mastery), t.mastery >= 0.85 ? 'success' : t.mastery >= 0.5 ? 'warning' : 'danger')}
                              </div>
                              ${progressBar(t.mastery, { tone: t.mastery >= 0.85 ? 'success' : t.mastery >= 0.5 ? 'warning' : 'danger', height: 6 })}
                            </div>`,
                          )
                          .join('')}
                      </div>`,
              })}
            </div>
          </div>`}`;

    const topicSelect = root.querySelector('#quiz-topic');
    topicSelect?.addEventListener('change', async (e) => {
      topicId = e.target.value;
      await refreshCount();
      paintSetup();
    });

    root.querySelector('#quiz-mode')?.addEventListener('change', (e) => {
      mode = e.target.value;
    });

    root.querySelector('#start-quiz')?.addEventListener('click', (e) => start(e.currentTarget));
    root.querySelector('#gen-questions')?.addEventListener('click', (e) => generate(e.currentTarget));
    root.querySelector('#gen-inline')?.addEventListener('click', (e) => generate(e.currentTarget));
  }

  async function generate(button) {
    if (!topicId) return;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Generating…';
    try {
      const res = await api('/quiz/generate', { method: 'POST', body: { topicId, count: 6 } });
      if (res.created > 0) {
        toast(`Generated ${res.created} new question${res.created === 1 ? '' : 's'}.`, 'success');
      } else {
        toast(res.reason ?? 'No new questions could be generated from this material.', 'warning');
      }
      // Refresh both the count and the per-topic mastery column.
      const [{ topics: list }] = await Promise.all([
        api(`/subjects/${subject.id}/topics`),
        refreshCount(),
      ]);
      topics = list;
      if (!destroyed && root.isConnected) paintSetup();
    } catch (err) {
      toast(err.message, 'danger');
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  /* -------------------------------------------------------------- quiz --- */

  async function start(button) {
    const original = button?.innerHTML;
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Starting…';
    }
    try {
      const { attempt } = await api('/quiz/attempts', { method: 'POST', body: { topicId, mode } });
      session.attempt = attempt;
      session.phase = 'quiz';
      await loadNext();
    } catch (err) {
      toast(err.message, 'danger');
      if (button) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  }

  async function loadNext() {
    session.feedback = null;
    const res = await api(`/quiz/attempts/${session.attempt.id}/next`);
    if (res.done) {
      await finish();
      return;
    }
    session.current = res;
    startedAt = Date.now();
    paintQuestion();
  }

  function paintQuestion() {
    if (destroyed || !root.isConnected) return;
    const { question, meta, progress } = session.current;
    const done = progress.total > 0 ? progress.answered / progress.total : 0;

    root.innerHTML = `
      ${pageHeader('Practice Quiz', `${esc(session.attempt.mode)} mode · topic mastery updates after each answer`,
        `<button class="btn btn-label-secondary" id="finish-early">Finish & see results</button>`)}

      <div class="row g-4">
        <div class="col-xl-8">
          <div class="card">
            <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div>
                <h5 class="card-title mb-0">Question ${progress.answered + 1} of ${progress.total}</h5>
                <small class="text-body-secondary">Answered ${progress.answered} · correct key hidden until you answer</small>
              </div>
              <div class="d-flex align-items-center gap-2">
                ${meta ? `<span class="badge bg-label-${meta.predictedSuccess >= 0.6 ? 'success' : 'warning'}">
                  predicted success ${pct(meta.predictedSuccess, 0)}
                </span>` : ''}
                <span class="badge bg-label-secondary" id="quiz-timer">0:00</span>
              </div>
            </div>
            <div class="card-body">
              <div class="mb-4">${progressBar(done, { tone: 'primary', height: 8, showLabel: false })}</div>

              <p class="quiz-stem">${esc(question.stem)}</p>

              <div class="d-flex flex-column gap-2" id="quiz-options">
                ${question.options
                  .map(
                    (opt, i) => `<button type="button" class="quiz-option" data-index="${i}">
                      <span class="quiz-key">${esc(LETTERS[i] ?? i + 1)}</span>
                      <span class="flex-grow-1">${esc(opt)}</span>
                    </button>`,
                  )
                  .join('')}
              </div>

              <div id="quiz-feedback" class="mt-4"></div>
            </div>
          </div>
        </div>

        <div class="col-xl-4">
          ${cardShell({
            title: 'Adaptive selection',
            subtitle: 'Why this question was served',
            body: meta
              ? `<dl class="row mb-0 small">
                  <dt class="col-7 text-body-secondary fw-normal">Target success</dt><dd class="col-5 text-end mb-2">${pct(meta.target, 0)}</dd>
                  <dt class="col-7 text-body-secondary fw-normal">Predicted success</dt><dd class="col-5 text-end mb-2">${pct(meta.predictedSuccess, 0)}</dd>
                  <dt class="col-7 text-body-secondary fw-normal">Your ability (Elo)</dt><dd class="col-5 text-end mb-2">${Math.round(meta.ability)}</dd>
                  <dt class="col-7 text-body-secondary fw-normal">Item difficulty (Elo)</dt><dd class="col-5 text-end mb-0">${Math.round(meta.itemDifficulty)}</dd>
                </dl>`
              : `<p class="text-body-secondary mb-0">Fixed mode serves questions in insertion order (the control condition).</p>`,
          })}
          <div class="mt-4">
            ${cardShell({
              title: 'Study rules',
              body: `<ul class="ps-3 mb-0 small text-body-secondary d-flex flex-column gap-2">
                <li>Attempting a question twice is rejected — evidence must stay clean.</li>
                <li>Every answer stores mastery/ability <em>before</em> it, so scores are auditable.</li>
                <li>Recommendations already shown for this topic are marked consumed when you finish.</li>
              </ul>`,
            })}
          </div>
        </div>
      </div>`;

    // Live timer so the student can see time-on-task being recorded.
    const timerEl = root.querySelector('#quiz-timer');
    stopTimer();
    timerHandle = setInterval(() => {
      if (!timerEl || !timerEl.isConnected) {
        stopTimer();
        return;
      }
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      timerEl.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }, TIMER_TICK_MS);

    root.querySelectorAll('[data-index]').forEach((btn) => {
      btn.addEventListener('click', () => answer(Number(btn.dataset.index)));
    });

    root.querySelector('#finish-early')?.addEventListener('click', () => finish());
  }

  async function answer(selectedIndex) {
    if (session.feedback) return;
    const timeMs = Date.now() - startedAt;

    const buttons = [...root.querySelectorAll('[data-index]')];
    buttons.forEach((b) => (b.disabled = true));

    try {
      const { feedback } = await api(`/quiz/attempts/${session.attempt.id}/answer`, {
        method: 'POST',
        body: { questionId: session.current.question.id, selectedIndex, timeMs },
      });
      if (destroyed || !root.isConnected) return;
      stopTimer();
      session.feedback = { ...feedback, selectedIndex };
      paintFeedback();
    } catch (err) {
      toast(err.message, 'danger');
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  function paintFeedback() {
    const feedback = session.feedback;
    const buttons = [...root.querySelectorAll('[data-index]')];

    buttons.forEach((btn) => {
      const index = Number(btn.dataset.index);
      btn.disabled = true;
      btn.classList.add('locked');
      if (index === feedback.correctIndex) btn.classList.add('is-correct');
      else if (index === feedback.selectedIndex) btn.classList.add('is-wrong');
    });

    const tone = feedback.isCorrect ? 'success' : 'danger';
    const slot = root.querySelector('#quiz-feedback');
    slot.innerHTML = `<div class="quiz-feedback ${tone}">
      <div class="d-flex align-items-start gap-3">
        <div class="avatar avatar-sm flex-shrink-0">
          <span class="avatar-initial rounded-circle bg-label-${tone}">
            ${icon(feedback.isCorrect ? 'check-circle' : 'x-circle')}
          </span>
        </div>
        <div class="flex-grow-1">
          <div class="fw-medium mb-1">
            ${feedback.isCorrect ? 'Correct' : `Not quite — the answer is ${esc(LETTERS[feedback.correctIndex] ?? feedback.correctIndex + 1)}`}
          </div>
          ${feedback.explanation ? `<p class="mb-2 small">${esc(feedback.explanation)}</p>` : ''}
          <div class="small text-body-secondary">
            Topic mastery ${pct(feedback.masteryBefore, 0)} → ${pct(feedback.masteryAfter, 0)}
            <span class="ms-1 badge bg-label-${feedback.masteryDelta >= 0 ? 'success' : 'danger'}">
              ${esc(signedPct(feedback.masteryDelta))}
            </span>
          </div>
        </div>
      </div>
      <div class="d-flex flex-wrap gap-2 mt-3">
        <button class="btn btn-primary btn-sm" id="next-question">Next question ${icon('chevron-right')}</button>
        <button class="btn btn-label-secondary btn-sm" id="finish-now">Finish & see results</button>
      </div>
    </div>`;

    root.querySelector('#next-question')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await loadNext();
      } catch (err) {
        toast(err.message, 'danger');
        e.currentTarget.disabled = false;
      }
    });
    root.querySelector('#finish-now')?.addEventListener('click', () => finish());
  }

  /* ------------------------------------------------------------ review --- */

  async function finish() {
    stopTimer();
    try {
      await api(`/quiz/attempts/${session.attempt.id}/finish`, { method: 'POST' });
      const review = await api(`/quiz/attempts/${session.attempt.id}/review`);
      if (destroyed || !root.isConnected) return;
      session.review = review;
      session.phase = 'review';
      paintReview();
      toast(`Quiz complete — ${review.summary.correct}/${review.summary.total} correct.`, 'success');
      // Mastery changed, so the sidebar subject data and dashboard are stale.
      ctx.refreshSubjects?.().catch(() => {});
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  function paintReview() {
    const { summary, questions, attempt } = session.review;
    const score = Math.round(summary.accuracy * 100);
    const tone = score >= 80 ? 'success' : score >= 50 ? 'warning' : 'danger';

    root.innerHTML = `
      ${pageHeader('Quiz Results', `Attempt ${String(attempt.id).slice(0, 8)} · ${attempt.mode} mode`,
        `<button class="btn btn-primary" id="retake">${icon('refresh', 'me-1')} Retake</button>
         <button class="btn btn-label-secondary" id="back-setup">Choose another topic</button>`)}

      <div class="row g-4 mb-4">
        <div class="col-md-4">
          <div class="card h-100">
            <div class="card-body text-center">
              <div class="quiz-score-ring bg-label-${tone}" style="--score:${score}%">
                <div>
                  <span class="quiz-score-value">${score}%</span>
                  <small class="d-block text-body-secondary">score</small>
                </div>
              </div>
              <h5 class="mt-3 mb-1">${esc(summary.correct)} of ${esc(summary.total)} correct</h5>
              <p class="text-body-secondary small mb-0">
                ${score >= 80 ? 'Excellent work — keep the streak going.' : score >= 50
                  ? 'Good effort — review the misses below.'
                  : 'Keep going — the explanations below will help.'}
              </p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card h-100">
            <div class="card-body">
              <h5 class="card-title mb-3">Mastery journey</h5>
              ${
                summary.masteryStart === null
                  ? `<p class="text-body-secondary small mb-0">No mastery data recorded.</p>`
                  : `<div class="d-flex align-items-center gap-2 mb-3">
                      <span class="badge bg-label-secondary">${pct(summary.masteryStart, 0)}</span>
                      ${icon('chevron-right', 'text-body-secondary')}
                      <span class="badge bg-label-${summary.masteryGain >= 0 ? 'success' : 'danger'}">${pct(summary.masteryEnd, 0)}</span>
                      <span class="ms-auto small text-body-secondary">${esc(signedPct(summary.masteryGain))}</span>
                    </div>`
              }
              <div class="d-flex flex-wrap gap-2">
                ${Object.entries(summary.byDifficulty ?? {})
                  .map(
                    ([level, s]) => `<span class="badge bg-label-${difficultyTone(level)}">
                      ${esc(level)} ${esc(s.correct)}/${esc(s.total)}
                    </span>`,
                  )
                  .join('')}
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card h-100">
            <div class="card-body">
              <h5 class="card-title mb-3">Next step</h5>
              <p class="text-body-secondary small">
                Recommendations for this topic were marked as acted on. Regenerate your plan to see what to study next.
              </p>
              <a href="#/plan" class="btn btn-sm btn-label-primary">${icon('calendar-check', 'me-1')} Open today's plan</a>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h5 class="card-title mb-0">Answer review</h5>
          <small class="text-body-secondary">Every question, with the correct answer, the reason, and the source</small>
        </div>
        <div class="card-body d-flex flex-column gap-4">
          ${questions
            .map((q, i) => {
              const answers = q.options
                .map((opt, oi) => {
                  const isCorrect = oi === q.correctIndex;
                  const isChosen = oi === q.selectedIndex;
                  if (!isCorrect && !isChosen) return '';
                  return `<div class="review-answer ${isCorrect ? 'correct' : 'wrong'}">
                    <span class="review-mark">${isCorrect ? '✓' : '✗'}</span>
                    <span class="flex-grow-1">${esc(opt)}</span>
                    <span class="small text-body-secondary">${isCorrect ? 'Correct answer' : 'Your answer'}</span>
                  </div>`;
                })
                .join('');

              return `<div class="review-item ${q.isCorrect ? '' : 'missed'}">
                <div class="d-flex align-items-start gap-3 mb-3">
                  <span class="review-number">${i + 1}</span>
                  <div class="flex-grow-1">
                    <div class="fw-medium">${esc(q.stem)}</div>
                  </div>
                  <span class="badge bg-label-${difficultyTone(q.difficulty)}">${esc(q.difficulty)}</span>
                </div>
                <div class="d-flex flex-column gap-2 ms-0 ms-sm-5">${answers}</div>
                <div class="review-reason">
                  <div class="review-reason-label">${q.isCorrect ? 'Why this is right' : 'Why the answer is different'}</div>
                  <div>${esc(q.explanation || q.sourceText || 'No explanation was stored for this question.')}</div>
                </div>
              </div>`;
            })
            .join('')}
        </div>
      </div>`;

    root.querySelector('#retake')?.addEventListener('click', async (e) => start(e.currentTarget));
    root.querySelector('#back-setup')?.addEventListener('click', async () => {
      await refreshCount();
      paintSetup();
    });
  }

  return {
    unmount() {
      destroyed = true;
      stopTimer();
    },
  };
}
