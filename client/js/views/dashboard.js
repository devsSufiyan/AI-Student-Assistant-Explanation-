/**
 * Dashboard — the learning-analytics overview.
 *
 * Reads three independent endpoints in parallel and renders:
 *   - headline metrics (readiness, accuracy, mastered topics, time on task)
 *   - the accuracy trend + exam-readiness gauge
 *   - per-topic mastery with forgetting risk
 *   - the current ranked recommendations with their human-readable reasons
 *
 * All API data is escaped before it touches `innerHTML`.
 */

import { api } from '../api.js';
import {
  esc,
  pct,
  num,
  formatDate,
  daysUntil,
  relativeDays,
  statCard,
  pageHeader,
  cardShell,
  emptyState,
  masteryTone,
  masteryBadge,
  masteryLabel,
  progressBar,
  badge,
  accuracyTrendChart,
  readinessChart,
  skeleton,
  alertBox,
  destroyCharts,
  icon,
} from '../ui.js';

export function mount(root, ctx) {
  let destroyed = false;

  (async () => {
    root.innerHTML = `<div class="row g-4">
      <div class="col-12">${skeleton(70)}</div>
      <div class="col-12"><div class="row g-4">
        ${[0, 1, 2, 3].map(() => `<div class="col-sm-6 col-xl-3">${skeleton(80)}</div>`).join('')}
      </div></div>
      <div class="col-12">${skeleton(240)}</div>
    </div>`;

    const subject = ctx.activeSubject;
    const q = subject ? `?subjectId=${encodeURIComponent(subject.id)}` : '';

    try {
      const [overviewRes, topicsRes, recsRes] = await Promise.all([
        api(`/analytics/overview${q}`),
        api(`/analytics/topics${q}`),
        api(`/recommendations${q}`),
      ]);
      if (destroyed || !root.isConnected) return;

      paint(root, ctx, {
        user: ctx.user,
        subject,
        overview: overviewRes.overview,
        trend: overviewRes.trend ?? [],
        follow: overviewRes.recommendations ?? { shown: 0, consumed: 0, rate: null },
        topics: topicsRes.topics ?? [],
        recs: recsRes.recommendations ?? [],
      });
    } catch (err) {
      if (destroyed || !root.isConnected) return;
      root.innerHTML = alertBox(err.message);
    }
  })();

  return {
    unmount() {
      destroyed = true;
    },
  };
}

function paint(root, ctx, data) {
  const { user, subject, overview, trend, follow, topics, recs } = data;
  const examDays = daysUntil(user.exam_date);
  const completed = overview.topicsTotal - overview.topicsMastered;

  const examHint =
    examDays === null
      ? 'Set an exam date in Settings'
      : examDays < 0
        ? `Exam was ${Math.abs(examDays)} day(s) ago`
        : examDays === 0
          ? 'Exam is today!'
          : `${examDays} day${examDays === 1 ? '' : 's'} until your exam`;

  root.innerHTML = `
    ${pageHeader(
      subject ? subject.name : 'All subjects',
      user.goal ? `Goal: ${user.goal}` : 'Your learning, at a glance',
      `<button class="btn btn-primary" id="go-plan">${icon('calendar-check', 'me-1')} Today's plan</button>
       <button class="btn btn-label-primary" id="go-chat">${icon('message-rounded-dots', 'me-1')} Ask a question</button>`,
    )}

    <div class="card mb-4 dashboard-hero">
      <div class="card-body">
        <div class="row align-items-center g-4">
          <div class="col-lg-8">
            <h4 class="mb-2">Welcome back, ${esc(user.name)} 👋</h4>
            <p class="text-body-secondary mb-3">
              ${esc(
                user.goal ||
                  'Upload your own notes, ask grounded questions, and practise with quizzes that adapt to you.',
              )}
            </p>
            <div class="d-flex flex-wrap gap-2">
              <span class="badge bg-label-primary">${icon('target-lock', 'me-1')}${esc(examHint)}</span>
              <span class="badge bg-label-info">${icon('time-five', 'me-1')}${esc(user.daily_minutes ?? 45)} min/day budget</span>
              <span class="badge bg-label-success">${icon('book-open', 'me-1')}${overview.topicsTotal} topic${overview.topicsTotal === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div class="col-lg-4 text-center text-lg-end">
            <img src="assets/img/illustrations/man-with-laptop.png" alt="" height="130" class="dashboard-hero-img" />
          </div>
        </div>
      </div>
    </div>

    <div class="row g-4 mb-4">
      <div class="col-sm-6 col-xl-3">
        ${statCard({
          label: 'Exam readiness',
          value: pct(overview.examReadiness),
          hint: 'Weighted mastery across the syllabus',
          iconName: 'target-lock',
          tone: 'primary',
        })}
      </div>
      <div class="col-sm-6 col-xl-3">
        ${statCard({
          label: 'Overall accuracy',
          value: pct(overview.accuracy),
          hint: `${overview.questionsAnswered} questions answered`,
          iconName: 'check-circle',
          tone: 'success',
        })}
      </div>
      <div class="col-sm-6 col-xl-3">
        ${statCard({
          label: 'Topics mastered',
          value: `${overview.topicsMastered}/${overview.topicsTotal}`,
          hint: `${completed} still to master (≥ 85%)`,
          iconName: 'award',
          tone: 'warning',
        })}
      </div>
      <div class="col-sm-6 col-xl-3">
        ${statCard({
          label: 'Time on task',
          value: `${overview.minutesOnTask}m`,
          hint: 'Total time spent answering questions',
          iconName: 'time-five',
          tone: 'info',
        })}
      </div>
    </div>

    <div class="row g-4 mb-4">
      <div class="col-xl-8">
        ${cardShell({
          title: 'Accuracy trend',
          subtitle: 'Daily accuracy over the last 14 days',
          body: `<div id="trend-chart"></div>`,
        })}
      </div>
      <div class="col-xl-4">
        <div class="card h-100">
          <div class="card-header"><h5 class="card-title mb-0">Exam readiness</h5></div>
          <div class="card-body">
            <div id="readiness-chart"></div>
            <div class="text-center mt-2">
              <span class="badge bg-label-${masteryTone(overview.examReadiness)}">
                ${esc(masteryLabel(overview.examReadiness))}
              </span>
              <p class="text-body-secondary small mt-2 mb-0">
                Weighted average mastery — unpractised topics count as 10%.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="row g-4">
      <div class="col-xl-7">
        <div class="card h-100">
          <div class="card-header d-flex justify-content-between align-items-center">
            <div>
              <h5 class="card-title mb-0">Topic mastery &amp; forgetting risk</h5>
              <small class="text-body-secondary">Risk ≥ 1 means the memory window has passed</small>
            </div>
            <a href="#/analytics" class="btn btn-sm btn-label-primary">Analytics</a>
          </div>
          <div class="card-body">
            ${
              topics.length === 0
                ? emptyState('No topics yet', 'Add topics under Materials to start tracking mastery.', 'book-open', 
                    `<a href="#/materials" class="btn btn-primary btn-sm">Go to Materials</a>`)
                : `<div class="table-responsive">
                    <table class="table table-hover align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Topic</th>
                          <th style="min-width:150px">Mastery</th>
                          <th>Level</th>
                          <th>Accuracy</th>
                          <th>Last practised</th>
                          <th>Review</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${topics
                          .map(
                            (t) => `<tr>
                              <td>
                                <div class="fw-medium">${esc(t.topicName)}</div>
                                <small class="text-body-secondary">${esc(t.subjectName)}</small>
                              </td>
                              <td>${progressBar(t.mastery, { tone: masteryTone(t.mastery), showLabel: true })}</td>
                              <td>${masteryBadge(t.mastery)}</td>
                              <td>${t.accuracy === null ? '<span class="text-body-secondary">—</span>' : pct(t.accuracy)}</td>
                              <td class="text-body-secondary small">${esc(relativeDays(t.daysSincePractice))}</td>
                              <td>${
                                t.dueForReview
                                  ? badge('due', 'warning')
                                  : badge('ok', 'success')
                              }</td>
                            </tr>`,
                          )
                          .join('')}
                      </tbody>
                    </table>
                  </div>`
            }
          </div>
        </div>
      </div>

      <div class="col-xl-5">
        <div class="card mb-4">
          <div class="card-header">
            <h5 class="card-title mb-0">Recommendation follow-through</h5>
          </div>
          <div class="card-body">
            <div class="d-flex align-items-center justify-content-between">
              <div>
                <h3 class="mb-1">${follow.rate === null ? '—' : pct(follow.rate)}</h3>
                <p class="text-body-secondary mb-0 small">
                  ${follow.consumed} of ${follow.shown} suggestions acted on
                </p>
              </div>
              <div class="avatar avatar-lg">
                <span class="avatar-initial rounded-circle bg-label-info">${icon('trending-up', 'icon-lg')}</span>
              </div>
            </div>
            <p class="text-body-secondary small mt-3 mb-0">
              Live Precision@N: when we recommend a topic, does the student actually practise it?
            </p>
          </div>
        </div>

        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h5 class="card-title mb-0">Why these topics, right now</h5>
            <button class="btn btn-sm btn-label-primary" id="regen-recs">${icon('refresh', 'me-1')}Refresh</button>
          </div>
          <div class="card-body">
            ${
              recs.length === 0
                ? emptyState('No recommendations yet', 'Take a quiz and the engine will suggest what to study next.', 'target-lock')
                : recs
                    .map(
                      (r, i) => `<div class="${i === recs.length - 1 ? '' : 'mb-4 pb-3 border-bottom'}">
                        <div class="d-flex justify-content-between align-items-start gap-2">
                          <div>
                            <span class="badge bg-label-primary me-2">#${i + 1}</span>
                            <span class="fw-medium">${esc(r.topicName)}</span>
                          </div>
                          <span class="badge bg-label-secondary">score ${num(r.score, 2)}</span>
                        </div>
                        <p class="text-body-secondary small mb-2 mt-2">${esc(r.reason)}</p>
                        <div class="d-flex flex-wrap gap-1">
                          ${Object.entries(r.breakdown?.terms ?? {})
                            .map(
                              ([key, value]) =>
                                `<span class="badge bg-label-secondary font-monospace">${esc(key)} ${Number(value).toFixed(2)}</span>`,
                            )
                            .join('')}
                        </div>
                      </div>`,
                    )
                    .join('')
            }
          </div>
        </div>
      </div>
    </div>`;

  root.querySelector('#go-plan')?.addEventListener('click', () => ctx.navigate('plan'));
  root.querySelector('#go-chat')?.addEventListener('click', () => ctx.navigate('chat'));

  root.querySelector('#regen-recs')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { recommendations } = await api('/recommendations/regenerate', {
        method: 'POST',
        body: { subjectId: subject?.id ?? null },
      });
      // Re-paint with the fresh list without another full dashboard round-trip.
      // Destroy the old charts first, otherwise ApexCharts keeps detached nodes.
      destroyCharts();
      data.recs = recommendations;
      paint(root, ctx, data);
    } catch (err) {
      const { toast } = await import('../ui.js');
      toast(err.message, 'danger');
    } finally {
      btn.disabled = false;
    }
  });

  accuracyTrendChart(root.querySelector('#trend-chart'), trend);
  readinessChart(root.querySelector('#readiness-chart'), overview.examReadiness);
}
