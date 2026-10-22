/**
 * Materials & Topics — the input side of the system.
 *
 * They live together because material is what RAG retrieves from, and topics are
 * what mastery, quizzes and recommendations are organised around. Without both,
 * nothing downstream has anything to work with.
 *
 * UPLOADS: any file type is accepted. The server detects the real format and
 * returns a clear 422 for files with no extractable text (images, scanned PDFs).
 */

import { api, upload } from '../api.js';
import {
  esc,
  pct,
  formatDateTime,
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
  showModal,
} from '../ui.js';

const SUPPORTED = [
  'PDF*', 'Word .docx', 'PowerPoint .pptx', 'Excel .xlsx', 'OpenDocument',
  'Markdown', 'Text', 'CSV', 'JSON', 'HTML', 'RTF', 'Code',
];

export function mount(root, ctx) {
  let destroyed = false;
  const subject = ctx.activeSubject;

  let materials = [];
  let topics = [];
  let pendingFile = null;
  let uploadTopicId = '';

  (async () => {
    root.innerHTML = skeleton(280);
    await reload();

    async function reload() {
      try {
        const [m, t] = await Promise.all([
          api(`/subjects/${subject.id}/materials`),
          api(`/subjects/${subject.id}/topics`),
        ]);
        if (destroyed || !root.isConnected) return;
        materials = m.materials ?? [];
        topics = t.topics ?? [];
        paint();
      } catch (err) {
        if (!destroyed) root.innerHTML = alertBox(err.message);
      }
    }

    function paint() {
      if (destroyed || !root.isConnected) return;

      root.innerHTML = `
        ${pageHeader(
          'Materials & Topics',
          `Everything the assistant knows about “${subject.name}”`,
          `<button class="btn btn-primary" id="add-topic">${icon('plus', 'me-1')} Add topic</button>`,
        )}

        <div class="row g-4">
          <div class="col-xl-7">
            <div class="card mb-4">
              <div class="card-header"><h5 class="card-title mb-0">Upload study material</h5></div>
              <div class="card-body">
                <form id="upload-form">
                  <div class="upload-drop" id="dropzone" tabindex="0" role="button"
                       aria-label="Choose or drop a file to upload">
                    <div class="avatar avatar-lg mx-auto mb-3">
                      <span class="avatar-initial rounded-circle bg-label-primary">${icon('upload', 'icon-lg')}</span>
                    </div>
                    <div class="fw-medium" id="drop-title">
                      ${pendingFile ? esc(pendingFile.name) : 'Drop a file here, or click to browse'}
                    </div>
                    <div class="text-body-secondary small mt-1" id="drop-hint">
                      ${pendingFile
                        ? `${(pendingFile.size / 1024).toFixed(0)} KB — ready to upload`
                        : 'Any document type. Nothing extra to install.'}
                    </div>
                    <input type="file" id="file-input" hidden />
                  </div>

                  <div class="d-flex flex-wrap gap-2 mt-3">
                    ${SUPPORTED.map((s) => `<span class="badge bg-label-secondary">${esc(s)}</span>`).join('')}
                  </div>
                  <p class="text-body-secondary small mt-2 mb-0">
                    *PDF needs the optional <code>pdf-parse</code> package. Files with no text layer
                    (scanned PDFs, images) are rejected with a clear message.
                  </p>

                  <hr class="my-4" />

                  <div class="row g-3 align-items-end">
                    <div class="col-sm-7">
                      <label class="form-label" for="upload-topic">Attach to topic (optional)</label>
                      <select class="form-select" id="upload-topic">
                        <option value="">No specific topic</option>
                        ${topics
                          .map(
                            (t) => `<option value="${esc(t.id)}" ${t.id === uploadTopicId ? 'selected' : ''}>${esc(t.name)}</option>`,
                          )
                          .join('')}
                      </select>
                    </div>
                    <div class="col-sm-5 d-flex gap-2">
                      <button class="btn btn-primary flex-grow-1" type="submit" id="upload-btn" ${pendingFile ? '' : 'disabled'}>
                        ${icon('upload', 'me-1')} Upload &amp; index
                      </button>
                      ${pendingFile ? `<button class="btn btn-label-secondary" type="button" id="clear-file">Clear</button>` : ''}
                    </div>
                  </div>
                </form>
              </div>
            </div>

            <div class="card">
              <div class="card-header d-flex justify-content-between align-items-center">
                <div>
                  <h5 class="card-title mb-0">Indexed material</h5>
                  <small class="text-body-secondary">${materials.length} file${materials.length === 1 ? '' : 's'} in this subject</small>
                </div>
              </div>
              <div class="card-body">
                ${
                  materials.length === 0
                    ? emptyState('Nothing uploaded yet', 'Drop a file above to make it searchable.', 'file-blank')
                    : `<div class="table-responsive">
                        <table class="table table-hover align-middle mb-0">
                          <thead><tr><th>File</th><th>Status</th><th>Uploaded</th></tr></thead>
                          <tbody>
                            ${materials
                              .map(
                                (m) => `<tr>
                                  <td>
                                    <div class="d-flex align-items-center gap-2">
                                      ${icon('file-blank', 'text-body-secondary')}
                                      <span class="text-truncate" style="max-width:260px" title="${esc(m.filename)}">${esc(m.filename)}</span>
                                    </div>
                                    ${m.error ? `<div class="small text-danger mt-1">${esc(m.error)}</div>` : ''}
                                  </td>
                                  <td>
                                    ${badge(
                                      m.status === 'indexed' ? 'indexed' : m.status,
                                      m.status === 'indexed' ? 'success' : m.status === 'failed' ? 'danger' : 'warning',
                                    )}
                                  </td>
                                  <td class="text-body-secondary small">${esc(formatDateTime(m.uploaded_at))}</td>
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
            <div class="card">
              <div class="card-header d-flex justify-content-between align-items-center">
                <div>
                  <h5 class="card-title mb-0">Topics</h5>
                  <small class="text-body-secondary">Prerequisites shape recommendations</small>
                </div>
                <button class="btn btn-sm btn-label-primary" id="add-topic-inline">${icon('plus', 'me-1')} Add</button>
              </div>
              <div class="card-body">
                ${
                  topics.length === 0
                    ? emptyState('No topics yet', 'Add your first topic, then upload notes for it.', 'book-open')
                    : `<div class="d-flex flex-column gap-3">
                        ${topics
                          .map(
                            (t) => `<div class="topic-row">
                              <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
                                <div class="min-w-0">
                                  <div class="fw-medium text-truncate">
                                    ${t.parent_topic_id ? `<span class="text-body-secondary">↳ </span>` : ''}${esc(t.name)}
                                  </div>
                                  <div class="d-flex flex-wrap gap-1 mt-1">
                                    ${badge(`weight ${t.weight}`, 'secondary')}
                                    ${badge(t.difficulty, t.difficulty === 'hard' ? 'danger' : t.difficulty === 'easy' ? 'success' : 'warning')}
                                    ${badge(`${t.attempts} answer${t.attempts === 1 ? '' : 's'}`, 'secondary')}
                                  </div>
                                </div>
                                ${badge(pct(t.mastery), masteryTone(t.mastery))}
                              </div>
                              ${progressBar(t.mastery, { tone: masteryTone(t.mastery), height: 6 })}
                            </div>`,
                          )
                          .join('')}
                      </div>
                      <p class="text-body-secondary small mt-3 mb-0">
                        A weak prerequisite raises a topic's recommendation priority, so the planner fixes
                        foundations before advanced material.
                      </p>`
                }
              </div>
            </div>
          </div>
        </div>`;

      bind();
    }

    function bind() {
      const dropzone = root.querySelector('#dropzone');
      const fileInput = root.querySelector('#file-input');

      const pick = (file) => {
        if (!file) return;
        pendingFile = file;
        paint();
      };

      dropzone?.addEventListener('click', () => fileInput?.click());
      dropzone?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput?.click();
        }
      });
      dropzone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('is-dragging');
      });
      dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
      dropzone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragging');
        pick(e.dataTransfer?.files?.[0]);
      });
      fileInput?.addEventListener('change', (e) => pick(e.target.files?.[0]));

      root.querySelector('#upload-topic')?.addEventListener('change', (e) => {
        uploadTopicId = e.target.value;
      });

      root.querySelector('#clear-file')?.addEventListener('click', () => {
        pendingFile = null;
        paint();
      });

      root.querySelector('#upload-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!pendingFile) return;

        const button = root.querySelector('#upload-btn');
        const original = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Extracting &amp; indexing…';

        try {
          const form = new FormData();
          form.append('file', pendingFile);
          if (uploadTopicId) form.append('topicId', uploadTopicId);

          const res = await upload(`/subjects/${subject.id}/materials`, form);
          pendingFile = null;
          toast(
            `Indexed "${res.material.filename}" (${res.format}) into ${res.chunkCount} searchable chunks.`,
            'success',
          );
          await reload();
        } catch (err) {
          // 422 means "parsed but unusable"; the server message is user-facing.
          toast(err.message, 'danger');
          button.disabled = false;
          button.innerHTML = original;
          await reload();
        }
      });

      root.querySelector('#add-topic')?.addEventListener('click', addTopicFlow);
      root.querySelector('#add-topic-inline')?.addEventListener('click', addTopicFlow);
    }

    async function addTopicFlow() {
      const created = await showModal({
        title: 'Add a topic',
        okText: 'Add topic',
        body: `<div class="mb-3">
            <label class="form-label" for="topic-name">Topic name</label>
            <input class="form-control" id="topic-name" maxlength="160" placeholder="e.g. Normalization" />
          </div>
          <div class="row g-3">
            <div class="col-sm-6">
              <label class="form-label" for="topic-parent">Prerequisite</label>
              <select class="form-select" id="topic-parent">
                <option value="">No prerequisite</option>
                ${topics.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
              </select>
            </div>
            <div class="col-sm-3">
              <label class="form-label" for="topic-difficulty">Difficulty</label>
              <select class="form-select" id="topic-difficulty">
                <option value="easy">Easy</option>
                <option value="medium" selected>Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div class="col-sm-3">
              <label class="form-label" for="topic-weight">Weight</label>
              <input type="number" class="form-control" id="topic-weight" min="0" max="10" step="0.5" value="1" />
            </div>
          </div>
          <div class="form-text">Higher weight = more important in the syllabus = lifted in recommendations.</div>`,
        onOk: async (modal) => {
          const name = modal.querySelector('#topic-name').value.trim();
          if (!name) {
            modal.querySelector('#topic-name').classList.add('is-invalid');
            return false;
          }
          const body = {
            name,
            parentTopicId: modal.querySelector('#topic-parent').value || null,
            difficulty: modal.querySelector('#topic-difficulty').value,
            weight: Number(modal.querySelector('#topic-weight').value) || 1,
          };
          await api(`/subjects/${subject.id}/topics`, { method: 'POST', body });
          toast(`Topic "${name}" added.`, 'success');
          return true;
        },
      });

      if (created) reload();
    }
  })();

  return {
    unmount() {
      destroyed = true;
    },
  };
}
