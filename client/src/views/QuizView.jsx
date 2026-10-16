/**
 * <QuizView/> - the adaptive tutoring pillar, end to end.
 *
 * THREE PHASES
 *   setup  -> choose topic, question mode, generate/start
 *   quiz   -> the server serves the next question; client shows live feedback
 *   review -> after finishing, a full breakdown: every question, what you chose,
 *             the correct answer, WHY (the source sentence), and the mastery
 *             change per question
 *
 * The review is fetched from the server AFTER the attempt is finished, so the
 * answer key is never present in the browser during the quiz.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Bar, EmptyState } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const DIFF_TONE = { easy: 'green', medium: 'amber', hard: 'red' };

export default function QuizView({ subject, onDataChange }) {
  const toast = useToast();

  const [topics, setTopics] = useState([]);
  const [topicId, setTopicId] = useState('');
  const [questionCount, setQuestionCount] = useState(0);
  const [mode, setMode] = useState('adaptive');

  const [phase, setPhase] = useState('setup'); // setup | quiz | review
  const [attempt, setAttempt] = useState(null);
  const [current, setCurrent] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [review, setReview] = useState(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Load topics whenever the subject changes; reset everything.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      resetToSetup();
      if (!subject) return;
      const { topics: list } = await api(`/subjects/${subject.id}/topics`);
      if (cancelled) return;
      setTopics(list);
      setTopicId(list[0]?.id ?? '');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject?.id]);

  // Refresh the available-question count when the topic changes.
  useEffect(() => {
    if (!topicId) return;
    api(`/quiz/topics/${topicId}/questions/count`)
      .then((r) => setQuestionCount(r.count))
      .catch(() => setQuestionCount(0));
  }, [topicId]);

  function resetToSetup() {
    setPhase('setup');
    setAttempt(null);
    setCurrent(null);
    setFeedback(null);
    setReview(null);
    setError('');
  }

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api('/quiz/generate', { method: 'POST', body: { topicId, count: 6 } });
      setQuestionCount((c) => c + res.created);
      if (res.created > 0) {
        toast.success(`Generated ${res.created} new question${res.created === 1 ? '' : 's'}.`);
      } else {
        toast.info(res.reason ?? 'No new questions could be generated from this material.');
      }
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const loadNext = async (attemptId) => {
    setFeedback(null);
    const res = await api(`/quiz/attempts/${attemptId}/next`);
    if (res.done) {
      // No questions left: go to the graded review instead of clearing the panel.
      await finish(attemptId);
    } else {
      setCurrent(res);
    }
  };

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const { attempt: a } = await api('/quiz/attempts', { method: 'POST', body: { topicId, mode } });
      setAttempt(a);
      setPhase('quiz');
      await loadNext(a.id);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const answer = async (selectedIndex) => {
    if (feedback || busy) return;
    setBusy(true);
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

  const finish = async (attemptId) => {
    setBusy(true);
    try {
      await api(`/quiz/attempts/${attemptId}/finish`, { method: 'POST' });
      // Pull the full review with answers + reasons now that grading is done.
      const data = await api(`/quiz/attempts/${attemptId}/review`);
      setReview(data);
      setCurrent(null);
      setFeedback(null);
      setPhase('review');
      onDataChange?.();
      toast.success(`Quiz complete — ${data.summary.correct}/${data.summary.total} correct.`);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const retake = () => {
    // Keep the chosen topic/mode, go straight back into the quiz.
    setReview(null);
    setPhase('setup');
    start();
  };

  const activeTopic = topics.find((t) => t.id === topicId);

  // ---------------------------------------------------------------- setup ---
  if (phase === 'setup') {
    return (
      <>
        <Card title="Start a practice quiz">
          {topics.length === 0 ? (
            <EmptyState
              icon="📝"
              title="No topics yet"
              hint="Add topics under Materials, then upload notes to generate questions."
            />
          ) : (
            <>
              <div className="grid cols-3">
                <label>
                  <span className="small muted">Topic</span>
                  <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {Math.round(t.mastery * 100)}% mastery
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="small muted">Question mode</span>
                  <select value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="adaptive">Adaptive — targets your level</option>
                    <option value="fixed">Fixed order — control mode</option>
                  </select>
                </label>
                <label>
                  <span className="small muted">Available questions</span>
                  <div className="row" style={{ height: 42 }}>
                    <span className="badge grey">{questionCount} ready</span>
                    {activeTopic && (
                      <span className="small muted">
                        mastery {Math.round(activeTopic.mastery * 100)}%
                      </span>
                    )}
                  </div>
                </label>
              </div>

              <div className="row wrap" style={{ marginTop: 16 }}>
                <button className="primary" onClick={start} disabled={busy || questionCount === 0}>
                  {busy ? 'Starting…' : '▶ Start quiz'}
                </button>
                <button onClick={generate} disabled={busy}>
                  {busy ? 'Working…' : '✨ Generate questions'}
                </button>
                {questionCount === 0 && (
                  <span className="small muted">
                    Generate questions first — they are created from your uploaded material.
                  </span>
                )}
              </div>

              {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
            </>
          )}
        </Card>

        <Card title="How adaptive mode works">
          <p className="small muted" style={{ margin: 0 }}>
            Each question is chosen so your likelihood of answering it correctly is close to
            <strong> 60%</strong> — hard enough to teach you something, easy enough to stay
            motivating. Answer correctly and the questions get harder; miss one and they ease off.
            Your mastery of the topic is updated after every single answer.
          </p>
        </Card>
      </>
    );
  }

  // ----------------------------------------------------------------- quiz ---
  if (phase === 'quiz' && current) {
    const { question, meta, progress } = current;
    const pctDone = progress.total > 0 ? progress.answered / progress.total : 0;

    return (
      <Card
        title={`Question ${progress.answered + 1} of ${progress.total}`}
        right={meta && <span className="badge grey">predicted success {Math.round(meta.predictedSuccess * 100)}%</span>}
      >
        <div className="quiz-progress">
          <div style={{ flex: 1 }}><Bar value={pctDone} thin /></div>
          <span className="small muted">{Math.round(pctDone * 100)}%</span>
        </div>

        <p style={{ fontWeight: 600, fontSize: 15.5, margin: '14px 0 16px' }}>{question.stem}</p>

        {question.options.map((opt, i) => {
          let cls = 'option';
          if (feedback) {
            if (i === feedback.correctIndex) cls += ' correct';
            else if (i === feedback.selectedIndex) cls += ' wrong';
          }
          return (
            <button key={i} className={cls} onClick={() => answer(i)} disabled={!!feedback || busy}>
              <span className="key">{LETTERS[i]}</span>
              <span>{opt}</span>
            </button>
          );
        })}

        {feedback && (
          <div className={`feedback ${feedback.isCorrect ? 'ok' : 'no'}`}>
            <span className="fb-ico">{feedback.isCorrect ? '✓' : '✗'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {feedback.isCorrect ? 'Correct' : 'Not quite — here is the answer'}
              </div>
              {feedback.explanation && (
                <div className="small" style={{ marginTop: 4, color: 'var(--text-2)' }}>
                  {feedback.explanation}
                </div>
              )}
              <div className="small muted" style={{ marginTop: 6 }}>
                Topic mastery {Math.round(feedback.masteryBefore * 100)}% →{' '}
                {Math.round(feedback.masteryAfter * 100)}%
                {' '}
                <span className={`mastery-delta ${feedback.masteryDelta >= 0 ? 'up' : 'down'}`}>
                  {feedback.masteryDelta >= 0 ? '+' : ''}{(feedback.masteryDelta * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {feedback && (
          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" onClick={() => loadNext(attempt.id)} disabled={busy}>
              Next question →
            </button>
            <button onClick={() => finish(attempt.id)} disabled={busy}>Finish & see results</button>
          </div>
        )}
      </Card>
    );
  }

  // --------------------------------------------------------------- review ---
  if (phase === 'review' && review) {
    const { summary, questions } = review;
    const pct = Math.round(summary.accuracy * 100);

    return (
      <>
        <div className="score-hero">
          <div className="score-ring" style={{ '--pct': `${pct}%` }}>
            <div className="score-inner">
              <b>{pct}%</b>
              <span>score</span>
            </div>
          </div>
          <h2>
            {summary.correct} of {summary.total} correct
          </h2>
          <p>
            {pct >= 80 ? 'Excellent work!' : pct >= 50 ? 'Good effort — review the misses below.' : 'Keep going — the explanations below will help.'}
          </p>
          {summary.masteryGain !== null && (
            <p style={{ marginTop: 8 }}>
              Mastery {Math.round(summary.masteryStart * 100)}% → {Math.round(summary.masteryEnd * 100)}%
              {' '}
              <span className={`mastery-delta ${summary.masteryGain >= 0 ? 'up' : 'down'}`}>
                {summary.masteryGain >= 0 ? '+' : ''}{(summary.masteryGain * 100).toFixed(1)}%
              </span>
            </p>
          )}
        </div>

        <Card title="Breakdown by difficulty" right={<span className="badge grey">{review.attempt.mode} mode</span>}>
          <div className="row wrap">
            {Object.entries(summary.byDifficulty).map(([level, s]) => (
              <div key={level} className="row" style={{ gap: 8, minWidth: 160 }}>
                <span className={`badge ${DIFF_TONE[level] ?? 'grey'}`}>{level}</span>
                <div style={{ flex: 1, minWidth: 90 }}>
                  <Bar value={s.total ? s.correct / s.total : 0} thin tone={s.correct === s.total ? 'success' : 'warning'} />
                </div>
                <span className="small muted">{s.correct}/{s.total}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Answer review">
          {questions.map((q, i) => (
            <div key={q.questionId} className={`review-item ${q.isCorrect ? '' : 'missed'}`}>
              <div className="q-head">
                <span className="q-num">{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div className="q-stem">{q.stem}</div>
                </div>
                <span className={`badge ${DIFF_TONE[q.difficulty] ?? 'grey'}`}>{q.difficulty}</span>
              </div>

              {q.options.map((opt, oi) => {
                const isCorrect = oi === q.correctIndex;
                const isChosen = oi === q.selectedIndex;
                if (!isCorrect && !isChosen) return null; // show only what matters
                const cls = isCorrect ? 'answer-row correct' : 'answer-row wrong';
                return (
                  <div key={oi} className={cls}>
                    <span className="mark">{isCorrect ? '✓' : '✗'}</span>
                    <span style={{ flex: 1 }}>{opt}</span>
                    <span className="small muted">
                      {isCorrect ? 'Correct answer' : 'Your answer'}
                    </span>
                  </div>
                );
              })}

              {/* THE REASON: sourced from the student's own material. */}
              <div className="reason">
                <div className="reason-label">
                  {q.isCorrect ? 'Why this is right' : 'Why the answer is different'}
                </div>
                <div>
                  {q.explanation
                    ? q.explanation
                    : q.sourceText
                      ? q.sourceText
                      : 'No explanation was stored for this question.'}
                </div>
              </div>
            </div>
          ))}
        </Card>

        <div className="row">
          <button className="primary" onClick={retake} disabled={busy}>Retake quiz</button>
          <button onClick={resetToSetup}>Choose another topic</button>
        </div>
      </>
    );
  }

  // Fallback (e.g. the topic had no questions at all).
  return (
    <Card title="Practice quiz">
      <EmptyState
        icon="🧠"
        title="No questions available"
        hint="Upload material for this topic, then generate questions."
      />
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="primary" onClick={resetToSetup}>Back to setup</button>
      </div>
      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
    </Card>
  );
}
