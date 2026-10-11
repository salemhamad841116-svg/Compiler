const fs = require('fs');
const pdfParse = require('pdf-parse');

/**
 * Extracts raw textual content and exact page count from a PDF file on the local filesystem.
 *
 * @param {string} filePath - Path to the PDF file on disk.
 * @returns {Promise<{ text: string, numPages: number, info?: Object }>}
 */
async function parsePDFDocument(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);

  if (!pdfData || !pdfData.text) {
    throw new Error('Failed to extract text from PDF or document is empty/scanned image.');
  }

  // Clean excessive whitespace and normalize line breaks
  const cleanedText = pdfData.text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Extract exact total number of pages from pdf-parse (numpages)
  const numPages = typeof pdfData.numpages === 'number' && pdfData.numpages > 0 ? pdfData.numpages : 1;

  return {
    text: cleanedText,
    numPages,
    info: pdfData.info,
  };
}

/**
 * Extracts raw textual content from a PDF file (backwards-compatible wrapper).
 *
 * @param {string} filePath - Path to the PDF file on disk.
 * @returns {Promise<string>} Extracted and cleaned text content.
 */
async function extractTextFromPDF(filePath) {
  const result = await parsePDFDocument(filePath);
  return result.text;
}

module.exports = {
  parsePDFDocument,
  extractTextFromPDF,
};
