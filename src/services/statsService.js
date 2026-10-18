const { get, all } = require('../db/database');
const { nowIso } = require('../utils/clock');

// Admin end-to-end self-test probes are real uploads (audited) but must not inflate lifetime counters.
const E2E_PROBE_TITLE_PREFIX = 'E2E self-test MSRQ-';

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
     FROM audit_events WHERE COALESCE(title, '') NOT LIKE '${E2E_PROBE_TITLE_PREFIX}%'${auditScope}`,
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

function ingestionAnalytics() {
  const n = (v) => Number(v || 0);

  const booksRow = get('SELECT COUNT(*) AS total_books FROM documents');
  const totalBooks = n(booksRow && booksRow.total_books);

  const pagesRow = get(`
    SELECT
      COALESCE(SUM(CASE WHEN index_status = 'completed' THEN COALESCE(page_count, pages_processed, 1) ELSE 0 END), 0) AS total_pages_processed,
      COALESCE(SUM(CASE WHEN kind = 'image' AND index_status = 'completed' THEN COALESCE(page_count, pages_processed, 1) ELSE 0 END), 0) AS image_pages_processed,
      COALESCE(SUM(CASE WHEN kind = 'document' AND index_status = 'completed' THEN COALESCE(page_count, pages_processed, 1) ELSE 0 END), 0) AS doc_pages_processed
    FROM documents
  `);
  const totalPagesProcessed = n(pagesRow && pagesRow.total_pages_processed);
  const imagePagesProcessed = n(pagesRow && pagesRow.image_pages_processed);
  const docPagesProcessed = n(pagesRow && pagesRow.doc_pages_processed);

  const bySupervisor = all(`
    SELECT
      u.id AS supervisor_id,
      u.name AS supervisor_name,
      u.email AS supervisor_email,
      COUNT(d.id) AS book_count,
      COALESCE(SUM(CASE WHEN d.index_status = 'completed' THEN COALESCE(d.page_count, d.pages_processed, 1) ELSE 0 END), 0) AS pages_processed,
      COALESCE(SUM(COALESCE(d.page_count, d.pages_total, 1)), 0) AS total_pages
    FROM users u
    LEFT JOIN documents d ON d.owner_id = u.id
    WHERE u.role = 'supervisor' OR d.id IS NOT NULL
    GROUP BY u.id
    ORDER BY book_count DESC, u.name COLLATE NOCASE
  `).map((r) => ({
    supervisorId: r.supervisor_id,
    supervisorName: r.supervisor_name,
    supervisorEmail: r.supervisor_email,
    bookCount: n(r.book_count),
    pagesProcessed: n(r.pages_processed),
    totalPages: n(r.total_pages),
  }));

  const byCategory = all(`
    SELECT
      c.id AS category_id,
      c.name AS category_name,
      c.name_key,
      COUNT(d.id) AS book_count,
      COALESCE(SUM(CASE WHEN d.index_status = 'completed' THEN COALESCE(d.page_count, d.pages_processed, 1) ELSE 0 END), 0) AS pages_processed,
      COALESCE(SUM(COALESCE(d.page_count, d.pages_total, 1)), 0) AS total_pages
    FROM categories c
    LEFT JOIN documents d ON d.category_id = c.id
    GROUP BY c.id
    ORDER BY book_count DESC, c.name COLLATE NOCASE
  `).map((r) => ({
    categoryId: r.category_id,
    categoryName: r.category_name,
    nameKey: r.name_key || null,
    bookCount: n(r.book_count),
    pagesProcessed: n(r.pages_processed),
    totalPages: n(r.total_pages),
  }));

  const bySupervisorAndCategory = all(`
    SELECT
      COALESCE(u.id, 'unattributed') AS supervisor_id,
      COALESCE(u.name, 'Unattributed') AS supervisor_name,
      c.id AS category_id,
      c.name AS category_name,
      c.name_key,
      COUNT(d.id) AS book_count,
      COALESCE(SUM(CASE WHEN d.index_status = 'completed' THEN COALESCE(d.page_count, d.pages_processed, 1) ELSE 0 END), 0) AS pages_processed,
      COALESCE(SUM(COALESCE(d.page_count, d.pages_total, 1)), 0) AS total_pages
    FROM documents d
    LEFT JOIN users u ON u.id = d.owner_id
    JOIN categories c ON c.id = d.category_id
    GROUP BY d.owner_id, d.category_id
    ORDER BY book_count DESC, supervisor_name COLLATE NOCASE, category_name COLLATE NOCASE
  `).map((r) => ({
    supervisorId: r.supervisor_id,
    supervisorName: r.supervisor_name,
    categoryId: r.category_id,
    categoryName: r.category_name,
    nameKey: r.name_key || null,
    bookCount: n(r.book_count),
    pagesProcessed: n(r.pages_processed),
    totalPages: n(r.total_pages),
  }));

  return {
    generatedAt: nowIso(),
    totalBooks,
    totalPagesProcessed,
    imagePagesProcessed,
    docPagesProcessed,
    bySupervisor,
    byCategory,
    bySupervisorAndCategory,
  };
}

module.exports = { E2E_PROBE_TITLE_PREFIX, overview, perSupervisor, ingestionAnalytics };
