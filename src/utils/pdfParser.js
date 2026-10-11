const fs = require('fs');
const pdfParse = require('pdf-parse');

/**
 * Extracts raw textual content from a PDF file on the local filesystem.
 *
 * @param {string} filePath - Path to the PDF file on disk.
 * @returns {Promise<string>} Extracted and cleaned text content.
 */
async function extractTextFromPDF(filePath) {
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

  return cleanedText;
}

module.exports = { extractTextFromPDF };
