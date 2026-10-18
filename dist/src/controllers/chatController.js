const config = require('../config');
const { provider, classifyError } = require('../services/aiProvider');
const { searchVectorDatabase } = require('../models/vectorDbModel');
const { generateConstrainedAnswer } = require('../services/geminiService');
const { AppError } = require('../utils/errors');

const NO_ANSWER = 'I cannot answer this question based on the books in your knowledge base.';

async function answerFor(question, chunks) {
  if (config.aiProvider === 'mock') {
    return `Mock answer for "${question}" based on ${chunks[0].bookTitle}: ${chunks[0].chunk.slice(0, 120)}`;
  }
  return generateConstrainedAnswer(question, chunks);
}

function defaultThreshold() {
  const v = parseFloat(process.env.SIMILARITY_THRESHOLD);
  return Number.isFinite(v) ? v : 0.45;
}

/**
 * The single RAG path used by the public chat (bahth) AND the admin end-to-end self-test:
 * question -> query embedding -> live chunk search (same SQLite DB the ingestion pipeline writes) -> grounded answer.
 * @returns {Promise<{answer: string, chunks: Array}>}
 */
async function retrieveAndAnswer(question, { topK, minSimilarity, category, language } = {}) {
  const limit = parseInt(topK, 10) || parseInt(process.env.TOP_K_RESULTS, 10) || 5;
  const parsedMin = parseFloat(minSimilarity);
  const threshold = Number.isFinite(parsedMin) ? parsedMin : defaultThreshold();

  const filterOptions = {};
  if (category && category !== 'All') filterOptions.category = category;
  if (language && language !== 'All') filterOptions.language = language;

  let chunks;
  try {
    const queryEmbedding = await provider().embed(question, { taskType: 'RETRIEVAL_QUERY' });
    chunks = await searchVectorDatabase(queryEmbedding, limit, threshold, filterOptions);
  } catch (error) {
    const c = classifyError(error);
    console.error(`[Chat] retrieval failed (${c.code}): ${c.message}`);
    throw new AppError(c.retryable ? 503 : 502, c.code, c.message);
  }

  if (!chunks || chunks.length === 0) return { answer: NO_ANSWER, chunks: [], threshold };

  try {
    return { answer: await answerFor(question, chunks), chunks, threshold };
  } catch (error) {
    const c = classifyError(error);
    console.error(`[Chat] answer generation failed (${c.code}): ${c.message}`);
    throw new AppError(c.retryable ? 503 : 502, c.code, c.message);
  }
}

async function handleUserChatQuery(req, res) {
  const { question, topK, minSimilarity, category, language } = req.body || {};

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    throw new AppError(400, 'QUESTION_REQUIRED', 'A valid "question" string is required in the request body.');
  }

  const { answer, chunks } = await retrieveAndAnswer(question.trim(), { topK, minSimilarity, category, language });

  return res.status(200).json({
    success: true,
    answer,
    sources: chunks.map((c) => ({
      documentId: c.documentId,
      bookTitle: c.bookTitle,
      category: c.category || 'General',
      language: c.language || 'Arabic',
      page: c.page || null,
      similarity: parseFloat(c.similarity.toFixed(4)),
      excerpt: c.chunk.length > 200 ? `${c.chunk.slice(0, 200)}...` : c.chunk,
    })),
  });
}

module.exports = {
  handleUserChatQuery,
  retrieveAndAnswer,
  NO_ANSWER,
};
