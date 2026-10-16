/**
 * <QuizView/> - the adaptive tutoring pillar, end to end.
 *
 * FLOW
 *   choose topic -> (generate questions if none) -> start attempt
 *   -> server serves the NEXT question (client never picks it)
 *   -> student answers -> immediate feedback + mastery delta
 *   -> repeat until the server says done -> summary
 *
 * The client shows the server's `meta.predictedSuccess` for each question so the
 * adaptation is visible: watch the predicted success hover near 0.6 as the
 * engine targets the zone of proximal development.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Bar } from '../components/ui.jsx';

export default function QuizView({ subject, onDataChange }) {
  const [topics, setTopics] = useState([]);
  const [topicId, setTopicId] = useState('');
  const [questionCount, setQuestionCount] = useState(0);
  const [mode, setMode] = useState('adaptive');

  const [attempt, setAttempt] = useState(null);
  const [current, setCurrent] = useState(null); // { question, meta, progress }
  const [feedback, setFeedback] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Load topics whenever the subject changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAttempt(null); setCurrent(null); setFeedback(null); setSummary(null); setNotice('');
      if (!subject) return;
      const { topics: list } = await api(`/subjects/${subject.id}/topics`);
      if (cancelled) return;
      setTopics(list);
      setTopicId(list[0]?.id ?? '');
    })();
    return () => { cancelled = true; };
  }, [subject]);

  // Check how many questions already exist for the chosen topic.
  useEffect(() => {
    if (!topicId) return;
    api(`/quiz/topics/${topicId}/questions/count`)
      .then((r) => setQuestionCount(r.count))
      .catch(() => setQuestionCount(0));
  }, [topicId]);

  const generate = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await api('/quiz/generate', { method: 'POST', body: { topicId, count: 6 } });
      setQuestionCount((c) => c + res.created);
      setNotice(res.created > 0
        ? `Generated ${res.created} questions using the "${res.provider}" provider.`
        : res.reason ?? 'No questions could be generated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true); setError(''); setSummary(null); setFeedback(null);
    try {
      const { attempt: a } = await api('/quiz/attempts', { method: 'POST', body: { topicId, mode } });
      setAttempt(a);
      await loadNext(a.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const loadNext = async (attemptId = attempt?.id) => {
    setFeedback(null);
    const res = await api(`/quiz/attempts/${attemptId}/next`);
    if (res.done) {
      // No questions left: go straight to the graded summary instead of clearing
      // the question and stranding the student with no way to finish.
      await finish(attemptId);
    } else {
      setCurrent(res);
    }
  };

  const answer = async (selectedIndex) => {
    if (feedback) return; // already answered this question
    setBusy(true); setError('');
    try {
      const { feedback: fb } = await api(`/quiz/attempts/${attempt.id}/answer`, {
        method: 'POST',
        body: { questionId: current.question.id, selectedIndex, timeMs: 12000 },
      });
      setFeedback({ ...fb, selectedIndex });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (attemptId = attempt?.id) => {
    setBusy(true);
    try {
      const { attempt: final } = await api(`/quiz/attempts/${attemptId}/finish`, { method: 'POST' });
      setSummary(final);
      setAttempt(null);
      setCurrent(null);
      setFeedback(null);
      onDataChange?.(); // refresh sidebar mastery counts
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Practice setup">
        {topics.length === 0 ? (
          <p className="muted">Add topics under Materials first.</p>
        ) : (
          <div className="row wrap">
            <select value={topicId} onChange={(e) => setTopicId(e.target.value)} style={{ width: 240 }}>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (mastery {Math.round(t.mastery * 100)}%)
                </option>
              ))}
            </select>

            <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ width: 200 }}>
              <option value="adaptive">Adaptive (targets your level)</option>
              <option value="fixed">Fixed order (control)</option>
            </select>

            <button onClick={generate} disabled={busy}>Generate questions</button>
            <button className="primary" onClick={start} disabled={busy || questionCount === 0}>
              Start quiz
            </button>
            <span className="small muted">
              {questionCount} question{questionCount === 1 ? '' : 's'} available
            </span>
          </div>
        )}

        {notice && <div className="notice" style={{ marginTop: 12 }}>{notice}</div>}
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      </Card>

      {current && (
        <Card
          title={`Question ${current.progress.answered + 1} of ${current.progress.total}`}
          right={
            current.meta && (
              <span className="small muted">
                predicted success {Math.round(current.meta.predictedSuccess * 100)}% · ability {current.meta.ability}
              </span>
            )
          }
        >
          <p style={{ fontWeight: 600 }}>{current.question.stem}</p>

          {current.question.options.map((opt, i) => {
            // Colour states only after the answer is submitted, otherwise the
            // student has no way to know which they picked.
            let cls = 'option';
            if (feedback) {
              if (i === feedback.correctIndex) cls += ' correct';
              else if (i === feedback.selectedIndex) cls += ' wrong';
            }
            return (
              <button key={i} className={cls} onClick={() => answer(i)} disabled={!!feedback || busy}>
                <span className="key">{String.fromCharCode(65 + i)}</span>
                <span>{opt}</span>
              </button>
            );
          })}

          {feedback && (
            <div style={{ marginTop: 12 }}>
              <div className={feedback.isCorrect ? 'notice' : 'error'}>
                {feedback.isCorrect ? '✓ Correct' : '✗ Not quite'}
                {' — '}
                mastery {Math.round(feedback.masteryBefore * 100)}% → {Math.round(feedback.masteryAfter * 100)}%
                {' '}({feedback.masteryDelta >= 0 ? '+' : ''}{feedback.masteryDelta})
              </div>
              {feedback.explanation && (
                <div className="small muted">From your material: “{feedback.explanation}”</div>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="primary" onClick={() => loadNext()} disabled={busy}>Next question</button>
                <button onClick={() => finish()} disabled={busy}>Finish & grade</button>
              </div>
            </div>
          )}
        </Card>
      )}

      {summary && (
        <Card title="Attempt summary">
          <div className="stat-value">{summary.correct} / {summary.total}</div>
          <div className="stat-label">Accuracy {Math.round(summary.accuracy * 100)}%</div>
          <div style={{ maxWidth: 320, marginTop: 10 }}>
            <Bar value={summary.accuracy} tone={summary.accuracy >= 0.7 ? 'success' : summary.accuracy >= 0.4 ? 'warning' : 'danger'} />
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Your mastery has been updated, and today's plan and recommendations have been re-derived from it.
          </p>
        </Card>
      )}
    </>
  );
}
