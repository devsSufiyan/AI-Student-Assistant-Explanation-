/**
 * <MaterialsView/> - upload material and manage the topic tree.
 *
 * These two things live together because they are the INPUT side of the system:
 * material is what RAG retrieves from, and topics are what mastery, quizzes and
 * recommendations are organised around. Without both, nothing downstream works.
 */

import React, { useEffect, useState } from 'react';
import { api, upload } from '../api.js';
import { Card, Bar, MasteryBadge } from '../components/ui.jsx';

export default function MaterialsView({ subject, onDataChange }) {
  const [materials, setMaterials] = useState([]);
  const [topics, setTopics] = useState([]);
  const [file, setFile] = useState(null);
  const [uploadTopicId, setUploadTopicId] = useState('');
  const [newTopic, setNewTopic] = useState({ name: '', parentTopicId: '', weight: 1, difficulty: 'medium' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const reload = async () => {
    const [m, t] = await Promise.all([
      api(`/subjects/${subject.id}/materials`),
      api(`/subjects/${subject.id}/topics`),
    ]);
    setMaterials(m.materials);
    setTopics(t.topics);
  };

  useEffect(() => {
    setNotice(''); setError('');
    reload().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject?.id]);

  const onUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const form = new FormData();
      form.append('file', file);
      if (uploadTopicId) form.append('topicId', uploadTopicId);
      const res = await upload(`/subjects/${subject.id}/materials`, form);
      setNotice(`Indexed "${res.material.filename}" into ${res.chunkCount} searchable chunks.`);
      setFile(null);
      e.target.reset();
      await reload();
      onDataChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addTopic = async (e) => {
    e.preventDefault();
    if (!newTopic.name.trim()) return;
    setBusy(true); setError('');
    try {
      await api(`/subjects/${subject.id}/topics`, {
        method: 'POST',
        body: {
          name: newTopic.name,
          parentTopicId: newTopic.parentTopicId || null,
          weight: Number(newTopic.weight) || 1,
          difficulty: newTopic.difficulty,
        },
      });
      setNewTopic({ name: '', parentTopicId: '', weight: 1, difficulty: 'medium' });
      await reload();
      onDataChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error">{error}</div>}

      <Card title="Upload study material">
        <p className="small muted">
          Text and Markdown are supported out of the box. PDF also works if you install <span className="mono">pdf-parse</span>.
        </p>
        <form className="row wrap" onSubmit={onUpload}>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ width: 280 }}
            accept=".txt,.md,.markdown,.csv,.pdf,text/plain,application/pdf"
          />
          <select value={uploadTopicId} onChange={(e) => setUploadTopicId(e.target.value)} style={{ width: 220 }}>
            <option value="">No specific topic</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="primary" type="submit" disabled={busy || !file}>
            {busy ? 'Indexing…' : 'Upload & index'}
          </button>
        </form>
      </Card>

      <Card title="Add a topic">
        <form className="row wrap" onSubmit={addTopic}>
          <input
            placeholder="Topic name"
            value={newTopic.name}
            onChange={(e) => setNewTopic((t) => ({ ...t, name: e.target.value }))}
            style={{ width: 220 }}
          />
          <select
            value={newTopic.parentTopicId}
            onChange={(e) => setNewTopic((t) => ({ ...t, parentTopicId: e.target.value }))}
            style={{ width: 200 }}
          >
            <option value="">No prerequisite</option>
            {topics.map((t) => <option key={t.id} value={t.id}>Prereq: {t.name}</option>)}
          </select>
          <select
            value={newTopic.difficulty}
            onChange={(e) => setNewTopic((t) => ({ ...t, difficulty: e.target.value }))}
            style={{ width: 130 }}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <input
            type="number" min="0" max="10" step="0.5"
            value={newTopic.weight}
            onChange={(e) => setNewTopic((t) => ({ ...t, weight: e.target.value }))}
            style={{ width: 100 }}
            title="Syllabus weight"
          />
          <button className="primary" type="submit" disabled={busy}>Add topic</button>
        </form>
        <p className="small muted" style={{ marginTop: 8 }}>
          Prerequisites matter: a weak prerequisite raises a topic's recommendation priority, so the planner
          fixes foundations before advanced material.
        </p>
      </Card>

      <Card title="Topics">
        {topics.length === 0 ? (
          <p className="muted">No topics yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Topic</th><th style={{ width: 180 }}>Mastery</th><th>Level</th><th>Attempts</th><th>Weight</th></tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.id}>
                  <td>{t.parent_topic_id ? '↳ ' : ''}{t.name}</td>
                  <td>
                    <div className="row">
                      <div style={{ flex: 1 }}><Bar value={t.mastery} /></div>
                      <span className="small muted" style={{ width: 36, textAlign: 'right' }}>
                        {Math.round(t.mastery * 100)}%
                      </span>
                    </div>
                  </td>
                  <td><MasteryBadge label={t.mastery >= 0.85 ? 'mastered' : t.mastery >= 0.65 ? 'proficient' : t.mastery >= 0.4 ? 'developing' : 'novice'} /></td>
                  <td>{t.attempts}</td>
                  <td>{t.weight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Indexed material">
        {materials.length === 0 ? (
          <p className="muted">Nothing uploaded yet.</p>
        ) : (
          <table>
            <thead><tr><th>File</th><th>Status</th><th>Uploaded</th></tr></thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id}>
                  <td>{m.filename}</td>
                  <td>
                    <span className={`badge ${m.status === 'indexed' ? 'green' : 'red'}`}>{m.status}</span>
                    {m.error && <div className="small muted">{m.error}</div>}
                  </td>
                  <td className="small muted">{new Date(m.uploaded_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
