const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

/**
 * Generates a vector embedding for a single text chunk using Gemini text-embedding-004.
 *
 * @param {string} textChunk - The text to be embedded.
 * @returns {Promise<number[]>} Numerical vector array representing the text chunk.
 */
async function generateVectorEmbedding(textChunk) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not defined in environment variables.');
  }

  const client = genAI || new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const embeddingModel = client.getGenerativeModel({
    model: process.env.EMBEDDING_MODEL || 'text-embedding-004',
  });

  const response = await embeddingModel.embedContent(textChunk);

  if (!response || !response.embedding || !response.embedding.values) {
    throw new Error('Invalid response received from Gemini Embedding API.');
  }

  return response.embedding.values;
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
    const embedding = await generateVectorEmbedding(chunk);
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
