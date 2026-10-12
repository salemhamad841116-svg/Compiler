const { get, all, run } = require('../db/database');
const { newId } = require('../utils/ids');
const { nowIso } = require('../utils/clock');

const SYSTEM_ACTOR = { id: null, name: 'system', role: 'system' };

function userSnapshot(userOrId) {
  if (!userOrId) return null;
  if (typeof userOrId === 'object') return userOrId;
  return get('SELECT id, name, email, role FROM users WHERE id = ?', userOrId) || null;
}

/**
 * Records an immutable audit event. Generated only by backend code paths.
 *
 * @param {Object} e
 * @param {string} e.action - e.g. 'document.uploaded'
 * @param {Object} [e.actor] - the user who actually performed the action (defaults to system)
 * @param {Object|string} [e.supervisor] - supervisor the action is attributed to (account or id)
 * @param {Object} [e.doc] - document row used to snapshot descriptive fields
 */
function record(e) {
  const actor = e.actor ? { id: e.actor.id, name: e.actor.name, role: e.actor.role } : SYSTEM_ACTOR;
  const doc = e.doc || null;
  const supervisor = userSnapshot(e.supervisor !== undefined ? e.supervisor : doc && doc.owner_id);
  const categoryId = e.categoryId !== undefined ? e.categoryId : doc && doc.category_id;
  let categoryName = e.categoryName;
  if (categoryName === undefined && categoryId) {
    const c = get('SELECT name FROM categories WHERE id = ?', categoryId);
    categoryName = c ? c.name : null;
  }
  const id = newId('evt');
  const at = e.at || nowIso();
  run(
    `INSERT INTO audit_events (
      id, at, action, actor_id, actor_name, actor_role, supervisor_id, supervisor_name,
      document_id, batch_id, title, filename, kind, file_type, size_bytes, category_id, category_name,
      pages_total, pages_processed, pages_failed, upload_status, ocr_status, index_status,
      outcome, failure_reason, completed_at, counts_lifetime, detail, ip
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    at,
    e.action,
    actor.id,
    actor.name,
    actor.role,
    supervisor ? supervisor.id : null,
    supervisor ? supervisor.name : e.supervisorName || null,
    e.documentId || (doc && doc.id) || null,
    e.batchId || (doc && doc.batch_id) || null,
    e.title !== undefined ? e.title : doc && doc.title,
    e.filename !== undefined ? e.filename : doc && doc.original_filename,
    e.kind !== undefined ? e.kind : doc && doc.kind,
    e.fileType !== undefined ? e.fileType : doc && doc.file_type,
    e.sizeBytes !== undefined ? e.sizeBytes : doc && doc.size_bytes,
    categoryId || null,
    categoryName || null,
    e.pagesTotal !== undefined ? e.pagesTotal : doc && doc.pages_total,
    e.pagesProcessed !== undefined ? e.pagesProcessed : doc && doc.pages_processed,
    e.pagesFailed !== undefined ? e.pagesFailed : doc && doc.pages_failed,
    e.uploadStatus !== undefined ? e.uploadStatus : doc && doc.upload_status,
    e.ocrStatus !== undefined ? e.ocrStatus : doc && doc.ocr_status,
    e.indexStatus !== undefined ? e.indexStatus : doc && doc.index_status,
    e.outcome || 'success',
    e.failureReason || null,
    e.completedAt || null,
    e.countsLifetime ? 1 : 0,
    e.detail ? JSON.stringify(e.detail) : null,
    e.ip || null
  );
  return id;
}

const SORT_COLUMNS = { at: 'e.at' };

/**
 * Builds the filtered activity query. scopeSupervisorId forces supervisor scope (server-enforced).
 */
function buildActivityQuery(filters, scopeSupervisorId) {
  const where = [];
  const params = [];
  if (scopeSupervisorId) {
    where.push('e.supervisor_id = ?');
    params.push(scopeSupervisorId);
  } else if (filters.supervisorId) {
    where.push('e.supervisor_id = ?');
    params.push(filters.supervisorId);
  }
  if (filters.from) {
    where.push('e.at >= ?');
    params.push(new Date(filters.from).toISOString());
  }
  if (filters.to) {
    where.push('e.at <= ?');
    params.push(new Date(filters.to).toISOString());
  }
  if (filters.q) {
    where.push('(e.title LIKE ? OR e.filename LIKE ? OR e.document_id = ? OR e.batch_id = ? OR e.id = ?)');
    const like = `%${String(filters.q).replace(/[%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like, filters.q, filters.q, filters.q);
  }
  if (filters.categoryId) {
    where.push('e.category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.action) {
    where.push('e.action = ?');
    params.push(filters.action);
  }
  if (filters.batchId) {
    where.push('e.batch_id = ?');
    params.push(filters.batchId);
  }
  if (filters.status) {
    where.push('(COALESCE(d.index_status, e.index_status) = ? OR e.outcome = ? OR e.upload_status = ?)');
    params.push(filters.status, filters.status, filters.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

function mapEvent(r) {
  return {
    id: r.id,
    at: r.at,
    action: r.action,
    actor: { id: r.actor_id, name: r.actor_name, role: r.actor_role },
    supervisor: r.supervisor_id || r.supervisor_name ? { id: r.supervisor_id, name: r.supervisor_name } : null,
    documentId: r.document_id,
    batchId: r.batch_id,
    title: r.title,
    filename: r.filename,
    kind: r.kind,
    fileType: r.file_type,
    sizeBytes: r.size_bytes,
    category: r.category_id || r.category_name ? { id: r.category_id, name: r.category_name } : null,
    pages: { total: r.pages_total, processed: r.pages_processed, failed: r.pages_failed },
    statuses: {
      upload: r.upload_status,
      ocr: r.ocr_status,
      index: r.index_status,
    },
    outcome: r.outcome,
    failureReason: r.failure_reason,
    completedAt: r.completed_at,
    detail: r.detail ? safeJson(r.detail) : null,
    // Live state of the related document (null if it was deleted: history is preserved via the snapshot above)
    current: r.cur_id
      ? {
          uploadStatus: r.cur_upload_status,
          ocrStatus: r.cur_ocr_status,
          indexStatus: r.cur_index_status,
          pagesTotal: r.cur_pages_total,
          pagesProcessed: r.cur_pages_processed,
          pagesFailed: r.cur_pages_failed,
          completedAt: r.cur_completed_at,
          failureReason: r.cur_failure_reason,
          fileUrl: `/api/documents/${r.cur_id}/file`,
        }
      : null,
    documentDeleted: Boolean(r.document_id && !r.cur_id),
    detailsUrl: r.document_id ? `/api/documents/${r.document_id}` : null,
  };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

const SELECT_EVENT = `
  SELECT e.*, d.id AS cur_id, d.upload_status AS cur_upload_status, d.ocr_status AS cur_ocr_status,
         d.index_status AS cur_index_status, d.pages_total AS cur_pages_total,
         d.pages_processed AS cur_pages_processed, d.pages_failed AS cur_pages_failed,
         d.completed_at AS cur_completed_at, d.failure_reason AS cur_failure_reason
  FROM audit_events e LEFT JOIN documents d ON d.id = e.document_id`;

function listActivity(filters = {}, scopeSupervisorId = null) {
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(filters.pageSize, 10) || 25));
  const { whereSql, params } = buildActivityQuery(filters, scopeSupervisorId);
  const total = get(
    `SELECT COUNT(*) AS n FROM audit_events e LEFT JOIN documents d ON d.id = e.document_id ${whereSql}`,
    ...params
  ).n;
  const rows = all(
    `${SELECT_EVENT} ${whereSql} ORDER BY e.at DESC, e.id DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize
  );
  return { total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), items: rows.map(mapEvent) };
}

function exportActivityRows(filters = {}, scopeSupervisorId = null, limit = 100000) {
  const { whereSql, params } = buildActivityQuery(filters, scopeSupervisorId);
  return all(`${SELECT_EVENT} ${whereSql} ORDER BY e.at DESC, e.id DESC LIMIT ?`, ...params, limit).map(mapEvent);
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const dubaiFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function toDubai(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${dubaiFmt.format(d).replace(',', '')} GST(UTC+4)`;
}

function activityToCsv(items) {
  const header = [
    'event_id', 'time_utc', 'time_asia_dubai', 'action', 'actor_id', 'actor_name', 'actor_role',
    'supervisor_id', 'supervisor_name', 'document_id', 'batch_id', 'title', 'filename', 'kind', 'file_type',
    'size_bytes', 'category_id', 'category_name', 'pages_total', 'pages_processed', 'pages_failed',
    'upload_status', 'ocr_status', 'index_status', 'outcome', 'failure_reason', 'completed_at_utc',
  ];
  const lines = [header.join(',')];
  for (const i of items) {
    lines.push(
      [
        i.id, i.at, toDubai(i.at), i.action, i.actor.id, i.actor.name, i.actor.role,
        i.supervisor && i.supervisor.id, i.supervisor && i.supervisor.name, i.documentId, i.batchId,
        i.title, i.filename, i.kind, i.fileType, i.sizeBytes, i.category && i.category.id,
        i.category && i.category.name, i.pages.total, i.pages.processed, i.pages.failed,
        i.statuses.upload, i.statuses.ocr, i.statuses.index, i.outcome, i.failureReason, i.completedAt,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** System-only retention purge. Not reachable from any HTTP route. */
function purgeExpiredAuditEvents(retentionDays) {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  run("INSERT OR REPLACE INTO system_flags (key, value) VALUES ('audit_purge', '1')");
  try {
    return run('DELETE FROM audit_events WHERE at < ?', cutoff).changes;
  } finally {
    run("INSERT OR REPLACE INTO system_flags (key, value) VALUES ('audit_purge', '0')");
  }
}

module.exports = {
  record,
  listActivity,
  exportActivityRows,
  activityToCsv,
  purgeExpiredAuditEvents,
  toDubai,
  SYSTEM_ACTOR,
};
