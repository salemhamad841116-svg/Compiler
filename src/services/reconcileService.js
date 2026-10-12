const path = require('path');
const { get, all, run } = require('../db/database');
const { newId } = require('../utils/ids');
const { nowIso } = require('../utils/clock');
const storage = require('./storageService');
const audit = require('./auditService');
const categories = require('./categoryService');
const documents = require('./documentService');
const jobQueue = require('./jobQueue');

const DETERMINISTIC_FAILURES = new Set(['NO_TEXT_LAYER', 'NO_TEXT', 'PDF_UNREADABLE', 'OCR_EMPTY', 'TRANSCRIPT_EMPTY']);

function sanitize(s) {
  return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Infers owner/time/category from a legacy vault path: <Category>/<ms>_<supervisor>_<name>. Returns evidence flags. */
function inferFromLegacyPath(relPath, users, cats) {
  const parts = relPath.split('/');
  const base = parts[parts.length - 1];
  const folder = parts.length > 1 ? parts[parts.length - 2] : null;
  const out = { owner: null, uploadedAt: null, category: null, titleGuess: base.replace(/\.[^/.]+$/, '') };
  const m = /^(\d{13})_(.+)$/.exec(base);
  if (m) {
    const ts = Number(m[1]);
    const d = new Date(ts);
    if (d.getFullYear() >= 2020 && d.getTime() <= Date.now() + 86400000) out.uploadedAt = d.toISOString();
    const rest = m[2];
    for (const u of users) {
      const token = `${sanitize(u.email)}_`;
      if (rest.startsWith(token)) {
        out.owner = u;
        out.titleGuess = rest.slice(token.length).replace(/\.[^/.]+$/, '');
        break;
      }
    }
  }
  if (folder && folder !== 'docs') {
    out.category = cats.find((c) => sanitize(c.name) === folder) || null;
  }
  return out;
}

function runReconciliation({ apply = false, actor = null } = {}) {
  const report = {
    ranAt: nowIso(),
    applied: Boolean(apply),
    vault: { files: 0, bytes: 0 },
    database: { documents: 0 },
    findings: {
      orphanVaultFiles: [],
      documentsMissingFile: [],
      documentsWithoutOwner: [],
      documentsWithoutCategory: [],
      documentsWithoutAuditEvents: [],
      stuckOrFailedEligibleForRetry: [],
      failedNotRetryable: [],
    },
    actions: { adopted: 0, auditBackfilled: 0, requeued: 0 },
    unrecoverable: [],
  };

  const files = storage.listAllFiles();
  report.vault.files = files.length;
  report.vault.bytes = files.reduce((s, f) => s + f.size, 0);
  const docs = all('SELECT * FROM documents');
  report.database.documents = docs.length;
  const known = new Set(docs.map((d) => d.vault_path).filter(Boolean));
  const users = all("SELECT id, name, email, role FROM users WHERE is_legacy_placeholder = 0");
  const cats = categories.listCategories();

  // 1. Vault files without a database record
  for (const f of files) {
    if (known.has(f.relPath)) continue;
    const ext = path.extname(f.relPath).toLowerCase();
    const kind = documents.classifyExt(ext);
    const inferred = inferFromLegacyPath(f.relPath, users, cats);
    const entry = {
      relPath: f.relPath, sizeBytes: f.size,
      inferred: {
        owner: inferred.owner ? { id: inferred.owner.id, email: inferred.owner.email, evidence: 'filename_embeds_account' } : null,
        uploadedAt: inferred.uploadedAt ? { value: inferred.uploadedAt, evidence: 'filename_timestamp' } : null,
        category: inferred.category ? { id: inferred.category.id, name: inferred.category.name, evidence: 'folder_name' } : null,
      },
      supported: Boolean(kind),
    };
    report.findings.orphanVaultFiles.push(entry);
    if (!kind) {
      report.unrecoverable.push({ type: 'orphan_file_unsupported_type', relPath: f.relPath });
      continue;
    }
    if (!apply) continue;
    const category = inferred.category || categories.ensureUncategorized();
    const id = newId('doc');
    run(
      `INSERT INTO documents (id, owner_id, actor_id, title, original_filename, kind, file_type, size_bytes, category_id, language,
         vault_path, storage_reference, upload_status, ocr_status, index_status, pages_kind, source, attribution, uploaded_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, inferred.owner ? inferred.owner.id : null, actor ? actor.id : null, inferred.titleGuess, path.posix.basename(f.relPath), kind,
      ext.replace('.', ''), f.size, category.id, 'Arabic', f.relPath, `local://vault/${f.relPath}`, 'stored',
      kind === 'image' || kind === 'media' ? 'pending' : 'not_applicable', 'pending',
      ext === '.pdf' ? 'pdf' : kind === 'image' ? 'image' : 'estimated', 'reconciled',
      inferred.owner ? 'inferred' : 'unknown', inferred.uploadedAt
    );
    audit.record({
      action: 'document.reconciled', actor, doc: get('SELECT * FROM documents WHERE id = ?', id),
      detail: { reason: 'orphan_vault_file', historicalUploadTimeUnavailable: !inferred.uploadedAt, ownerEvidence: inferred.owner ? 'filename' : null },
    });
    jobQueue.enqueue(id);
    report.actions.adopted++;
  }

  // 2/3. Records without files, owners, categories, audit events; failed/stuck processing
  const current = all('SELECT * FROM documents');
  for (const d of current) {
    const brief = { id: d.id, title: d.title, source: d.source };
    if (d.vault_path && !storage.exists(d.vault_path)) {
      report.findings.documentsMissingFile.push({ ...brief, vaultPath: d.vault_path });
      report.unrecoverable.push({ type: 'file_missing_from_vault', documentId: d.id, title: d.title, note: d.chunk_count ? 'Searchable text chunks still exist; original file cannot be recovered.' : 'No file and no chunks.' });
    } else if (!d.vault_path) {
      report.findings.documentsMissingFile.push({ ...brief, vaultPath: null });
    }
    if (!d.owner_id) report.findings.documentsWithoutOwner.push({ ...brief, legacyUploader: d.legacy_uploader, attribution: d.attribution });
    if (!d.category_id) report.findings.documentsWithoutCategory.push(brief);
    const hasEvents = get('SELECT 1 AS x FROM audit_events WHERE document_id = ? LIMIT 1', d.id);
    if (!hasEvents) {
      report.findings.documentsWithoutAuditEvents.push(brief);
      if (apply) {
        audit.record({
          action: 'document.reconciled', actor, doc: d,
          detail: { reason: 'missing_audit_history', historicalUploadTimeUnavailable: !d.uploaded_at, note: 'Original upload event was not recorded; this event marks when the record was reconciled.' },
        });
        report.actions.auditBackfilled++;
      }
    }
    const status = documents.pipelineStatus(d);
    const activeJob = get("SELECT 1 AS x FROM processing_jobs WHERE document_id = ? AND status IN ('queued','running')", d.id);
    const fileOk = d.vault_path && storage.exists(d.vault_path);
    if ((status === 'failed' || ((d.index_status === 'processing' || d.ocr_status === 'processing' || d.index_status === 'pending') && !activeJob)) && d.source !== 'legacy_import') {
      if (!fileOk) continue;
      if (status === 'failed' && DETERMINISTIC_FAILURES.has(d.failure_code)) {
        report.findings.failedNotRetryable.push({ ...brief, failureCode: d.failure_code, failureReason: d.failure_reason });
        report.unrecoverable.push({ type: 'processing_failure_content', documentId: d.id, title: d.title, code: d.failure_code });
        continue;
      }
      report.findings.stuckOrFailedEligibleForRetry.push({ ...brief, status, failureCode: d.failure_code });
      if (apply && !activeJob) {
        run("UPDATE documents SET index_status = 'pending', ocr_status = ?, failure_code = NULL, failure_reason = NULL WHERE id = ?", d.kind === 'image' || d.kind === 'media' ? 'pending' : 'not_applicable', d.id);
        if (jobQueue.enqueue(d.id)) report.actions.requeued++;
      }
    }
  }

  run("INSERT OR REPLACE INTO system_flags (key, value) VALUES ('last_reconcile_report', ?)", JSON.stringify(report));
  if (apply) {
    audit.record({ action: 'system.reconciliation_applied', actor, detail: { actions: report.actions, unrecoverable: report.unrecoverable.length } });
  }
  return report;
}

function lastReport() {
  const row = get("SELECT value FROM system_flags WHERE key = 'last_reconcile_report'");
  return row ? JSON.parse(row.value) : null;
}

module.exports = { runReconciliation, lastReport, inferFromLegacyPath };
