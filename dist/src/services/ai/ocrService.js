// ==============================================================================
// OCR service (Phase 5): replaces the Gemini vision calls.
//
// Engine chain per image (System Settings > Model routing > Vision / OCR):
//   target 'cloud' | 'local' -> open-source vision LLM (default Llama 4 Scout)
//                               then, if enabled, local Tesseract as a fallback
//   target 'tesseract'       -> local Tesseract only (100% on-server, privacy mode)
// A page fails only when every engine in the chain fails or returns no text.
// ==============================================================================
const fs = require('fs');
const path = require('path');
const client = require('./openaiCompatClient');
const tools = require('./localTools');

const OCR_PROMPT = `
You are an expert OCR and document analysis engine specialized in Arabic and English document transcription.

TASK:
1. Carefully extract ALL visible text from the image verbatim, including Arabic and English words, titles, paragraphs, tables, lists, captions, and numbers.
2. Maintain natural reading order (Right-to-Left for Arabic, Left-to-Right for English).
3. Preserve all names, dates, numbers, and technical terms accurately. Do not translate.
4. If the image contains little or no text (e.g. diagrams, photographs, charts), write a detailed factual description of everything depicted so the content is searchable in a knowledge base.
5. Return ONLY the transcribed text and/or descriptive content. No markdown code fences, no commentary, no greetings.
`.trim();

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

function mimeOf(p) {
  return MIME[path.extname(p).toLowerCase()] || null;
}

function settings() {
  return require('../settingsService');
}

function maxImageBytes(target) {
  const { CLOUD_PRESETS, LOCAL_PRESET } = require('./presets');
  const cfg = settings().getAiConfig();
  const mb = target === 'local' ? LOCAL_PRESET.limits.imageMb : (CLOUD_PRESETS[cfg.cloud.preset] || CLOUD_PRESETS.groq).limits.imageMb;
  // base64 grows the payload by ~4/3; keep a safety margin under the provider's limit
  return Math.floor((mb * 1024 * 1024 * 3) / 4) - 64 * 1024;
}

function stripFences(text) {
  return String(text || '').replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

/** Vision LLM OCR of one image; large or unsupported formats are re-encoded with ffmpeg first. */
async function visionOcr(imagePath, role, workDir) {
  let file = imagePath;
  let mime = mimeOf(file);
  const size = fs.statSync(file).size;
  if (!mime || size > maxImageBytes(role.target)) {
    if (await tools.has('ffmpeg')) {
      file = await tools.shrinkImage(imagePath, workDir);
      mime = 'image/jpeg';
    } else if (!mime) {
      throw Object.assign(new Error(`Image format ${path.extname(imagePath) || '(none)'} is not supported by the vision model and ffmpeg is not installed to convert it.`), { code: 'AI_FAILED' });
    }
  }
  try {
    const text = await client.vision({ target: role.target, model: role.model, image: fs.readFileSync(file), mime, prompt: OCR_PROMPT });
    return stripFences(text);
  } catch (e) {
    if (e.code === 'AI_EMPTY_RESPONSE') return ''; // blank page: let the chain try the next engine / report OCR_EMPTY
    throw e;
  }
}

/**
 * OCR of one image file through the configured engine chain.
 * @returns {Promise<{text: string, engine: string}>}
 */
async function ocrImage(imagePath, { label = '' } = {}) {
  if (!fs.existsSync(imagePath)) throw new Error(`Image file not found at path: ${imagePath}`);
  const role = settings().getAiConfig().roles.vision;
  const engines = role.target === 'tesseract' ? ['tesseract'] : [role.target, ...(role.tesseractFallback ? ['tesseract'] : [])];
  const workDir = tools.makeWorkDir('ocr');
  const errors = [];
  try {
    for (const engine of engines) {
      try {
        if (engine === 'tesseract' && !(await tools.has('tesseract'))) {
          throw Object.assign(new Error('Tesseract is not installed on this server.'), { code: 'TOOL_MISSING' });
        }
        const text = engine === 'tesseract' ? await tools.tesseractOcr(imagePath) : await visionOcr(imagePath, role, workDir);
        if (text && text.trim()) {
          if (engine !== engines[0]) console.warn(`[OCR] ${label || path.basename(imagePath)}: used fallback engine ${engine}`);
          return { text: text.trim(), engine: engine === 'tesseract' ? 'tesseract' : `${engine}:${role.model}` };
        }
        errors.push(Object.assign(new Error(`OCR engine ${engine} returned no text.`), { code: 'OCR_EMPTY' }));
      } catch (e) {
        errors.push(e);
        const more = engines.indexOf(engine) < engines.length - 1;
        console.warn(`[OCR] ${label || path.basename(imagePath)}: engine ${engine} failed (${e.message.slice(0, 200)})${more ? ' -> trying next engine' : ''}`);
      }
    }
    // The primary engine's error is the meaningful one (e.g. a rejected key), unless it only found no text.
    throw errors.find((e) => e.code !== 'OCR_EMPTY' && e.code !== 'TOOL_MISSING') || errors[0];
  } finally {
    tools.cleanupWorkDir(workDir);
  }
}

module.exports = { ocrImage, OCR_PROMPT, mimeOf };
