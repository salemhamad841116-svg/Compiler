const { get, all } = require('../db/database');
const { nowIso } = require('../utils/clock');

function ownerClause(alias, ownerId, params) {
  if (!ownerId) return '';
  params.push(ownerId);
  return ` AND ${alias}.owner_id = ?`;
}

/**
 * Authoritative statistics, each computed directly from database records.
 *
 * "current" figures describe what exists now (deleting a file removes it).
 * "lifetime" figures come from the append-only audit log (a retry never adds to them).
 */
function overview({ ownerId = null } = {}) {
  const p1 = [];
  const scope = ownerClause('d', ownerId, p1);

  const files = get(
    `SELECT COUNT(*) AS total,
       SUM(d.kind = 'image') AS images,
       SUM(d.kind = 'document') AS documents,
       SUM(d.kind = 'raw_text') AS raw_text,
       SUM(d.kind = 'media') AS media,
       SUM(d.kind = 'url') AS urls
     FROM documents d WHERE 1=1${scope}`,
    ...p1
  );

  const p2 = [];
  const scope2 = ownerClause('d', ownerId, p2);
  const pipe = get(
    `SELECT
       SUM(CASE WHEN d.ocr_status = 'failed' OR d.index_status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN d.ocr_status != 'failed' AND d.index_status != 'failed' AND (d.ocr_status = 'processing' OR d.index_status = 'processing') THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN d.ocr_status != 'failed' AND d.index_status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN d.ocr_status NOT IN ('failed','processing') AND d.index_status IN ('pending','not_started') THEN 1 ELSE 0 END) AS queued,
       SUM(CASE WHEN d.index_status = 'completed' AND d.kind = 'document' THEN 1 ELSE 0 END) AS indexed_documents,
       SUM(CASE WHEN d.index_status = 'completed' AND d.kind = 'image' THEN 1 ELSE 0 END) AS indexed_images,
       SUM(CASE WHEN d.index_status = 'completed' AND d.kind = 'raw_text' THEN 1 ELSE 0 END) AS indexed_raw_text,
       SUM(CASE WHEN d.index_status = 'completed' AND d.kind IN ('media','url') THEN 1 ELSE 0 END) AS indexed_other,
       SUM(CASE WHEN d.pages_kind = 'pdf' THEN d.pages_total ELSE 0 END) AS pdf_pages_total,
       SUM(CASE WHEN d.pages_kind = 'pdf' THEN d.pages_processed ELSE 0 END) AS pdf_pages_processed,
       SUM(CASE WHEN d.pages_kind = 'pdf' THEN d.pages_failed ELSE 0 END) AS pdf_pages_failed,
       SUM(d.size_bytes) AS bytes
     FROM documents d WHERE 1=1${scope2}`,
    ...p2
  );

  const p3 = [];
  const scope3 = ownerClause('d', ownerId, p3);
  const chunks = get(`SELECT COUNT(*) AS n FROM chunks c JOIN documents d ON d.id = c.document_id WHERE 1=1${scope3}`, ...p3).n;

  const pa = [];
  const auditScope = ownerId ? (pa.push(ownerId), ' AND supervisor_id = ?') : '';
  const lifetime = get(
    `SELECT
       SUM(action = 'document.uploaded') AS stored,
       SUM(action = 'document.upload_failed' AND COALESCE(json_extract(detail, '$.code'), '') != 'DUPLICATE_FILE') AS upload_failed,
       SUM(action = 'document.upload_failed' AND json_extract(detail, '$.code') = 'DUPLICATE_FILE') AS duplicates_rejected,
       SUM(action = 'document.processing_completed' AND counts_lifetime = 1) AS processed,
       SUM(CASE WHEN action = 'document.processing_completed' AND counts_lifetime = 1 THEN COALESCE(pages_processed, 0) ELSE 0 END) AS pages_processed,
       SUM(action = 'document.deleted') AS deleted
     FROM audit_events WHERE 1=1${auditScope}`,
    ...pa
  );

  const n = (v) => Number(v || 0);
  return {
    generatedAt: nowIso(),
    scope: ownerId ? 'supervisor' : 'all',
    current: {
      filesStored: {
        total: n(files.total), images: n(files.images), documents: n(files.documents),
        rawText: n(files.raw_text), media: n(files.media), urls: n(files.urls), bytes: n(pipe.bytes),
      },
      indexed: {
        documents: n(pipe.indexed_documents), images: n(pipe.indexed_images),
        rawText: n(pipe.indexed_raw_text), mediaAndUrls: n(pipe.indexed_other),
      },
      pipeline: { queued: n(pipe.queued), processing: n(pipe.processing), completed: n(pipe.completed), failed: n(pipe.failed) },
      pages: { pdfTotal: n(pipe.pdf_pages_total), pdfProcessed: n(pipe.pdf_pages_processed), pdfFailed: n(pipe.pdf_pages_failed) },
      chunks,
    },
    lifetime: {
      uploadsStored: n(lifetime.stored), uploadsFailed: n(lifetime.upload_failed), duplicatesRejected: n(lifetime.duplicates_rejected),
      processingCompleted: n(lifetime.processed), pagesProcessed: n(lifetime.pages_processed), documentsDeleted: n(lifetime.deleted),
    },
  };
}

function perSupervisor() {
  const owners = all(
    `SELECT u.id, u.name, u.email, u.role, u.status FROM users u
     WHERE u.is_legacy_placeholder = 0 AND (u.role = 'supervisor' OR EXISTS (SELECT 1 FROM documents d WHERE d.owner_id = u.id))
     ORDER BY u.name COLLATE NOCASE`
  );
  const rows = owners.map((u) => {
    const o = overview({ ownerId: u.id });
    const last = get("SELECT MAX(at) AS at FROM audit_events WHERE supervisor_id = ? AND action = 'document.uploaded'", u.id);
    return {
      supervisor: { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status },
      lastUploadAt: last ? last.at : null,
      ...o,
    };
  });
  const unattributed = get("SELECT COUNT(*) AS n FROM documents WHERE owner_id IS NULL").n;
  return { items: rows, unattributedDocuments: unattributed };
}

module.exports = { overview, perSupervisor };
