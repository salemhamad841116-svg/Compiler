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

// Document file filter (.pdf, .txt, .md)
const documentFileFilter = (req, file, cb) => {
  const allowedExts = ['.pdf', '.txt', '.md'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid document type: ${ext}. Supported formats: .pdf, .txt, .md`), false);
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

// 1. Document Upload (.pdf, .txt, .md)
router.post('/upload-book', documentUpload.single('bookFile'), processBookUpload);

// 2. Raw Text Ingestion
router.post('/raw-text', processRawTextInput);

// 3. Video & Audio Speech-to-Text Ingestion (.mp4, .mp3, .wav, etc.)
router.post('/media', mediaUpload.single('mediaFile'), processMediaUpload);

// 4. Web URL Scraper Ingestion
router.post('/scrape-url', processUrlScraping);

// 5. Books listing endpoint
router.get('/books', listIndexedBooks);

// 6. Data Vault file download endpoint
router.get('/vault/:filename', downloadVaultFile);

module.exports = router;
