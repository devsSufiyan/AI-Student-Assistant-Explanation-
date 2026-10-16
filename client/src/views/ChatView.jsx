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
import { Card } from '../components/ui.jsx';

export default function ChatView({ subject }) {
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
  }, [messages]);

  const ask = async (e) => {
    e.preventDefault();
    const q = question.trim();
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`Ask about ${subject?.name ?? 'your material'}`}>
      <div className="chat-log" ref={logRef} style={{ maxHeight: 460, overflowY: 'auto' }}>
        {messages.length === 0 && (
          <p className="muted">
            Ask a question and the assistant will answer using only your uploaded
            material, citing the exact sources it used.
          </p>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="bubble user">{m.text}</div>
          ) : (
            <div key={i} className={`bubble assistant ${m.refused ? 'refused' : ''}`}>
              <div>{m.answer}</div>
              {m.citations?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="small muted">Sources:</div>
                  {m.citations.map((c, j) => (
                    <div key={j} className="citation">
                      <div className="small">“{c.quote}”</div>
                      <div className="small muted">
                        score {c.score} {c.page ? `· page ${c.page}` : ''} · chunk {c.chunkId.slice(0, 8)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {m.refused && <div className="small muted" style={{ marginTop: 6 }}>No grounded answer was found.</div>}
            </div>
          ),
        )}
        {busy && <div className="bubble assistant muted">Thinking…</div>}
      </div>

      {error && <div className="error">{error}</div>}

      <form className="row" onSubmit={ask}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What is a B-tree and why is it used?"
          disabled={busy}
        />
        <button className="primary" type="submit" disabled={busy || !question.trim()}>Ask</button>
      </form>
    </Card>
  );
}
