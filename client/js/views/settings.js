/**
 * Settings — profile and study preferences.
 *
 * Every field here feeds a different subsystem, which is why it is editable:
 *   goal          -> shown on the dashboard, keeps the student oriented
 *   exam_date     -> recommendation urgency (days-to-exam term)
 *   daily_minutes -> the planner's minute budget
 *
 * Email and password are deliberately read-only: changing them needs a
 * verification / current-password flow, so the API refuses to write them.
 */

import { api } from '../api.js';
import {
  esc,
  formatDate,
  pageHeader,
  cardShell,
  badge,
  icon,
  toast,
  alertBox,
} from '../ui.js';

export function mount(root, ctx) {
  let destroyed = false;
  paint();

  function paint() {
    if (destroyed || !root.isConnected) return;
    const user = ctx.user;

    root.innerHTML = `
      ${pageHeader('Settings', 'Profile and study preferences', '')}

      <div class="row g-4">
        <div class="col-xl-7">
          <form id="profile-form" novalidate>
            <div class="card mb-4">
              <div class="card-header">
                <h5 class="card-title mb-0">Profile</h5>
              </div>
              <div class="card-body">
                <div id="settings-alert"></div>

                <div class="row g-3">
                  <div class="col-md-6">
                    <label class="form-label" for="set-name">Full name</label>
                    <input class="form-control" id="set-name" name="name" maxlength="80"
                           value="${esc(user.name ?? '')}" required />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label" for="set-email">Email</label>
                    <input class="form-control" id="set-email" type="email"
                           value="${esc(user.email ?? '')}" disabled />
                    <div class="form-text">Email changes need verification — not editable here.</div>
                  </div>
                  <div class="col-12">
                    <label class="form-label" for="set-goal">Study goal</label>
                    <input class="form-control" id="set-goal" name="goal" maxlength="200"
                           placeholder="e.g. Pass Database Systems with 85%"
                           value="${esc(user.goal ?? '')}" />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label" for="set-exam">Exam date</label>
                    <input class="form-control" id="set-exam" name="examDate" type="date"
                           value="${esc(String(user.exam_date ?? '').slice(0, 10))}" />
                    <div class="form-text">Drives how urgently topics are recommended.</div>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label" for="set-minutes">Daily study budget (minutes)</label>
                    <input class="form-control" id="set-minutes" name="dailyMinutes" type="number"
                           min="5" max="600" step="5" value="${esc(user.daily_minutes ?? 45)}" />
                    <div class="form-text">The planner never schedules more than this.</div>
                  </div>
                </div>
              </div>
              <div class="card-footer d-flex justify-content-end gap-2">
                <button type="button" class="btn btn-label-secondary" id="reset-profile">Reset</button>
                <button type="submit" class="btn btn-primary" id="save-profile">
                  ${icon('check-circle', 'me-1')} Save changes
                </button>
              </div>
            </div>
          </form>

          <div class="card">
            <div class="card-header"><h5 class="card-title mb-0">Account &amp; privacy</h5></div>
            <div class="card-body">
              <div class="d-flex flex-column gap-3 small">
                <div class="d-flex justify-content-between gap-3">
                  <div>
                    <div class="fw-medium text-heading">Password</div>
                    <div class="text-body-secondary">Stored as a bcrypt hash; never logged or returned.</div>
                  </div>
                  <span class="badge bg-label-success align-self-start">hashed</span>
                </div>
                <div class="d-flex justify-content-between gap-3">
                  <div>
                    <div class="fw-medium text-heading">Session</div>
                    <div class="text-body-secondary">A signed JWT in this browser's localStorage, sent as a Bearer token.</div>
                  </div>
                  <span class="badge bg-label-info align-self-start">stateless</span>
                </div>
                <div class="d-flex justify-content-between gap-3">
                  <div>
                    <div class="fw-medium text-heading">Your material</div>
                    <div class="text-body-secondary">Stored locally in SQLite. Answers are grounded only in your own uploads.</div>
                  </div>
                  <span class="badge bg-label-secondary align-self-start">local</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-xl-5">
          <div class="card mb-4">
            <div class="card-header d-flex justify-content-between align-items-center">
              <h5 class="card-title mb-0">Subjects</h5>
              <button class="btn btn-sm btn-label-primary" id="settings-new-subject">
                ${icon('plus', 'me-1')} New
              </button>
            </div>
            <div class="card-body">
              ${
                ctx.subjects.length === 0
                  ? `<p class="text-body-secondary mb-0">No subjects yet — create one to begin.</p>`
                  : `<div class="d-flex flex-column gap-2">
                      ${ctx.subjects
                        .map(
                          (s) => `<button type="button" class="subject-option ${s.id === ctx.activeSubject?.id ? 'active' : ''}"
                              data-subject="${esc(s.id)}">
                            <span class="avatar avatar-sm">
                              <span class="avatar-initial rounded bg-label-${s.id === ctx.activeSubject?.id ? 'primary' : 'secondary'}">
                                ${icon('book-content')}
                              </span>
                            </span>
                            <span class="flex-grow-1 text-start">
                              <span class="d-block fw-medium">${esc(s.name)}</span>
                              <span class="d-block small text-body-secondary">created ${esc(formatDate(s.created_at))}</span>
                            </span>
                            ${s.id === ctx.activeSubject?.id ? badge('active', 'primary') : '<span class="small text-body-secondary">switch</span>'}
                          </button>`,
                        )
                        .join('')}
                    </div>`
              }
              <p class="text-body-secondary small mt-3 mb-0">
                The active subject scopes the dashboard, quiz, chat, materials and plan.
              </p>
            </div>
          </div>

          ${cardShell({
            title: 'How your data is used',
            body: `<ul class="ps-3 mb-0 small text-body-secondary d-flex flex-column gap-2">
              <li>Answers are stored as append-only evidence, with mastery before/after each one.</li>
              <li>Recommendations are computed from mastery, forgetting risk, prerequisites and exam proximity.</li>
              <li>Nothing is sent to a third party unless you configure an optional provider key.</li>
            </ul>`,
          })}

          <div class="card mt-4 border-danger">
            <div class="card-body">
              <h6 class="text-danger mb-2">Sign out</h6>
              <p class="text-body-secondary small">
                Removes the session token from this browser. Your material stays on the server.
              </p>
              <button class="btn btn-outline-danger btn-sm" id="settings-logout">
                ${icon('log-out', 'me-1')} Log out
              </button>
            </div>
          </div>
        </div>
      </div>`;

    const form = root.querySelector('#profile-form');
    const alertSlot = root.querySelector('#settings-alert');

    root.querySelector('#reset-profile')?.addEventListener('click', () => {
      paint();
      toast('Form reset to the saved values.', 'info');
    });

    root.querySelector('#settings-logout')?.addEventListener('click', () => ctx.logout());

    root.querySelector('#settings-new-subject')?.addEventListener('click', () => {
      // The shell owns subject creation; trigger its modal rather than duplicating it.
      document.getElementById('new-subject-btn')?.click();
    });

    root.querySelectorAll('[data-subject]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ctx.setActiveSubject(btn.dataset.subject);
        paint();
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertSlot.innerHTML = '';

      const name = form.querySelector('#set-name').value.trim();
      const goal = form.querySelector('#set-goal').value.trim();
      const examDate = form.querySelector('#set-exam').value || null;
      const dailyMinutes = Number(form.querySelector('#set-minutes').value);

      if (!name) {
        alertSlot.innerHTML = alertBox('Name cannot be empty.');
        form.querySelector('#set-name').classList.add('is-invalid');
        return;
      }
      if (!Number.isInteger(dailyMinutes) || dailyMinutes < 5 || dailyMinutes > 600) {
        alertSlot.innerHTML = alertBox('Daily budget must be between 5 and 600 minutes.');
        form.querySelector('#set-minutes').classList.add('is-invalid');
        return;
      }

      const button = root.querySelector('#save-profile');
      const original = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving…';

      try {
        const { user } = await api('/auth/me', {
          method: 'PATCH',
          body: {
            name,
            goal: goal || null,
            examDate,
            dailyMinutes,
          },
        });
        ctx.setUser(user);
        toast('Settings saved.', 'success');
        paint();
      } catch (err) {
        alertSlot.innerHTML = alertBox(err.message);
        button.disabled = false;
        button.innerHTML = original;
      }
    });
  }

  return {
    unmount() {
      destroyed = true;
    },
  };
}
