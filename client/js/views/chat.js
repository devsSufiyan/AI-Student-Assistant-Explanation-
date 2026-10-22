/**
 * Ask Questions — the RAG-based academic assistant.
 *
 * The view is intentionally thin: it sends a question, renders the grounded
 * answer, and SHOWS THE CITATIONS. Sources are not decoration — they are how the
 * student verifies that the answer came from their own material.
 *
 * Conversations are kept in memory per subject, so switching subjects does not
 * mix answers that were retrieved from different material.
 *
 * XSS: every piece of server/user text is inserted with `textContent`, never
 * `innerHTML`. The answer body can therefore contain anything safely.
 */

import { api } from '../api.js';
import {
  esc,
  pageHeader,
  cardShell,
  icon,
  alertBox,
  skeleton,
  toast,
} from '../ui.js';

const conversations = new Map(); // subjectId -> message[]
const SUGGESTIONS = [
  'Summarise the key ideas in my notes',
  'What is a B-tree and why is it used?',
  'Explain the ACID properties',
  'What is the difference between a clustered and non-clustered index?',
];

export function mount(root, ctx) {
  let destroyed = false;

  (async () => {
    const subject = ctx.activeSubject;
    if (!subject) return;

    root.innerHTML = skeleton(280);
    if (destroyed || !root.isConnected) return;

    paint();
  })();

  function paint() {
    const subject = ctx.activeSubject;
    if (!subject) return;

    if (!conversations.has(subject.id)) conversations.set(subject.id, []);
    const messages = conversations.get(subject.id);

    root.innerHTML = `
      ${pageHeader(
        'Ask Questions',
        `Answers are built only from the material in “${subject.name}”, with citations.`,
        `<button class="btn btn-label-primary" id="clear-chat">${icon('refresh', 'me-1')} Clear chat</button>
         <a class="btn btn-label-primary" href="#/materials">${icon('folder', 'me-1')} Materials</a>`,
      )}

      <div class="row g-4">
        <div class="col-xl-8">
          <div class="card chat-card">
            <div class="card-header d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-center gap-2">
                <div class="avatar avatar-sm">
                  <span class="avatar-initial rounded-circle bg-label-success">${icon('brain')}</span>
                </div>
                <div>
                  <h5 class="card-title mb-0">Study assistant</h5>
                  <small class="text-body-secondary">Retrieval-augmented — refuses when the notes do not cover it</small>
                </div>
              </div>
              <span class="badge bg-label-secondary" id="provider-badge">grounded</span>
            </div>

            <div class="chat-log" id="chat-log" aria-live="polite"></div>

            <div class="card-body border-top" id="chat-suggestions">
              <p class="text-body-secondary small mb-2">Try one of these:</p>
              <div class="d-flex flex-wrap gap-2">
                ${SUGGESTIONS.map(
                  (s) => `<button type="button" class="btn btn-sm btn-label-primary" data-suggestion="${esc(s)}">${esc(s)}</button>`,
                ).join('')}
              </div>
            </div>

            <div class="card-body border-top">
              <form id="chat-form" class="d-flex gap-2 align-items-end">
                <div class="flex-grow-1">
                  <label for="chat-input" class="visually-hidden">Your question</label>
                  <input type="text" class="form-control" id="chat-input" maxlength="500" autocomplete="off"
                         placeholder="e.g. What is a B-tree and why is it used?" />
                </div>
                <button class="btn btn-primary" type="submit" id="chat-send">${icon('message-rounded-dots', 'me-1')} Ask</button>
              </form>
              <div class="mt-2" id="chat-error"></div>
            </div>
          </div>
        </div>

        <div class="col-xl-4">
          ${cardShell({
            title: 'How this stays honest',
            body: `<ol class="ps-3 mb-0 small text-body-secondary d-flex flex-column gap-2">
              <li>Your question is embedded and matched against chunks of your own uploaded notes.</li>
              <li>The most relevant chunks are diversified (MMR) and passed to the answer provider.</li>
              <li>If retrieval is weak, the assistant refuses instead of inventing an answer.</li>
              <li>Every answer lists the exact source excerpts and similarity scores.</li>
            </ol>`,
          })}
          <div class="mt-4">
            ${cardShell({
              title: 'Citation key',
              body: `<div class="d-flex flex-column gap-2 small text-body-secondary">
                <div><span class="badge bg-label-primary me-2">match</span> cosine similarity of the retrieved chunk</div>
                <div><span class="badge bg-label-secondary me-2">chunk</span> short id of the stored chunk</div>
                <div><span class="badge bg-label-info me-2">page</span> present when the document has page data</div>
              </div>`,
            })}
          </div>
        </div>
      </div>`;

    const log = root.querySelector('#chat-log');
    const form = root.querySelector('#chat-form');
    const input = root.querySelector('#chat-input');
    const send = root.querySelector('#chat-send');
    const errorSlot = root.querySelector('#chat-error');
    const suggestions = root.querySelector('#chat-suggestions');

    messages.forEach((m) => log.appendChild(messageElement(m)));
    updateSuggestions();
    scrollToBottom();

    root.querySelector('#clear-chat')?.addEventListener('click', () => {
      conversations.set(subject.id, []);
      paint();
      toast('Conversation cleared.', 'info');
    });

    root.querySelectorAll('[data-suggestion]').forEach((btn) => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.suggestion;
        submit();
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });

    function updateSuggestions() {
      const empty = conversations.get(subject.id).length === 0;
      suggestions.classList.toggle('d-none', !empty);
    }

    function scrollToBottom() {
      log.scrollTop = log.scrollHeight;
    }

    async function submit() {
      const question = input.value.trim();
      if (!question) {
        input.focus();
        return;
      }

      const list = conversations.get(subject.id);
      list.push({ role: 'user', text: question });
      log.appendChild(messageElement({ role: 'user', text: question }));
      updateSuggestions();
      input.value = '';
      errorSlot.innerHTML = '';

      // Typing indicator is removed as soon as the response (or error) lands.
      const typing = document.createElement('div');
      typing.className = 'chat-row assistant';
      typing.innerHTML = `<div class="chat-avatar bg-label-success">${icon('brain')}</div>
        <div class="chat-bubble assistant"><span class="typing"><i></i><i></i><i></i></span></div>`;
      log.appendChild(typing);
      scrollToBottom();

      input.disabled = true;
      send.disabled = true;
      try {
        const result = await api('/rag/query', {
          method: 'POST',
          body: { subjectId: subject.id, question },
        });
        if (destroyed || !root.isConnected) return;

        typing.remove();
        const assistant = { role: 'assistant', ...result };
        list.push(assistant);
        log.appendChild(messageElement(assistant));

        const provider = root.querySelector('#provider-badge');
        if (provider && result.provider) provider.textContent = result.provider;
        scrollToBottom();
      } catch (err) {
        if (destroyed || !root.isConnected) return;
        typing.remove();
        errorSlot.innerHTML = alertBox(err.message);
        // Put the question back so the student does not have to retype it.
        input.value = question;
        toast(err.message, 'danger');
      } finally {
        input.disabled = false;
        send.disabled = false;
        input.focus();
      }
    }
  }

  /** Build one chat row safely with DOM APIs. */
  function messageElement(message) {
    const row = document.createElement('div');
    row.className = `chat-row ${message.role}`;

    const avatar = document.createElement('div');
    avatar.className = `chat-avatar ${message.role === 'user' ? 'bg-label-primary' : 'bg-label-success'}`;
    avatar.innerHTML = icon(message.role === 'user' ? 'user' : 'brain');

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${message.role}${message.refused ? ' refused' : ''}`;

    const body = document.createElement('div');
    body.className = 'chat-text';
    body.textContent = message.text ?? message.answer ?? '';
    bubble.appendChild(body);

    if (message.role === 'assistant' && message.refused) {
      const note = document.createElement('div');
      note.className = 'chat-refusal-note';
      note.textContent = 'Nothing in your material covered this, so no answer was invented.';
      bubble.appendChild(note);
    }

    if (message.citations?.length) {
      const sources = document.createElement('div');
      sources.className = 'chat-sources';

      const label = document.createElement('div');
      label.className = 'chat-sources-label';
      label.textContent = `Sources (${message.citations.length})`;
      sources.appendChild(label);

      for (const citation of message.citations) {
        const item = document.createElement('div');
        item.className = 'chat-citation';

        const quote = document.createElement('div');
        quote.className = 'chat-quote';
        quote.textContent = `“${citation.quote ?? ''}”`;
        item.appendChild(quote);

        const meta = document.createElement('div');
        meta.className = 'chat-citation-meta';
        const bits = [];
        if (citation.score !== undefined) bits.push(`match ${citation.score}`);
        if (citation.page) bits.push(`page ${citation.page}`);
        if (citation.chunkId) bits.push(`chunk ${String(citation.chunkId).slice(0, 8)}`);
        meta.textContent = bits.join(' · ');
        item.appendChild(meta);

        sources.appendChild(item);
      }
      bubble.appendChild(sources);
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    return row;
  }

  return {
    unmount() {
      destroyed = true;
    },
  };
}
