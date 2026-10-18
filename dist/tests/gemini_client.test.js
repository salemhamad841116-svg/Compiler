// Unit tests for the Gemini REST client with a stubbed global fetch (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated data dir: System Settings keys live in the DB (never touch the workspace ./data).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-gemini-'));
process.env.DATA_DIR = dataDir;
process.on('exit', () => fs.rmSync(dataDir, { recursive: true, force: true }));

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

// ------------------------------------------------------------------ Phase 4: DB keys + rotation
const settings = require('../src/services/settingsService');
const DB1 = 'AIzaDBPRIMARYKEY000000000000000001';
const DB2 = 'AIzaDBFALLBACKKEY00000000000000002';
const okEmbedding = { status: 200, body: { embedding: { values: [0.5, 0.5] } } };
const keyOf = (c) => c.headers['x-goog-api-key'];

test('DB keys take priority over .env, in slot order, and apply without restart', async () => {
  gemini._resetCooldowns();
  settings.setGeminiKeys({ primary: DB1, fallback1: DB2 }, null);
  assert.deepEqual(settings.getGeminiKeyChain().map((k) => k.source), ['db:primary', 'db:fallback1', 'env']);
  calls.length = 0;
  responder = () => okEmbedding;
  await gemini.embedText('x');
  assert.equal(keyOf(calls[0]), DB1);
});

test('rotates to the next key on 429 and on invalid/leaked keys, then skips the cooled-down key', async () => {
  gemini._resetCooldowns();
  calls.length = 0;
  responder = (url, body) => (calls[calls.length - 1].headers['x-goog-api-key'] === DB1
    ? { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' } } }
    : okEmbedding);
  await gemini.embedText('x');
  assert.deepEqual(calls.map(keyOf), [DB1, DB2]);
  calls.length = 0;
  await gemini.embedText('y');
  assert.deepEqual(calls.map(keyOf), [DB2], 'rate-limited key is skipped during its cool-down');

  gemini._resetCooldowns();
  calls.length = 0;
  responder = () => (calls[calls.length - 1].headers['x-goog-api-key'] === DB2
    ? okEmbedding
    : { status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Your API key was reported as leaked.' } } });
  await gemini.embedText('z');
  assert.deepEqual(calls.map(keyOf), [DB1, DB2]);
  const health = settings.describeKeys().slots;
  assert.equal(health[0].status, 'invalid');
  assert.equal(health[1].status, 'ok');
});

test('does NOT rotate on model 404 or bad input (not key problems)', async () => {
  gemini._resetCooldowns();
  calls.length = 0;
  responder = () => ({ status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Request contains an invalid argument.' } } });
  await assert.rejects(gemini.embedText('x'));
  assert.equal(calls.length, 1, 'bad input is surfaced immediately');
  calls.length = 0;
  responder = () => ({ status: 404, body: { error: { code: 404, status: 'NOT_FOUND', message: 'models/x is not found' } } });
  await assert.rejects(gemini.embedText('x'));
  assert.equal(calls.length, 1, 'embedding 404 is not retried with other keys');
});

test('falls back to the .env key when every DB key fails; pinned key never rotates', async () => {
  gemini._resetCooldowns();
  calls.length = 0;
  responder = () => (calls[calls.length - 1].headers['x-goog-api-key'] === 'AIzaTESTKEY1234'
    ? okEmbedding
    : { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } } });
  await gemini.embedText('x');
  assert.deepEqual(calls.map(keyOf), [DB1, DB2, 'AIzaTESTKEY1234']);

  calls.length = 0;
  await assert.rejects(gemini.embedText('x', { key: DB1 }));
  assert.deepEqual(calls.map(keyOf), [DB1], 'per-slot test uses exactly one key');
});

test('clearing DB keys returns to the .env key immediately', async () => {
  gemini._resetCooldowns();
  settings.clearGeminiKey('primary', null);
  settings.clearGeminiKey('fallback1', null);
  assert.deepEqual(settings.getGeminiKeyChain().map((k) => k.source), ['env']);
  calls.length = 0;
  responder = () => okEmbedding;
  await gemini.embedText('x');
  assert.equal(keyOf(calls[0]), 'AIzaTESTKEY1234');
});
