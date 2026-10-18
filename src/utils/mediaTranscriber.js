const fs = require('fs');
const path = require('path');
const { generateText } = require('../services/geminiClient');

/**
 * Maps file extension to standard MIME types for Gemini multimodal API.
 * @param {string} filePath
 * @returns {string}
 */
function getMediaMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp3':
      return 'audio/mp3';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/m4a';
    case '.ogg':
      return 'audio/ogg';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.mp4':
    default:
      return 'video/mp4';
  }
}

const TRANSCRIBE_PROMPT = `
You are a master-level speech-to-text audio transcriber.

TASK:
1. Listen carefully to all speech, dialogue, lectures, speeches, or discussions in the provided media file.
2. Transcribe ALL spoken words verbatim with high fidelity and punctuation.
3. Preserve all explanations, examples, and terminology exactly as spoken.
4. Do NOT summarize, critique, or add commentary. Return ONLY the complete transcription text.
`.trim();

/**
 * Transcribes spoken words from a video or audio file using Gemini's native multimodal audio engine
 * (TRANSCRIPTION_MODEL, falling back to GEMINI_MODEL, then the client default).
 *
 * @param {string} filePath - Absolute path to the media file on disk.
 * @returns {Promise<string>} Full verbatim textual transcript.
 */
async function transcribeMediaFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Media file not found at path: ${filePath}`);
  }

  const mimeType = getMediaMimeType(filePath);
  const mediaBuffer = fs.readFileSync(filePath);

  console.log(`[Transcriber] Sending media ${path.basename(filePath)} (${(mediaBuffer.length / (1024 * 1024)).toFixed(2)} MB, ${mimeType}) to Gemini...`);

  const transcript = await generateText({
    purpose: 'transcribe',
    modelEnv: 'TRANSCRIPTION_MODEL',
    parts: [{ inlineData: { mimeType, data: mediaBuffer.toString('base64') } }, { text: TRANSCRIBE_PROMPT }],
    generationConfig: { temperature: 0, maxOutputTokens: 32768 },
    timeoutMs: 300000,
  });

  console.log(`[Transcriber] Successfully transcribed media (${transcript.length} characters).`);
  return transcript;
}

module.exports = {
  transcribeMediaFile,
  getMediaMimeType,
};
