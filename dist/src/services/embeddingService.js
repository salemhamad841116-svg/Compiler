const { embedText } = require('./geminiClient');

/**
 * Generates a vector embedding for a single text chunk using Gemini (gemini-embedding-001 by default,
 * truncated to EMBEDDING_DIMENSIONS, default 768).
 *
 * @param {string} textChunk - The text to be embedded.
 * @param {{taskType?: string}} [opts] - RETRIEVAL_DOCUMENT for stored chunks, RETRIEVAL_QUERY for questions.
 * @returns {Promise<number[]>} Numerical vector array representing the text chunk.
 */
async function generateVectorEmbedding(textChunk, opts = {}) {
  return embedText(textChunk, opts);
}

/**
 * Generates embeddings for a batch of text chunks with sequential throttling.
 *
 * @param {string[]} chunks - Array of text chunks.
 * @param {number} delayMs - Delay between API calls to prevent rate limiting (default: 100ms).
 * @returns {Promise<Array<{ chunk: string, embedding: number[] }>>}
 */
async function generateBatchEmbeddings(chunks, delayMs = 100) {
  const results = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await generateVectorEmbedding(chunk, { taskType: 'RETRIEVAL_DOCUMENT' });
    results.push({ chunk, embedding });

    if (delayMs > 0 && i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

module.exports = {
  generateVectorEmbedding,
  generateBatchEmbeddings,
};
