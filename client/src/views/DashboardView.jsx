/**
 * <DashboardView/> - the learning-analytics pillar.
 *
 * Reads three read-only endpoints and renders them without owning any state that
 * other views depend on:
 *   /analytics/overview  -> headline numbers + accuracy trend
 *   /analytics/topics    -> per-topic mastery + forgetting risk
 *   /recommendations     -> the engine's current advice with reasons
 */

import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Stat, Bar, MasteryBadge, Sparkline, EmptyState } from '../components/ui.jsx';

const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;

/** Choose a tone for a mastery bar based on how far along the student is. */
function masteryTone(m) {
  if (m >= 0.85) return 'success';
  if (m >= 0.5) return 'warning';
  return 'danger';
}

export default function DashboardView({ subject }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const q = subject ? `?subjectId=${subject.id}` : '';
        // Fetch all three in parallel - they are independent and this halves latency.
        const [overview, topics, recs] = await Promise.all([
          api(`/analytics/overview${q}`),
          api(`/analytics/topics${q}`),
          api(`/recommendations${q}`),
        ]);
        if (!cancelled) {
          setData({ overview, topics: topics.topics, recs: recs.recommendations });
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    // The `cancelled` flag prevents a stale response from overwriting newer state
    // when the user switches subjects quickly.
    return () => { cancelled = true; };
  }, [subject]);

  if (error) return <div className="error">{error}</div>;
  if (!data) {
    return (
      <>
        <div className="grid cols-4" style={{ marginBottom: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 92 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 220 }} />
      </>
    );
  }

  const { overview } = data;
  const o = overview.overview;

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Exam readiness" value={pct(o.examReadiness)} hint="Weighted mastery across the syllabus" />
        <Stat label="Overall accuracy" value={pct(o.accuracy)} hint={`${o.questionsAnswered} questions answered`} />
        <Stat label="Topics mastered" value={`${o.topicsMastered}/${o.topicsTotal}`} hint="Mastery ≥ 85%" />
        <Stat label="Time on task" value={`${o.minutesOnTask}m`} hint="Total time answering questions" />
      </div>

      <div className="grid cols-2">
        <Card title="Accuracy trend">
          <Sparkline points={overview.trend} />
          <div className="small muted" style={{ marginTop: 8 }}>
            {overview.trend.length > 0
              ? `${overview.trend.length} active day(s) · latest ${pct(overview.trend.at(-1).accuracy)}`
              : 'Attempt a quiz to start building the trend.'}
          </div>
        </Card>

        <Card title="Recommendation follow-through">
          <div className="stat-value">
            {overview.recommendations.rate === null ? '—' : pct(overview.recommendations.rate)}
          </div>
          <div className="stat-label">
            {overview.recommendations.consumed} of {overview.recommendations.shown} suggestions acted on
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            This is live Precision@N: when we recommend a topic, does the student actually practise it?
          </p>
        </Card>
      </div>

      <Card title="Topic mastery & forgetting risk">
        {data.topics.length === 0 ? (
          <EmptyState icon="📚" title="No topics yet" hint="Add topics under Materials to start tracking mastery." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Topic</th>
                <th style={{ width: 200 }}>Mastery</th>
                <th>Level</th>
                <th>Accuracy</th>
                <th>Last practised</th>
                <th>Forgetting risk</th>
              </tr>
            </thead>
            <tbody>
              {data.topics.map((t) => (
                <tr key={t.topicId}>
                  <td>{t.topicName}</td>
                  <td>
                    <div className="row">
                      <div style={{ flex: 1 }}>
                        <Bar value={t.mastery} tone={masteryTone(t.mastery)} />
                      </div>
                      <span className="small muted" style={{ width: 38, textAlign: 'right' }}>{pct(t.mastery)}</span>
                    </div>
                  </td>
                  <td><MasteryBadge label={t.label} /></td>
                  <td>{t.accuracy === null ? '—' : pct(t.accuracy)}</td>
                  <td className="small muted">
                    {t.daysSincePractice === null ? 'never' : `${t.daysSincePractice.toFixed(0)}d ago`}
                  </td>
                  <td>
                    {t.dueForReview
                      ? <span className="badge amber">due for review</span>
                      : <span className="badge green">ok</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Why these topics, right now">
        {data.recs.length === 0
          ? <EmptyState icon="✨" title="No recommendations yet" hint="Take a quiz and the engine will suggest what to study next." />
          : data.recs.map((r) => (
              <div key={r.id} style={{ marginBottom: 14 }}>
                <div className="row">
                  <strong>{r.topicName}</strong>
                  <span className="badge">score {r.score.toFixed(2)}</span>
                </div>
                <div className="small muted">{r.reason}</div>
                {/* Show the raw weighted terms: this is the explainability payoff. */}
                <div className="small mono muted" style={{ marginTop: 4 }}>
                  {Object.entries(r.breakdown.terms)
                    .map(([k, v]) => `${k}:${v.toFixed(3)}`)
                    .join('  ')}
                </div>
              </div>
            ))}
      </Card>
    </>
  );
}
