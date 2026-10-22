/**
 * Application shell (pure JavaScript, no framework).
 *
 * RESPONSIBILITIES
 *   1. Boot: verify a stored token and load the user's subjects.
 *   2. Own the global state: the user, the subject list, the selected subject.
 *   3. Render the Sneat layout (fixed sidebar + detached navbar) once, and swap
 *      only the content region when the route changes.
 *   4. Route with the URL hash (#/dashboard) so refresh + back/forward work.
 *
 * WHY A PERSISTENT SHELL
 *   Re-rendering the sidebar on every navigation would re-initialise Sneat's
 *   menu plugin and the perfect-scrollbar instance each time. Rendering the shell
 *   once keeps the layout stable and makes navigation feel instantly.
 *
 * Everything a view receives is in `ctx`; views never import the shell, which
 * keeps the dependency graph acyclic (views -> api/ui only).
 */

import { api, getToken, setToken } from './api.js';
import { brand, esc, icon, toast, statCard, destroyCharts } from './ui.js';

import { mount as mountAuth } from './views/auth.js';
import { mount as mountDashboard } from './views/dashboard.js';
import { mount as mountPlan } from './views/plan.js';
import { mount as mountChat } from './views/chat.js';
import { mount as mountQuiz } from './views/quiz.js';
import { mount as mountMaterials } from './views/materials.js';
import { mount as mountAnalytics } from './views/analytics.js';
import { mount as mountSettings } from './views/settings.js';

/* --------------------------------------------------------------- navigation */

const MENU_KEY = 'study_assistant_menu';

const ROUTES = {
  dashboard: { title: 'Dashboard', icon: 'home-smile', mount: mountDashboard, group: 'Learn' },
  plan: { title: "Today's Plan", icon: 'calendar-check', mount: mountPlan, group: 'Learn' },
  quiz: { title: 'Practice Quiz', icon: 'list-check', mount: mountQuiz, group: 'Learn' },
  chat: { title: 'Ask Questions', icon: 'message-rounded-dots', mount: mountChat, group: 'Learn' },
  analytics: { title: 'Analytics', icon: 'bar-chart-alt-2', mount: mountAnalytics, group: 'Insights' },
  materials: { title: 'Materials & Topics', icon: 'folder', mount: mountMaterials, group: 'Library' },
  settings: { title: 'Settings', icon: 'cog', mount: mountSettings, group: 'Account' },
};

const DEFAULT_ROUTE = 'dashboard';
const MENU_GROUPS = ['Learn', 'Insights', 'Library', 'Account'];

/** Views that operate on one subject; the shell blocks them without one. */
const SUBJECT_ROUTES = new Set(['dashboard', 'plan', 'quiz', 'chat', 'materials']);

/* -------------------------------------------------------------------- state */

const state = {
  user: null,
  subjects: [],
  activeSubjectId: null,
  route: DEFAULT_ROUTE,
  view: null, // { unmount() }
};

const ctx = {
  get user() {
    return state.user;
  },
  get subjects() {
    return state.subjects;
  },
  get activeSubject() {
    return state.subjects.find((s) => s.id === state.activeSubjectId) ?? null;
  },
  navigate,
  refreshSubjects,
  setUser,
  setActiveSubject,
  logout,
};

/* ------------------------------------------------------------------ helpers */

function currentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES[hash] ? hash : DEFAULT_ROUTE;
}

function navigate(route) {
  if (!ROUTES[route]) route = DEFAULT_ROUTE;
  if (window.location.hash === `#/${route}`) applyRoute();
  else window.location.hash = `#/${route}`;
}

function setUser(user) {
  state.user = user;
  paintNavbarUser();
}

/** Load the subject list and keep the current selection valid. */
async function refreshSubjects() {
  if (!state.user) return [];
  const { subjects } = await api('/subjects');
  state.subjects = subjects;
  if (!state.activeSubjectId || !subjects.some((s) => s.id === state.activeSubjectId)) {
    state.activeSubjectId = subjects[0]?.id ?? null;
  }
  paintSubjectPicker();
  return subjects;
}

function setActiveSubject(id) {
  state.activeSubjectId = id;
  paintSubjectPicker();
  applyRoute(); // re-render the current view against the new subject
}

function logout() {
  setToken(null);
  state.user = null;
  state.subjects = [];
  state.activeSubjectId = null;
  window.location.hash = '';
  render();
}

/* --------------------------------------------------------------------- boot */

async function boot() {
  if (!getToken()) {
    render();
    return;
  }
  try {
    const { user } = await api('/auth/me');
    state.user = user;
    await refreshSubjects();
  } catch {
    // Expired or invalid token: drop it and fall back to the auth screen.
    setToken(null);
  }
  render();
}

/* ------------------------------------------------------------------- layout */

function render() {
  destroyCharts();
  state.view?.unmount?.();
  state.view = null;

  const root = document.getElementById('app');

  if (!state.user) {
    root.innerHTML = `<div class="app-auth" id="auth-root"></div>`;
    document.body.classList.add('auth-page');
    mountAuth(document.getElementById('auth-root'), {
      onAuthed: async (user, token) => {
        setToken(token);
        state.user = user;
        document.body.classList.remove('auth-page');
        try {
          await refreshSubjects();
        } catch (err) {
          toast(err.message, 'danger');
        }
        render();
      },
    });
    return;
  }

  document.body.classList.remove('auth-page');
  root.innerHTML = shellHtml();
  bindShellEvents();
  restoreMenuPreference();

  // Sneat menu plugin: re-initialise on the freshly rendered sidebar.
  initSneatMenu();
  initMenuAffordances();

  state.route = currentRoute();
  applyRoute();
}

function shellHtml() {
  return `<div class="layout-wrapper layout-content-navbar">
    <div class="layout-container">
      <aside id="layout-menu" class="layout-menu menu-vertical menu bg-menu-theme">
        <div class="app-brand demo">
          ${brand()}
          <a href="javascript:void(0);" class="layout-menu-toggle menu-link text-large ms-auto">
            <i class="icon-base bx bx-chevron-left d-block d-xl-none align-middle"></i>
          </a>
        </div>
        <div class="menu-divider mt-0"></div>
        <div class="menu-inner-shadow"></div>
        ${menuHtml()}
      </aside>

      <div class="layout-page">
        <nav class="layout-navbar container-xxl navbar-detached navbar navbar-expand-xl align-items-center bg-navbar-theme"
             id="layout-navbar">
          <div class="layout-menu-toggle navbar-nav align-items-xl-center me-4 me-xl-0 d-xl-none">
            <a class="nav-item nav-link px-0 me-xl-6" href="javascript:void(0)" id="mobile-menu-toggle">
              <i class="icon-base bx bx-menu icon-md"></i>
            </a>
          </div>

          <div class="navbar-nav-right d-flex align-items-center justify-content-end" id="navbar-collapse">
            <div class="navbar-nav align-items-center me-auto">
              <div class="nav-item d-flex align-items-center gap-2" id="subject-picker"></div>
            </div>

            <ul class="navbar-nav flex-row align-items-center ms-md-auto">
              <li class="nav-item dropdown me-3">
                <button class="btn btn-sm btn-label-primary" id="new-subject-btn" type="button">
                  ${icon('plus')}<span class="d-none d-sm-inline ms-1">Subject</span>
                </button>
              </li>
              <li class="nav-item navbar-dropdown dropdown-user dropdown">
                <a class="nav-link dropdown-toggle hide-arrow p-0" href="javascript:void(0);" data-bs-toggle="dropdown">
                  <div class="avatar avatar-online" id="navbar-avatar">
                    <span class="avatar-initial rounded-circle bg-label-primary">?</span>
                  </div>
                </a>
                <ul class="dropdown-menu dropdown-menu-end" id="navbar-user-menu"></ul>
              </li>
            </ul>
          </div>
        </nav>

        <div class="content-wrapper">
          <div class="container-xxl flex-grow-1 container-p-y" id="view-root"></div>
          <footer class="content-footer footer bg-footer-theme">
            <div class="container-xxl">
              <div class="footer-container d-flex align-items-center justify-content-between py-4 flex-md-row flex-column">
                <div class="mb-2 mb-md-0">
                  AI-Based Student Study Assistant — <span class="text-body-secondary">Sneat template, pure JavaScript</span>
                </div>
                <a href="#/settings" class="footer-link">Study preferences</a>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
    <div class="layout-overlay layout-menu-toggle"></div>
  </div>`;
}

function menuHtml() {
  const route = currentRoute();
  return `<ul class="menu-inner py-1">
    ${MENU_GROUPS.map((group) => {
      const items = Object.entries(ROUTES).filter(([, r]) => r.group === group);
      if (items.length === 0) return '';
      return `
        <li class="menu-header small text-uppercase"><span class="menu-header-text">${esc(group)}</span></li>
        ${items
          .map(
            ([key, r]) => `<li class="menu-item ${route === key ? 'active' : ''}" data-route="${esc(key)}">
              <a href="#/${esc(key)}" class="menu-link">
                <i class="menu-icon icon-base bx bx-${esc(r.icon)}"></i>
                <div class="text-truncate">${esc(r.title)}</div>
              </a>
            </li>`,
          )
          .join('')}`;
    }).join('')}
  </ul>`;
}

function paintSubjectPicker() {
  const slot = document.getElementById('subject-picker');
  if (!slot) return;
  if (state.subjects.length === 0) {
    slot.innerHTML = `<span class="text-body-secondary small d-none d-md-inline">No subjects yet</span>`;
    return;
  }
  slot.innerHTML = `
    <span class="text-body-secondary d-none d-md-inline">${icon('book-content')} Subject</span>
    <select class="form-select form-select-sm" id="subject-select" style="min-width:200px" aria-label="Active subject">
      ${state.subjects
        .map(
          (s) => `<option value="${esc(s.id)}" ${s.id === state.activeSubjectId ? 'selected' : ''}>${esc(s.name)}</option>`,
        )
        .join('')}
    </select>`;
  slot.querySelector('#subject-select')?.addEventListener('change', (e) => setActiveSubject(e.target.value));
}

function paintNavbarUser() {
  const avatar = document.getElementById('navbar-avatar');
  const menu = document.getElementById('navbar-user-menu');
  if (!avatar || !menu || !state.user) return;

  const initials = String(state.user.name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  avatar.innerHTML = `<span class="avatar-initial rounded-circle bg-label-primary">${esc(initials || '?')}</span>`;

  menu.innerHTML = `
    <li>
      <div class="dropdown-item">
        <div class="d-flex">
          <div class="flex-shrink-0 me-3">
            <div class="avatar avatar-online">
              <span class="avatar-initial rounded-circle bg-label-primary">${esc(initials || '?')}</span>
            </div>
          </div>
          <div class="flex-grow-1">
            <h6 class="mb-0">${esc(state.user.name)}</h6>
            <small class="text-body-secondary">${esc(state.user.email)}</small>
          </div>
        </div>
      </div>
    </li>
    <li><div class="dropdown-divider my-1"></div></li>
    <li>
      <a class="dropdown-item" href="#/settings">
        ${icon('cog', 'icon-md me-3')}<span>Settings</span>
      </a>
    </li>
    <li><div class="dropdown-divider my-1"></div></li>
    <li>
      <a class="dropdown-item" href="javascript:void(0)" id="logout-link">
        ${icon('log-out', 'icon-md me-3')}<span>Log Out</span>
      </a>
    </li>`;
  menu.querySelector('#logout-link')?.addEventListener('click', logout);
}

function bindShellEvents() {
  paintSubjectPicker();
  paintNavbarUser();

  document.getElementById('new-subject-btn')?.addEventListener('click', () => {
    createSubjectFlow();
  });

  document.getElementById('mobile-menu-toggle')?.addEventListener('click', (event) => {
    event.preventDefault();
    toggleSidebar();
  });

  // The chevron inside the sidebar brand. Sneat's own `assets/js/main.js` wires
  // this up; we do it here because the shell is rendered after boot, not at
  // parse time, so that script would bind to elements that do not exist yet.
  document.querySelectorAll('.layout-menu-toggle').forEach((el) => {
    el.addEventListener('click', (event) => {
      // The navbar wrapper also carries this class; only the anchor toggles.
      if (!el.matches('a, button, .menu-link')) return;
      event.preventDefault();
      toggleSidebar();
    });
  });
}

/**
 * One toggle for two layouts:
 *  - small screens (<1200px): the sidebar is an off-canvas drawer, so defer to
 *    Sneat's `Helpers.toggleCollapsed()`;
 *  - desktop: toggle `layout-menu-collapsed` directly. Sneat's free helpers only
 *    implement the drawer branch, but its stylesheet fully supports the 84px
 *    icon rail, so the class is all that is needed (and the choice is sticky).
 */
function toggleSidebar() {
  if (window.Helpers?.isSmallScreen?.()) {
    window.Helpers.toggleCollapsed();
    return;
  }
  const collapsed = document.documentElement.classList.toggle('layout-menu-collapsed');
  try {
    localStorage.setItem(MENU_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* storage can fail in private mode; the toggle still works for this page */
  }
  window.dispatchEvent(new Event('resize'));
}

/** Restore the desktop rail preference from the last visit. */
function restoreMenuPreference() {
  let saved = null;
  try {
    saved = localStorage.getItem(MENU_KEY);
  } catch {
    saved = null;
  }
  if (saved === 'collapsed') document.documentElement.classList.add('layout-menu-collapsed');
}

/**
 * Reveal the sidebar's collapse chevron on hover (desktop) and auto-close the
 * drawer after a navigation on small screens, matching the Sneat demo.
 */
function initMenuAffordances() {
  const sidebar = document.getElementById('layout-menu');
  const chevron = sidebar?.querySelector('.layout-menu-toggle');
  if (!sidebar || !chevron) return;

  sidebar.addEventListener('mouseenter', () => {
    if (!window.Helpers?.isSmallScreen?.()) chevron.classList.add('d-block');
    // While collapsed, hovering slides the full menu over the page.
    if (document.documentElement.classList.contains('layout-menu-collapsed')) {
      document.documentElement.classList.add('layout-menu-hover');
    }
  });
  sidebar.addEventListener('mouseleave', () => {
    chevron.classList.remove('d-block');
    document.documentElement.classList.remove('layout-menu-hover');
  });
}

/** Close the off-canvas drawer after a route change on small screens. */
function closeMenuOnSmallScreen() {
  if (window.Helpers?.isSmallScreen?.() && document.documentElement.classList.contains('layout-menu-expanded')) {
    window.Helpers.setCollapsed(true, false);
  }
}

/** Initialise the Sneat vertical menu (perfect-scrollbar + open/close state). */
function initSneatMenu() {
  const menuEl = document.getElementById('layout-menu');
  if (!menuEl || !window.Menu) return;
  try {
    // Destroy a previous instance if the shell was re-rendered.
    window.Helpers?.mainMenu?.destroy?.();
    const menu = new window.Menu(menuEl, { orientation: 'vertical', closeChildren: false });
    window.Helpers.mainMenu = menu;
    if (window.Helpers.isSmallScreen?.()) window.Helpers.setCollapsed?.(true, false);
  } catch (err) {
    console.warn('Sneat menu initialisation failed:', err);
  }
}

/* ------------------------------------------------------------- subject flow */

async function createSubjectFlow() {
  const { showModal } = await import('./ui.js');
  const created = await showModal({
    title: 'Create a subject',
    body: `<label class="form-label" for="subject-name">Subject name</label>
      <input class="form-control" id="subject-name" placeholder="e.g. Database Systems" maxlength="120" />
      <div class="form-text">A subject groups your topics, notes and quizzes.</div>`,
    okText: 'Create',
    onOk: async (modal) => {
      const name = modal.querySelector('#subject-name').value.trim();
      if (!name) {
        modal.querySelector('#subject-name').classList.add('is-invalid');
        return false;
      }
      const { subject } = await api('/subjects', { method: 'POST', body: { name } });
      await refreshSubjects();
      state.activeSubjectId = subject.id;
      paintSubjectPicker();
      toast(`Subject "${subject.name}" created.`, 'success');
      return true;
    },
  });

  if (created) {
    // Send the student straight to Materials so they can add topics and notes.
    if (ctx.activeSubject && state.subjects.length === 1) navigate('materials');
    else applyRoute();
  }
}

/* ------------------------------------------------------------------ routing */

function applyRoute() {
  const routeKey = currentRoute();
  const route = ROUTES[routeKey];
  const root = document.getElementById('view-root');
  if (!root) return;

  closeMenuOnSmallScreen();

  // Tear down the previous view + its charts before swapping content.
  destroyCharts();
  try {
    state.view?.unmount?.();
  } catch (err) {
    console.warn('View unmount failed:', err);
  }
  state.view = null;
  state.route = routeKey;

  // Update menu highlighting without re-rendering the sidebar.
  document.querySelectorAll('.menu-item[data-route]').forEach((li) => {
    li.classList.toggle('active', li.dataset.route === routeKey);
  });
  document.title = `${route.title} · Study Assistant`;

  // Block subject-dependent views until a subject exists.
  if (SUBJECT_ROUTES.has(routeKey) && state.subjects.length === 0) {
    root.innerHTML = `<div class="card">
      <div class="card-body">${emptySubjectCard()}</div>
    </div>`;
    root.querySelector('#empty-create-subject')?.addEventListener('click', createSubjectFlow);
    return;
  }

  try {
    state.view = route.mount(root, ctx) ?? null;
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="alert alert-danger">Failed to render this page: ${esc(err.message)}</div>`;
  }
}

function emptySubjectCard() {
  return `<div class="text-center py-5">
    <div class="avatar avatar-xl mx-auto mb-3">
      <span class="avatar-initial rounded-circle bg-label-primary"><i class="icon-base bx bx-book-open icon-xl"></i></span>
    </div>
    <h4>Create your first subject</h4>
    <p class="text-body-secondary mb-4">
      A subject holds your topics, uploaded notes, quizzes and analytics.<br />
      Start with one subject, add topics, then upload the material you want to study.
    </p>
    <button class="btn btn-primary" id="empty-create-subject">
      <i class="icon-base bx bx-plus me-1"></i> New subject
    </button>
  </div>`;
}

/* ------------------------------------------------------------------- start */

window.addEventListener('hashchange', () => {
  if (!state.user) return;
  applyRoute();
});

boot();

// Exposed for manual debugging in the console (handy during a demo).
window.__studyAssistant = { state, ctx };
