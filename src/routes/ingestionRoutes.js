const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  processBookUpload,
  processRawTextInput,
  processMediaUpload,
  processUrlScraping,
  downloadVaultFile,
  listIndexedBooks,
} = require('../controllers/ingestionController');

const router = express.Router();

const uploadDir = path.join(__dirname, '../../uploads/temp_books/');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedFilename}`);
  },
});

// Document and Image file filter (.pdf, .txt, .md, .jpg, .jpeg, .png, .webp)
const documentFileFilter = (req, file, cb) => {
  const allowedExts = ['.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  const isImageMime = file.mimetype && file.mimetype.startsWith('image/');
  const isDocMime = file.mimetype && (file.mimetype === 'application/pdf' || file.mimetype.startsWith('text/'));
  if (allowedExts.includes(ext) || isImageMime || isDocMime) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${ext}. Supported formats: PDF, TXT, MD, JPG, PNG, WEBP`), false);
  }
};

// Media file filter (.mp4, .mp3, .wav, .m4a, .ogg, .webm, .mov)
const mediaFileFilter = (req, file, cb) => {
  const allowedExts = ['.mp4', '.mp3', '.wav', '.m4a', '.ogg', '.webm', '.mov', '.avi'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext) || file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid media type: ${ext}. Supported video/audio formats: .mp4, .mp3, .wav, .m4a, .ogg, .webm, .mov`), false);
  }
};

const documentUpload = multer({
  storage,
  fileFilter: documentFileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const mediaUpload = multer({
  storage,
  fileFilter: mediaFileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

const handleDocumentUpload = (req, res, next) => {
  documentUpload.single('bookFile')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'File size exceeds maximum limit (50MB).' });
        }
        return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ success: false, error: err.message || 'File upload error.' });
    }
    next();
  });
};

const handleMediaUpload = (req, res, next) => {
  mediaUpload.single('mediaFile')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'Media size exceeds maximum limit (100MB).' });
        }
        return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ success: false, error: err.message || 'Media upload error.' });
    }
    next();
  });
};

// 1. Document & Image Upload (.pdf, .txt, .md, .jpg, .png, .webp)
router.post('/upload-book', handleDocumentUpload, processBookUpload);

// 2. Raw Text Ingestion
router.post('/raw-text', processRawTextInput);

// 3. Video & Audio Speech-to-Text Ingestion (.mp4, .mp3, .wav, etc.)
router.post('/media', handleMediaUpload, processMediaUpload);

// 4. Web URL Scraper Ingestion
router.post('/scrape-url', processUrlScraping);

// 5. Books listing endpoint
router.get('/books', listIndexedBooks);

// 6. Data Vault file download endpoint
router.get('/vault/:filename', downloadVaultFile);

module.exports = router;
