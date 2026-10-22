/**
 * Today's Plan — the personalised-learning pillar.
 *
 * Renders the planner's minute-budgeted timetable plus the ranked
 * recommendations behind it. "Regenerate" makes the pipeline observable:
 * practise a topic, come back, regenerate, and watch the plan respond.
 */

import { api } from '../api.js';
import {
  esc,
  pct,
  num,
  formatDate,
  pageHeader,
  cardShell,
  emptyState,
  progressBar,
  masteryTone,
  badge,
  icon,
  toast,
  alertBox,
  skeleton,
} from '../ui.js';

const ACTIVITY = {
  quiz: { icon: 'list-check', label: 'Practice quiz', tone: 'primary', route: 'quiz' },
  read: { icon: 'book-open', label: 'Read / review', tone: 'info', route: 'materials' },
  review: { icon: 'refresh', label: 'Spaced review', tone: 'warning', route: 'quiz' },
};

export function mount(root, ctx) {
  let destroyed = false;

  (async () => {
    root.innerHTML = skeleton(260);
    await load();

    async function load() {
      try {
        const [planRes, recsRes] = await Promise.all([
          api('/plan'),
          api(`/recommendations${ctx.activeSubject ? `?subjectId=${encodeURIComponent(ctx.activeSubject.id)}` : ''}`),
        ]);
        if (destroyed || !root.isConnected) return;
        paint(planRes.plan, recsRes.recommendations ?? []);
      } catch (err) {
        if (destroyed || !root.isConnected) return;
        root.innerHTML = alertBox(err.message);
      }
    }

    function paint(plan, recs) {
      const total = Math.max(plan?.total_minutes ?? 0, 1);
      const budget = ctx.user.daily_minutes ?? 45;

      root.innerHTML = `
        ${pageHeader(
          "Today's Plan",
          plan ? `${formatDate(plan.plan_date)} · built around your latest mastery` : 'A minute-budgeted study schedule',
          `<button class="btn btn-primary" id="regen-plan">${icon('refresh', 'me-1')} Regenerate plan</button>`,
        )}

        <div class="row g-4 mb-4">
          <div class="col-sm-6 col-xl-3">
            ${metric('Scheduled', `${plan?.total_minutes ?? 0} min`, 'time-five', 'primary', 'Total planned study time')}
          </div>
          <div class="col-sm-6 col-xl-3">
            ${metric('Daily budget', `${budget} min`, 'target-lock', 'info', 'From your settings')}
          </div>
          <div class="col-sm-6 col-xl-3">
            ${metric('Blocks', `${plan?.items?.length ?? 0}`, 'list-check', 'success', 'Focused study blocks')}
          </div>
          <div class="col-sm-6 col-xl-3">
            ${metric('Recommendations', `${recs.length}`, 'trending-up', 'warning', 'Ranked by priority score')}
          </div>
        </div>

        <div class="row g-4">
          <div class="col-xl-7">
            <div class="card h-100">
              <div class="card-header d-flex justify-content-between align-items-center">
                <div>
                  <h5 class="card-title mb-0">Your schedule</h5>
                  <small class="text-body-secondary">${esc(plan?.plan_date ? formatDate(plan.plan_date) : 'Not built yet')}</small>
                </div>
                <span class="badge bg-label-primary">${Math.min(100, Math.round(((plan?.total_minutes ?? 0) / Math.max(budget, 1)) * 100))}% of budget</span>
              </div>
              <div class="card-body">
                ${
                  !plan || plan.items.length === 0
                    ? emptyState(
                        'Nothing scheduled yet',
                        'Add material and take a quiz so the planner has data to work from.',
                        'calendar-check',
                        `<a href="#/materials" class="btn btn-primary btn-sm">Add material</a>`,
                      )
                    : `<div class="d-flex flex-column gap-3">
                        ${plan.items
                          .map((item, i) => {
                            const meta = ACTIVITY[item.activity] ?? {
                              icon: 'file-blank',
                              label: item.activity,
                              tone: 'secondary',
                              route: 'materials',
                            };
                            return `<div class="plan-block">
                              <div class="d-flex align-items-start gap-3">
                                <div class="avatar flex-shrink-0">
                                  <span class="avatar-initial rounded bg-label-${meta.tone}">${icon(meta.icon, 'icon-md')}</span>
                                </div>
                                <div class="flex-grow-1 min-w-0">
                                  <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
                                    <span class="fw-medium">${esc(item.topicName)}</span>
                                    ${badge(meta.label, meta.tone)}
                                    <span class="badge bg-label-secondary">${esc(item.minutes)} min</span>
                                  </div>
                                  <p class="text-body-secondary small mb-2">${esc(item.reason)}</p>
                                  <div class="d-flex align-items-center gap-3">
                                    ${progressBar(item.minutes / total, { tone: meta.tone, height: 6 })}
                                    <button class="btn btn-sm btn-label-primary flex-shrink-0" data-open="${esc(meta.route)}">
                                      Open ${icon('chevron-right')}
                                    </button>
                                  </div>
                                </div>
                                <span class="plan-index">${i + 1}</span>
                              </div>
                            </div>`;
                          })
                          .join('')}
                      </div>`
                }
              </div>
            </div>
          </div>

          <div class="col-xl-5">
            ${cardShell({
              title: 'Ranked recommendations',
              subtitle: 'Transparent priority score, with the weighted terms',
              body:
                recs.length === 0
                  ? emptyState('No recommendations yet', 'They appear once there is mastery data to reason about.', 'target-lock')
                  : `<div class="d-flex flex-column gap-4">
                      ${recs
                        .map(
                          (r, i) => `<div>
                            <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
                              <div>
                                <span class="badge bg-label-primary me-2">#${i + 1}</span>
                                <span class="fw-medium">${esc(r.topicName)}</span>
                              </div>
                              <span class="badge bg-label-secondary">priority ${num(r.score, 2)}</span>
                            </div>
                            ${(() => {
                              // The recommendations payload is model output, not a
                              // mastery read: recover mastery from the knowledge-gap
                              // feature so the bar and the score never disagree.
                              const knowledgeGap = r.breakdown?.features?.knowledgeGap;
                              if (knowledgeGap === undefined) return '';
                              const mastery = 1 - knowledgeGap;
                              return `<div class="d-flex align-items-center gap-3 mb-2">
                                <div class="flex-grow-1">
                                  ${progressBar(mastery, { tone: masteryTone(mastery), height: 6, showLabel: true })}
                                </div>
                                <small class="text-body-secondary">mastery</small>
                              </div>`;
                            })()}
                            <p class="text-body-secondary small mb-2">${esc(r.reason)}</p>
                            <details class="small">
                              <summary class="text-body-secondary">Score breakdown</summary>
                              <div class="d-flex flex-wrap gap-1 mt-2">
                                ${Object.entries(r.breakdown?.terms ?? {})
                                  .map(
                                    ([key, value]) =>
                                      `<span class="badge bg-label-secondary font-monospace">${esc(key)}: ${Number(value).toFixed(3)}</span>`,
                                  )
                                  .join('')}
                              </div>
                            </details>
                          </div>`,
                        )
                        .join('')}
                    </div>`,
            })}
          </div>
        </div>`;

      root.querySelectorAll('[data-open]').forEach((btn) => {
        btn.addEventListener('click', () => ctx.navigate(btn.dataset.open));
      });

      root.querySelector('#regen-plan')?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const original = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Rebuilding…';
        try {
          const subjectId = ctx.activeSubject?.id ?? null;
          await api('/recommendations/regenerate', { method: 'POST', body: { subjectId } });
          const { plan: fresh } = await api('/plan/regenerate', { method: 'POST', body: { subjectId } });
          const { recommendations } = await api(
            `/recommendations${subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : ''}`,
          );
          if (destroyed || !root.isConnected) return;
          toast("Today's plan was rebuilt from your latest progress.", 'success');
          paint(fresh, recommendations ?? []);
        } catch (err) {
          toast(err.message, 'danger');
          button.disabled = false;
          button.innerHTML = original;
        }
      });
    }
  })();

  return {
    unmount() {
      destroyed = true;
    },
  };
}

function metric(label, value, iconName, tone, hint) {
  return `<div class="card h-100">
    <div class="card-body">
      <div class="d-flex align-items-start justify-content-between mb-3">
        <div class="avatar"><span class="avatar-initial rounded bg-label-${tone}">${icon(iconName, 'icon-lg')}</span></div>
      </div>
      <p class="mb-1 text-body-secondary">${esc(label)}</p>
      <h4 class="mb-1">${esc(value)}</h4>
      <small class="text-body-secondary">${esc(hint)}</small>
    </div>
  </div>`;
}
