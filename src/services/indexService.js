// ==============================================================================
// Search index management (Phase 5). Vectors from different embedding models are
// not comparable, so after switching models (e.g. Gemini -> bge-m3) the index must
// be rebuilt: stale chunks are purged and their documents re-queued, then the
// normal pipeline re-extracts (with OCR where needed) and re-embeds them.
//
// Safety: a pre-flight embedding call against the NEW model must succeed before
// anything is deleted; a dry run reports what would happen without changing data.
// ==============================================================================
const { get, all, run, tx } = require('../db/database');
const { nowIso } = require('../utils/clock');
const { AppError } = require('../utils/errors');
const storage = require('./storageService');
const audit = require('./auditService');
const events = require('./eventBus');

const MODES = ['stale', 'all', 'failed'];
const REBUILD_FLAG = 'index.last_rebuild';
let rebuilding = false;

function aiProvider() {
  return require('./aiProvider');
}

function lastRebuild() {
  const r = get('SELECT value FROM system_flags WHERE key = ?', REBUILD_FLAG);
  try { return r && r.value ? JSON.parse(r.value) : null; } catch (_) { return null; }
}

/** Index health for the admin "Search index" card. */
function status() {
  const tag = aiProvider().provider().embedTag();
  const byModel = all(
    `SELECT COALESCE(c.embed_model, '(unknown)') AS model, COUNT(*) AS chunks, COUNT(DISTINCT c.document_id) AS documents
     FROM chunks c JOIN documents d ON d.id = c.document_id GROUP BY c.embed_model ORDER BY chunks DESC`
  ).map((r) => ({ ...r, active: r.model === tag }));
  const docs = get(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN index_status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN index_status = 'failed' OR ocr_status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN index_status IN ('pending','processing','not_started') AND ocr_status != 'failed' THEN 1 ELSE 0 END) AS in_progress
     FROM documents`
  );
  const staleDocs = get(
    `SELECT COUNT(DISTINCT c.document_id) AS n FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE d.index_status = 'completed' AND c.embed_model IS NOT ?`,
    tag
  ).n;
  const activeDocs = get(
    `SELECT COUNT(DISTINCT c.document_id) AS n FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE d.index_status = 'completed' AND c.embed_model = ?`,
    tag
  ).n;
  const queue = require('./jobQueue').queueStats();
  return {
    activeModel: tag,
    byModel,
    chunksActive: byModel.filter((m) => m.active).reduce((n, m) => n + m.chunks, 0),
    chunksStale: byModel.filter((m) => !m.active).reduce((n, m) => n + m.chunks, 0),
    documents: {
      total: docs.total || 0,
      completed: docs.completed || 0,
      searchable: activeDocs || 0,
      stale: staleDocs || 0,
      failed: docs.failed || 0,
      inProgress: docs.in_progress || 0,
    },
    queue,
    rebuilding,
    lastRebuild: lastRebuild(),
  };
}

function targetDocuments(mode, tag) {
  if (mode === 'all') {
    return all("SELECT * FROM documents WHERE index_status NOT IN ('processing') ORDER BY uploaded_at");
  }
  if (mode === 'failed') {
    return all("SELECT * FROM documents WHERE (index_status = 'failed' OR ocr_status = 'failed') ORDER BY uploaded_at");
  }
  // stale: documents indexed with another model, plus every failed document
  return all(
    `SELECT * FROM documents d WHERE d.index_status != 'processing' AND (
       d.index_status = 'failed' OR d.ocr_status = 'failed'
       OR (d.index_status = 'completed' AND EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id AND c.embed_model IS NOT ?))
     ) ORDER BY d.uploaded_at`,
    tag
  );
}

/**
 * Purges stale vectors and re-queues documents for re-indexing with the active embedding model.
 * @param {{mode?: 'stale'|'all'|'failed', dryRun?: boolean, actor: Object, ip?: string}} o
 */
async function rebuild({ mode = 'stale', dryRun = false, actor, ip } = {}) {
  if (!MODES.includes(mode)) throw new AppError(400, 'INVALID_REBUILD_MODE', `Unknown rebuild mode "${mode}".`);
  if (rebuilding) throw new AppError(409, 'REBUILD_IN_PROGRESS', 'An index rebuild is already being prepared.');
  rebuilding = true;
  try {
    const { provider, classifyError } = aiProvider();
    const tag = provider().embedTag();

    // 1. Pre-flight: the new embedding model must answer before we delete anything.
    const t0 = Date.now();
    let preflight;
    try {
      const v = await provider().embed('pre-flight check for the search index rebuild');
      preflight = { ok: true, dimensions: v.length, ms: Date.now() - t0 };
    } catch (e) {
      const c = classifyError(e);
      preflight = { ok: false, code: c.code, message: c.message, ms: Date.now() - t0 };
    }

    // 2. Select documents; files missing from the vault cannot be re-processed.
    const candidates = targetDocuments(mode, tag);
    const active = new Set(all("SELECT document_id FROM processing_jobs WHERE status IN ('queued','running')").map((r) => r.document_id));
    const eligible = [];
    const skipped = [];
    for (const d of candidates) {
      if (active.has(d.id)) skipped.push({ id: d.id, title: d.title, code: 'ALREADY_QUEUED' });
      else if (!d.vault_path || !storage.exists(d.vault_path)) skipped.push({ id: d.id, title: d.title, code: 'FILE_MISSING' });
      else eligible.push(d);
    }
    const staleChunks = eligible.length
      ? get(`SELECT COUNT(*) AS n FROM chunks WHERE document_id IN (${eligible.map(() => '?').join(',')})`, ...eligible.map((d) => d.id)).n
      : 0;
    const report = {
      mode, dryRun, activeModel: tag, preflight,
      documents: candidates.length, queued: 0, skipped: skipped.length, skippedDetails: skipped.slice(0, 50),
      chunksPurged: 0, chunksToPurge: staleChunks,
    };
    if (dryRun) return report;
    if (!preflight.ok) {
      throw new AppError(preflight.code === 'AI_RATE_LIMIT' || preflight.code === 'AI_NETWORK' ? 503 : 502, preflight.code,
        `Pre-flight failed, nothing was deleted: the embedding model "${tag}" did not answer (${preflight.message})`, { preflight });
    }

    // 3. Purge + reset atomically, then enqueue.
    const purged = tx(() => {
      let n = 0;
      for (const d of eligible) {
        n += run('DELETE FROM chunks WHERE document_id = ?', d.id).changes || 0;
        run(
          `UPDATE documents SET index_status = 'pending', ocr_status = ?, failure_code = NULL, failure_reason = NULL, chunk_count = 0 WHERE id = ?`,
          d.kind === 'image' || d.kind === 'media' ? 'pending' : 'not_applicable', d.id
        );
      }
      return n;
    });
    require('../models/vectorDbModel').invalidateCache();
    const jobQueue = require('./jobQueue');
    for (const d of eligible) {
      if (jobQueue.enqueue(d.id)) report.queued++;
      events.publishDoc('document.queued', d);
    }
    report.chunksPurged = purged;
    const summary = { at: nowIso(), mode, activeModel: tag, queued: report.queued, skipped: skipped.length, chunksPurged: purged, by: actor && (actor.email || actor.name) };
    run('INSERT INTO system_flags (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', REBUILD_FLAG, JSON.stringify(summary));
    audit.record({ action: 'index.rebuild_started', actor, ip, detail: { mode, activeModel: tag, queued: report.queued, skipped: skipped.length, chunksPurged: purged } });
    events.publish('index.rebuild', { mode, queued: report.queued });
    console.log(`[Index] rebuild (${mode}) by ${summary.by || 'system'}: ${report.queued} document(s) re-queued, ${purged} stale chunk(s) purged, ${skipped.length} skipped; model=${tag}`);
    return report;
  } finally {
    rebuilding = false;
  }
}

module.exports = { status, rebuild, MODES };
