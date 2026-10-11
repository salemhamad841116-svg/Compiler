const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const STRICT_RAG_SYSTEM_INSTRUCTION = `
You are a Private AI Assistant strictly limited to the user's personal book knowledge base.

CRITICAL RULES:
1. Answer the user's question ONLY using the provided Context Chunks from the books.
2. Do NOT use outside knowledge, assumptions, or training data that is not explicitly in the provided context.
3. If the context does not contain enough information to answer the question accurately, you MUST explicitly state:
   "I cannot answer this question based on the books in your knowledge base."
4. Always maintain high accuracy, be concise, and cite the book titles when mentioning facts if available in the context.
`;

/**
 * Generates an answer strictly constrained to the provided book context chunks.
 *
 * @param {string} userQuestion - The question asked by the user.
 * @param {Array<{ chunk: string, bookTitle: string, similarity: number }>} contextChunks - Retrieved relevant chunks.
 * @returns {Promise<string>} Model response.
 */
async function generateConstrainedAnswer(userQuestion, contextChunks) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }

  const client = genAI || new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: STRICT_RAG_SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0.2, // Low temperature for factual fidelity
      topP: 0.8,
      maxOutputTokens: 1024,
    },
  });

  const formattedContext = contextChunks
    .map((item, index) => {
      return `--- CONTEXT EXCERPT #${index + 1} (Source: "${item.bookTitle}", Relevance: ${(item.similarity * 100).toFixed(1)}%) ---\n${item.chunk}\n`;
    })
    .join('\n');

  const prompt = `
Context from Knowledge Base:
${formattedContext}

User Question:
${userQuestion}

Please provide a precise and faithful answer based solely on the context above:
`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

module.exports = {
  generateConstrainedAnswer,
  STRICT_RAG_SYSTEM_INSTRUCTION,
};
