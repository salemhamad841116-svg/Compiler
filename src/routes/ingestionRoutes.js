const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { requireAuth, requireRole, asyncHandler } = require('../auth/middleware');
const documents = require('../services/documentService');
const c = require('../controllers/ingestionController');

const router = express.Router();

function makeUpload(maxMb, filter) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(config.tempUploadDir, { recursive: true });
      cb(null, config.tempUploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      req.pendingFileName = file.originalname; // for audit of rejected uploads
      filter(req, file, cb);
    },
  });
}

const docUpload = makeUpload(config.maxFileMb, (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const kind = documents.classifyExt(ext);
  if (kind === 'document' || kind === 'image') return cb(null, true);
  return cb(Object.assign(new Error(`Unsupported file type "${ext}". Allowed: PDF, TXT, MD, JPG, PNG, WEBP.`), { status: 400, code: 'UNSUPPORTED_FILE_TYPE' }));
});

const mediaUpload = makeUpload(config.maxMediaMb, (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (documents.classifyExt(ext) === 'media') return cb(null, true);
  return cb(Object.assign(new Error(`Unsupported media type "${ext}".`), { status: 400, code: 'UNSUPPORTED_FILE_TYPE' }));
});

/** Wraps multer so failures are returned as clean JSON AND recorded as failed uploads in the audit log. */
function handle(uploader, field, maxMb) {
  return (req, res, next) => {
    uploader.single(field)(req, res, (err) => {
      if (!err) return next();
      let status = err.status || 400;
      let code = err.code && typeof err.code === 'string' && !err.code.startsWith('LIMIT_') ? err.code : 'UPLOAD_REJECTED';
      let message = err.message || 'File upload error.';
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          status = 413;
          code = 'FILE_TOO_LARGE';
          message = `File size exceeds the maximum of ${maxMb} MB.`;
        } else {
          code = 'UPLOAD_ERROR';
        }
      }
      try {
        documents.recordUploadFailure({
          actor: req.user, ownerRef: req.body && req.body.supervisorId, filename: req.pendingFileName || null,
          categoryRef: req.body && (req.body.categoryId || req.body.category), batchId: req.body && req.body.batchId,
          code, reason: message, ip: req.socket.remoteAddress,
        });
      } catch (_) { /* never mask the real error */ }
      next(Object.assign(new Error(message), { status, code }));
    });
  };
}

const auth = [requireAuth(), requireRole('supervisor', 'admin')];

router.use(auth);

router.post('/batches', asyncHandler(c.createBatch));
router.get('/batches/:id', asyncHandler(c.getBatch));
router.post('/batches/:id/retry-failed', asyncHandler(c.retryFailedInBatch));

router.post('/upload-book', handle(docUpload, 'bookFile', config.maxFileMb), asyncHandler(c.uploadFile('document')));
router.post('/media', handle(mediaUpload, 'mediaFile', config.maxMediaMb), asyncHandler(c.uploadFile('media')));
router.post('/raw-text', asyncHandler(c.rawText));
router.post('/scrape-url', asyncHandler(c.scrapeUrl));
router.get('/books', asyncHandler(c.listBooks));

module.exports = router;
