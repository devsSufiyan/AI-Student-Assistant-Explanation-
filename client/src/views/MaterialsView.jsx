/**
 * <MaterialsView/> - upload material and manage the topic tree.
 *
 * These two things live together because they are the INPUT side of the system:
 * material is what RAG retrieves from, and topics are what mastery, quizzes and
 * recommendations are organised around. Without both, nothing downstream works.
 *
 * UPLOADS: any file type is accepted. The server detects the real format and
 * returns a clear error for files with no extractable text (images, scanned
 * PDFs), which we surface as a toast instead of a silent failure.
 */

import React, { useEffect, useRef, useState } from 'react';
import { api, upload } from '../api.js';
import { Card, Bar, MasteryBadge, EmptyState } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';

// Shown as hint chips so the user knows what works before uploading.
const SUPPORTED = [
  'PDF', 'Word .docx', 'PowerPoint .pptx', 'Excel .xlsx',
  'OpenDocument', 'Markdown', 'Text', 'CSV', 'JSON', 'HTML', 'RTF', 'Code',
];

export default function MaterialsView({ subject, onDataChange }) {
  const toast = useToast();

  const [materials, setMaterials] = useState([]);
  const [topics, setTopics] = useState([]);
  const [file, setFile] = useState(null);
  const [uploadTopicId, setUploadTopicId] = useState('');
  const [drag, setDrag] = useState(false);
  const [newTopic, setNewTopic] = useState({ name: '', parentTopicId: '', weight: 1, difficulty: 'medium' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const reload = async () => {
    const [m, t] = await Promise.all([
      api(`/subjects/${subject.id}/materials`),
      api(`/subjects/${subject.id}/topics`),
    ]);
    setMaterials(m.materials);
    setTopics(t.topics);
  };

  useEffect(() => {
    setError('');
    setFile(null);
    reload().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject?.id]);

  /** Accept a dropped/selected file and show it for confirmation. */
  const pickFile = (f) => {
    if (!f) return;
    setFile(f);
    setError('');
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    pickFile(e.dataTransfer.files?.[0]);
  };

  const onUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      if (uploadTopicId) form.append('topicId', uploadTopicId);

      const res = await upload(`/subjects/${subject.id}/materials`, form);
      toast.success(
        `Indexed "${res.material.filename}" (${res.format}) into ${res.chunkCount} searchable chunks.`,
      );
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await reload();
      onDataChange?.();
    } catch (err) {
      // 422 means "parsed but unusable" - the server's message is user-facing.
      setError(err.message);
      toast.error(err.message);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const addTopic = async (e) => {
    e.preventDefault();
    if (!newTopic.name.trim()) return;
    setBusy(true);
    setError('');
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
      toast.success(`Topic "${newTopic.name}" added.`);
      setNewTopic({ name: '', parentTopicId: '', weight: 1, difficulty: 'medium' });
      await reload();
      onDataChange?.();
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <div className="error">{error}</div>}

      <Card title="Upload study material">
        <form onSubmit={onUpload}>
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
          >
            <div className="dz-ico">📄</div>
            <div className="dz-title">
              {file ? file.name : 'Drop a file here, or click to browse'}
            </div>
            <div className="dz-hint">
              {file
                ? `${(file.size / 1024).toFixed(0)} KB — ready to upload`
                : 'Any document type. Nothing to install.'}
            </div>
            {/* No `accept` attribute: we deliberately allow any file type. */}
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          <div className="chips">
            {SUPPORTED.map((s) => <span key={s} className="chip">{s}</span>)}
          </div>

          <div className="row wrap" style={{ marginTop: 16 }}>
            <select
              value={uploadTopicId}
              onChange={(e) => setUploadTopicId(e.target.value)}
              style={{ width: 240 }}
              aria-label="Assign to topic"
            >
              <option value="">No specific topic</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="primary" type="submit" disabled={busy || !file}>
              {busy ? 'Extracting & indexing…' : '⬆ Upload & index'}
            </button>
            {file && !busy && (
              <button type="button" className="ghost" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                Clear
              </button>
            )}
          </div>
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
            aria-label="Prerequisite"
          >
            <option value="">No prerequisite</option>
            {topics.map((t) => <option key={t.id} value={t.id}>Prereq: {t.name}</option>)}
          </select>
          <select
            value={newTopic.difficulty}
            onChange={(e) => setNewTopic((t) => ({ ...t, difficulty: e.target.value }))}
            style={{ width: 130 }}
            aria-label="Difficulty"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <input
            type="number" min="0" max="10" step="0.5"
            value={newTopic.weight}
            onChange={(e) => setNewTopic((t) => ({ ...t, weight: e.target.value }))}
            style={{ width: 96 }}
            title="Syllabus weight (higher = more important)"
            aria-label="Syllabus weight"
          />
          <button className="primary" type="submit" disabled={busy}>+ Add topic</button>
        </form>
        <p className="small muted" style={{ marginTop: 10 }}>
          Prerequisites matter: a weak prerequisite raises a topic's recommendation priority, so the
          planner fixes foundations before advanced material.
        </p>
      </Card>

      <Card title="Topics">
        {topics.length === 0 ? (
          <EmptyState icon="🗂️" title="No topics yet" hint="Add your first topic above, then upload notes for it." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Topic</th>
                <th style={{ width: 190 }}>Mastery</th>
                <th>Level</th>
                <th>Attempts</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.id}>
                  <td>{t.parent_topic_id ? '↳ ' : ''}{t.name}</td>
                  <td>
                    <div className="row">
                      <div style={{ flex: 1 }}><Bar value={t.mastery} thin /></div>
                      <span className="small muted" style={{ width: 38, textAlign: 'right' }}>
                        {Math.round(t.mastery * 100)}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <MasteryBadge
                      label={
                        t.mastery >= 0.85 ? 'mastered'
                          : t.mastery >= 0.65 ? 'proficient'
                            : t.mastery >= 0.4 ? 'developing'
                              : 'novice'
                      }
                    />
                  </td>
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
          <EmptyState icon="📥" title="Nothing uploaded yet" hint="Drop a file above to make it searchable." />
        ) : (
          <table>
            <thead><tr><th>File</th><th>Status</th><th>Uploaded</th></tr></thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id}>
                  <td>{m.filename}</td>
                  <td>
                    <span className={`badge ${m.status === 'indexed' ? 'green' : 'red'}`}>
                      {m.status === 'indexed' ? '✓ indexed' : m.status}
                    </span>
                    {m.error && <div className="small muted" style={{ marginTop: 4 }}>{m.error}</div>}
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
