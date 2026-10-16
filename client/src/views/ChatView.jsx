/**
 * <ChatView/> - the RAG-based academic assistant.
 *
 * The component is deliberately thin: it sends a question, renders the grounded
 * answer, and SHOWS THE CITATIONS. Displaying sources is not decoration - it is
 * how the student verifies the answer came from their own material, and how a
 * marker can see the RAG pipeline working.
 */

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Card, EmptyState } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';

// A few starter questions make the empty chat less intimidating than a blank box.
const SUGGESTIONS = [
  'Summarise the key ideas in my notes',
  'What is a B-tree and why is it used?',
  'Explain the ACID properties',
  'What is the difference between a clustered and non-clustered index?',
];

export default function ChatView({ subject }) {
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);

  // Clear the conversation when the student switches subject - answers are only
  // meaningful in the context of the material they were retrieved from.
  useEffect(() => {
    setMessages([]);
    setError('');
  }, [subject?.id]);

  // Keep the newest message in view.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const ask = async (e, preset) => {
    e?.preventDefault();
    const q = (preset ?? question).trim();
    if (!q || busy) return;

    setMessages((m) => [...m, { role: 'user', text: q }]);
    setQuestion('');
    setBusy(true);
    setError('');

    try {
      const res = await api('/rag/query', {
        method: 'POST',
        body: { subjectId: subject.id, question: q },
      });
      setMessages((m) => [...m, { role: 'assistant', ...res }]);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`Ask about ${subject?.name ?? 'your material'}`}>
      <div className="chat-log" ref={logRef} style={{ maxHeight: 440, overflowY: 'auto' }}>
        {messages.length === 0 && (
          <EmptyState
            icon="💬"
            title="Ask anything from your notes"
            hint="Answers are built only from your uploaded material, with the exact sources cited."
          />
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="bubble user">{m.text}</div>
          ) : (
            <div key={i} className={`bubble assistant ${m.refused ? 'refused' : ''}`}>
              <div>{m.answer}</div>
              {m.citations?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="small muted" style={{ marginBottom: 4 }}>
                    Sources ({m.citations.length})
                  </div>
                  {m.citations.map((c, j) => (
                    <div key={j} className="citation">
                      <div>“{c.quote}”</div>
                      <div className="small muted" style={{ marginTop: 3 }}>
                        match {c.score}{c.page ? ` · page ${c.page}` : ''} · chunk {c.chunkId.slice(0, 8)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {m.refused && (
                <div className="small muted" style={{ marginTop: 6 }}>
                  Nothing in your material covered this, so no answer was invented.
                </div>
              )}
            </div>
          ),
        )}

        {busy && (
          <div className="bubble assistant">
            <span className="typing"><i /><i /><i /></span>
          </div>
        )}
      </div>

      {messages.length === 0 && (
        <div className="chips" style={{ marginBottom: 14 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" style={{ cursor: 'pointer', border: 'none' }} onClick={(e) => ask(e, s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <form className="row" onSubmit={(e) => ask(e)}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What is a B-tree and why is it used?"
          disabled={busy}
          aria-label="Your question"
        />
        <button className="primary" type="submit" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
    </Card>
  );
}
