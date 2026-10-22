/**
 * Shared UI helpers.
 *
 * Everything here is plain JavaScript. Two rules are enforced:
 *
 *   1. NEVER interpolate API/user data into HTML without `esc()`.
 *      The old React client escaped automatically; a vanilla client must do it
 *      explicitly, otherwise notes/questions become an XSS vector.
 *   2. Charts are tracked so a route change can destroy them. ApexCharts keeps
 *      listeners on window resize; leaking instances on every navigation would
 *      slowly degrade the page.
 */

/* ------------------------------------------------------------------ escaping */

/** Escape a value for safe insertion into HTML text or a quoted attribute. */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** Escape a string for use inside a single-quoted JS string in an inline handler. */
export function escAttr(value) {
  return esc(value).replaceAll('\n', ' ');
}

/* ------------------------------------------------------------------- format */

export function pct(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function signedPct(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
}

export function num(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const target = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

export function relativeDays(value) {
  if (value === null || value === undefined || value === '') return 'never';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'never';
  if (n < 1) return 'today';
  if (n < 2) return '1 day ago';
  return `${Math.round(n)} days ago`;
}

/* --------------------------------------------------------------- visual bits */

/** Sneat's brand mark, reused by the sidebar and the auth card. */
export const BRAND_LOGO = `
<span class="app-brand-logo demo">
  <span class="text-primary">
    <svg width="25" viewBox="0 0 25 42" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <path d="M13.7918663,0.358365126 L3.39788168,7.44174259 C0.566865006,9.69408886 -0.379795268,12.4788597 0.557900856,15.7960551 C0.68998853,16.2305145 1.09562888,17.7872135 3.12357076,19.2293357 C3.8146334,19.7207684 5.32369333,20.3834223 7.65075054,21.2172976 L7.59773219,21.2525164 L2.63468769,24.5493413 C0.445452254,26.3002124 0.0884951797,28.5083815 1.56381646,31.1738486 C2.83770406,32.8170431 5.20850219,33.2640127 7.09180128,32.5391577 C8.347334,32.0559211 11.4559176,30.0011079 16.4175519,26.3747182 C18.0338572,24.4997857 18.6973423,22.4544883 18.4080071,20.2388261 C17.963753,17.5346866 16.1776345,15.5799961 13.0496516,14.3747546 L10.9194936,13.4715819 L18.6192054,7.984237 L13.7918663,0.358365126 Z" id="path-1"></path>
        <path d="M5.47320593,6.00457225 C4.05321814,8.216144 4.36334763,10.0722806 6.40359441,11.5729822 C8.61520715,12.571656 10.0999176,13.2171421 10.8577257,13.5094407 L15.5088241,14.433041 L18.6192054,7.984237 C15.5364148,3.11535317 13.9273018,0.573395879 13.7918663,0.358365126 C13.5790555,0.511491653 10.8061687,2.3935607 5.47320593,6.00457225 Z" id="path-3"></path>
        <path d="M7.50063644,21.2294429 L12.3234468,23.3159332 C14.1688022,24.7579751 14.397098,26.4880487 13.008334,28.506154 C11.6195701,30.5242593 10.3099883,31.790241 9.07958868,32.3040991 C5.78142938,33.4346997 4.13234973,34 4.13234973,34 C4.13234973,34 2.75489982,33.0538207 2.37032616e-14,31.1614621 C-0.55822714,27.8186216 -0.55822714,26.0572515 -4.05231404e-15,25.8773518 C0.83734071,25.6075023 2.77988457,22.8248993 3.3049379,22.52991 C3.65497346,22.3332504 5.05353963,21.8997614 7.50063644,21.2294429 Z" id="path-4"></path>
        <path d="M20.6,7.13333333 L25.6,13.8 C26.2627417,14.6836556 26.0836556,15.9372583 25.2,16.6 C24.8538077,16.8596443 24.4327404,17 24,17 L14,17 C12.8954305,17 12,16.1045695 12,15 C12,14.5672596 12.1403557,14.1461923 12.4,13.8 L17.4,7.13333333 C18.0627417,6.24967773 19.3163444,6.07059163 20.2,6.73333333 C20.3516113,6.84704183 20.4862915,6.981722 20.6,7.13333333 Z" id="path-5"></path>
      </defs>
      <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g transform="translate(-27.000000, -15.000000)">
          <g transform="translate(27.000000, 15.000000)">
            <g transform="translate(0.000000, 8.000000)">
              <mask id="brand-mask" fill="white"><use xlink:href="#path-1"></use></mask>
              <use fill="currentColor" xlink:href="#path-1"></use>
              <g mask="url(#brand-mask)">
                <use fill="currentColor" xlink:href="#path-3"></use>
                <use fill-opacity="0.2" fill="#FFFFFF" xlink:href="#path-3"></use>
              </g>
              <g mask="url(#brand-mask)">
                <use fill="currentColor" xlink:href="#path-4"></use>
                <use fill-opacity="0.2" fill="#FFFFFF" xlink:href="#path-4"></use>
              </g>
            </g>
            <g transform="translate(19.000000, 11.000000) rotate(-300.000000) translate(-19.000000, -11.000000)">
              <use fill="currentColor" xlink:href="#path-5"></use>
              <use fill-opacity="0.2" fill="#FFFFFF" xlink:href="#path-5"></use>
            </g>
          </g>
        </g>
      </g>
    </svg>
  </span>
</span>`;

/** The Sneat logo + product name. */
export function brand(name = 'Study Assistant') {
  return `<a href="#/dashboard" class="app-brand-link gap-2">
    ${BRAND_LOGO}
    <span class="app-brand-text demo text-heading fw-bold">${esc(name)}</span>
  </a>`;
}

export function icon(name, extra = '') {
  return `<i class="icon-base bx bx-${esc(name)} ${extra}" aria-hidden="true"></i>`;
}

export function masteryLabel(mastery) {
  if (mastery >= 0.85) return 'mastered';
  if (mastery >= 0.65) return 'proficient';
  if (mastery >= 0.4) return 'developing';
  return 'novice';
}

/** Bootstrap contextual colour for a mastery value. */
export function masteryTone(mastery) {
  if (mastery >= 0.85) return 'success';
  if (mastery >= 0.5) return 'warning';
  return 'danger';
}

export function difficultyTone(difficulty) {
  return { easy: 'success', medium: 'warning', hard: 'danger' }[difficulty] ?? 'secondary';
}

export function badge(text, tone = 'secondary', extra = '') {
  return `<span class="badge bg-label-${esc(tone)} ${extra}">${esc(text)}</span>`;
}

export function masteryBadge(mastery) {
  return badge(masteryLabel(mastery), masteryTone(mastery));
}

/** A thin Bootstrap progress bar; `value` is 0..1. */
export function progressBar(value, { tone = 'primary', height = 8, showLabel = false } = {}) {
  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  const percent = Math.round(clamped * 100);
  return `<div class="d-flex align-items-center gap-2">
    <div class="progress flex-grow-1" style="height:${height}px" role="progressbar"
         aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-bar bg-${esc(tone)}" style="width:${percent}%"></div>
    </div>
    ${showLabel ? `<small class="text-body-secondary" style="min-width:38px;text-align:right">${percent}%</small>` : ''}
  </div>`;
}

/** Sneat-style metric card. */
export function statCard({ label, value, hint, iconName = 'bar-chart-alt-2', tone = 'primary' }) {
  return `<div class="card h-100">
    <div class="card-body">
      <div class="d-flex align-items-start justify-content-between mb-3">
        <div class="avatar flex-shrink-0">
          <span class="avatar-initial rounded bg-label-${esc(tone)}">${icon(iconName, 'icon-lg')}</span>
        </div>
      </div>
      <p class="mb-1 text-body-secondary">${esc(label)}</p>
      <h4 class="mb-1">${esc(value)}</h4>
      ${hint ? `<small class="text-body-secondary">${esc(hint)}</small>` : ''}
    </div>
  </div>`;
}

export function pageHeader(title, subtitle = '', actions = '') {
  return `<div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
    <div>
      <h4 class="mb-1">${esc(title)}</h4>
      ${subtitle ? `<p class="text-body-secondary mb-0">${esc(subtitle)}</p>` : ''}
    </div>
    ${actions ? `<div class="d-flex flex-wrap gap-2">${actions}</div>` : ''}
  </div>`;
}

export function emptyState(title, hint = '', iconName = 'folder', actionHtml = '') {
  return `<div class="text-center py-5">
    <div class="avatar avatar-xl mx-auto mb-3">
      <span class="avatar-initial rounded-circle bg-label-primary">${icon(iconName, 'icon-xl')}</span>
    </div>
    <h5 class="mb-1">${esc(title)}</h5>
    ${hint ? `<p class="text-body-secondary mb-3">${esc(hint)}</p>` : ''}
    ${actionHtml}
  </div>`;
}

export function alertBox(message, tone = 'danger', dismissible = true) {
  return `<div class="alert alert-${esc(tone)} ${dismissible ? 'alert-dismissible' : ''}" role="alert">
    ${esc(message)}
    ${dismissible ? '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>' : ''}
  </div>`;
}

export function cardShell({ title = '', subtitle = '', body = '', actions = '', className = '', bodyClass = '' }) {
  return `<div class="card ${esc(className)}">
    ${title || actions ? `<div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
      <div>
        ${title ? `<h5 class="card-title mb-0">${esc(title)}</h5>` : ''}
        ${subtitle ? `<small class="text-body-secondary">${esc(subtitle)}</small>` : ''}
      </div>
      ${actions ? `<div class="d-flex flex-wrap gap-2">${actions}</div>` : ''}
    </div>` : ''}
    <div class="card-body ${esc(bodyClass)}">${body}</div>
  </div>`;
}

export function skeleton(height = 120) {
  return `<div class="card"><div class="card-body"><div class="placeholder-glow">
    <span class="placeholder col-12 rounded" style="height:${height}px;display:block"></span>
  </div></div></div>`;
}

/* ------------------------------------------------------------------- toasts */

/**
 * Show a Bootstrap toast. Kinds: success, danger, warning, info.
 * Messages are escaped because they can come from server error responses.
 */
export function toast(message, kind = 'success', delay = 4500) {
  const root = document.getElementById('toast-root');
  if (!root) return;

  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${kind} border-0`;
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', 'assertive');
  el.setAttribute('aria-atomic', 'true');
  el.innerHTML = `<div class="d-flex">
      <div class="toast-body">${esc(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>`;
  root.appendChild(el);

  const instance = window.bootstrap?.Toast
    ? new window.bootstrap.Toast(el, { delay })
    : null;
  if (instance) instance.show();
  else el.classList.add('show');

  el.addEventListener('hidden.bs.toast', () => el.remove());
  // Fallback removal if Bootstrap failed to load.
  setTimeout(() => el.remove(), delay + 1000);
}

/* ------------------------------------------------------------------- modals */

/**
 * Open a Bootstrap modal and resolve when it closes.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.body       safe HTML (caller escapes dynamic data)
 * @param {string} [options.okText]
 * @param {string} [options.cancelText]
 * @param {string} [options.okClass]
 * @param {(modal: HTMLElement) => boolean|Promise<boolean>} [options.onOk]
 *        Return `false` to keep the modal open (e.g. validation failed).
 * @returns {Promise<boolean>} true when the primary action succeeded
 */
export function showModal({
  title,
  body,
  okText = 'Save',
  cancelText = 'Cancel',
  okClass = 'btn-primary',
  onOk = null,
}) {
  return new Promise((resolve) => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<div class="modal fade" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">${esc(title)}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div data-modal-alert></div>
            ${body}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-label-secondary" data-bs-dismiss="modal">${esc(cancelText)}</button>
            <button type="button" class="btn ${esc(okClass)}" data-modal-ok>${esc(okText)}</button>
          </div>
        </div>
      </div>
    </div>`;

    const modalEl = wrapper.firstElementChild;
    document.body.appendChild(modalEl);

    // Only ever one dialog at a time. Because the element is moved out of the
    // wrapper above (not cloned), removal must target `modalEl` itself —
    // removing `wrapper` would leave an orphaned dialog in <body> whose stale
    // buttons still answer `document.querySelector('.modal …')`.
    const modal = window.bootstrap?.Modal ? new window.bootstrap.Modal(modalEl) : null;
    let succeeded = false;
    let settled = false;

    const okBtn = modalEl.querySelector('[data-modal-ok]');
    const alertSlot = modalEl.querySelector('[data-modal-alert]');

    function finish() {
      if (settled) return;
      settled = true;
      modalEl.remove();
      resolve(succeeded);
    }

    for (const open of document.querySelectorAll('.modal')) {
      if (open !== modalEl) window.bootstrap?.Modal?.getInstance(open)?.hide();
    }

    okBtn.addEventListener('click', async () => {
      if (!onOk) {
        succeeded = true;
        if (modal) modal.hide();
        else finish();
        return;
      }
      const original = okBtn.innerHTML;
      okBtn.disabled = true;
      okBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Working…';
      alertSlot.innerHTML = '';
      try {
        const result = await onOk(modalEl);
        if (result !== false) {
          succeeded = true;
          if (modal) modal.hide();
          else finish();
        }
      } catch (err) {
        alertSlot.innerHTML = alertBox(err.message || 'Something went wrong.');
      } finally {
        okBtn.disabled = false;
        okBtn.innerHTML = original;
      }
    });

    modalEl.addEventListener('hidden.bs.modal', finish);

    if (modal) {
      modal.show();
    } else {
      // Extremely defensive fallback when Bootstrap's JS is unavailable.
      succeeded = window.confirm(title);
      finish();
    }
  });
}

/* ------------------------------------------------------------------- charts */

const charts = [];

/** Create + track an ApexChart. Returns null when ApexCharts is unavailable. */
export function mountChart(element, options) {
  if (!element || !window.ApexCharts) return null;
  const chart = new window.ApexCharts(element, options);
  chart.render();
  charts.push(chart);
  return chart;
}

/** Destroy every chart created by the previous view. */
export function destroyCharts() {
  while (charts.length) {
    try {
      charts.pop().destroy();
    } catch {
      /* already gone */
    }
  }
}

/** Shared ApexCharts theme values for a consistent dashboard look. */
export function chartTheme() {
  const c = window.config?.colors ?? {};
  return {
    primary: c.primary ?? '#696cff',
    success: c.success ?? '#71dd37',
    warning: c.warning ?? '#ffab00',
    danger: c.danger ?? '#ff3e1d',
    info: c.info ?? '#03c3ec',
    textMuted: c.textMuted ?? '#a1acb8',
    border: c.borderColor ?? '#e7e7e8',
    fontFamily: c.fontFamily ?? 'Public Sans, sans-serif',
  };
}

/** Accuracy trend area chart. `points` = [{day, accuracy, total}]. */
export function accuracyTrendChart(element, points) {
  if (!element) return;
  const theme = chartTheme();
  if (!points || points.length === 0) {
    element.innerHTML = emptyState(
      'No attempts yet',
      'Take a quiz and your daily accuracy will appear here.',
      'trending-up',
    );
    return;
  }

  const data = points.map((p) => Math.round(p.accuracy * 100));
  mountChart(element, {
    chart: {
      type: 'area',
      height: 260,
      toolbar: { show: false },
      fontFamily: theme.fontFamily,
      parentHeightOffset: 0,
    },
    series: [{ name: 'Accuracy', data }],
    colors: [theme.primary],
    stroke: { curve: 'smooth', width: 3 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05, stops: [0, 90, 100] },
    },
    dataLabels: { enabled: false },
    grid: { borderColor: theme.border, strokeDashArray: 4, padding: { left: 8, right: 8 } },
    xaxis: {
      categories: points.map((p) =>
        new Date(`${p.day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      ),
      labels: { style: { colors: theme.textMuted } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      min: 0,
      max: 100,
      labels: {
        style: { colors: theme.textMuted },
        formatter: (v) => `${Math.round(v)}%`,
      },
    },
    tooltip: {
      y: { formatter: (v) => `${Math.round(v)}%` },
      theme: 'light',
    },
    markers: { size: 4, strokeColors: '#fff', strokeWidth: 2, hover: { size: 6 } },
  });
}

/** Radial gauge for exam readiness. `value` is 0..1. */
export function readinessChart(element, value) {
  if (!element) return;
  const theme = chartTheme();
  const percent = Math.round((Number(value) || 0) * 100);
  mountChart(element, {
    chart: { type: 'radialBar', height: 260, fontFamily: theme.fontFamily, sparkline: { enabled: true } },
    series: [percent],
    colors: [theme.primary],
    plotOptions: {
      radialBar: {
        hollow: { size: '62%' },
        track: { background: theme.border, strokeWidth: '100%' },
        dataLabels: {
          name: { show: true, fontSize: '15px', color: theme.textMuted, offsetY: 24 },
          value: {
            show: true,
            fontSize: '32px',
            fontWeight: 600,
            color: theme.primary,
            offsetY: -10,
            formatter: (v) => `${Math.round(v)}%`,
          },
        },
      },
    },
    labels: ['Ready'],
  });
}

/** Horizontal bars for per-topic mastery. */
export function masteryBarChart(element, topics) {
  if (!element) return;
  const theme = chartTheme();
  if (!topics || topics.length === 0) {
    element.innerHTML = emptyState('No topics yet', 'Add topics and take a quiz to see mastery.', 'bar-chart-alt-2');
    return;
  }
  mountChart(element, {
    chart: { type: 'bar', height: Math.max(220, topics.length * 46), fontFamily: theme.fontFamily, toolbar: { show: false } },
    series: [{ name: 'Mastery', data: topics.map((t) => Math.round((t.mastery ?? 0) * 100)) }],
    colors: [theme.primary],
    plotOptions: {
      bar: { horizontal: true, borderRadius: 4, barHeight: '55%', distributed: true },
    },
    dataLabels: {
      enabled: true,
      formatter: (v) => `${v}%`,
      style: { fontSize: '11px', fontWeight: 500 },
    },
    legend: { show: false },
    grid: { borderColor: theme.border, strokeDashArray: 4, xaxis: { lines: { show: true } } },
    xaxis: {
      max: 100,
      // For horizontal bars ApexCharts reads categories from xaxis, not yaxis.
      categories: topics.map((t) => t.topicName ?? t.name ?? ''),
      labels: { style: { colors: theme.textMuted }, formatter: (v) => `${Math.round(v)}%` },
      axisBorder: { show: false },
    },
    yaxis: { labels: { style: { colors: theme.textMuted } } },
    tooltip: { y: { formatter: (v) => `${v}%` }, theme: 'light' },
  });
}

/* ------------------------------------------------------------------ controls */

/** Toggle a button into a loading state and restore it afterwards. */
export async function withLoading(button, work, label = 'Working…') {
  if (!button) return work();
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>${esc(label)}`;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

/** Disable/enable a button without changing its label. */
export function setDisabled(button, disabled) {
  if (button) button.disabled = Boolean(disabled);
}
