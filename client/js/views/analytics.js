/**
 * Analytics — the learning-analytics pillar in detail.
 *
 * Everything is derived server-side from append-only answer evidence. This view
 * simply visualises the same metrics the dashboard summarises:
 * readiness, accuracy trend, per-topic mastery, and forgetting risk.
 */

import { api } from '../api.js';
import {
  esc,
  pct,
  num,
  pageHeader,
  cardShell,
  emptyState,
  progressBar,
  masteryTone,
  masteryBadge,
  relativeDays,
  statCard,
  badge,
  icon,
  accuracyTrendChart,
  masteryBarChart,
  skeleton,
  alertBox,
} from '../ui.js';

export function mount(root, ctx) {
  let destroyed = false;
  const subject = ctx.activeSubject;
  const q = subject ? `?subjectId=${encodeURIComponent(subject.id)}` : '';

  (async () => {
    root.innerHTML = `<div class="row g-4">
      ${[0, 1, 2, 3].map(() => `<div class="col-sm-6 col-xl-3">${skeleton(80)}</div>`).join('')}
      <div class="col-12">${skeleton(240)}</div>
    </div>`;

    try {
      const [overviewRes, topicsRes] = await Promise.all([
        api(`/analytics/overview${q}`),
        api(`/analytics/topics${q}`),
      ]);
      if (destroyed || !root.isConnected) return;

      const overview = overviewRes.overview;
      const trend = overviewRes.trend ?? [];
      const follow = overviewRes.recommendations ?? { shown: 0, consumed: 0, rate: null };
      const topics = topicsRes.topics ?? [];

      const atRisk = topics.filter((t) => t.forgettingRisk >= 1 && t.mastery < 0.85);
      const averageMastery =
        topics.length > 0 ? topics.reduce((sum, t) => sum + (t.mastery ?? 0), 0) / topics.length : 0;

      root.innerHTML = `
        ${pageHeader(
          'Learning Analytics',
          subject ? `Scoped to “${subject.name}”` : 'Across all of your subjects',
          `<a href="#/quiz" class="btn btn-primary">${icon('list-check', 'me-1')} Practise now</a>`,
        )}

        <div class="row g-4 mb-4">
          <div class="col-sm-6 col-xl-3">
            ${statCard({ label: 'Exam readiness', value: pct(overview.examReadiness), hint: 'Weighted syllabus mastery', iconName: 'target-lock', tone: 'primary' })}
          </div>
          <div class="col-sm-6 col-xl-3">
            ${statCard({ label: 'Average topic mastery', value: pct(averageMastery), hint: `${topics.length} topic(s) tracked`, iconName: 'award', tone: 'success' })}
          </div>
          <div class="col-sm-6 col-xl-3">
            ${statCard({ label: 'Accuracy', value: pct(overview.accuracy), hint: `${overview.questionsAnswered} answers`, iconName: 'check-circle', tone: 'info' })}
          </div>
          <div class="col-sm-6 col-xl-3">
            ${statCard({ label: 'Due for review', value: String(atRisk.length), hint: 'Past the memory-stability window', iconName: 'refresh', tone: atRisk.length ? 'warning' : 'success' })}
          </div>
        </div>

        <div class="row g-4 mb-4">
          <div class="col-xl-8">
            ${cardShell({
              title: 'Accuracy trend',
              subtitle: 'Daily accuracy over the last 14 days',
              body: `<div id="analytics-trend"></div>`,
            })}
          </div>
          <div class="col-xl-4">
            ${cardShell({
              title: 'Recommendation follow-through',
              subtitle: 'Live Precision@N',
              body: `<div class="d-flex align-items-center gap-3 mb-3">
                  <h2 class="mb-0">${follow.rate === null ? '—' : pct(follow.rate)}</h2>
                  <span class="badge bg-label-info">${follow.consumed}/${follow.shown}</span>
                </div>
                <p class="text-body-secondary small mb-3">
                  Of the recommendations shown, how many did you act on by starting a quiz on that topic?
                </p>
                <div class="d-flex flex-column gap-2 small">
                  <div class="d-flex justify-content-between"><span class="text-body-secondary">Suggestions shown</span><span>${follow.shown}</span></div>
                  <div class="d-flex justify-content-between"><span class="text-body-secondary">Acted on</span><span>${follow.consumed}</span></div>
                  <div class="d-flex justify-content-between"><span class="text-body-secondary">Questions answered</span><span>${overview.questionsAnswered}</span></div>
                  <div class="d-flex justify-content-between"><span class="text-body-secondary">Minutes on task</span><span>${overview.minutesOnTask}m</span></div>
                </div>`,
            })}
          </div>
        </div>

        <div class="row g-4">
          <div class="col-xl-5">
            ${cardShell({
              title: 'Mastery by topic',
              subtitle: 'Weighted readiness is computed from these values',
              body: `<div id="analytics-bars"></div>`,
            })}
          </div>

          <div class="col-xl-7">
            <div class="card h-100">
              <div class="card-header d-flex justify-content-between align-items-center">
                <div>
                  <h5 class="card-title mb-0">Mastery &amp; forgetting risk</h5>
                  <small class="text-body-secondary">Risk &gt; 1 means it is time to review</small>
                </div>
                ${atRisk.length ? badge(`${atRisk.length} due`, 'warning') : badge('all caught up', 'success')}
              </div>
              <div class="card-body">
                ${
                  topics.length === 0
                    ? emptyState('No topics yet', 'Add topics in Materials and answer a few questions.', 'bar-chart-alt-2')
                    : `<div class="table-responsive">
                        <table class="table table-hover align-middle mb-0">
                          <thead>
                            <tr>
                              <th>Topic</th>
                              <th style="min-width:140px">Mastery</th>
                              <th>Level</th>
                              <th>Accuracy</th>
                              <th>Last practised</th>
                              <th>Risk</th>
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
                                  <td class="small text-body-secondary">${esc(relativeDays(t.daysSincePractice))}</td>
                                  <td>
                                    <span class="badge bg-label-${t.forgettingRisk >= 1 ? 'warning' : 'success'}">
                                      ${num(t.forgettingRisk, 1)}${t.dueForReview ? icon('error-circle', 'ms-1') : ''}
                                    </span>
                                  </td>
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
        </div>

        <div class="card mt-4">
          <div class="card-header"><h5 class="card-title mb-0">How these numbers are produced</h5></div>
          <div class="card-body">
            <div class="row g-4 small text-body-secondary">
              <div class="col-md-3">
                <div class="fw-medium text-heading mb-1">Mastery</div>
                Bayesian Knowledge Tracing updates P(knows topic) after every answer, adjusted by item difficulty.
              </div>
              <div class="col-md-3">
                <div class="fw-medium text-heading mb-1">Exam readiness</div>
                Weighted average mastery over the syllabus. Unpractised topics count as 10%, so gaps are penalised.
              </div>
              <div class="col-md-3">
                <div class="fw-medium text-heading mb-1">Forgetting risk</div>
                Days since practice ÷ memory stability. Stability grows with mastery, so strong memories decay slower.
              </div>
              <div class="col-md-3">
                <div class="fw-medium text-heading mb-1">Adaptive difficulty</div>
                Elo predicts success per question; the quiz serves items closest to a 60% success target.
              </div>
            </div>
          </div>
        </div>`;

      accuracyTrendChart(root.querySelector('#analytics-trend'), trend);
      masteryBarChart(root.querySelector('#analytics-bars'), topics);
    } catch (err) {
      if (!destroyed) root.innerHTML = alertBox(err.message);
    }
  })();

  return {
    unmount() {
      destroyed = true;
    },
  };
}
