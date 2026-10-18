#!/usr/bin/env node
// ==============================================================================
// Live AI diagnostics. Run inside the backend container:
//   docker exec masruq_rag_backend node scripts/ai-diagnose.js
// Shows the effective key (masked) and models, then makes one real embedding call
// and one real generation call, printing the exact Google error if anything fails.
// Exit code 0 = OCR + embeddings are working.
// ==============================================================================
require('dotenv').config();
const config = require('../src/config');
const gemini = require('../src/services/geminiClient');
const { classifyError } = require('../src/services/aiProvider');

(async () => {
  const d = gemini.describeConfig();
  console.log('AI provider       :', config.aiProvider);
  console.log('GEMINI_API_KEY    :', d.keyPresent ? d.keyMasked : 'MISSING', d.keyPresent && !d.keyUsable ? '(placeholder value!)' : '');
  console.log('OCR model         :', d.ocrModel);
  console.log('Chat model        :', d.generationModel);
  console.log('Embedding model   :', `${d.embeddingModel} (${d.embeddingDimensions} dims)`);
  if (!d.keyUsable) {
    console.error('\nFAIL: no usable GEMINI_API_KEY inside the container. Check env_file in docker-compose.prod.yml.');
    process.exit(2);
  }
  let ok = true;
  try {
    const v = await gemini.embedText('diagnostic embedding test', { taskType: 'RETRIEVAL_QUERY' });
    console.log(`\nEmbedding         : OK (${v.length} values)`);
  } catch (e) {
    ok = false;
    console.error(`\nEmbedding         : FAIL [${classifyError(e).code}] ${e.message}`);
  }
  try {
    const t = await gemini.generateText({ purpose: 'ocr', modelEnv: 'OCR_MODEL', parts: [{ text: 'Reply with the single word OK.' }], generationConfig: { maxOutputTokens: 512 }, timeoutMs: 60000 });
    console.log(`Generation (OCR)  : OK -> "${t.slice(0, 40)}" using ${gemini.describeConfig().ocrModel}`);
  } catch (e) {
    ok = false;
    console.error(`Generation (OCR)  : FAIL [${classifyError(e).code}] ${e.message}`);
  }
  console.log(ok ? '\nRESULT: AI pipeline is healthy.' : '\nRESULT: AI pipeline is NOT healthy (see errors above).');
  process.exit(ok ? 0 : 1);
})();
