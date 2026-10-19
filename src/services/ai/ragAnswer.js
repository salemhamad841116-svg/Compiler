// ==============================================================================
// Grounded RAG answers (Phase 5): replaces geminiService. The chat role model
// (default Llama 4 Scout) answers ONLY from the retrieved book excerpts.
// ==============================================================================
const client = require('./openaiCompatClient');

const STRICT_RAG_SYSTEM_INSTRUCTION = `
You are a Private AI Assistant strictly limited to the user's personal book knowledge base.

CRITICAL RULES:
1. Answer the user's question ONLY using the provided Context Excerpts from the books.
2. Do NOT use outside knowledge, assumptions, or training data that is not explicitly in the provided context.
3. If the context does not contain enough information to answer accurately, say clearly that you cannot answer this question based on the books in the knowledge base.
4. Always reply in the same language as the user's question (Arabic questions get Arabic answers, English questions get English answers).
5. Be accurate and concise, and cite the book titles (and page numbers when given) for the facts you use.
`.trim();

/**
 * @param {string} userQuestion
 * @param {Array<{chunk: string, bookTitle: string, similarity: number, page?: number}>} contextChunks
 * @returns {Promise<string>}
 */
async function generateConstrainedAnswer(userQuestion, contextChunks) {
  const formattedContext = contextChunks
    .map((item, index) => {
      const page = item.page ? `, Page: ${item.page}` : '';
      return `--- CONTEXT EXCERPT #${index + 1} (Source: "${item.bookTitle}"${page}, Relevance: ${(item.similarity * 100).toFixed(1)}%) ---\n${item.chunk}\n`;
    })
    .join('\n');

  const role = require('../settingsService').getAiConfig().roles.chat;
  return client.chat({
    target: role.target,
    model: role.model,
    temperature: 0.2,
    maxTokens: parseInt(process.env.CHAT_MAX_TOKENS, 10) || 2048,
    timeoutMs: 120000,
    label: 'chat',
    messages: [
      { role: 'system', content: STRICT_RAG_SYSTEM_INSTRUCTION },
      { role: 'user', content: `Context from Knowledge Base:\n${formattedContext}\n\nUser Question:\n${userQuestion}\n\nProvide a precise and faithful answer based solely on the context above.` },
    ],
  });
}

module.exports = { generateConstrainedAnswer, STRICT_RAG_SYSTEM_INSTRUCTION };
