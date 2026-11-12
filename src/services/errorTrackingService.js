const { getDb } = require('../db/database');
const { nowIso } = require('../utils/clock');
const crypto = require('crypto');

const MAX_STORED_ERRORS = 1000;

function cleanStack(stack) {
  if (!stack || typeof stack !== 'string') return '';
  return stack
    .split('\n')
    .slice(0, 15)
    .join('\n');
}

function clientIp(req) {
  if (!req) return null;
  const fwd = req.headers && req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket ? req.socket.remoteAddress : null) || null;
}

class ErrorTrackingService {
  captureException(err, req = null, { status = 500, code = null, severity = null } = {}) {
    if (!err) return null;

    const db = getDb();
    const id = `err_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const timestamp = nowIso();
    const errorCode = code || err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
    const message = err.message || String(err);
    const stack = cleanStack(err.stack);

    let calculatedSeverity = severity;
    if (!calculatedSeverity) {
      if (status >= 500) calculatedSeverity = 'fatal';
      else if (status >= 400) calculatedSeverity = 'error';
      else calculatedSeverity = 'warning';
    }

    const endpoint = req ? (req.originalUrl || req.url || null) : null;
    const method = req ? (req.method || null) : null;
    const actorId = req && req.user ? req.user.id : (req && req.serviceClient ? req.serviceClient.id : null);
    const actorEmail = req && req.user ? req.user.email : (req && req.serviceClient ? req.serviceClient.appSlug : null);
    const ip = clientIp(req);
    const detailsJson = JSON.stringify({
      requestId: req ? req.id || null : null,
      extra: err.extra || {},
    });

    try {
      db.prepare(`
        INSERT INTO error_events (
          id, timestamp, error_code, message, stack, severity,
          endpoint, method, status_code, actor_id, actor_email, ip, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        timestamp,
        errorCode || null,
        message || 'Unknown error',
        stack || null,
        calculatedSeverity || 'error',
        endpoint || null,
        method || null,
        status || 500,
        actorId || null,
        actorEmail || null,
        ip || null,
        detailsJson || null
      );

      // Prune old errors if exceeding maximum limit
      const countRow = db.prepare('SELECT COUNT(*) as c FROM error_events').get();
      if (countRow && countRow.c > MAX_STORED_ERRORS) {
        db.prepare(`
          DELETE FROM error_events
          WHERE id IN (
            SELECT id FROM error_events ORDER BY timestamp ASC LIMIT ?
          )
        `).run(countRow.c - MAX_STORED_ERRORS);
      }
    } catch (e) {
      console.error('[ErrorTracking] Failed to persist error event:', e.message);
    }

    return id;
  }

  getRecentErrors({ limit = 50, offset = 0, severity = null } = {}) {
    const db = getDb();
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);

    let query = 'SELECT * FROM error_events';
    const params = [];

    if (severity && severity !== 'all') {
      query += ' WHERE severity = ?';
      params.push(severity);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(lim, off);

    const rows = db.prepare(query).all(...params);
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      errorCode: r.error_code,
      message: r.message,
      stack: r.stack,
      severity: r.severity,
      endpoint: r.endpoint,
      method: r.method,
      statusCode: r.status_code,
      actorId: r.actor_id,
      actorEmail: r.actor_email,
      ip: r.ip,
      details: (() => {
        try { return JSON.parse(r.details_json || '{}'); } catch (_) { return {}; }
      })(),
    }));
  }

  getErrorStats() {
    const db = getDb();
    const totalRow = db.prepare('SELECT COUNT(*) as c FROM error_events').get();
    const fatalRow = db.prepare("SELECT COUNT(*) as c FROM error_events WHERE severity = 'fatal' OR status_code >= 500").get();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const last24hRow = db.prepare('SELECT COUNT(*) as c FROM error_events WHERE timestamp >= ?').get(dayAgo);
    const lastRow = db.prepare('SELECT timestamp FROM error_events ORDER BY timestamp DESC LIMIT 1').get();

    return {
      total: totalRow ? totalRow.c : 0,
      fatal: fatalRow ? fatalRow.c : 0,
      last24h: last24hRow ? last24hRow.c : 0,
      lastErrorAt: lastRow ? lastRow.timestamp : null,
    };
  }

  clearErrors() {
    const db = getDb();
    const r = db.prepare('DELETE FROM error_events').run();
    return { deletedCount: r.changes };
  }

  deleteError(id) {
    const db = getDb();
    const r = db.prepare('DELETE FROM error_events WHERE id = ?').run(id);
    return { deleted: r.changes > 0 };
  }
}

module.exports = new ErrorTrackingService();
