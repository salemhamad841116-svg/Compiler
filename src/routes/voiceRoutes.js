const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { requireAuth, requireRole, asyncHandler } = require('../auth/middleware');
const voiceService = require('../services/voiceService');
const { AppError } = require('../utils/errors');

const upload = multer({
  dest: config.tempUploadDir,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const allowedMime = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/mp4'];
    const allowedExt = ['.wav', '.mp3', '.ogg', '.m4a'];
    if (allowedMime.includes(mime) || allowedExt.includes(ext)) {
      return cb(null, true);
    }
    return cb(new AppError(400, 'UNSUPPORTED_AUDIO_FORMAT', 'Unsupported audio format. Please upload WAV or MP3.'));
  },
});

// -------------------------------------------------------------
// Public / Chat Router
// -------------------------------------------------------------
const publicRouter = express.Router();

publicRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const voices = voiceService.listVoices({ activeOnly: true });
    const mapped = voices.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      duration: v.duration_seconds,
      speakerGender: v.speaker_gender,
      language: v.language,
      sampleUrl: `/api/voices/${v.id}/sample`,
    }));
    res.json({ success: true, voices: mapped });
  })
);

publicRouter.get(
  '/:id/sample',
  asyncHandler(async (req, res) => {
    const { filePath, mimeType } = voiceService.getVoiceAudioPath(req.params.id);
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  })
);

publicRouter.post(
  '/synthesize',
  asyncHandler(async (req, res) => {
    const { text, voiceId } = req.body || {};
    if (!text) throw new AppError(400, 'TEXT_REQUIRED', 'Field "text" is required.');
    if (!voiceId) throw new AppError(400, 'VOICE_ID_REQUIRED', 'Field "voiceId" is required.');

    const result = await voiceService.synthesizeSpeech(text, voiceId);

    if (req.headers.accept && req.headers.accept.includes('audio/')) {
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Length', result.audioBuffer.length);
      return res.send(result.audioBuffer);
    }

    res.json({
      success: true,
      voiceId: result.voiceId,
      voiceName: result.voiceName,
      durationEstimate: result.durationEstimate,
      mimeType: result.mimeType,
      audioBase64: result.audioBuffer.toString('base64'),
    });
  })
);

// -------------------------------------------------------------
// Admin Router (requires auth and admin role)
// -------------------------------------------------------------
const adminRouter = express.Router();
adminRouter.use(requireAuth(), requireRole('admin'));

adminRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const voices = voiceService.listVoices({ activeOnly: false });
    res.json({ success: true, data: voices });
  })
);

adminRouter.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(400, 'VOICE_FILE_REQUIRED', 'No audio file uploaded.');
    const { name, description, duration, speakerGender, language } = req.body || {};

    const voice = voiceService.createVoice({
      name,
      description,
      speakerGender,
      language,
      file: req.file,
      durationSeconds: duration,
      userId: req.user ? req.user.id : null,
    });

    res.status(201).json({ success: true, data: voice });
  })
);

adminRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const voice = voiceService.getVoice(req.params.id);
    res.json({ success: true, data: voice });
  })
);

adminRouter.get(
  '/:id/audio',
  asyncHandler(async (req, res) => {
    const { filePath, mimeType } = voiceService.getVoiceAudioPath(req.params.id);
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, no-cache');
    fs.createReadStream(filePath).pipe(res);
  })
);

adminRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const updated = voiceService.updateVoice(req.params.id, req.body || {});
    res.json({ success: true, data: updated });
  })
);

adminRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = voiceService.deleteVoice(req.params.id);
    res.json({ success: true, ...result });
  })
);

adminRouter.post(
  '/:id/test-tts',
  asyncHandler(async (req, res) => {
    const { text } = req.body || {};
    const sampleText = text || 'This is a sample voice cloning test output.';
    const result = await voiceService.synthesizeSpeech(sampleText, req.params.id);
    res.json({
      success: true,
      voiceId: result.voiceId,
      voiceName: result.voiceName,
      mimeType: result.mimeType,
      durationEstimate: result.durationEstimate,
      audioBase64: result.audioBuffer.toString('base64'),
    });
  })
);

module.exports = {
  publicRouter,
  adminRouter,
};
