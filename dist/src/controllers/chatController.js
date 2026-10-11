const { generateVectorEmbedding } = require('../services/embeddingService');
const { searchVectorDatabase } = require('../models/vectorDbModel');
const { generateConstrainedAnswer } = require('../services/geminiService');

async function handleUserChatQuery(req, res) {
  try {
    const { question, topK, minSimilarity, category, language } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'A valid "question" string is required in the request body.',
      });
    }

    const trimmedQuestion = question.trim();
    const limit = parseInt(topK, 10) || parseInt(process.env.TOP_K_RESULTS, 10) || 5;
    const threshold = parseFloat(minSimilarity) || parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.5;

    const filterOptions = {};
    if (category && category !== 'All') filterOptions.category = category;
    if (language && language !== 'All') filterOptions.language = language;

    console.log(`[Chat] Received question: "${trimmedQuestion}" with filters:`, filterOptions);

    const queryEmbedding = await generateVectorEmbedding(trimmedQuestion);
    const relevantChunks = await searchVectorDatabase(queryEmbedding, limit, threshold, filterOptions);

    if (!relevantChunks || relevantChunks.length === 0) {
      return res.status(200).json({
        success: true,
        answer: 'I cannot answer this question based on the books in your knowledge base.',
        sources: [],
      });
    }

    const aiAnswer = await generateConstrainedAnswer(trimmedQuestion, relevantChunks);

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
  } catch (error) {
    console.error('[Chat] Error processing user query:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error while answering query.',
    });
  }
}

module.exports = {
  handleUserChatQuery,
};
