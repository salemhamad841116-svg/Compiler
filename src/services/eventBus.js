// ==============================================================================
// In-process event bus + Server-Sent Events fan-out (Phase 4 real-time updates).
// Events: document.uploaded | document.processing | document.completed |
//         document.failed | document.deleted | settings.changed
// Supervisors only receive events about their own documents; admins receive all.
// ==============================================================================
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0);
let seq = 0;
const openStreams = new Set();

/**
 * @param {string} type
 * @param {Object} payload - may include documentId, ownerId, status, code
 */
function publish(type, payload = {}) {
  const evt = { id: ++seq, type, at: new Date().toISOString(), ...payload };
  bus.emit('event', evt);
  return evt;
}

/** Convenience for document lifecycle events from a documents row. */
function publishDoc(type, doc, extra = {}) {
  if (!doc) return null;
  return publish(type, {
    documentId: doc.id,
    ownerId: doc.owner_id || null,
    kind: doc.kind,
    title: doc.title,
    ...extra,
  });
}

function canSee(user, evt) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (evt.type === 'settings.changed') return false;
  return Boolean(evt.ownerId) && evt.ownerId === user.id;
}

/** Express handler: GET /api/events (mounted behind requireAuth). */
function sseHandler(req, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders && res.flushHeaders();
  res.write('retry: 5000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ role: req.user.role, at: new Date().toISOString() })}\n\n`);

  const onEvent = (evt) => {
    if (!canSee(req.user, evt)) return;
    res.write(`id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
  };
  bus.on('event', onEvent);
  openStreams.add(res);
  // Comment heartbeat keeps Cloudflare (100 s idle limit) and proxies from closing the stream.
  const hb = setInterval(() => res.write(`: hb ${Date.now()}\n\n`), 25000);
  hb.unref && hb.unref();
  const cleanup = () => {
    clearInterval(hb);
    bus.off('event', onEvent);
    openStreams.delete(res);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
}

/** Ends every open stream (graceful shutdown); browsers reconnect automatically after `retry`. */
function closeAll() {
  for (const res of openStreams) {
    try { res.end(); } catch (_) { /* already closed */ }
  }
  openStreams.clear();
}

function listenerCount() {
  return bus.listenerCount('event');
}

module.exports = { publish, publishDoc, sseHandler, canSee, listenerCount, closeAll, _bus: bus };
