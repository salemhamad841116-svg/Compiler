const fs = require('fs');
const path = require('path');
const config = require('../config');
const { get, all, run, tx } = require('../db/database');
const { newId } = require('../utils/ids');
const { nowIso } = require('../utils/clock');
const { chunkDocumentText, calculateEstimatedPages } = require('../utils/textChunker');
const { parsePdfPages } = require('../utils/pdfParser');
const { parseEpub } = require('../utils/epubParser');
const { inspectZip, extractEntry } = require('../utils/zipParser');
const { provider, classifyError, AiError } = require('./aiProvider');
const storage = require('./storageService');
const audit = require('./auditService');
const events = require('./eventBus');
const tools = require('./ai/localTools');

class PipelineError extends Error {
  constructor(code, message, stage = 'extract', retryable = false) {
    super(message);
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
  }
}

/** Short, single-line identity of a document for logs. */
function docLabel(doc) {
  return `${doc.id} kind=${doc.kind} type=${doc.file_type} "${String(doc.original_filename || doc.title || '').slice(0, 80)}"`;
}

function floatsToBlob(arr) {
  const f = new Float32Array(arr);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

const EMBED_SLICE = 64;

/** Embeds all chunk texts in slices; each slice is retried on transient failures. */
async function embedAll(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_SLICE) {
    const slice = texts.slice(i, i + EMBED_SLICE);
    let attempt = 0;
    for (;;) {
      try {
        out.push(...(await provider().embedBatch(slice)));
        break;
      } catch (e) {
        const err = classifyError(e);
        if (err.retryable && attempt < config.embeddingRetries) {
          attempt++;
          console.warn(`[Pipeline] embed attempt ${attempt} failed (${err.code}): ${err.message} - retrying`);
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        throw new PipelineError(err.code, err.message, 'embed', err.retryable);
      }
    }
  }
  return out;
}

/** OCR errors that only concern one page; anything else (key, model, network) stops the document. */
function isPageLevelOcrError(err) {
  return err.code === 'OCR_EMPTY' || err.code === 'TOOL_FAILED';
}

/**
 * PDF extraction: text layer per page, plus OCR (Poppler render -> vision LLM / Tesseract) for
 * pages without a usable text layer (scanned books). PDF OCR mode comes from System Settings:
 * 'auto' (sparse pages only), 'always' (every page) or 'never'.
 */
async function extractPdf(doc, abs, info, sections) {
  const mode = require('./settingsService').getAiConfig().pdfOcr;
  const canRender = mode !== 'never' && (await tools.has('pdftoppm'));
  let parsed = null;
  let parseError = null;
  try {
    parsed = await parsePdfPages(abs);
  } catch (e) {
    parseError = e;
  }
  let numPages = parsed ? parsed.numPages : null;
  if (!parsed) {
    if (!canRender || !(await tools.has('pdfinfo'))) {
      throw new PipelineError('PDF_UNREADABLE', `The PDF could not be read: ${parseError.message}`, 'extract', false);
    }
    try {
      numPages = await tools.pdfPageCount(abs);
    } catch (e) {
      throw new PipelineError('PDF_UNREADABLE', `The PDF could not be read: ${parseError.message} / ${e.message}`, 'extract', false);
    }
    console.warn(`[Pipeline] ${doc.id}: text layer unreadable (${parseError.message.slice(0, 120)}); OCR of all ${numPages} page(s)`);
  }
  info.pagesTotal = numPages;
  const pageTexts = parsed ? parsed.pages : new Array(numPages).fill('');
  const minChars = parseInt(process.env.PDF_OCR_MIN_CHARS, 10) || 40;
  const maxOcrPages = parseInt(process.env.OCR_MAX_PAGES, 10) || 1000;
  const ocrPages = [];
  pageTexts.forEach((t, i) => {
    const text = (t || '').trim();
    if (canRender && (mode === 'always' || text.length < minChars) && ocrPages.length < maxOcrPages) ocrPages.push(i + 1);
    else if (text) sections.push({ page: i + 1, text });
  });
  info.charCount = sections.reduce((n, s) => n + s.text.length, 0);

  if (ocrPages.length) {
    console.log(`[Pipeline] ${doc.id}: OCR of ${ocrPages.length}/${numPages} page(s) without a usable text layer (mode=${mode})`);
    run("UPDATE documents SET ocr_status = 'processing', pages_total = ? WHERE id = ?", numPages, doc.id);
    const workDir = tools.makeWorkDir(`pdf-${doc.id}`);
    try {
      for (const p of ocrPages) {
        let text = '';
        try {
          const img = await tools.renderPdfPage(abs, p, workDir);
          text = await provider().ocrImage(img, `${doc.original_filename || doc.id} p${p}`);
          try { fs.unlinkSync(img); } catch (_) { /* best effort */ }
        } catch (e) {
          const err = classifyError(e);
          if (!isPageLevelOcrError(err)) {
            throw Object.assign(new PipelineError(err.code, `OCR stopped at page ${p}/${numPages}: ${err.message}`, 'ocr', err.retryable), { info });
          }
          console.warn(`[Pipeline] ${doc.id}: page ${p} OCR skipped (${err.code}): ${err.message.slice(0, 160)}`);
        }
        const layer = (pageTexts[p - 1] || '').trim();
        const best = text && text.trim().length >= layer.length ? text.trim() : layer;
        if (best) {
          sections.push({ page: p, text: best });
          info.charCount += best.length;
          info.ocrPages = (info.ocrPages || 0) + (best === layer ? 0 : 1);
        }
        run('UPDATE documents SET pages_processed = ? WHERE id = ?', sections.length, doc.id);
      }
    } finally {
      tools.cleanupWorkDir(workDir);
    }
    sections.sort((a, b) => a.page - b.page);
  }
  info.pagesProcessed = sections.length;
  info.pagesFailed = numPages - sections.length;
  if (!sections.length) {
    const why = canRender
      ? 'OCR could not read any page of this PDF.'
      : mode === 'never'
        ? 'The PDF has no extractable text and PDF OCR is turned off in System Settings.'
        : 'The PDF has no extractable text (scanned images?) and the OCR tools (poppler-utils) are not installed.';
    throw Object.assign(new PipelineError('NO_TEXT_LAYER', why, canRender ? 'ocr' : 'extract', false), { info });
  }
}

async function extractEpub(doc, abs, info, sections) {
  let parsed;
  try {
    parsed = await parseEpub(abs);
  } catch (e) {
    throw new PipelineError('EPUB_UNREADABLE', `The EPUB could not be read: ${e.message}`, 'extract', false);
  }

  const chapters = (parsed && parsed.chapters) || [];
  if (!chapters.length && (!parsed || !parsed.text)) {
    throw new PipelineError('NO_TEXT', 'The EPUB contains no readable text.', 'extract', false);
  }

  info.pagesTotal = chapters.length || 1;
  let fullText = '';
  chapters.forEach((ch, idx) => {
    const text = (ch.text || '').trim();
    if (text) {
      sections.push({ page: idx + 1, text });
      fullText += (fullText ? '\n\n' : '') + text;
    }
  });

  if (!sections.length && parsed && parsed.text) {
    const text = parsed.text.trim();
    if (text) {
      sections.push({ page: 1, text });
      fullText = text;
    }
  }

  if (!sections.length) {
    throw new PipelineError('NO_TEXT', 'The EPUB contains no readable text.', 'extract', false);
  }

  info.pagesProcessed = sections.length;
  info.pagesFailed = Math.max(0, (info.pagesTotal || sections.length) - sections.length);
  info.pagesEstimated = calculateEstimatedPages(fullText);
  info.charCount = fullText.length;
  info.rawText = fullText;
  if (!doc.title && parsed.title) {
    run('UPDATE documents SET title = ? WHERE id = ?', String(parsed.title).slice(0, 255), doc.id);
  }
}

async function extractZip(doc, abs, info, sections) {
  let inspected;
  try {
    inspected = inspectZip(abs);
  } catch (e) {
    throw new PipelineError('ZIP_UNREADABLE', `The ZIP archive could not be read: ${e.message}`, 'extract', false);
  }

  const { entries, imageEntries, textEntries, documentEntries } = inspected;
  if (!entries.length) {
    throw new PipelineError('NO_TEXT', 'The ZIP archive contains no supported files.', 'extract', false);
  }

  const workDir = tools.makeWorkDir(`zip-${doc.id}`);
  let totalText = '';
  try {
    if (imageEntries.length > 0) {
      info.pagesTotal = imageEntries.length;
      run("UPDATE documents SET ocr_status = 'processing', pages_total = ? WHERE id = ?", imageEntries.length, doc.id);
      console.log(`[Pipeline] ${doc.id}: OCR processing of ${imageEntries.length} image page(s) in ZIP archive...`);

      for (let i = 0; i < imageEntries.length; i++) {
        const entry = imageEntries[i];
        const pageNumber = i + 1;
        const ext = path.extname(entry.entryName).toLowerCase();
        const extractedRawPath = path.join(workDir, `raw-p${pageNumber}${ext}`);
        extractEntry(entry, extractedRawPath);

        let finalImagePath = extractedRawPath;
        if (['.jp2', '.jpx', '.j2k'].includes(ext)) {
          finalImagePath = await tools.convertJp2ToImage(extractedRawPath, workDir);
        }

        let text = '';
        try {
          text = await provider().ocrImage(finalImagePath, `${doc.original_filename || doc.id} p${pageNumber}`);
        } catch (e) {
          const err = classifyError(e);
          console.warn(`[Pipeline] ${doc.id}: page ${pageNumber} OCR warning (${err.code}): ${err.message.slice(0, 160)}`);
        }

        const trimmed = (text || '').trim();
        if (trimmed) {
          sections.push({ page: pageNumber, text: trimmed });
          totalText += (totalText ? '\n\n' : '') + trimmed;
          info.charCount += trimmed.length;
          info.ocrPages = (info.ocrPages || 0) + 1;
          info.pagesProcessed++;
        } else {
          info.pagesFailed++;
        }

        try { fs.unlinkSync(extractedRawPath); } catch (_) {}
        if (finalImagePath !== extractedRawPath) {
          try { fs.unlinkSync(finalImagePath); } catch (_) {}
        }
        run('UPDATE documents SET pages_processed = ? WHERE id = ?', sections.length, doc.id);
      }
    } else if (textEntries.length > 0) {
      info.pagesTotal = textEntries.length;
      for (let i = 0; i < textEntries.length; i++) {
        const entry = textEntries[i];
        const pageNumber = i + 1;
        const text = (entry.getData().toString('utf8') || '').trim();
        if (text) {
          sections.push({ page: pageNumber, text });
          totalText += (totalText ? '\n\n' : '') + text;
          info.charCount += text.length;
          info.pagesProcessed++;
        } else {
          info.pagesFailed++;
        }
      }
    } else if (documentEntries.length > 0) {
      for (const entry of documentEntries) {
        const ext = path.extname(entry.entryName).toLowerCase();
        const extractedDocPath = path.join(workDir, `sub-${path.basename(entry.entryName)}`);
        extractEntry(entry, extractedDocPath);
        if (ext === '.epub') {
          await extractEpub({ ...doc, title: null }, extractedDocPath, info, sections);
        } else if (ext === '.pdf') {
          await extractPdf(doc, extractedDocPath, info, sections);
        }
        try { fs.unlinkSync(extractedDocPath); } catch (_) {}
      }
      totalText = sections.map((s) => s.text).join('\n\n');
    }
  } finally {
    tools.cleanupWorkDir(workDir);
  }

  if (!sections.length) {
    throw new PipelineError('NO_TEXT', 'The ZIP archive contains no extractable text or recognized pages.', 'extract', false);
  }

  info.pagesProcessed = sections.length;
  info.pagesFailed = Math.max(0, (info.pagesTotal || sections.length) - sections.length);
  info.pagesEstimated = calculateEstimatedPages(totalText);
  info.charCount = totalText.length;
  info.rawText = totalText;

  if (!doc.title && doc.original_filename) {
    const cleanTitle = path.basename(doc.original_filename, path.extname(doc.original_filename))
      .replace(/(_jp2|_images|_scans)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    if (cleanTitle) {
      run('UPDATE documents SET title = ? WHERE id = ?', cleanTitle.slice(0, 255), doc.id);
    }
  }
}

async function extract(doc, abs) {
  const chunkSize = parseInt(process.env.MAX_CHUNK_SIZE, 10) || 800;
  const overlap = parseInt(process.env.CHUNK_OVERLAP, 10) || 150;
  const sections = []; // { page, text }
  const info = { pagesTotal: null, pagesProcessed: 0, pagesFailed: 0, pagesEstimated: null, charCount: 0, rawText: null, ocrPages: 0 };

  if (doc.kind === 'document' && doc.file_type === 'pdf') {
    await extractPdf(doc, abs, info, sections);
  } else if (doc.kind === 'document' && (doc.file_type === 'epub' || doc.mime_type === 'application/epub+zip' || (doc.mime_type && doc.mime_type.includes('epub')))) {
    await extractEpub(doc, abs, info, sections);
  } else if (doc.kind === 'document' && (doc.file_type === 'zip' || doc.mime_type === 'application/zip' || doc.mime_type === 'application/x-zip-compressed')) {
    await extractZip(doc, abs, info, sections);
  } else if (doc.kind === 'document') {
    const text = fs.readFileSync(abs, 'utf-8').trim();
    if (!text) throw new PipelineError('NO_TEXT', 'The file contains no readable text.', 'extract', false);
    sections.push({ page: null, text });
    info.pagesEstimated = calculateEstimatedPages(text);
    info.charCount = text.length;
    info.rawText = text;
  } else if (doc.kind === 'raw_text' || doc.kind === 'url') {
    const text = fs.readFileSync(abs, 'utf-8').trim();
    if (!text) throw new PipelineError('NO_TEXT', 'The entry contains no text.', 'extract', false);
    sections.push({ page: null, text });
    info.pagesEstimated = calculateEstimatedPages(text);
    info.charCount = text.length;
    info.rawText = text;
  } else if (doc.kind === 'image') {
    run("UPDATE documents SET ocr_status = 'processing' WHERE id = ?", doc.id);
    const bookPages = all('SELECT * FROM book_pages WHERE book_id = ? ORDER BY page_number', doc.id);
    if (bookPages.length > 0) {
      info.pagesTotal = bookPages.length;
      let totalText = '';
      for (const pg of bookPages) {
        const pageAbs = storage.resolve(pg.vault_path);
        if (!pageAbs || !fs.existsSync(pageAbs)) {
          console.error(`[Pipeline] ${doc.id}: page ${pg.page_number} file missing in vault (${pg.vault_path})`);
          run("UPDATE book_pages SET ocr_status = 'failed' WHERE id = ?", pg.id);
          info.pagesFailed++;
          continue;
        }
        let text;
        try {
          text = await provider().ocrImage(pageAbs, pg.original_filename || '');
        } catch (e) {
          const err = classifyError(e);
          if (err.code === 'OCR_EMPTY') {
            text = '';
          } else {
            console.error(`[Pipeline] ${doc.id}: OCR failed on page ${pg.page_number}/${bookPages.length} (${err.code}): ${err.message}`, e && e.message !== err.message ? `| raw: ${e.message}` : '');
            run("UPDATE book_pages SET ocr_status = 'failed' WHERE id = ?", pg.id);
            throw new PipelineError(err.code, err.message, 'ocr', err.retryable);
          }
        }
        if (text && text.trim()) {
          run("UPDATE book_pages SET ocr_text = ?, ocr_status = 'completed' WHERE id = ?", text.trim(), pg.id);
          sections.push({ page: pg.page_number, text: text.trim() });
          totalText += (totalText ? '\n\n' : '') + text.trim();
          info.pagesProcessed++;
        } else {
          run("UPDATE book_pages SET ocr_status = 'empty' WHERE id = ?", pg.id);
          info.pagesFailed++;
        }
        run('UPDATE documents SET pages_processed = ? WHERE id = ?', info.pagesProcessed, doc.id);
      }
      if (!sections.length) throw new PipelineError('OCR_EMPTY', 'OCR returned no text for the uploaded book images.', 'ocr', false);
      info.charCount = totalText.length;
      info.rawText = totalText;
    } else {
      let text;
      try {
        text = await provider().ocrImage(abs, doc.original_filename || '');
      } catch (e) {
        const err = classifyError(e);
        throw new PipelineError(err.code, err.message, 'ocr', err.retryable);
      }
      if (!text || !text.trim()) throw new PipelineError('OCR_EMPTY', 'OCR returned no text for this image.', 'ocr', false);
      sections.push({ page: 1, text: text.trim() });
      info.pagesTotal = 1;
      info.pagesProcessed = 1;
      info.charCount = text.trim().length;
      info.rawText = text.trim();
    }
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
  const t0 = Date.now();
  console.log(`[Pipeline] START ${docLabel(doc)} attempt=${(doc.attempts || 0) + 1} provider=${provider().name}`);
  run(
    `UPDATE documents SET index_status = 'processing', ocr_status = ?, processing_started_at = ?, attempts = attempts + 1,
       failure_code = NULL, failure_reason = NULL WHERE id = ?`,
    needsExtractionStage ? 'processing' : 'not_applicable', nowIso(), documentId
  );
  events.publishDoc('document.processing', doc);

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
    const embedTag = provider().embedTag();
    console.log(`[Pipeline] ${documentId}: extracted ${info.charCount} chars -> ${chunks.length} chunk(s)${info.ocrPages ? ` (${info.ocrPages} OCR page(s))` : ''}; embedding with ${embedTag}...`);
    const vectors = await embedAll(chunks.map((c) => c.text));
    const embedded = chunks.map((c, i) => ({ ...c, blob: floatsToBlob(vectors[i]) }));

    const completedAt = nowIso();
    const first = doc.lifetime_counted === 0;
    const ocrStatus = needsExtractionStage || info.ocrPages > 0 ? 'completed' : 'not_applicable';
    tx(() => {
      run('DELETE FROM chunks WHERE document_id = ?', documentId);
      embedded.forEach((c, idx) => {
        run('INSERT INTO chunks (id, document_id, idx, page, text, embedding, created_at, embed_model) VALUES (?,?,?,?,?,?,?,?)', newId('chk'), documentId, idx, c.page, c.text, c.blob, completedAt, embedTag);
      });
      const resolvedPageCount = info.pagesTotal || (info.pagesProcessed > 0 ? info.pagesProcessed : (doc.page_count || 1));
      const resolvedRawText = info.rawText || (doc.raw_text || null);
      run(
        `UPDATE documents SET index_status = 'completed', ocr_status = ?, pages_total = ?, pages_processed = ?, pages_failed = ?,
           pages_estimated = ?, page_count = ?, raw_text = COALESCE(?, raw_text), chunk_count = ?, char_count = ?, completed_at = ?, failure_code = NULL, failure_reason = NULL,
           lifetime_counted = 1 WHERE id = ?`,
        ocrStatus, info.pagesTotal, info.pagesProcessed, info.pagesFailed,
        info.pagesEstimated, resolvedPageCount, resolvedRawText, embedded.length, info.charCount, completedAt, documentId
      );
    });
    require('../models/vectorDbModel').invalidateCache();
    audit.record({
      action: 'document.processing_completed', doc: get('SELECT * FROM documents WHERE id = ?', documentId),
      completedAt, countsLifetime: first, detail: { chunks: embedded.length, firstCompletion: first, embedModel: embedTag, ocrPages: info.ocrPages || 0 },
    });
    events.publishDoc('document.completed', doc, { chunks: embedded.length });
    console.log(`[Pipeline] DONE ${documentId}: ${embedded.length} chunk(s) indexed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return { ok: true, chunks: embedded.length };
  } catch (e) {
    const err = e instanceof PipelineError ? e : (() => { const c = classifyError(e); return new PipelineError(c.code, c.message, stage, c.retryable); })();
    const info = err.info || partialInfo || (e && e.info) || {};
    const ocrFailed = err.stage === 'ocr';
    // Never fail silently: the reason is stored on the document AND written to the container log.
    console.error(
      `[Pipeline] FAILED ${docLabel(doc)} stage=${err.stage} code=${err.code} retryable=${Boolean(err.retryable)} after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}`
    );
    if (!(e instanceof PipelineError) && e && e.stack) console.error(e.stack);
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
    events.publishDoc('document.failed', doc, { code: err.code, stage: err.stage });
    return { ok: false, code: err.code };
  }
}

module.exports = { processDocument, PipelineError };
