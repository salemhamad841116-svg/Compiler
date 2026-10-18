const config = require('../config');
const { provider, classifyError } = require('../services/aiProvider');
const { searchVectorDatabase } = require('../models/vectorDbModel');
const { generateConstrainedAnswer } = require('../services/geminiService');
const { AppError } = require('../utils/errors');

async function answerFor(question, chunks) {
  if (config.aiProvider === 'mock') {
    return `Mock answer for "${question}" based on ${chunks[0].bookTitle}: ${chunks[0].chunk.slice(0, 120)}`;
  }
  return generateConstrainedAnswer(question, chunks);
}

async function handleUserChatQuery(req, res) {
  const { question, topK, minSimilarity, category, language } = req.body || {};

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    throw new AppError(400, 'QUESTION_REQUIRED', 'A valid "question" string is required in the request body.');
  }

  const trimmedQuestion = question.trim();
  const limit = parseInt(topK, 10) || parseInt(process.env.TOP_K_RESULTS, 10) || 5;
  const parsedMin = parseFloat(minSimilarity);
  const threshold = Number.isFinite(parsedMin) ? parsedMin : parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.5;

  const filterOptions = {};
  if (category && category !== 'All') filterOptions.category = category;
  if (language && language !== 'All') filterOptions.language = language;

  let relevantChunks;
  try {
    const queryEmbedding = await provider().embed(trimmedQuestion, { taskType: 'RETRIEVAL_QUERY' });
    relevantChunks = await searchVectorDatabase(queryEmbedding, limit, threshold, filterOptions);
  } catch (error) {
    const c = classifyError(error);
    throw new AppError(c.retryable ? 503 : 502, c.code, c.message);
  }

  if (!relevantChunks || relevantChunks.length === 0) {
    return res.status(200).json({
      success: true,
      answer: 'I cannot answer this question based on the books in your knowledge base.',
      sources: [],
    });
  }

  let aiAnswer;
  try {
    aiAnswer = await answerFor(trimmedQuestion, relevantChunks);
  } catch (error) {
    const c = classifyError(error);
    throw new AppError(c.retryable ? 503 : 502, c.code, c.message);
  }

  return res.status(200).json({
    success: true,
    answer: aiAnswer,
    sources: relevantChunks.map((c) => ({
      bookTitle: c.bookTitle,
      category: c.category || 'General',
      language: c.language || 'Arabic',
      similarity: parseFloat(c.similarity.toFixed(4)),
      excerpt: c.chunk.length > 200 ? `${c.chunk.slice(0, 200)}...` : c.chunk,
    })),
  });
}

module.exports = {
  handleUserChatQuery,
};
