const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

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
    default:
      return 'image/jpeg';
  }
}

/**
 * Extracts verbatim text and semantic content from an image using Gemini 1.5 Flash multimodal vision.
 * Supports both Arabic and English printed and handwritten text, tables, and diagrams.
 *
 * @param {string} filePath - Absolute path to the image file.
 * @returns {Promise<string>} Extracted OCR text or semantic visual description.
 */
async function extractTextFromImage(filePath) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Image file not found at path: ${filePath}`);
  }

  const client = genAI || new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.OCR_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const model = client.getGenerativeModel({ model: modelName });

  const mimeType = getImageMimeType(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  console.log(`[ImageOCR] Processing image (${(fileBuffer.length / 1024).toFixed(1)} KB, ${mimeType}) with Gemini vision model (${modelName})...`);

  const prompt = `
You are an expert OCR and document analysis engine specialized in Arabic and English document transcription.

TASK:
1. Carefully extract ALL visible text from the image verbatim, including Arabic and English words, titles, paragraphs, tables, lists, captions, and numbers.
2. Maintain natural reading order (Right-to-Left for Arabic, Left-to-Right for English).
3. Preserve all names, dates, numbers, and technical terms accurately.
4. If the image contains little or no text (e.g. diagrams, infographics, photographs, charts), generate a comprehensive and detailed factual description of everything depicted so that the content is fully searchable in a knowledge base.
5. Return ONLY the transcribed text and/or descriptive content. Do NOT wrap output in markdown code fences (like \`\`\`), and do not include commentary or greetings.
`.trim();

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64Data,
      },
    },
    { text: prompt },
  ]);

  const extractedText = result.response.text().trim();

  if (!extractedText || extractedText.length === 0) {
    throw new Error('Image OCR extraction returned no readable text or description.');
  }

  console.log(`[ImageOCR] Successfully extracted ${extractedText.length} characters from image.`);
  return extractedText;
}

module.exports = {
  extractTextFromImage,
  getImageMimeType,
};
