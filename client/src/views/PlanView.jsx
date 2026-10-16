/**
 * <PlanView/> - the personalized-learning pillar.
 *
 * Renders today's timetable produced by the planner, plus the ranked
 * recommendations with their human-readable reasons. The "Regenerate" button
 * makes the pipeline observable: change your mastery by taking a quiz, come
 * back, regenerate, and watch the plan respond.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Bar } from '../components/ui.jsx';

const ACTIVITY_ICON = { quiz: '🧠', read: '📖', review: '🔁' };

export default function PlanView() {
  const [plan, setPlan] = useState(null);
  const [recs, setRecs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [p, r] = await Promise.all([api('/plan'), api('/recommendations')]);
      setPlan(p.plan);
      setRecs(r.recommendations);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const regenerate = async () => {
    setBusy(true);
    try {
      await api('/recommendations/regenerate', { method: 'POST', body: {} });
      const { plan: fresh } = await api('/plan/regenerate', { method: 'POST', body: {} });
      setPlan(fresh);
      const { recommendations } = await api('/recommendations');
      setRecs(recommendations);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="error">{error}</div>;
  if (!plan) return <div className="muted">Building today's plan…</div>;

  return (
    <>
      <Card
        title={`Today's plan (${plan.plan_date})`}
        right={<button onClick={regenerate} disabled={busy}>{busy ? 'Rebuilding…' : 'Regenerate'}</button>}
      >
        {plan.items.length === 0 ? (
          <p className="muted">
            Nothing scheduled. Add material and take a quiz so the engine has data to plan from.
          </p>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="bar" style={{ flex: 1 }}>
                <span style={{ width: '100%' }} />
              </div>
              <span className="small muted">{plan.total_minutes} min total</span>
            </div>

            {plan.items.map((item, i) => (
              <div key={i} className="card" style={{ marginBottom: 10, boxShadow: 'none' }}>
                <div className="row">
                  <span style={{ fontSize: 18 }}>{ACTIVITY_ICON[item.activity] ?? '📌'}</span>
                  <div>
                    <strong>{item.topicName}</strong>
                    <div className="small muted">{item.reason}</div>
                  </div>
                  <div className="spacer" />
                  <span className="badge">{item.minutes} min</span>
                  <span className="badge">{item.activity}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </Card>

      <Card title="Ranked recommendations">
        {recs.length === 0 ? (
          <p className="muted">No recommendations yet.</p>
        ) : (
          recs.map((r) => (
            <div key={r.id} style={{ marginBottom: 16 }}>
              <div className="row">
                <strong>{r.topicName}</strong>
                <span className="badge">priority {r.score.toFixed(2)}</span>
                <div className="spacer" />
                <span className="small muted">mastery {Math.round(r.mastery * 100)}%</span>
              </div>
              <div style={{ maxWidth: 420, margin: '6px 0' }}>
                <Bar value={r.mastery} />
              </div>
              <div className="small muted">{r.reason}</div>
            </div>
          ))
        )}
      </Card>
    </>
  );
}
