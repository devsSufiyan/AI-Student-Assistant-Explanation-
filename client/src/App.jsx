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
import { ToastProvider } from './components/Toast.jsx';
import AuthView from './views/AuthView.jsx';
import DashboardView from './views/DashboardView.jsx';
import ChatView from './views/ChatView.jsx';
import QuizView from './views/QuizView.jsx';
import MaterialsView from './views/MaterialsView.jsx';
import PlanView from './views/PlanView.jsx';

const VIEWS = [
  { key: 'dashboard', icon: '📊', label: 'Dashboard' },
  { key: 'plan', icon: '🗓️', label: "Today's Plan" },
  { key: 'chat', icon: '💬', label: 'Ask Questions' },
  { key: 'quiz', icon: '🧠', label: 'Practice Quiz' },
  { key: 'materials', icon: '📁', label: 'Materials' },
];

function Shell() {
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

  if (booting) {
    return (
      <div className="auth-wrap">
        <div style={{ width: 260 }}>
          <div className="skeleton" style={{ height: 20, marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 20, width: '70%' }} />
        </div>
      </div>
    );
  }
  if (!user) return <AuthView onAuthed={handleAuthed} />;

  const activeView = VIEWS.find((v) => v.key === view);
  // Views that operate on a subject's material cannot work without one.
  const needsSubject = ['chat', 'quiz', 'materials'].includes(view);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">🎓</div>
          <span className="brand-text">Study Assistant</span>
        </div>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={`nav-item ${view === v.key ? 'active' : ''}`}
            onClick={() => setView(v.key)}
          >
            <span className="nav-ico">{v.icon}</span>
            {v.label}
          </button>
        ))}
        <div className="spacer" />
        <button className="nav-item" onClick={logout}>
          <span className="nav-ico">↩</span>
          Sign out
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{activeView?.icon} {activeView?.label}</h1>
          <div className="spacer" />
          {subjects.length > 0 && (
            <select
              value={activeSubjectId ?? ''}
              onChange={(e) => setActiveSubjectId(e.target.value)}
              style={{ width: 210 }}
              aria-label="Select subject"
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
                style={{ width: 170 }}
              />
              <button className="primary" type="submit">Add</button>
              <button type="button" className="ghost" onClick={() => setShowNewSubject(false)}>✕</button>
            </form>
          ) : (
            <button onClick={() => setShowNewSubject(true)}>+ Subject</button>
          )}
        </header>

        <main className="content">
          {error && <div className="error" onClick={() => setError('')}>{error}</div>}

          {needsSubject && !activeSubject ? (
            <div className="card">
              <div className="empty">
                <div className="empty-ico">📚</div>
                <div className="empty-title">Create a subject to get started</div>
                <div className="small" style={{ marginTop: 4 }}>
                  Upload your notes under a subject, then ask questions and take quizzes against them.
                </div>
                <button className="primary" style={{ marginTop: 14 }} onClick={() => setShowNewSubject(true)}>
                  + New subject
                </button>
              </div>
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

export default function App() {
  // ToastProvider wraps the shell so any view can raise a notification.
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
