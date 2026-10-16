/**
 * Material routes: upload a document and index it into the RAG store.
 *
 * The upload and the indexing happen in one request for MVP simplicity. In
 * production this belongs in a background job (indexing can take a few seconds);
 * that is noted as future work. We do, however, save the raw file and a material
 * row BEFORE indexing, so a failure leaves a recoverable `status='failed'` record
 * rather than a silent disappearance.
 */

import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { all, get, run, resolveDataPath } from '../db/index.js';
import { newId, nowIso } from '../lib/util.js';
import { DB } from '../config/constants.js';
import { requireSubject } from '../modules/subjects/service.js';
import { extractText } from '../modules/materials/parse.js';
import { ingestMaterial } from '../modules/rag/index.js';

const router = Router();
router.use(requireAuth);

// In-memory upload: files are small study notes, and we immediately persist them
// to disk ourselves, so we never need multer's temp-file machinery.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB ceiling
});

router.get(
  '/:subjectId/materials',
  asyncHandler((req, res) => {
    requireSubject(req.params.subjectId, req.user.id);
    const materials = all(
      `SELECT id, filename, mime_type, status, error, uploaded_at
         FROM materials WHERE subject_id = ? ORDER BY uploaded_at DESC`,
      req.params.subjectId,
    );
    res.json({ materials });
  }),
);

router.post(
  '/:subjectId/materials',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const subject = requireSubject(req.params.subjectId, req.user.id);
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded (expected form field "file")' });
    }

    const topicId = req.body?.topicId ? String(req.body.topicId) : null;

    // 1. Persist the raw upload first so nothing is lost if indexing fails.
    const materialId = newId();
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedPath = resolveDataPath(`${DB.UPLOAD_DIR}/${materialId}-${safeName}`);
    fs.writeFileSync(storedPath, req.file.buffer);

    run(
      `INSERT INTO materials (id, subject_id, filename, mime_type, status, uploaded_at)
       VALUES (?, ?, ?, ?, 'uploaded', ?)`,
      materialId,
      subject.id,
      req.file.originalname,
      req.file.mimetype,
      nowIso(),
    );

    // 2. Extract, chunk, embed, and store. Errors are caught locally so we can
    //    mark the material failed AND still return a useful message.
    try {
      const text = await extractText({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        filename: req.file.originalname,
      });

      if (!text || text.trim().length < 20) {
        throw new Error('No readable text was found in the file.');
      }

      const chunkCount = await ingestMaterial({
        materialId,
        subjectId: subject.id,
        topicId,
        text,
      });

      const material = get(`SELECT * FROM materials WHERE id = ?`, materialId);
      return res.status(201).json({ material, chunkCount });
    } catch (err) {
      run(`UPDATE materials SET status = 'failed', error = ? WHERE id = ?`, err.message, materialId);
      return res.status(422).json({ error: err.message, materialId });
    }
  }),
);

export default router;
