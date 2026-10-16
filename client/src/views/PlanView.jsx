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
import { Card, Bar, EmptyState } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';

const ACTIVITY = {
  quiz: { icon: '🧠', label: 'Practice quiz' },
  read: { icon: '📖', label: 'Read / review' },
  review: { icon: '🔁', label: 'Spaced review' },
};

export default function PlanView() {
  const toast = useToast();
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
      toast.success("Today's plan was rebuilt from your latest progress.");
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="error">{error}</div>;
  if (!plan) return <div className="skeleton" style={{ height: 240 }} />;

  const totalPlanned = Math.max(plan.total_minutes, 1);

  return (
    <>
      <Card
        title={`Today's plan · ${plan.plan_date}`}
        right={<button onClick={regenerate} disabled={busy}>{busy ? 'Rebuilding…' : '↻ Regenerate'}</button>}
      >
        {plan.items.length === 0 ? (
          <EmptyState
            icon="🗓️"
            title="Nothing scheduled yet"
            hint="Add material and take a quiz so the planner has data to work from."
          />
        ) : (
          <>
            <div className="row" style={{ marginBottom: 16 }}>
              <span className="badge">{plan.total_minutes} min total</span>
              <span className="badge grey">{plan.items.length} blocks</span>
              <div className="spacer" />
              <span className="small muted">Fits your daily budget</span>
            </div>

            {plan.items.map((item, i) => {
              const meta = ACTIVITY[item.activity] ?? { icon: '📌', label: item.activity };
              return (
                <div key={i} className="card" style={{ marginBottom: 10, boxShadow: 'none' }}>
                  <div className="row">
                    <span style={{ fontSize: 20 }}>{meta.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <strong>{item.topicName}</strong>
                        <span className="badge grey">{meta.label}</span>
                      </div>
                      <div className="small muted" style={{ marginTop: 2 }}>{item.reason}</div>
                    </div>
                    <div style={{ width: 120 }}>
                      <Bar value={item.minutes / totalPlanned} thin />
                    </div>
                    <span className="badge">{item.minutes} min</span>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </Card>

      <Card title="Ranked recommendations">
        {recs.length === 0 ? (
          <EmptyState icon="✨" title="No recommendations yet" hint="They appear once there is mastery data to reason about." />
        ) : (
          recs.map((r) => (
            <div key={r.id} style={{ marginBottom: 18 }}>
              <div className="row">
                <strong>{r.topicName}</strong>
                <span className="badge">priority {r.score.toFixed(2)}</span>
                <div className="spacer" />
                <span className="small muted">mastery {Math.round(r.mastery * 100)}%</span>
              </div>
              <div style={{ maxWidth: 440, margin: '7px 0' }}>
                <Bar value={r.mastery} thin />
              </div>
              <div className="small muted">{r.reason}</div>
            </div>
          ))
        )}
      </Card>
    </>
  );
}
