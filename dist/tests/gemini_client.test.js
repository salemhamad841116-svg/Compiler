// Unit tests for the Gemini REST client with a stubbed global fetch (no network).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GEMINI_API_KEY = '  "AIzaTESTKEY1234"\r ';
process.env.AI_PROVIDER = 'gemini';

const calls = [];
let responder = () => ({ status: 200, body: {} });
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, headers: init.headers, body });
  const r = responder(url, body);
  return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) };
};

const config = require('../src/config');
const gemini = require('../src/services/geminiClient');
const { classifyError } = require('../src/services/aiProvider');

test('API key is sanitized (quotes, whitespace, CR) and sent as a header, never in the URL', async () => {
  assert.equal(config.geminiApiKey, 'AIzaTESTKEY1234');
  assert.equal(config.geminiKeyUsable, true);
  calls.length = 0;
  responder = () => ({ status: 200, body: { embedding: { values: [0.1, 0.2] } } });
  await gemini.embedText('x');
  assert.equal(calls[0].headers['x-goog-api-key'], 'AIzaTESTKEY1234');
  assert.ok(!calls[0].url.includes('AIza'));
});

test('retired embedding model is upgraded to gemini-embedding-001 with 768 dims and task type', async () => {
  process.env.EMBEDDING_MODEL = 'text-embedding-004';
  calls.length = 0;
  responder = () => ({ status: 200, body: { embedding: { values: new Array(768).fill(0.01) } } });
  const v = await gemini.embedText('hello', { taskType: 'RETRIEVAL_DOCUMENT' });
  assert.equal(v.length, 768);
  assert.match(calls[0].url, /models\/gemini-embedding-001:embedContent$/);
  assert.equal(calls[0].body.outputDimensionality, 768);
  assert.equal(calls[0].body.taskType, 'RETRIEVAL_DOCUMENT');
});

test('retired generation model is upgraded; 404 falls back to the next model and is remembered', async () => {
  process.env.OCR_MODEL = 'gemini-1.5-flash';
  assert.equal(gemini.resolveGenerationModel('OCR_MODEL'), gemini.DEFAULT_GENERATION_MODEL);
  calls.length = 0;
  responder = (url) => (url.includes(`/${gemini.DEFAULT_GENERATION_MODEL}:`)
    ? { status: 404, body: { error: { code: 404, status: 'NOT_FOUND', message: 'model is not found for API version v1beta' } } }
    : { status: 200, body: { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: 'Extracted page text' }] }, finishReason: 'STOP' }] } });
  const text = await gemini.generateText({ purpose: 'ocr', modelEnv: 'OCR_MODEL', parts: [{ text: 'p' }] });
  assert.equal(text, 'Extracted page text');
  assert.equal(calls.length, 2);
  calls.length = 0;
  await gemini.generateText({ purpose: 'ocr', modelEnv: 'OCR_MODEL', parts: [{ text: 'p' }] });
  assert.equal(calls.length, 1, 'working fallback model should be reused');
});

test('HTTP errors carry status + Google message and are classified to stable codes', async () => {
  responder = () => ({ status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } } });
  await assert.rejects(gemini.embedText('x'), (e) => {
    assert.match(e.message, /Gemini API 400 INVALID_ARGUMENT/);
    assert.equal(classifyError(e).code, 'AI_KEY_INVALID');
    return true;
  });
  responder = () => ({ status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Your API key was reported as leaked.' } } });
  await assert.rejects(gemini.embedText('x'), (e) => classifyError(e).code === 'AI_KEY_INVALID');
  responder = () => ({ status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, please check your plan and billing details.' } } });
  await assert.rejects(gemini.embedText('x'), (e) => {
    const c = classifyError(e);
    return c.code === 'AI_RATE_LIMIT' && c.retryable === true;
  });
});

test('empty candidate text is an explicit error (never a silent empty OCR)', async () => {
  process.env.OCR_MODEL = 'gemini-3.6-flash';
  responder = () => ({ status: 200, body: { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] } });
  await assert.rejects(gemini.generateText({ purpose: 'chat', modelEnv: 'GEMINI_MODEL', parts: [{ text: 'q' }] }), /finishReason: MAX_TOKENS/);
});
