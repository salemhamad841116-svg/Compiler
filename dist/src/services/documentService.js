const path = require('path');
const { get, all, run, tx } = require('../db/database');
const { newId } = require('../utils/ids');
const { nowIso } = require('../utils/clock');
const { AppError } = require('../utils/errors');
const storage = require('./storageService');
const audit = require('./auditService');
const categories = require('./categoryService');

const DOC_EXTS = ['.pdf', '.txt', '.md'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const MEDIA_EXTS = ['.mp4', '.mp3', '.wav', '.m4a', '.ogg', '.webm', '.mov', '.avi'];

function classifyExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (DOC_EXTS.includes(e)) return 'document';
  if (IMAGE_EXTS.includes(e)) return 'image';
  if (MEDIA_EXTS.includes(e)) return 'media';
  return null;
}

function pipelineStatus(d) {
  if (d.ocr_status === 'failed' || d.index_status === 'failed') return 'failed';
  if (d.ocr_status === 'processing' || d.index_status === 'processing') return 'processing';
  if (d.index_status === 'completed') return 'completed';
  return 'queued';
}

function mapDocument(d, { withOwner = true } = {}) {
  if (!d) return null;
  const owner = withOwner && d.owner_id ? get('SELECT id, name, email, role FROM users WHERE id = ?', d.owner_id) : null;
  const actor = withOwner && d.actor_id && d.actor_id !== d.owner_id ? get('SELECT id, name, email, role FROM users WHERE id = ?', d.actor_id) : owner;
  const cat = d.category_id ? get('SELECT id, name, name_key FROM categories WHERE id = ?', d.category_id) : null;
  const bookPages = all('SELECT id, page_number, original_filename, file_size, ocr_status, created_at FROM book_pages WHERE book_id = ? ORDER BY page_number', d.id).map((p) => ({
    id: p.id,
    pageNumber: p.page_number,
    originalFilename: p.original_filename,
    fileSize: p.file_size,
    ocrStatus: p.ocr_status,
    createdAt: p.created_at,
  }));
  return {
    id: d.id,
    batchId: d.batch_id,
    title: d.title,
    originalFilename: d.original_filename,
    kind: d.kind,
    fileType: d.file_type,
    mimeType: d.mime_type,
    sizeBytes: d.size_bytes,
    category: cat ? { id: cat.id, name: cat.name, nameKey: cat.name_key || null } : null,
    language: d.language,
    owner: owner || (d.legacy_uploader ? { id: null, name: null, email: d.legacy_uploader, unverified: true } : null),
    actor: actor || null,
    onBehalf: Boolean(d.actor_id && d.owner_id && d.actor_id !== d.owner_id),
    statuses: { upload: d.upload_status, ocr: d.ocr_status, index: d.index_status },
    pipelineStatus: pipelineStatus(d),
    pages: { kind: d.pages_kind, total: d.pages_total, processed: d.pages_processed, failed: d.pages_failed, estimated: d.pages_estimated },
    pageCount: d.page_count != null ? d.page_count : (d.pages_total || d.pages_processed || 0),
    rawText: d.raw_text || null,
    bookPages: bookPages.length ? bookPages : undefined,
    chunkCount: d.chunk_count,
    charCount: d.char_count,
    failureCode: d.failure_code,
    failureReason: d.failure_reason,
    attempts: d.attempts,
    source: d.source,
    attribution: d.attribution,
    sourceUrl: d.source_url,
    uploadedAt: d.uploaded_at,
    processingStartedAt: d.processing_started_at,
    completedAt: d.completed_at,
    fileUrl: `/api/documents/${d.id}/file`,
    fileAvailable: Boolean(d.vault_path && storage.exists(d.vault_path)),
    duplicateOf: d.duplicate_of,
  };
}

function getDocumentRow(id) {
  return get('SELECT * FROM documents WHERE id = ?', id) || null;
}

/** Throws 404 for missing documents AND for documents a supervisor does not own (no existence leak). */
function getAuthorizedDocument(id, user) {
  const d = getDocumentRow(id);
  if (!d || (user.role !== 'admin' && d.owner_id !== user.id)) {
    throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }
  return d;
}

function listDocuments(filters, user) {
  const where = [];
  const params = [];
  if (user.role !== 'admin') {
    where.push('d.owner_id = ?');
    params.push(user.id);
  } else if (filters.ownerId) {
    where.push('d.owner_id = ?');
    params.push(filters.ownerId);
  }
  if (filters.q) {
    const like = `%${String(filters.q).replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.push("(d.title LIKE ? ESCAPE '\\' OR d.original_filename LIKE ? ESCAPE '\\' OR d.id = ? OR d.batch_id = ?)");
    params.push(like, like, filters.q, filters.q);
  }
  if (filters.categoryId) { where.push('d.category_id = ?'); params.push(filters.categoryId); }
  if (filters.kind) { where.push('d.kind = ?'); params.push(filters.kind); }
  if (filters.batchId) { where.push('d.batch_id = ?'); params.push(filters.batchId); }
  if (filters.status) {
    const s = filters.status;
    if (s === 'failed') where.push("(d.index_status = 'failed' OR d.ocr_status = 'failed')");
    else if (s === 'processing') where.push("(d.index_status = 'processing' OR d.ocr_status = 'processing') AND d.ocr_status != 'failed' AND d.index_status != 'failed'");
    else if (s === 'completed') where.push("d.index_status = 'completed' AND d.ocr_status != 'failed'");
    else if (s === 'queued') where.push("d.index_status IN ('pending','not_started') AND d.ocr_status NOT IN ('failed','processing')");
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(filters.pageSize, 10) || 25));
  const total = get(`SELECT COUNT(*) AS n FROM documents d ${whereSql}`, ...params).n;
  const rows = all(
    `SELECT d.* FROM documents d ${whereSql} ORDER BY COALESCE(d.uploaded_at, d.completed_at, '') DESC, d.id DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize
  );
  return { total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), items: rows.map((r) => mapDocument(r)) };
}

// ------------------------------------------------------------------ batches
function createBatch({ declaredCount, supervisorId }, actor) {
  const owner = resolveOwner(actor, supervisorId);
  const id = newId('bat');
  run('INSERT INTO upload_batches (id, owner_id, actor_id, declared_count, created_at) VALUES (?,?,?,?,?)', id, owner.id, actor.id, Math.max(0, parseInt(declaredCount, 10) || 0), nowIso());
  audit.record({
    action: 'batch.created', actor, supervisor: owner, batchId: id,
    detail: { declaredCount: parseInt(declaredCount, 10) || 0, onBehalf: owner.id !== actor.id },
  });
  return { id, ownerId: owner.id, declaredCount: parseInt(declaredCount, 10) || 0 };
}

function batchSummary(id, user) {
  const b = get('SELECT * FROM upload_batches WHERE id = ?', id);
  if (!b || (user.role !== 'admin' && b.owner_id !== user.id)) throw new AppError(404, 'BATCH_NOT_FOUND', 'Batch not found.');
  const docs = all('SELECT * FROM documents WHERE batch_id = ? ORDER BY uploaded_at, id', id);
  const failedUploads = get("SELECT COUNT(*) AS n FROM audit_events WHERE batch_id = ? AND action = 'document.upload_failed'", id).n;
  const counts = { queued: 0, processing: 0, completed: 0, failed: 0 };
  for (const d of docs) counts[pipelineStatus(d)]++;
  const owner = b.owner_id ? get('SELECT id, name, email FROM users WHERE id = ?', b.owner_id) : null;
  const actor = b.actor_id ? get('SELECT id, name, email FROM users WHERE id = ?', b.actor_id) : null;
  return {
    id: b.id,
    createdAt: b.created_at,
    owner,
    actor,
    declaredCount: b.declared_count,
    stored: docs.length,
    uploadFailed: failedUploads,
    pipeline: counts,
    pagesProcessed: docs.reduce((s, d) => s + (d.pages_processed || 0), 0),
    files: docs.map((d) => mapDocument(d, { withOwner: false })),
  };
}

// ------------------------------------------------------------------ ownership
function resolveOwner(actor, requestedSupervisorId) {
  if (actor.role === 'supervisor') return { id: actor.id, name: actor.name, email: actor.email, role: actor.role };
  if (requestedSupervisorId) {
    const u = get("SELECT id, name, email, role, status FROM users WHERE id = ? AND role = 'supervisor'", requestedSupervisorId);
    if (!u) throw new AppError(400, 'SUPERVISOR_NOT_FOUND', 'The selected supervisor does not exist.');
    if (u.status === 'disabled') throw new AppError(400, 'SUPERVISOR_DISABLED', 'The selected supervisor account is disabled.');
    return u;
  }
  return { id: actor.id, name: actor.name, email: actor.email, role: actor.role };
}

function resolveBatch(batchId, actor, owner) {
  if (!batchId) return null;
  const b = get('SELECT * FROM upload_batches WHERE id = ?', batchId);
  if (!b) throw new AppError(400, 'BATCH_NOT_FOUND', 'Upload batch does not exist.');
  if (actor.role !== 'admin' && b.owner_id !== actor.id) throw new AppError(403, 'FORBIDDEN', 'Batch belongs to another account.');
  if (b.owner_id !== owner.id) throw new AppError(400, 'BATCH_OWNER_MISMATCH', 'Batch belongs to a different supervisor.');
  return b.id;
}

function resolveCategoryOrThrow(ref) {
  if (!ref) return categories.ensureUncategorized();
  const c = categories.resolveCategory(ref);
  if (!c) throw new AppError(400, 'CATEGORY_NOT_FOUND', 'The selected category does not exist. Refresh the category list.');
  return c;
}

function recordUploadFailure({ actor, ownerRef, filename, sizeBytes, categoryRef, batchId, code, reason, ip, kind, fileType }) {
  let owner = null;
  try { owner = resolveOwner(actor, ownerRef); } catch (_) { owner = { id: actor.id, name: actor.name }; }
  const cat = categoryRef ? categories.resolveCategory(categoryRef) : null;
  audit.record({
    action: 'document.upload_failed', outcome: 'failed', actor, supervisor: owner, batchId: batchId || null,
    filename, title: filename, sizeBytes: sizeBytes || null, kind: kind || null, fileType: fileType || null,
    categoryId: cat ? cat.id : null, categoryName: cat ? cat.name : null,
    uploadStatus: 'failed', failureReason: reason, ip, detail: { code },
  });
}

// ------------------------------------------------------------------ store stage
function insertDocument(row) {
  const cols = Object.keys(row);
  run(`INSERT INTO documents (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => row[c]));
  return getDocumentRow(row.id);
}

function findDuplicate(sha256, ownerId) {
  return get('SELECT * FROM documents WHERE sha256 = ? AND owner_id IS ? LIMIT 1', sha256, ownerId) || null;
}

/** Persists an uploaded multipart file into the vault + database BEFORE any slow processing. */
async function storeUploadedFile({ file, body, actor, ip }) {
  const ext = path.extname(file.originalname).toLowerCase();
  const kind = classifyExt(ext);
  const owner = resolveOwner(actor, body.supervisorId);
  const cleanup = () => storage.removeTemp(file.path);
  const fail = (status, code, message) => {
    cleanup();
    recordUploadFailure({ actor, ownerRef: body.supervisorId, filename: file.originalname, sizeBytes: file.size, categoryRef: body.categoryId || body.category, batchId: body.batchId, code, reason: message, ip, kind, fileType: ext.replace('.', '') });
    throw new AppError(status, code, message);
  };
  if (!kind) fail(400, 'UNSUPPORTED_FILE_TYPE', `Unsupported file type "${ext}".`);
  if (body._expectKind && body._expectKind !== kind && !(body._expectKind === 'document' && kind === 'image')) {
    fail(400, 'WRONG_ENDPOINT', 'This file type is not accepted by this upload channel.');
  }
  if (!file.size) fail(422, 'EMPTY_FILE', 'The uploaded file is empty.');

  let category;
  let batchId;
  try {
    category = resolveCategoryOrThrow(body.categoryId || body.category);
    batchId = resolveBatch(body.batchId, actor, owner);
  } catch (e) {
    fail(e.status || 400, e.code || 'INVALID_REQUEST', e.message);
  }

  const sha = storage.sha256File(file.path);
  const dup = findDuplicate(sha, owner.id);
  if (dup) {
    cleanup();
    recordUploadFailure({ actor, ownerRef: body.supervisorId, filename: file.originalname, sizeBytes: file.size, categoryRef: category.id, batchId, code: 'DUPLICATE_FILE', reason: `Identical file already stored as ${dup.id}`, ip, kind, fileType: ext.replace('.', '') });
    throw new AppError(409, 'DUPLICATE_FILE', 'An identical file was already uploaded; it was not stored again.', { existingDocumentId: dup.id, existing: mapDocument(dup) });
  }

  const id = newId('doc');
  let saved;
  try {
    saved = await storage.saveFile(file.path, id, file.originalname);
  } catch (e) {
    fail(500, 'STORAGE_FAILED', `Could not save the file to the Data Vault: ${e.message}`);
  }
  const title = String(body.title || '').trim() || file.originalname.replace(/\.[^/.]+$/, '');
  const doc = insertDocument({
    id, batch_id: batchId, owner_id: owner.id, actor_id: actor.id, title,
    original_filename: file.originalname, kind, file_type: ext.replace('.', ''), mime_type: file.mimetype || null,
    size_bytes: saved.size, sha256: saved.sha256, category_id: category.id,
    language: String(body.language || 'Arabic').trim() || 'Arabic',
    vault_path: saved.relPath, storage_reference: saved.storageReference,
    upload_status: 'stored', ocr_status: kind === 'image' || kind === 'media' ? 'pending' : 'not_applicable',
    index_status: 'pending',
    pages_kind: ext === '.pdf' ? 'pdf' : kind === 'image' ? 'image' : 'estimated',
    page_count: ext === '.pdf' ? 0 : 1,
    source: 'upload', attribution: 'verified', uploaded_at: nowIso(),
  });
  audit.record({
    action: 'document.uploaded', actor, supervisor: owner, doc, ip, uploadStatus: 'stored',
    detail: { onBehalf: owner.id !== actor.id, sha256: saved.sha256 },
  });
  return doc;
}

/** Persists multiple images as a single Book entity with child book_pages. */
async function storeBookImages({ files, body, actor, ip }) {
  if (!files || !files.length) {
    throw new AppError(400, 'NO_FILES', 'At least one image file is required.');
  }
  const owner = resolveOwner(actor, body.supervisorId);
  const cleanup = () => files.forEach((f) => storage.removeTemp(f.path));
  const fail = (status, code, message) => {
    cleanup();
    recordUploadFailure({
      actor, ownerRef: body.supervisorId, filename: files[0].originalname,
      sizeBytes: files.reduce((acc, f) => acc + f.size, 0),
      categoryRef: body.categoryId || body.category, batchId: body.batchId,
      code, reason: message, ip, kind: 'image', fileType: 'images',
    });
    throw new AppError(status, code, message);
  };

  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (!IMAGE_EXTS.includes(ext)) {
      fail(400, 'UNSUPPORTED_FILE_TYPE', `File "${f.originalname}" is not an allowed image format (JPG, PNG, WEBP).`);
    }
    if (!f.size) fail(422, 'EMPTY_FILE', `The file "${f.originalname}" is empty.`);
  }

  let category;
  let batchId;
  try {
    category = resolveCategoryOrThrow(body.categoryId || body.category);
    batchId = resolveBatch(body.batchId, actor, owner);
  } catch (e) {
    fail(e.status || 400, e.code || 'INVALID_REQUEST', e.message);
  }

  const id = newId('doc');
  const bookTitle = body.title && String(body.title).trim() ? String(body.title).trim() : null;
  const displayTitle = bookTitle || files[0].originalname.replace(/\.[^/.]+$/, '');
  const savedPages = [];
  let totalBytes = 0;

  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const pageNumber = i + 1;
      const saved = await storage.saveFile(f.path, `${id}_p${pageNumber}`, f.originalname);
      savedPages.push({ pageNumber, file: f, saved });
      totalBytes += saved.size;
    }
  } catch (e) {
    fail(500, 'STORAGE_FAILED', `Could not save image files to the Data Vault: ${e.message}`);
  }

  const firstSaved = savedPages[0].saved;
  const doc = insertDocument({
    id,
    batch_id: batchId,
    owner_id: owner.id,
    actor_id: actor.id,
    title: displayTitle,
    original_filename: files[0].originalname,
    kind: 'image',
    file_type: 'images',
    mime_type: files[0].mimetype || 'image/jpeg',
    size_bytes: totalBytes,
    sha256: firstSaved.sha256,
    category_id: category.id,
    language: String(body.language || 'Arabic').trim() || 'Arabic',
    vault_path: firstSaved.relPath,
    storage_reference: firstSaved.storageReference,
    upload_status: 'stored',
    ocr_status: 'pending',
    index_status: 'pending',
    pages_kind: 'image',
    page_count: files.length,
    pages_total: files.length,
    pages_processed: 0,
    pages_failed: 0,
    source: 'upload',
    attribution: 'verified',
    uploaded_at: nowIso(),
  });

  for (const sp of savedPages) {
    run(
      `INSERT INTO book_pages (id, book_id, page_number, original_filename, file_size, vault_path, ocr_status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      newId('pg'), id, sp.pageNumber, sp.file.originalname, sp.saved.size, sp.saved.relPath, 'pending', nowIso()
    );
  }

  audit.record({
    action: 'document.uploaded',
    actor,
    supervisor: owner,
    doc,
    ip,
    uploadStatus: 'stored',
    detail: { onBehalf: owner.id !== actor.id, pagesCount: files.length },
  });

  return doc;
}

async function storeRawText({ title, textContent, body, actor, ip }) {
  const owner = resolveOwner(actor, body.supervisorId);
  const text = String(textContent || '').trim();
  const docTitle = String(title || '').trim() || `Pasted Note ${nowIso().slice(0, 16).replace('T', ' ')}`;
  const fail = (status, code, message) => {
    recordUploadFailure({ actor, ownerRef: body.supervisorId, filename: docTitle, categoryRef: body.categoryId || body.category, batchId: body.batchId, code, reason: message, ip, kind: 'raw_text', fileType: 'txt' });
    throw new AppError(status, code, message);
  };
  if (!text) fail(400, 'TEXT_REQUIRED', 'Text content is required.');
  let category;
  let batchId;
  try {
    category = resolveCategoryOrThrow(body.categoryId || body.category);
    batchId = resolveBatch(body.batchId, actor, owner);
  } catch (e) {
    fail(e.status || 400, e.code || 'INVALID_REQUEST', e.message);
  }
  const id = newId('doc');
  const saved = await storage.saveText(text, id, docTitle);
  const doc = insertDocument({
    id, batch_id: batchId, owner_id: owner.id, actor_id: actor.id, title: docTitle,
    original_filename: `${storage.sanitizeFilename(docTitle)}.txt`, kind: 'raw_text', file_type: 'txt', mime_type: 'text/plain',
    size_bytes: saved.size, sha256: saved.sha256, category_id: category.id,
    language: String(body.language || 'Arabic').trim() || 'Arabic', vault_path: saved.relPath, storage_reference: saved.storageReference,
    upload_status: 'stored', ocr_status: 'not_applicable', index_status: 'pending', pages_kind: 'estimated',
    page_count: 1, raw_text: text,
    source: 'upload', attribution: 'verified', uploaded_at: nowIso(),
  });
  audit.record({ action: 'document.uploaded', actor, supervisor: owner, doc, ip, uploadStatus: 'stored', detail: { onBehalf: owner.id !== actor.id } });
  return doc;
}

async function storeScrapedUrl({ url, title, scraped, body, actor, ip }) {
  const owner = resolveOwner(actor, body.supervisorId);
  const category = resolveCategoryOrThrow(body.categoryId || body.category);
  const batchId = resolveBatch(body.batchId, actor, owner);
  const docTitle = String(title || '').trim() || scraped.title || url;
  const id = newId('doc');
  const saved = await storage.saveText(`Source URL: ${url}\nTitle: ${docTitle}\n\n${scraped.content}`, id, docTitle);
  const doc = insertDocument({
    id, batch_id: batchId, owner_id: owner.id, actor_id: actor.id, title: docTitle,
    original_filename: url, kind: 'url', file_type: 'url', mime_type: 'text/plain', size_bytes: saved.size, sha256: saved.sha256,
    category_id: category.id, language: String(body.language || 'Arabic').trim() || 'Arabic',
    vault_path: saved.relPath, storage_reference: saved.storageReference, source_url: url,
    upload_status: 'stored', ocr_status: 'not_applicable', index_status: 'pending', pages_kind: 'estimated',
    source: 'upload', attribution: 'verified', uploaded_at: nowIso(),
  });
  audit.record({ action: 'document.uploaded', actor, supervisor: owner, doc, ip, uploadStatus: 'stored', detail: { url } });
  return doc;
}

// ------------------------------------------------------------------ admin edit / delete
function updateDocument(id, patch, actor) {
  const d = getDocumentRow(id);
  if (!d) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  const changes = {};
  if (patch.title !== undefined) {
    const t = String(patch.title).trim();
    if (!t) throw new AppError(400, 'TITLE_REQUIRED', 'Title cannot be empty.');
    if (t !== d.title) changes.title = { from: d.title, to: t };
  }
  if (patch.language !== undefined && String(patch.language).trim() && String(patch.language).trim() !== d.language) {
    changes.language = { from: d.language, to: String(patch.language).trim() };
  }
  let newCat = null;
  if (patch.categoryId !== undefined || patch.category !== undefined) {
    newCat = categories.resolveCategory(patch.categoryId || patch.category);
    if (!newCat) throw new AppError(400, 'CATEGORY_NOT_FOUND', 'The selected category does not exist.');
    if (newCat.id !== d.category_id) {
      const old = d.category_id ? categories.getCategory(d.category_id) : null;
      changes.category = { from: old ? { id: old.id, name: old.name } : null, to: { id: newCat.id, name: newCat.name } };
    }
  }
  let newOwner = null;
  if (patch.ownerId !== undefined && patch.ownerId !== null && patch.ownerId !== '') {
    if (actor.role !== 'admin') throw new AppError(403, 'FORBIDDEN', 'Only an administrator can reassign ownership.');
    newOwner = get("SELECT id, name, email FROM users WHERE id = ? AND role = 'supervisor'", patch.ownerId);
    if (!newOwner) throw new AppError(400, 'SUPERVISOR_NOT_FOUND', 'The selected supervisor does not exist.');
    if (newOwner.id !== d.owner_id) changes.owner = { from: d.owner_id, to: newOwner.id };
  }
  if (!Object.keys(changes).length) return mapDocument(d);
  run('UPDATE documents SET title = ?, language = ?, category_id = ?, owner_id = ?, attribution = ? WHERE id = ?',
    changes.title ? changes.title.to : d.title,
    changes.language ? changes.language.to : d.language,
    changes.category ? changes.category.to.id : d.category_id,
    changes.owner ? changes.owner.to : d.owner_id,
    changes.owner ? 'assigned_by_admin' : d.attribution, id);
  const updated = getDocumentRow(id);
  audit.record({
    action: changes.owner ? 'document.owner_reassigned' : changes.category && Object.keys(changes).length === 1 ? 'document.category_reassigned' : 'document.updated',
    actor, supervisor: newOwner || undefined, doc: updated, detail: { changes },
  });
  require('../models/vectorDbModel').invalidateCache();
  return mapDocument(updated);
}

function deleteDocument(id, actor) {
  const d = getDocumentRow(id);
  if (!d) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  const snapshotChunks = d.chunk_count;
  tx(() => {
    run('DELETE FROM processing_jobs WHERE document_id = ?', id);
    run('DELETE FROM chunks WHERE document_id = ?', id);
    run('DELETE FROM documents WHERE id = ?', id);
  });
  let fileRemoved = false;
  if (d.vault_path) fileRemoved = storage.deleteFile(d.vault_path);
  audit.record({ action: 'document.deleted', actor, doc: d, detail: { chunksDeleted: snapshotChunks, vaultFileRemoved: fileRemoved } });
  require('../models/vectorDbModel').invalidateCache();
  return { deleted: true, chunksDeleted: snapshotChunks, vaultFileRemoved: fileRemoved };
}

module.exports = {
  classifyExt, pipelineStatus, mapDocument, getDocumentRow, getAuthorizedDocument, listDocuments,
  createBatch, batchSummary, resolveOwner, resolveCategoryOrThrow, recordUploadFailure,
  storeUploadedFile, storeBookImages, storeRawText, storeScrapedUrl, updateDocument, deleteDocument,
  DOC_EXTS, IMAGE_EXTS, MEDIA_EXTS,
};
