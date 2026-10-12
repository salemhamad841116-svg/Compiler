const express = require('express');
const { requireAuth, requireRole, asyncHandler } = require('../auth/middleware');
const documents = require('../services/documentService');
const jobQueue = require('../services/jobQueue');
const storage = require('../services/storageService');
const audit = require('../services/auditService');
const stats = require('../services/statsService');
const { getDocumentChunks } = require('../models/vectorDbModel');
const { AppError } = require('../utils/errors');

/** Document routes shared by supervisors (own records only) and admins (all records). */
const docs = express.Router();
docs.use(requireAuth(), requireRole('supervisor', 'admin'));

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

docs.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: documents.listDocuments(req.query, req.user) });
  })
);

docs.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: documents.mapDocument(documents.getAuthorizedDocument(req.params.id, req.user)) });
  })
);

docs.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    const d = documents.getAuthorizedDocument(req.params.id, req.user);
    const abs = d.vault_path ? storage.resolve(d.vault_path) : null;
    if (!abs || !storage.exists(d.vault_path)) {
      throw new AppError(404, 'FILE_MISSING', 'The stored file could not be found in the Data Vault.');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const inlineOk = req.query.inline === '1' && ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(String(d.file_type).toLowerCase());
    audit.record({ action: 'document.downloaded', actor: req.user, doc: d, ip: clientIp(req) });
    res.type(d.mime_type && inlineOk ? d.mime_type : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inlineOk ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.original_filename || 'file')}`);
    res.sendFile(abs);
  })
);

docs.get(
  '/:id/chunks',
  asyncHandler(async (req, res) => {
    const d = documents.getAuthorizedDocument(req.params.id, req.user);
    const chunks = getDocumentChunks(d.id);
    res.json({ success: true, count: chunks.length, data: chunks });
  })
);

const patch = asyncHandler(async (req, res) => {
  documents.getAuthorizedDocument(req.params.id, req.user);
  const body = req.body || {};
  res.json({
    success: true,
    data: documents.updateDocument(req.params.id, {
      title: body.title !== undefined ? body.title : body.newTitle,
      language: body.language,
      categoryId: body.categoryId,
      category: body.category,
      ownerId: body.ownerId,
    }, req.user),
  });
});
docs.patch('/:id', patch);
docs.put('/:id', patch);

docs.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    documents.getAuthorizedDocument(req.params.id, req.user);
    res.json({ success: true, data: documents.deleteDocument(req.params.id, req.user) });
  })
);

docs.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: jobQueue.retryDocument(req.params.id, req.user, { ip: clientIp(req) }) });
  })
);

/** "My workspace" routes: statistics and activity scoped server-side to the authenticated account. */
const me = express.Router();
me.use(requireAuth(), requireRole('supervisor', 'admin'));

me.get(
  '/stats',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: stats.overview({ ownerId: req.user.id }) });
  })
);

me.get(
  '/activity',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: audit.listActivity(req.query, req.user.id) });
  })
);

me.get(
  '/activity.csv',
  asyncHandler(async (req, res) => {
    const rows = audit.exportActivityRows(req.query, req.user.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my-activity.csv"');
    res.send(audit.activityToCsv(rows));
  })
);

module.exports = { docs, me };
