const fs = require('fs');
const pdfParse = require('pdf-parse');

function cleanText(t) {
  return String(t || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts text per page and the exact page count from a PDF.
 * Pages without a text layer (e.g. scanned images) are returned with empty text so callers can
 * report them as unprocessed instead of silently dropping them.
 *
 * @param {string} filePath
 * @returns {Promise<{ numPages: number, pages: string[], text: string, info?: object }>}
 */
async function parsePdfPages(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }
  const pages = [];
  const render = (pageData) =>
    pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((tc) => {
      let lastY;
      let text = '';
      for (const item of tc.items) {
        if (lastY === item.transform[5] || lastY === undefined) text += item.str;
        else text += `\n${item.str}`;
        lastY = item.transform[5];
      }
      pages.push(text);
      return text;
    });

  // pdf.js (bundled v1.10) mis-handles Node Buffers on some PDFs because Buffer#slice is a view, not a copy.
  // Passing a plain Uint8Array copy avoids spurious "bad XRef entry" failures.
  const data = await pdfParse(new Uint8Array(fs.readFileSync(filePath)), { pagerender: render });
  const numPages = typeof data.numpages === 'number' && data.numpages > 0 ? data.numpages : pages.length;
  while (pages.length < numPages) pages.push('');
  const cleaned = pages.map(cleanText);
  return { numPages, pages: cleaned, text: cleaned.join('\n\n').trim(), info: data.info };
}

/** Backwards-compatible whole-document parser. */
async function parsePDFDocument(filePath) {
  const { text, numPages, info } = await parsePdfPages(filePath);
  if (!text) {
    throw new Error('Failed to extract text from PDF or document is empty/scanned image.');
  }
  return { text, numPages, info };
}

async function extractTextFromPDF(filePath) {
  return (await parsePDFDocument(filePath)).text;
}

module.exports = { parsePdfPages, parsePDFDocument, extractTextFromPDF };
