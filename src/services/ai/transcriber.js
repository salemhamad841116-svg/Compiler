// ==============================================================================
// Audio / video transcription (Phase 5): open-source Whisper through the
// OpenAI-compatible /audio/transcriptions API (Groq whisper-large-v3[-turbo] by
// default). ffmpeg extracts the audio track (also from video), converts it to
// 16 kHz mono and splits long recordings into segments that fit the upload limit.
// ==============================================================================
const fs = require('fs');
const path = require('path');
const client = require('./openaiCompatClient');
const tools = require('./localTools');

const AUDIO_MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.mp4': 'audio/mp4', '.flac': 'audio/flac' };

function settings() {
  return require('../settingsService');
}

function uploadLimitBytes(target) {
  const { CLOUD_PRESETS, LOCAL_PRESET } = require('./presets');
  const cfg = settings().getAiConfig();
  const mb = target === 'local' ? LOCAL_PRESET.limits.audioMb : (CLOUD_PRESETS[cfg.cloud.preset] || CLOUD_PRESETS.groq).limits.audioMb;
  return mb * 1024 * 1024;
}

/**
 * @param {string} filePath
 * @returns {Promise<string>} full transcript
 */
async function transcribeMediaFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Media file not found at path: ${filePath}`);
  const role = settings().getAiConfig().roles.transcription;
  if (role.target === 'disabled') {
    throw Object.assign(new Error('Audio/video transcription is disabled in System Settings.'), { code: 'AI_TRANSCRIPTION_DISABLED' });
  }
  const name = path.basename(filePath);
  if (!(await tools.has('ffmpeg'))) {
    const size = fs.statSync(filePath).size;
    if (size > uploadLimitBytes(role.target)) {
      throw Object.assign(new Error(`The media file is ${(size / 1048576).toFixed(1)} MB, above the provider upload limit, and ffmpeg is not installed to split it.`), { code: 'AI_PAYLOAD_TOO_LARGE' });
    }
    const mime = AUDIO_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    console.log(`[Transcriber] ${name}: sending as-is (ffmpeg not available)`);
    return client.transcribe(fs.readFileSync(filePath), { target: role.target, model: role.model, filename: name, mime });
  }
  const workDir = tools.makeWorkDir('media');
  try {
    const segments = await tools.splitAudio(filePath, workDir);
    console.log(`[Transcriber] ${name}: ${segments.length} segment(s) -> ${role.target}:${role.model}`);
    const parts = [];
    for (let i = 0; i < segments.length; i++) {
      const text = await client.transcribe(fs.readFileSync(segments[i]), {
        target: role.target, model: role.model, filename: `segment-${i + 1}.mp3`, mime: 'audio/mpeg',
      });
      if (text) parts.push(text);
    }
    const transcript = parts.join('\n\n').trim();
    console.log(`[Transcriber] ${name}: ${transcript.length} characters transcribed`);
    return transcript;
  } finally {
    tools.cleanupWorkDir(workDir);
  }
}

module.exports = { transcribeMediaFile };
