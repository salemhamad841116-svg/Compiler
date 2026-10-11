/**
 * Splits a long text document into overlapping chunks suitable for embedding models.
 * Uses recursive paragraph/sentence boundaries where possible to avoid cutting sentences.
 *
 * @param {string} text - The raw text document to be chunked.
 * @param {number} chunkSize - Maximum target characters per chunk (default: 800).
 * @param {number} chunkOverlap - Overlap characters between consecutive chunks (default: 150).
 * @returns {string[]} Array of formatted text chunks.
 */
function chunkDocumentText(text, chunkSize = 800, chunkOverlap = 150) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const sanitizedText = text.trim();
  if (sanitizedText.length <= chunkSize) {
    return [sanitizedText];
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < sanitizedText.length) {
    let endIndex = startIndex + chunkSize;

    if (endIndex >= sanitizedText.length) {
      const remainingChunk = sanitizedText.slice(startIndex).trim();
      if (remainingChunk.length > 0) {
        chunks.push(remainingChunk);
      }
      break;
    }

    // Attempt to break at the nearest natural delimiter
    const substring = sanitizedText.slice(startIndex, endIndex);
    const lastParagraphBreak = substring.lastIndexOf('\n\n');
    const lastSentenceBreak = Math.max(
      substring.lastIndexOf('. '),
      substring.lastIndexOf('? '),
      substring.lastIndexOf('! ')
    );
    const lastSpaceBreak = substring.lastIndexOf(' ');

    let splitOffset = chunkSize;

    if (lastParagraphBreak > chunkSize * 0.5) {
      splitOffset = lastParagraphBreak + 2;
    } else if (lastSentenceBreak > chunkSize * 0.5) {
      splitOffset = lastSentenceBreak + 2;
    } else if (lastSpaceBreak > chunkSize * 0.3) {
      splitOffset = lastSpaceBreak + 1;
    }

    const chunkContent = sanitizedText.slice(startIndex, startIndex + splitOffset).trim();
    if (chunkContent.length > 0) {
      chunks.push(chunkContent);
    }

    // Advance startIndex by chunk size minus overlap
    startIndex += Math.max(splitOffset - chunkOverlap, 1);
  }

  return chunks;
}

module.exports = { chunkDocumentText };
