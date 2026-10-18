const fs = require('fs');
const path = require('path');
const { generateText } = require('../services/geminiClient');

/**
 * Maps image file extension to valid MIME type.
 * @param {string} filePath
 * @returns {string}
 */
function getImageMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    default:
      return 'image/jpeg';
  }
}

const OCR_PROMPT = `
You are an expert OCR and document analysis engine specialized in Arabic and English document transcription.

TASK:
1. Carefully extract ALL visible text from the image verbatim, including Arabic and English words, titles, paragraphs, tables, lists, captions, and numbers.
2. Maintain natural reading order (Right-to-Left for Arabic, Left-to-Right for English).
3. Preserve all names, dates, numbers, and technical terms accurately.
4. If the image contains little or no text (e.g. diagrams, infographics, photographs, charts), generate a comprehensive and detailed factual description of everything depicted so that the content is fully searchable in a knowledge base.
5. Return ONLY the transcribed text and/or descriptive content. Do NOT wrap output in markdown code fences (like \`\`\`), and do not include commentary or greetings.
`.trim();

/**
 * Extracts verbatim text and semantic content from an image using a Gemini multimodal model
 * (OCR_MODEL, falling back to GEMINI_MODEL, then the client default).
 * Supports both Arabic and English printed and handwritten text, tables, and diagrams.
 *
 * @param {string} filePath - Absolute path to the image file.
 * @returns {Promise<string>} Extracted OCR text or semantic visual description.
 */
async function extractTextFromImage(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Image file not found at path: ${filePath}`);
  }

  const mimeType = getImageMimeType(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  console.log(`[ImageOCR] Processing image ${path.basename(filePath)} (${(fileBuffer.length / 1024).toFixed(1)} KB, ${mimeType})...`);

  const extractedText = await generateText({
    purpose: 'ocr',
    modelEnv: 'OCR_MODEL',
    parts: [{ inlineData: { mimeType, data: fileBuffer.toString('base64') } }, { text: OCR_PROMPT }],
    generationConfig: { temperature: 0, maxOutputTokens: 16384 },
  });

  console.log(`[ImageOCR] Successfully extracted ${extractedText.length} characters from ${path.basename(filePath)}.`);
  return extractedText;
}

module.exports = {
  extractTextFromImage,
  getImageMimeType,
};
