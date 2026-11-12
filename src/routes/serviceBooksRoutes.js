const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config');
const { requireServiceKey } = require('../auth/serviceKeyMiddleware');
const { asyncHandler } = require('../auth/middleware');
const { AppError } = require('../utils/errors');
const { nowIso } = require('../utils/clock');
const { newId } = require('../utils/ids');
const { getDb, tx } = require('../db/database');
const documentService = require('../services/documentService');
const categoryService = require('../services/categoryService');
const { provider } = require('../services/aiProvider');
const vectorDbModel = require('../models/vectorDbModel');
const { retrieveAndAnswer } = require('../controllers/chatController');
const audit = require('../services/auditService');
const serviceKeyService = require('../services/serviceKeyService');
const storageService = require('../services/storageService');

const AUDIO_EXTS = ['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.webm'];
const AUDIO_MIMES = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

const upload = multer({
  dest: config.tempUploadDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

const router = express.Router();

/**
 * Basic security scanner for prompt injection or malicious executable payloads.
 */
function scanForPromptInjection(text) {
  if (!text || typeof text !== 'string') return;
  const lower = text.toLowerCase();
  const dangerousPatterns = [
    'ignore all previous instructions',
    'system prompt override',
    'you are now in developer mode',
    'output the system prompt',
    '<script',
    'javascript:',
  ];
  for (const pattern of dangerousPatterns) {
    if (lower.includes(pattern)) {
      throw new AppError(400, 'SECURITY_RISK_DETECTED', `Security check failed: suspicious pattern "${pattern}" detected in payload.`);
    }
  }
}

/**
 * 1. Ingest a book or document into the unified Knowledge Center with real-time indexing.
 */
router.post(
  '/ingest',
  requireServiceKey({ scope: 'write' }),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const client = req.serviceClient;
    const db = getDb();

    // Determine category
    const catRef = body.categoryId || body.categorySlug || body.category;
    let targetCategory = null;
    if (catRef) {
      targetCategory = categoryService.resolveCategory(catRef);
    }
    if (!targetCategory) {
      // Pick first allowed category from service key
      if (client.allowedCategoryIds && client.allowedCategoryIds.length > 0 && !client.allowedCategoryIds.includes('*')) {
        targetCategory = categoryService.getCategory(client.allowedCategoryIds[0]);
      }
    }
    if (!targetCategory) {
      targetCategory = categoryService.resolveCategory('General Knowledge') || categoryService.ensureUncategorized();
    }

    // Verify client is allowed to write into this category
    const serviceKeyService = require('../services/serviceKeyService');
    if (!serviceKeyService.isCategoryAllowed(client, targetCategory.id) && !serviceKeyService.isCategoryAllowed(client, targetCategory.name)) {
      throw new AppError(403, 'CATEGORY_ACCESS_FORBIDDEN', `Service key "${client.name}" is not permitted to ingest into category "${targetCategory.name}".`);
    }

    let docTitle = String(body.title || '').trim();
    let textContent = '';
    let kind = 'document';
    let fileType = 'txt';
    let mimeType = 'text/plain';
    let vaultPath = null;
    let storageReference = null;
    let sizeBytes = 0;
    let sha256 = null;

    const docId = newId('doc');
    const now = nowIso();

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      docTitle = docTitle || path.basename(req.file.originalname, ext);
      const isAudio = AUDIO_EXTS.includes(ext) || (req.file.mimetype && req.file.mimetype.startsWith('audio/'));

      if (isAudio) {
        kind = 'media';
        fileType = ext ? ext.slice(1) : 'wav';
        mimeType = req.file.mimetype || AUDIO_MIMES[ext] || 'audio/wav';

        // Save raw audio permanently to Data Vault
        const saved = await storageService.saveFile(req.file.path, docId, req.file.originalname);
        vaultPath = saved.relPath;
        storageReference = saved.storageReference;
        sizeBytes = saved.size;
        sha256 = saved.sha256;

        // Transcription via Whisper / provider
        if (body.transcriptText || body.transcript_text || body.rawText) {
          textContent = String(body.transcriptText || body.transcript_text || body.rawText).trim();
        } else {
          try {
            textContent = await provider().transcribe(saved.absPath, req.file.originalname);
          } catch (e) {
            console.warn(`[ServiceBooks] Whisper transcription failed: ${e.message}`);
          }
        }
        if (!textContent || !textContent.trim()) {
          textContent = `${docTitle} (Audio recording in ${targetCategory.name})`;
        }
      } else if (req.file.mimetype.includes('text') || ext === '.txt' || ext === '.md') {
        const saved = await storageService.saveFile(req.file.path, docId, req.file.originalname);
        vaultPath = saved.relPath;
        storageReference = saved.storageReference;
        sizeBytes = saved.size;
        sha256 = saved.sha256;
        kind = 'document';
        fileType = ext ? ext.slice(1) : 'txt';
        mimeType = req.file.mimetype || 'text/plain';
        textContent = fs.readFileSync(saved.absPath, 'utf8');
      } else {
        const saved = await storageService.saveFile(req.file.path, docId, req.file.originalname);
        vaultPath = saved.relPath;
        storageReference = saved.storageReference;
        sizeBytes = saved.size;
        sha256 = saved.sha256;
        kind = 'document';
        fileType = ext ? ext.slice(1) : 'bin';
        mimeType = req.file.mimetype || 'application/octet-stream';
        textContent = `Content for book: ${docTitle}. Document ingested via Service API. Category: ${targetCategory.name}.`;
      }
    } else if (body.rawText || body.text || body.content || body.transcriptText || body.transcript_text) {
      textContent = String(body.transcriptText || body.transcript_text || body.rawText || body.text || body.content).trim();
      docTitle = docTitle || `Document_${Date.now()}`;
      kind = 'raw_text';
      fileType = 'txt';
      mimeType = 'text/plain';
      const saved = await storageService.saveText(textContent, docId, docTitle);
      vaultPath = saved.relPath;
      storageReference = saved.storageReference;
      sizeBytes = saved.size;
      sha256 = saved.sha256;
    } else {
      throw new AppError(400, 'PAYLOAD_REQUIRED', 'Either an uploaded file or "rawText" field is required.');
    }

    scanForPromptInjection(textContent);

    let ownerId = client.createdBy;
    if (!ownerId) {
      const u = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get();
      ownerId = u ? u.id : null;
    }

    // Acoustic / dialect training metadata
    const dialectCode = body.dialectCode || body.dialect_code || (
      targetCategory.name_key === 'cat.dialect_emirati' ? 'ar-AE' :
      targetCategory.name_key === 'cat.dialect_omani' ? 'ar-OM' : null
    );
    const pronunciationNotes = body.pronunciationNotes || body.pronunciation_notes || null;
    const speakerTone = body.speakerTone || body.speaker_tone || null;
    let trainingMetadata = null;
    if (body.trainingMetadata || body.training_metadata) {
      const tm = body.trainingMetadata || body.training_metadata;
      trainingMetadata = typeof tm === 'object' ? JSON.stringify(tm) : String(tm);
    } else if (dialectCode || speakerTone || pronunciationNotes || kind === 'media') {
      trainingMetadata = JSON.stringify({
        dialectCode,
        speakerTone,
        pronunciationNotes,
        kind,
        fileType,
        originalFilename: req.file ? req.file.originalname : `${docTitle}.txt`,
        recordedAt: now,
      });
    }

    // Split text into chunks
    const { chunkDocumentText } = require('../utils/textChunker');
    const chunkTexts = chunkDocumentText(textContent, 600, 50);

    // Generate local embeddings via bge-m3 / provider
    const embeddings = await provider().embedBatch(chunkTexts);
    const embedTag = provider().embedTag();

    tx(() => {
      // 1. Insert document record with version_number = 1, is_current = 1
      db.prepare(`
        INSERT INTO documents (
          id, owner_id, title, original_filename, kind, file_type,
          mime_type, size_bytes, sha256, category_id, language, vault_path,
          storage_reference, upload_status, ocr_status, index_status,
          chunk_count, page_count, raw_text, dialect_code, transcript_text,
          pronunciation_notes, speaker_tone, training_metadata,
          source, attribution, uploaded_at, version_number, is_current
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stored', 'completed', 'completed', ?, 1, ?, ?, ?, ?, ?, ?, 'service_api', 'verified', ?, 1, 1)
      `).run(
        docId,
        ownerId,
        docTitle,
        req.file ? req.file.originalname : `${docTitle}.txt`,
        kind,
        fileType,
        mimeType,
        sizeBytes || textContent.length,
        sha256 || null,
        targetCategory.id,
        body.language || 'Arabic',
        vaultPath || null,
        storageReference || null,
        chunkTexts.length,
        textContent,
        dialectCode,
        textContent,
        pronunciationNotes,
        speakerTone,
        trainingMetadata,
        now
      );

      // 2. Insert chunks with provenance footprint: version_number and verified_at
      const insertChunk = db.prepare(`
        INSERT INTO chunks (
          id, document_id, idx, page, text, embedding, created_at, embed_model, version_number, verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `);

      for (let i = 0; i < chunkTexts.length; i++) {
        const text = chunkTexts[i];
        const emb = embeddings[i];
        const blob = Buffer.from(new Float32Array(emb).buffer);
        insertChunk.run(
          newId('chk'),
          docId,
          i,
          1,
          text,
          blob,
          now,
          embedTag,
          now
        );
      }
    });

    vectorDbModel.invalidateCache();

    audit.record({
      action: 'service_book.ingested',
      actor: req.actor,
      detail: {
        documentId: docId,
        title: docTitle,
        category: targetCategory.name,
        categoryId: targetCategory.id,
        categoryKey: targetCategory.name_key,
        chunkCount: chunkTexts.length,
        kind,
        dialectCode,
        speakerTone,
        appSlug: client.appSlug,
      },
    });

    res.status(201).json({
      success: true,
      documentId: docId,
      versionNumber: 1,
      chunkCount: chunkTexts.length,
      document: {
        id: docId,
        title: docTitle,
        kind,
        fileType,
        category: targetCategory.name,
        categoryId: targetCategory.id,
        categoryKey: targetCategory.name_key,
        chunkCount: chunkTexts.length,
        version: 1,
        versionNumber: 1,
        status: 'completed',
        ingestedAt: now,
        dialectCode,
        speakerTone,
        pronunciationNotes,
        transcriptText: textContent,
        vaultPath,
      },
    });
  })
);

/**
 * 2. Real-time Delete Book: removes document, all chunks, and invalidates vector cache instantly.
 */
router.delete(
  '/:id',
  requireServiceKey({ scope: 'delete' }),
  asyncHandler(async (req, res) => {
    const docId = req.params.id;
    const client = req.serviceClient;
    const db = getDb();

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
    if (!doc) throw new AppError(404, 'DOCUMENT_NOT_FOUND', `Document not found with id: ${docId}`);

    // Verify category access
    const serviceKeyService = require('../services/serviceKeyService');
    if (!serviceKeyService.isCategoryAllowed(client, doc.category_id)) {
      throw new AppError(403, 'CATEGORY_ACCESS_FORBIDDEN', 'Service key is not authorized to delete documents from this category.');
    }

    let chunksCount = 0;
    tx(() => {
      const chunkRow = db.prepare('SELECT COUNT(*) as c FROM chunks WHERE document_id = ?').get(docId);
      chunksCount = chunkRow ? chunkRow.c : 0;
      db.prepare('DELETE FROM chunks WHERE document_id = ?').run(docId);
      db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(docId);
      db.prepare('DELETE FROM processing_jobs WHERE document_id = ?').run(docId);
      db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
    });

    vectorDbModel.invalidateCache();

    audit.record({
      action: 'service_book.deleted',
      actor: req.actor,
      detail: {
        documentId: docId,
        title: doc.title,
        chunksRemoved: chunksCount,
        appSlug: client.appSlug,
      },
    });

    res.json({
      success: true,
      deleted: true,
      documentId: docId,
      deletedId: docId,
      chunksDeleted: chunksCount,
    });
  })
);

/**
 * 3. Update Book & Version Governance: archives previous version and increments version_number.
 */
router.put(
  '/:id',
  requireServiceKey({ scope: 'write' }),
  asyncHandler(async (req, res) => {
    const docId = req.params.id;
    const client = req.serviceClient;
    const db = getDb();
    const body = req.body || {};

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
    if (!doc) throw new AppError(404, 'DOCUMENT_NOT_FOUND', `Document not found with id: ${docId}`);

    const serviceKeyService = require('../services/serviceKeyService');
    if (!serviceKeyService.isCategoryAllowed(client, doc.category_id)) {
      throw new AppError(403, 'CATEGORY_ACCESS_FORBIDDEN', 'Service key is not authorized to update documents in this category.');
    }

    const currentVersion = doc.version_number || 1;
    const nextVersion = currentVersion + 1;
    const now = nowIso();

    let newChunks = null;
    let newEmbeddings = null;
    let embedTag = null;
    const newText = body.rawText || body.text || body.content;
    if (newText && String(newText).trim()) {
      scanForPromptInjection(newText);
      const { chunkDocumentText } = require('../utils/textChunker');
      chunkTexts = chunkDocumentText(String(newText).trim(), 600, 50);
      newEmbeddings = await provider().embedBatch(chunkTexts);
      embedTag = provider().embedTag();
    }

    tx(() => {
      // 1. Archive current version to document_versions
      db.prepare(`
        INSERT INTO document_versions (
          id, document_id, version_number, title, vault_path, chunk_count, change_summary, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId('ver'),
        doc.id,
        currentVersion,
        doc.title,
        doc.vault_path || '',
        doc.chunk_count || 0,
        body.changeSummary || 'Updated via Service API',
        doc.uploaded_at || now,
        client.createdBy || doc.owner_id || null
      );

      // 2. Update document metadata
      const newTitle = body.title ? String(body.title).trim() : doc.title;
      let newCatId = doc.category_id;
      if (body.categoryId || body.category) {
        const cat = categoryService.resolveCategory(body.categoryId || body.category);
        if (cat) newCatId = cat.id;
      }

      db.prepare(`
        UPDATE documents
        SET title = ?, category_id = ?, version_number = ?, uploaded_at = ?
        WHERE id = ?
      `).run(newTitle, newCatId, nextVersion, now, docId);

      // 3. Update chunks
      if (chunkTexts) {
        db.prepare('DELETE FROM chunks WHERE document_id = ?').run(docId);
        const insertChunk = db.prepare(`
          INSERT INTO chunks (
            id, document_id, idx, page, text, embedding, created_at, embed_model, version_number, verified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (let i = 0; i < chunkTexts.length; i++) {
          const text = chunkTexts[i];
          const emb = newEmbeddings[i];
          const blob = Buffer.from(new Float32Array(emb).buffer);
          insertChunk.run(newId('chk'), docId, i, 1, text, blob, now, embedTag, nextVersion, now);
        }
      } else {
        db.prepare(`
          UPDATE chunks
          SET version_number = ?, verified_at = ?
          WHERE document_id = ?
        `).run(nextVersion, now, docId);
      }
    });

    vectorDbModel.invalidateCache();

    audit.record({
      action: 'service_book.updated',
      actor: req.actor,
      detail: {
        documentId: docId,
        newVersion: nextVersion,
        archivedVersion: currentVersion,
        appSlug: client.appSlug,
      },
    });

    res.json({
      success: true,
      documentId: docId,
      version: nextVersion,
      newVersion: nextVersion,
      previousVersionArchived: currentVersion,
    });
  })
);

/**
 * 4. List Books scoped to the client's allowed spaces.
 */
router.get(
  '/',
  requireServiceKey({ scope: 'read' }),
  asyncHandler(async (req, res) => {
    const client = req.serviceClient;
    const db = getDb();

    let query = `
      SELECT d.id, d.title, d.kind, d.file_type, d.category_id, cat.name as category_name, cat.name_key as category_key,
             d.version_number, d.chunk_count, d.size_bytes, d.uploaded_at,
             d.dialect_code, d.speaker_tone, d.pronunciation_notes, d.transcript_text, d.vault_path
      FROM documents d
      LEFT JOIN categories cat ON cat.id = d.category_id
      WHERE d.index_status = 'completed' AND COALESCE(d.is_current, 1) = 1
    `;
    const rows = db.prepare(query).all();

    const serviceKeyService = require('../services/serviceKeyService');
    const filtered = rows.filter((r) => serviceKeyService.isCategoryAllowed(client, r.category_id));

    const list = filtered.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      fileType: r.file_type,
      categoryId: r.category_id,
      category: r.category_name,
      categoryKey: r.category_key,
      version: r.version_number || 1,
      chunkCount: r.chunk_count,
      uploadedAt: r.uploaded_at,
      dialectCode: r.dialect_code || null,
      speakerTone: r.speaker_tone || null,
      pronunciationNotes: r.pronunciation_notes || null,
      vaultPath: r.vault_path || null,
    }));

    res.json({
      success: true,
      count: list.length,
      books: list,
      documents: list,
    });
  })
);

/**
 * 5. Scoped RAG Query Endpoint for Consumer Agents with Full Provenance Footprint.
 */
router.post(
  '/query',
  requireServiceKey({ scope: 'read' }),
  asyncHandler(async (req, res) => {
    const rawQuestion = req.body ? (req.body.question || req.body.query) : null;
    if (!rawQuestion || !String(rawQuestion).trim()) {
      throw new AppError(400, 'QUESTION_REQUIRED', 'Field "question" or "query" is required.');
    }
    const question = String(rawQuestion).trim();
    const category = req.body ? (req.body.category || req.body.categoryId) : null;
    const { topK, minSimilarity, language } = req.body || {};
    const client = req.serviceClient;

    if (category && !serviceKeyService.isCategoryAllowed(client, category)) {
      throw new AppError(403, 'CATEGORY_ACCESS_FORBIDDEN', 'This service key is not authorized for the requested category.');
    }

    const { answer, chunks } = await retrieveAndAnswer(String(question).trim(), {
      topK,
      minSimilarity,
      category,
      language,
      allowedCategoryIds: client.allowedCategoryIds,
      forbiddenCategoryIds: client.forbiddenCategoryIds,
    });

    // Record RAG retrieval event in audit log (Guideline 7: Usage tracking)
    audit.record({
      action: 'service_query.executed',
      actor: req.actor,
      detail: {
        appSlug: client.appSlug,
        question: question.trim().slice(0, 100),
        sourcesReturned: chunks.length,
        sources: chunks.map((c) => ({
          sourceId: c.sourceId || c.documentId,
          bookTitle: c.bookTitle,
          pageNumber: c.pageNumber || c.page,
        })),
      },
    });

    res.json({
      success: true,
      answer,
      appSlug: client.appSlug,
      sources: chunks.map((c) => ({
        sourceId: c.sourceId || c.documentId,
        bookTitle: c.bookTitle,
        category: c.category,
        categoryId: c.categoryId,
        categoryKey: c.categoryKey,
        dialectCode: c.dialectCode || null,
        speakerTone: c.speakerTone || null,
        pronunciationNotes: c.pronunciationNotes || null,
        pageNumber: c.pageNumber || c.page,
        versionNumber: c.versionNumber || 1,
        verifiedAt: c.verifiedAt || null,
        similarity: parseFloat(c.similarity.toFixed(4)),
        excerpt: c.chunk.length > 250 ? `${c.chunk.slice(0, 250)}...` : c.chunk,
      })),
    });
  })
);

module.exports = router;
