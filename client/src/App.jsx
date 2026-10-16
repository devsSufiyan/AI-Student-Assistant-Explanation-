/**
 * <App/> - application shell.
 *
 * STATE OWNERSHIP
 *   App owns the things that are truly global: the logged-in user, the subject
 *   list, which subject is selected, and which view is active. Everything else
 *   is local to a view. No Redux/Context needed at this size - plain props keep
 *   the data flow obvious.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import AuthView from './views/AuthView.jsx';
import DashboardView from './views/DashboardView.jsx';
import ChatView from './views/ChatView.jsx';
import QuizView from './views/QuizView.jsx';
import MaterialsView from './views/MaterialsView.jsx';
import PlanView from './views/PlanView.jsx';

const VIEWS = [
  { key: 'dashboard', label: '📊 Dashboard' },
  { key: 'plan', label: "🗓 Today's Plan" },
  { key: 'chat', label: '💬 Ask Questions' },
  { key: 'quiz', label: '🧠 Practice Quiz' },
  { key: 'materials', label: '📁 Materials' },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState('dashboard');

  const [subjects, setSubjects] = useState([]);
  const [activeSubjectId, setActiveSubjectId] = useState(null);
  const [newSubject, setNewSubject] = useState('');
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [error, setError] = useState('');

  const activeSubject = subjects.find((s) => s.id === activeSubjectId) ?? null;

  /** Load the subject list and keep the current selection valid. */
  const refreshSubjects = useCallback(async () => {
    const { subjects: list } = await api('/subjects');
    setSubjects(list);
    setActiveSubjectId((current) => {
      if (current && list.some((s) => s.id === current)) return current;
      return list[0]?.id ?? null;
    });
    return list;
  }, []);

  // Bootstrap: if a token exists, verify it and load the user's subjects.
  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setBooting(false);
        return;
      }
      try {
        const { user: me } = await api('/auth/me');
        setUser(me);
        await refreshSubjects();
      } catch {
        // Expired/invalid token: clear it and fall back to the login screen.
        setToken(null);
      } finally {
        setBooting(false);
      }
    })();
  }, [refreshSubjects]);

  const handleAuthed = async (nextUser, token) => {
    setToken(token);
    setUser(nextUser);
    setBooting(false);
    await refreshSubjects();
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setSubjects([]);
    setActiveSubjectId(null);
  };

  const createSubject = async (e) => {
    e.preventDefault();
    if (!newSubject.trim()) return;
    try {
      const { subject } = await api('/subjects', { method: 'POST', body: { name: newSubject } });
      setNewSubject('');
      setShowNewSubject(false);
      await refreshSubjects();
      setActiveSubjectId(subject.id);
    } catch (err) {
      setError(err.message);
    }
  };

  if (booting) return <div className="auth-wrap"><span className="muted">Loading…</span></div>;
  if (!user) return <AuthView onAuthed={handleAuthed} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">🎓 Study Assistant</div>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={`nav-item ${view === v.key ? 'active' : ''}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
        <div className="spacer" />
        <button className="nav-item" onClick={logout}>↩ Sign out</button>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{VIEWS.find((v) => v.key === view)?.label}</h1>
          <div className="spacer" />
          {subjects.length > 0 && (
            <select
              value={activeSubjectId ?? ''}
              onChange={(e) => setActiveSubjectId(e.target.value)}
              style={{ width: 220 }}
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          {showNewSubject ? (
            <form className="row" onSubmit={createSubject}>
              <input
                autoFocus
                placeholder="Subject name"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                style={{ width: 180 }}
              />
              <button className="primary" type="submit">Add</button>
            </form>
          ) : (
            <button onClick={() => setShowNewSubject(true)}>+ Subject</button>
          )}
        </header>

        <main className="content">
          {error && <div className="error" onClick={() => setError('')}>{error}</div>}

          {/* A subject is required for material/quiz/chat, so we gate those views. */}
          {!activeSubject && view !== 'dashboard' && view !== 'plan' ? (
            <div className="card">
              <h2>Create a subject first</h2>
              <p className="muted">Upload material under a subject, then ask questions and take quizzes against it.</p>
            </div>
          ) : (
            <>
              {view === 'dashboard' && <DashboardView subject={activeSubject} user={user} />}
              {view === 'plan' && <PlanView subject={activeSubject} />}
              {view === 'chat' && <ChatView subject={activeSubject} />}
              {view === 'quiz' && <QuizView subject={activeSubject} onDataChange={refreshSubjects} />}
              {view === 'materials' && (
                <MaterialsView subject={activeSubject} onDataChange={refreshSubjects} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
