/**
 * Authentication view — login and registration on Sneat's auth layout.
 *
 * One card, two modes. Switching modes re-renders only the form so the student
 * never loses the page context. Errors are rendered inline (not in a toast) so
 * they sit next to the field that caused them.
 *
 * The demo credentials are shown deliberately: this is a coursework project with
 * a seeded demo account, and the graders need to get in quickly.
 */

import { api } from '../api.js';
import { brand, esc, icon, toast, alertBox } from '../ui.js';

const DEMO = { email: 'demo@example.com', password: 'password123' };

export function mount(root, { onAuthed }) {
  let mode = 'login'; // 'login' | 'register'
  let busy = false;

  /** Paint the auth card for the current mode. */
  function paint(errorMessage = '', fieldErrors = {}) {
    root.innerHTML = `<div class="container-xxl">
      <div class="authentication-wrapper authentication-basic container-p-y">
        <div class="authentication-inner">
          <div class="card px-sm-6 px-0">
            <div class="card-body">
              <div class="app-brand justify-content-center mb-6">${brand()}</div>

              <h4 class="mb-1">${mode === 'login' ? 'Welcome back 👋' : 'Start learning smarter 🚀'}</h4>
              <p class="mb-6 text-body-secondary">
                ${
                  mode === 'login'
                    ? 'Sign in to your study dashboard, quizzes and analytics.'
                    : 'Create an account, upload your notes and get personalised study plans.'
                }
              </p>

              <div class="btn-group w-100 mb-6" role="group" aria-label="Authentication mode">
                <button type="button" class="btn ${mode === 'login' ? 'btn-primary' : 'btn-label-primary'}" data-mode="login">Sign in</button>
                <button type="button" class="btn ${mode === 'register' ? 'btn-primary' : 'btn-label-primary'}" data-mode="register">Create account</button>
              </div>

              ${errorMessage ? alertBox(errorMessage) : ''}

              <form id="auth-form" novalidate>
                ${
                  mode === 'register'
                    ? `<div class="mb-4">
                        <label class="form-label" for="name">Full name</label>
                        <input type="text" class="form-control ${fieldErrors.name ? 'is-invalid' : ''}" id="name"
                               name="name" placeholder="Ada Lovelace" autocomplete="name" />
                        <div class="invalid-feedback">${esc(fieldErrors.name ?? '')}</div>
                      </div>`
                    : ''
                }

                <div class="mb-4">
                  <label class="form-label" for="email">Email</label>
                  <input type="email" class="form-control ${fieldErrors.email ? 'is-invalid' : ''}" id="email"
                         name="email" placeholder="you@university.edu" autocomplete="email" />
                  <div class="invalid-feedback">${esc(fieldErrors.email ?? '')}</div>
                </div>

                <div class="mb-4 form-password-toggle">
                  <label class="form-label" for="password">Password</label>
                  <div class="input-group input-group-merge">
                    <input type="password" id="password" name="password"
                           class="form-control ${fieldErrors.password ? 'is-invalid' : ''}"
                           placeholder="············" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" />
                    <span class="input-group-text cursor-pointer" data-toggle-password>
                      <i class="icon-base bx bx-hide"></i>
                    </span>
                  </div>
                  <div class="form-text">
                    ${mode === 'register' ? 'At least 6 characters.' : 'The password you registered with.'}
                  </div>
                </div>

                ${
                  mode === 'register'
                    ? `<div class="row g-3 mb-4">
                        <div class="col-sm-6">
                          <label class="form-label" for="goal">Study goal (optional)</label>
                          <input type="text" class="form-control" id="goal" name="goal"
                                 placeholder="Pass the final exam" maxlength="200" />
                        </div>
                        <div class="col-sm-3">
                          <label class="form-label" for="examDate">Exam date</label>
                          <input type="date" class="form-control" id="examDate" name="examDate" />
                        </div>
                        <div class="col-sm-3">
                          <label class="form-label" for="dailyMinutes">Minutes/day</label>
                          <input type="number" class="form-control" id="dailyMinutes" name="dailyMinutes"
                                 value="45" min="5" max="600" step="5" />
                        </div>
                      </div>`
                    : ''
                }

                <button class="btn btn-primary d-grid w-100" type="submit" id="auth-submit">
                  ${mode === 'login' ? 'Sign in' : 'Create account'}
                </button>
              </form>

              ${
                mode === 'login'
                  ? `<div class="divider my-6"><div class="divider-text">Demo account</div></div>
                     <div class="d-grid gap-2">
                       <button class="btn btn-label-primary" type="button" id="demo-login">
                         ${icon('bxs-magic-wand', 'me-1')} Sign in as Demo Student
                       </button>
                       <small class="text-body-secondary text-center">
                         ${esc(DEMO.email)} / ${esc(DEMO.password)} — seeded with a subject, topics, notes and quiz history.
                       </small>
                     </div>`
                  : `<p class="text-center mt-6 mb-0">
                       <span class="text-body-secondary">Already have an account?</span>
                       <a href="javascript:void(0)" data-mode="login"> Sign in</a>
                     </p>`
              }
            </div>
          </div>
          <p class="text-center text-body-secondary small mt-4 mb-0">
            Runs fully offline by default — no API keys required.
          </p>
        </div>
      </div>
    </div>`;

    bind();
  }

  function bind() {
    root.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        paint();
      });
    });

    // Password visibility toggle (mirrors Sneat's own behaviour).
    root.querySelector('[data-toggle-password]')?.addEventListener('click', () => {
      const input = root.querySelector('#password');
      const iconEl = root.querySelector('[data-toggle-password] i');
      if (!input) return;
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      iconEl.className = `icon-base bx ${hidden ? 'bx-show' : 'bx-hide'}`;
    });

    root.querySelector('#demo-login')?.addEventListener('click', () => {
      const email = root.querySelector('#email');
      const password = root.querySelector('#password');
      if (email) email.value = DEMO.email;
      if (password) password.value = DEMO.password;
      submit();
    });

    root.querySelector('#auth-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
  }

  /** Validate locally, then call the API. */
  async function submit() {
    if (busy) return;

    const form = root.querySelector('#auth-form');
    if (!form) return;

    const data = Object.fromEntries(new FormData(form).entries());
    const fieldErrors = {};

    if (!data.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      fieldErrors.email = 'Enter a valid email address.';
    }
    if (!data.password || data.password.length < 6) {
      fieldErrors.password = 'Password must be at least 6 characters.';
    }
    if (mode === 'register' && !String(data.name ?? '').trim()) {
      fieldErrors.name = 'Your name is required.';
    }

    if (Object.keys(fieldErrors).length > 0) {
      paint('', fieldErrors);
      return;
    }

    busy = true;
    const button = root.querySelector('#auth-submit');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Please wait…';

    try {
      if (mode === 'login') {
        const res = await api('/auth/login', {
          method: 'POST',
          body: { email: data.email.trim(), password: data.password },
        });
        toast(`Welcome back, ${res.user.name}.`, 'success');
        await onAuthed(res.user, res.token);
        return;
      }

      // Registration: only send optional fields when the student filled them in,
      // otherwise the server would store empty strings instead of nulls.
      const body = {
        name: String(data.name).trim(),
        email: data.email.trim(),
        password: data.password,
      };
      if (String(data.goal ?? '').trim()) body.goal = String(data.goal).trim();
      if (data.examDate) body.examDate = data.examDate;
      const minutes = Number(data.dailyMinutes);
      if (Number.isFinite(minutes) && minutes >= 5) body.dailyMinutes = Math.round(minutes);

      const res = await api('/auth/register', { method: 'POST', body });
      toast('Account created. Let’s set up your first subject.', 'success');
      await onAuthed(res.user, res.token);
    } catch (err) {
      busy = false;
      button.disabled = false;
      button.innerHTML = original;
      paint(err.message);
    }
  }

  paint();

  return {
    unmount() {
      root.innerHTML = '';
    },
  };
}
