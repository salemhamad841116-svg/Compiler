const fs = require('fs');
const config = require('../config');
const { get, run, tx } = require('../db/database');
const { newId } = require('../utils/ids');
const { nowIso } = require('../utils/clock');
const { chunkDocumentText, calculateEstimatedPages } = require('../utils/textChunker');
const { parsePdfPages } = require('../utils/pdfParser');
const { provider, classifyError, AiError } = require('./aiProvider');
const storage = require('./storageService');
const audit = require('./auditService');

class PipelineError extends Error {
  constructor(code, message, stage = 'extract', retryable = false) {
    super(message);
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
  }
}

function floatsToBlob(arr) {
  const f = new Float32Array(arr);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

async function embedWithRetry(text) {
  let attempt = 0;
  for (;;) {
    try {
      return await provider().embed(text);
    } catch (e) {
      const err = classifyError(e);
      if (err.retryable && attempt < config.embeddingRetries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 200 * attempt));
        continue;
      }
      throw new PipelineError(err.code, err.message, 'embed', err.retryable);
    }
  }
}

async function extract(doc, abs) {
  const chunkSize = parseInt(process.env.MAX_CHUNK_SIZE, 10) || 800;
  const overlap = parseInt(process.env.CHUNK_OVERLAP, 10) || 150;
  const sections = []; // { page, text }
  const info = { pagesTotal: null, pagesProcessed: 0, pagesFailed: 0, pagesEstimated: null, charCount: 0 };

  if (doc.kind === 'document' && doc.file_type === 'pdf') {
    let parsed;
    try {
      parsed = await parsePdfPages(abs);
    } catch (e) {
      throw new PipelineError('PDF_UNREADABLE', `The PDF could not be read: ${e.message}`, 'extract', false);
    }
    info.pagesTotal = parsed.numPages;
    parsed.pages.forEach((text, i) => {
      if (text && text.trim().length) sections.push({ page: i + 1, text });
    });
    info.pagesProcessed = sections.length;
    info.pagesFailed = parsed.numPages - sections.length;
    info.charCount = parsed.text.length;
    if (!sections.length) {
      throw Object.assign(new PipelineError('NO_TEXT_LAYER', 'The PDF has no extractable text (scanned images?). OCR for scanned PDFs is not enabled.', 'extract', false), { info });
    }
  } else if (doc.kind === 'document') {
    const text = fs.readFileSync(abs, 'utf-8').trim();
    if (!text) throw new PipelineError('NO_TEXT', 'The file contains no readable text.', 'extract', false);
    sections.push({ page: null, text });
    info.pagesEstimated = calculateEstimatedPages(text);
    info.charCount = text.length;
  } else if (doc.kind === 'raw_text' || doc.kind === 'url') {
    const text = fs.readFileSync(abs, 'utf-8').trim();
    if (!text) throw new PipelineError('NO_TEXT', 'The entry contains no text.', 'extract', false);
    sections.push({ page: null, text });
    info.pagesEstimated = calculateEstimatedPages(text);
    info.charCount = text.length;
  } else if (doc.kind === 'image') {
    run("UPDATE documents SET ocr_status = 'processing' WHERE id = ?", doc.id);
    let text;
    try {
      text = await provider().ocrImage(abs, doc.original_filename || '');
    } catch (e) {
      const err = classifyError(e);
      throw new PipelineError(err.code, err.message, 'ocr', err.retryable);
    }
    if (!text || !text.trim()) throw new PipelineError('OCR_EMPTY', 'OCR returned no text for this image.', 'ocr', false);
    sections.push({ page: 1, text: text.trim() });
    info.charCount = text.trim().length;
  } else if (doc.kind === 'media') {
    run("UPDATE documents SET ocr_status = 'processing' WHERE id = ?", doc.id);
    let text;
    try {
      text = await provider().transcribe(abs, doc.original_filename || '');
    } catch (e) {
      const err = classifyError(e);
      throw new PipelineError(err.code, err.message, 'ocr', err.retryable);
    }
    if (!text || !text.trim()) throw new PipelineError('TRANSCRIPT_EMPTY', 'No speech could be transcribed.', 'ocr', false);
    sections.push({ page: null, text: text.trim() });
    info.pagesEstimated = calculateEstimatedPages(text);
    info.charCount = text.trim().length;
  }

  const chunks = [];
  for (const s of sections) {
    for (const c of chunkDocumentText(s.text, chunkSize, overlap)) chunks.push({ page: s.page, text: c });
  }
  return { chunks, info };
}

/**
 * Processes one stored document: extract/OCR -> chunk -> embed -> atomically replace its chunks.
 * Idempotent: re-running replaces chunks for the same document, so retries never duplicate data.
 */
async function processDocument(documentId) {
  const doc = get('SELECT * FROM documents WHERE id = ?', documentId);
  if (!doc) return { skipped: true };

  const needsExtractionStage = doc.kind === 'image' || doc.kind === 'media';
  run(
    `UPDATE documents SET index_status = 'processing', ocr_status = ?, processing_started_at = ?, attempts = attempts + 1,
       failure_code = NULL, failure_reason = NULL WHERE id = ?`,
    needsExtractionStage ? 'processing' : 'not_applicable', nowIso(), documentId
  );

  let stage = 'extract';
  let partialInfo = null;
  try {
    const abs = storage.resolve(doc.vault_path);
    if (!abs || !fs.existsSync(abs)) {
      throw new PipelineError('FILE_MISSING', 'The stored file is missing from the Data Vault.', 'extract', false);
    }
    const { chunks, info } = await extract(doc, abs);
    partialInfo = info;
    if (!chunks.length) throw new PipelineError('NO_TEXT', 'No text chunks could be produced.', 'extract', false);

    stage = 'embed';
    const embedded = [];
    for (const c of chunks) {
      const vec = await embedWithRetry(c.text);
      embedded.push({ ...c, blob: floatsToBlob(vec) });
    }

    const completedAt = nowIso();
    const first = doc.lifetime_counted === 0;
    tx(() => {
      run('DELETE FROM chunks WHERE document_id = ?', documentId);
      embedded.forEach((c, idx) => {
        run('INSERT INTO chunks (id, document_id, idx, page, text, embedding, created_at) VALUES (?,?,?,?,?,?,?)', newId('chk'), documentId, idx, c.page, c.text, c.blob, completedAt);
      });
      run(
        `UPDATE documents SET index_status = 'completed', ocr_status = ?, pages_total = ?, pages_processed = ?, pages_failed = ?,
           pages_estimated = ?, chunk_count = ?, char_count = ?, completed_at = ?, failure_code = NULL, failure_reason = NULL,
           lifetime_counted = 1 WHERE id = ?`,
        needsExtractionStage ? 'completed' : 'not_applicable', info.pagesTotal, info.pagesProcessed, info.pagesFailed,
        info.pagesEstimated, embedded.length, info.charCount, completedAt, documentId
      );
    });
    require('../models/vectorDbModel').invalidateCache();
    audit.record({
      action: 'document.processing_completed', doc: get('SELECT * FROM documents WHERE id = ?', documentId),
      completedAt, countsLifetime: first, detail: { chunks: embedded.length, firstCompletion: first },
    });
    return { ok: true, chunks: embedded.length };
  } catch (e) {
    const err = e instanceof PipelineError ? e : (() => { const c = classifyError(e); return new PipelineError(c.code, c.message, stage, c.retryable); })();
    const info = err.info || partialInfo || (e && e.info) || {};
    const ocrFailed = err.stage === 'ocr';
    run(
      `UPDATE documents SET index_status = ?, ocr_status = ?, failure_code = ?, failure_reason = ?,
         pages_total = COALESCE(?, pages_total), pages_processed = ?, pages_failed = ?, pages_estimated = COALESCE(?, pages_estimated) WHERE id = ?`,
      ocrFailed ? 'not_started' : 'failed',
      ocrFailed ? 'failed' : needsExtractionStage ? 'completed' : 'not_applicable',
      err.code, err.message.slice(0, 500),
      info.pagesTotal ?? null, 0, info.pagesTotal != null ? info.pagesTotal : 0, info.pagesEstimated ?? null, documentId
    );
    audit.record({
      action: 'document.processing_failed', outcome: 'failed', doc: get('SELECT * FROM documents WHERE id = ?', documentId),
      failureReason: `${err.code}: ${err.message}`.slice(0, 500), detail: { code: err.code, stage: err.stage, retryable: err.retryable },
    });
    return { ok: false, code: err.code };
  }
}

module.exports = { processDocument, PipelineError };
