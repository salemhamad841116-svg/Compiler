const config = require('../config');
const { get, all, run, tx } = require('../db/database');
const { newId } = require('../utils/ids');
const { nowIso } = require('../utils/clock');
const { AppError } = require('../utils/errors');
const { processDocument } = require('./processingPipeline');
const audit = require('./auditService');
const documents = require('./documentService');

let running = 0;
let timer = null;
let started = false;

/** Queues processing for a document. Returns false if an active job already exists (idempotent). */
function enqueue(documentId) {
  try {
    run("INSERT INTO processing_jobs (id, document_id, status, attempt, queued_at) VALUES (?,?,?,?,?)", newId('job'), documentId, 'queued',
      (get('SELECT COUNT(*) AS n FROM processing_jobs WHERE document_id = ?', documentId).n || 0) + 1, nowIso());
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return false;
    throw e;
  }
  setImmediate(pump);
  return true;
}

function claimNext() {
  return tx(() => {
    const job = get("SELECT * FROM processing_jobs WHERE status = 'queued' ORDER BY queued_at, id LIMIT 1");
    if (!job) return null;
    run("UPDATE processing_jobs SET status = 'running', started_at = ? WHERE id = ?", nowIso(), job.id);
    return job;
  });
}

async function runJob(job) {
  running++;
  try {
    const result = await processDocument(job.document_id);
    run('UPDATE processing_jobs SET status = ?, finished_at = ?, last_error = ? WHERE id = ?', result.ok || result.skipped ? 'done' : 'failed', nowIso(), result.ok ? null : result.code || null, job.id);
  } catch (e) {
    console.error('[Queue] Unexpected job error:', e);
    run("UPDATE processing_jobs SET status = 'failed', finished_at = ?, last_error = ? WHERE id = ?", nowIso(), String(e.message).slice(0, 300), job.id);
    run("UPDATE documents SET index_status = 'failed', failure_code = 'INTERNAL_ERROR', failure_reason = ? WHERE id = ?", `Unexpected processing error: ${String(e.message).slice(0, 200)}`, job.document_id);
  } finally {
    running--;
    setImmediate(pump);
  }
}

function pump() {
  if (!started) return;
  while (running < config.jobConcurrency) {
    let job;
    try {
      job = claimNext();
    } catch (e) {
      console.error('[Queue] claim failed:', e.message);
      return;
    }
    if (!job) return;
    runJob(job);
  }
}

function start() {
  if (started) return;
  started = true;
  // Crash recovery: jobs that were running when the process stopped are resumed.
  run("UPDATE processing_jobs SET status = 'queued', started_at = NULL WHERE status = 'running'");
  // Documents stuck mid-processing without an active job are re-queued.
  const orphans = all("SELECT id FROM documents WHERE (index_status = 'processing' OR ocr_status = 'processing') AND id NOT IN (SELECT document_id FROM processing_jobs WHERE status IN ('queued','running'))");
  for (const o of orphans) enqueue(o.id);
  timer = setInterval(pump, 2000);
  timer.unref();
  setImmediate(pump);
}

function stop() {
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test/ops helper: resolves when nothing is queued or running. */
async function waitForIdle(timeoutMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    const n = get("SELECT COUNT(*) AS n FROM processing_jobs WHERE status IN ('queued','running')").n;
    if (n === 0 && running === 0) return true;
    if (Date.now() - t0 > timeoutMs) throw new Error('Queue did not become idle in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

function queueStats() {
  const rows = all('SELECT status, COUNT(*) AS n FROM processing_jobs GROUP BY status');
  const out = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** Re-queues a failed document. Never creates a new document or increments lifetime totals. */
function retryDocument(documentId, user, { force = false, ip } = {}) {
  const doc = documents.getAuthorizedDocument(documentId, user);
  const status = documents.pipelineStatus(doc);
  if (status === 'processing' || status === 'queued') {
    throw new AppError(409, 'ALREADY_QUEUED', 'This file is already queued or being processed.');
  }
  if (status === 'completed' && !(force && user.role === 'admin')) {
    throw new AppError(409, 'NOT_FAILED', 'This file was already processed successfully.');
  }
  if (!doc.vault_path || !require('./storageService').exists(doc.vault_path)) {
    throw new AppError(409, 'FILE_MISSING', 'The stored file is missing, so processing cannot be retried. Upload it again.');
  }
  run(
    `UPDATE documents SET index_status = 'pending', ocr_status = ?, failure_code = NULL, failure_reason = NULL WHERE id = ?`,
    doc.kind === 'image' || doc.kind === 'media' ? 'pending' : 'not_applicable', documentId
  );
  const queued = enqueue(documentId);
  require('./eventBus').publishDoc('document.queued', doc);
  audit.record({
    action: 'document.retry_requested', actor: user, doc: get('SELECT * FROM documents WHERE id = ?', documentId), ip,
    detail: { previousFailure: doc.failure_code, forced: Boolean(force) },
  });
  return { queued };
}

/**
 * Re-queues every failed document whose file is still in the Data Vault (admin / ops recovery,
 * e.g. after fixing the AI key or model configuration). Safe to run repeatedly.
 * @param {Object} actor - admin user (or a system actor with role 'admin' for CLI use)
 */
function retryAllFailed(actor, { ip } = {}) {
  const failed = all("SELECT id FROM documents WHERE index_status = 'failed' OR ocr_status = 'failed' ORDER BY uploaded_at");
  let queued = 0;
  const skipped = [];
  for (const d of failed) {
    try {
      if (retryDocument(d.id, actor, { ip }).queued) queued++;
      else skipped.push({ id: d.id, code: 'ALREADY_QUEUED' });
    } catch (e) {
      skipped.push({ id: d.id, code: e.code || 'ERROR' });
    }
  }
  console.log(`[Queue] retry-all-failed by ${actor && actor.email ? actor.email : (actor && actor.name) || 'system'}: ${queued} queued, ${skipped.length} skipped of ${failed.length} failed`);
  return { failed: failed.length, queued, skipped: skipped.length, skippedDetails: skipped.slice(0, 50) };
}

module.exports = { enqueue, start, stop, pump, waitForIdle, queueStats, retryDocument, retryAllFailed };
