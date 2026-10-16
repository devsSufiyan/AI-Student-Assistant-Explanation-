/**
 * <AuthView/> - login and registration.
 *
 * Owns only its own form state; on success it hands the token + user up to App,
 * which is the component that knows what "logged in" means for the whole app.
 */

import React, { useState } from 'react';
import { api } from '../api.js';

export default function AuthView({ onAuthed }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    goal: '',
    examDate: '',
    dailyMinutes: 45,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      // Only send the goal/exam fields on register; login needs just credentials.
      const body =
        mode === 'login'
          ? { email: form.email, password: form.password }
          : {
              name: form.name,
              email: form.email,
              password: form.password,
              goal: form.goal || null,
              examDate: form.examDate || null,
              dailyMinutes: Number(form.dailyMinutes) || 45,
            };
      const { user, token } = await api(path, { method: 'POST', body });
      onAuthed(user, token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h2 style={{ fontSize: 18 }}>🎓 AI Study Assistant</h2>
        <div className="tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create account</button>
        </div>

        {error && <div className="error">{error}</div>}

        <form onSubmit={submit} className="grid" style={{ gap: 10 }}>
          {mode === 'register' && (
            <label>
              <span className="small muted">Name</span>
              <input value={form.name} onChange={set('name')} required />
            </label>
          )}
          <label>
            <span className="small muted">Email</span>
            <input type="email" value={form.email} onChange={set('email')} required />
          </label>
          <label>
            <span className="small muted">Password</span>
            <input type="password" value={form.password} onChange={set('password')} required minLength={6} />
          </label>

          {mode === 'register' && (
            <>
              <label>
                <span className="small muted">Learning goal (optional)</span>
                <input value={form.goal} onChange={set('goal')} placeholder="Pass the DB final" />
              </label>
              <label>
                <span className="small muted">Exam date (optional)</span>
                <input type="date" value={form.examDate} onChange={set('examDate')} />
              </label>
              <label>
                <span className="small muted">Minutes available per day</span>
                <input type="number" min="5" max="600" value={form.dailyMinutes} onChange={set('dailyMinutes')} />
              </label>
            </>
          )}

          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="small muted" style={{ marginTop: 12 }}>
          Demo account: <span className="mono">demo@example.com</span> / <span className="mono">password123</span>
        </p>
      </div>
    </div>
  );
}
