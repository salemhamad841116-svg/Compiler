// ==============================================================================
// Gemini REST client (single place for every Gemini call: OCR, transcription,
// chat generation and embeddings).
//
// Why REST instead of the legacy @google/generative-ai SDK:
//  - the SDK is deprecated and cannot pass newer request fields reliably
//    (e.g. outputDimensionality for gemini-embedding-001);
//  - every failure here is turned into an Error whose message carries the HTTP
//    status + Google's error status/message, so classifyError() in aiProvider.js
//    can map it to a stable code, and the logs show the real reason.
//
// Retired model names (gemini-1.0/1.5/2.0, gemini-pro, text-embedding-004,
// embedding-001 ...) are transparently upgraded, because those IDs now return
// 404 and silently broke the whole ingestion pipeline.
// ==============================================================================
const config = require('../config');

const API_BASE = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');

const DEFAULT_GENERATION_MODEL = 'gemini-3.8-flash';
// Tried in order when the configured generation model returns 404 (retired / not enabled for this key).
const GENERATION_FALLBACKS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'];
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

const RETIRED_GENERATION = /^(gemini-1\.0|gemini-1\.5|gemini-2\.0|gemini-pro$|gemini-pro-vision|gemini-ultra|chat-bison|text-bison)/i;
const RETIRED_EMBEDDING = /^(text-embedding-00\d|embedding-001|embedding-gecko|textembedding-gecko|text-multilingual-embedding)/i;

const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

function stripModelPrefix(name) {
  return String(name || '').trim().replace(/^models\//i, '');
}

/** Masks a key for logs: never prints more than the last 4 characters. */
function maskKey(k) {
  if (!k) return '(missing)';
  return `${'*'.repeat(Math.max(0, Math.min(k.length - 4, 8)))}${k.slice(-4)} (len ${k.length})`;
}

function resolveGenerationModel(envName) {
  const requested = stripModelPrefix(process.env[envName] || process.env.GEMINI_MODEL || DEFAULT_GENERATION_MODEL);
  if (RETIRED_GENERATION.test(requested)) {
    warnOnce(`gen:${requested}`, `[Gemini] Model "${requested}" (${envName}) is retired by Google and returns 404. Using "${DEFAULT_GENERATION_MODEL}" instead. Update ${envName} in your env file.`);
    return DEFAULT_GENERATION_MODEL;
  }
  return requested;
}

function resolveEmbeddingModel() {
  const requested = stripModelPrefix(process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL);
  if (RETIRED_EMBEDDING.test(requested)) {
    warnOnce(`emb:${requested}`, `[Gemini] Embedding model "${requested}" is retired by Google and returns 404. Using "${DEFAULT_EMBEDDING_MODEL}" instead. Update EMBEDDING_MODEL in your env file.`);
    return DEFAULT_EMBEDDING_MODEL;
  }
  return requested;
}

function embeddingDimensions() {
  const n = parseInt(process.env.EMBEDDING_DIMENSIONS, 10);
  return Number.isFinite(n) && n > 0 ? n : 768;
}

/** Remembers a working fallback per purpose so we do not hit a 404 on every call. */
const workingModel = new Map();

class GeminiHttpError extends Error {
  constructor(status, apiStatus, apiMessage, model, op) {
    super(`Gemini API ${status}${apiStatus ? ` ${apiStatus}` : ''} [${op} ${model}]: ${apiMessage || 'no error message'}`);
    this.name = 'GeminiHttpError';
    this.httpStatus = status;
    this.apiStatus = apiStatus;
    this.model = model;
  }
}

// ------------------------------------------------------------------ key rotation (Phase 4)
// Keys come from settingsService: DB primary -> fallback1 -> fallback2 -> env.
// We only rotate on KEY problems (quota, invalid, permission). Model 404s, network
// errors and bad input are not key problems and are surfaced immediately.
const COOLDOWN_RATE_LIMIT_MS = 60 * 1000;
const COOLDOWN_INVALID_MS = 10 * 60 * 1000;
const cooldown = new Map(); // fingerprint -> until (ms)

function keyProblem(e) {
  const msg = String((e && e.message) || '');
  if (e instanceof GeminiHttpError && e.httpStatus === 429) return 'AI_RATE_LIMIT';
  if (/RESOURCE_EXHAUSTED/i.test(msg)) return 'AI_RATE_LIMIT';
  if (/API key not valid|API_KEY_INVALID|API key expired/i.test(msg)) return 'AI_KEY_INVALID';
  if (e instanceof GeminiHttpError && e.httpStatus === 403) return 'AI_KEY_INVALID';
  if (/PERMISSION_DENIED|leaked|SERVICE_DISABLED|API_KEY_SERVICE_BLOCKED/i.test(msg)) return 'AI_KEY_INVALID';
  return null;
}

function settings() {
  return require('./settingsService');
}

/**
 * Runs fn(key) with the first healthy key, rotating to the next one on key problems.
 * @param {(key: string) => Promise<any>} fn
 * @param {{key?: string, label?: string}} [opts] - opts.key pins a single key (per-slot test)
 */
async function withKeyRotation(fn, { key, label = 'call' } = {}) {
  if (key) return fn(key);
  const chain = settings().getGeminiKeyChain();
  if (!chain.length) throw new Error('GEMINI_API_KEY is not configured (no key in System Settings or environment).');
  const now = Date.now();
  let order = chain.filter((k) => !(cooldown.get(k.fp) > now));
  if (!order.length) order = chain; // every key is cooling down: try them all rather than fail outright
  let lastErr;
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    try {
      const out = await fn(k.key);
      cooldown.delete(k.fp);
      safeHealth(k.source, true);
      return out;
    } catch (e) {
      const problem = keyProblem(e);
      if (!problem) throw e;
      lastErr = e;
      cooldown.set(k.fp, Date.now() + (problem === 'AI_RATE_LIMIT' ? COOLDOWN_RATE_LIMIT_MS : COOLDOWN_INVALID_MS));
      safeHealth(k.source, false, problem);
      const next = order[i + 1];
      console.warn(`[Gemini] ${label}: key ${k.source} failed (${problem}: ${e.message.slice(0, 160)})${next ? ` -> rotating to ${next.source}` : ' -> no more keys'}`);
    }
  }
  throw lastErr;
}

function safeHealth(source, ok, code) {
  try { settings().recordKeyHealth(source, ok, code); } catch (_) { /* never break a call on bookkeeping */ }
}

async function callApi(model, op, body, timeoutMs, key) {
  if (!key) throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:${op}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const reason = e && e.name === 'TimeoutError' ? `timeout after ${timeoutMs} ms` : (e && e.cause && e.cause.code) || (e && e.message) || String(e);
    throw new Error(`Gemini network error [${op} ${model}]: fetch failed (${reason})`);
  }
  const raw = await res.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch (_) { /* non-JSON body */ }
  if (!res.ok) {
    const err = (json && json.error) || {};
    const details = Array.isArray(err.details) ? err.details.map((d) => d && d.reason).filter(Boolean).join(',') : '';
    throw new GeminiHttpError(res.status, err.status || '', `${err.message || raw.slice(0, 300)}${details ? ` (${details})` : ''}`, model, op);
  }
  if (!json) throw new Error(`Gemini API returned an empty/non-JSON response [${op} ${model}].`);
  return json;
}

function textFromCandidates(json, model) {
  const fb = json.promptFeedback;
  if (fb && fb.blockReason) throw new Error(`Gemini blocked the request [${model}]: ${fb.blockReason}`);
  const cand = (json.candidates || [])[0];
  if (!cand) throw new Error(`Gemini returned no candidates [${model}].`);
  const parts = (cand.content && cand.content.parts) || [];
  const text = parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
  if (!text) {
    throw new Error(`Gemini returned no text [${model}] (finishReason: ${cand.finishReason || 'unknown'}).`);
  }
  return text;
}

/**
 * generateContent with automatic model fallback on 404.
 * @param {Object} o
 * @param {string} o.purpose  - log label, e.g. 'ocr', 'chat', 'transcribe'
 * @param {string} o.modelEnv - env var holding the model for this purpose
 * @param {Array}  o.parts    - Gemini content parts
 * @param {string} [o.systemInstruction]
 * @param {Object} [o.generationConfig]
 * @param {number} [o.timeoutMs]
 * @param {string} [o.key] - pin a single API key (skips rotation; used by the per-slot test)
 */
async function generateText({ purpose, modelEnv, parts, systemInstruction, generationConfig, timeoutMs = 180000, key }) {
  const body = { contents: [{ role: 'user', parts }] };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
  if (generationConfig) body.generationConfig = generationConfig;
  return withKeyRotation((apiKey) => generateWithModelFallback({ purpose, modelEnv, body, timeoutMs, apiKey }), { key, label: purpose });
}

/** Tries the configured model, then GENERATION_FALLBACKS on 404, with one API key. */
async function generateWithModelFallback({ purpose, modelEnv, body, timeoutMs, apiKey }) {
  const primary = workingModel.get(purpose) || resolveGenerationModel(modelEnv);
  const candidates = [primary, ...GENERATION_FALLBACKS.filter((m) => m !== primary)];
  let lastErr;
  for (const model of candidates) {
    try {
      const json = await callApi(model, 'generateContent', body, timeoutMs, apiKey);
      const text = textFromCandidates(json, model);
      if (model !== primary) {
        warnOnce(`fallback:${purpose}:${model}`, `[Gemini] ${purpose}: model "${primary}" unavailable, now using "${model}". Set ${modelEnv}=${model} to silence this.`);
      }
      workingModel.set(purpose, model);
      return text;
    } catch (e) {
      lastErr = e;
      if (e instanceof GeminiHttpError && e.httpStatus === 404) {
        console.error(`[Gemini] ${purpose}: model "${model}" returned 404 (${e.message}). Trying next fallback...`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * Embeds one text with gemini-embedding-001 (Matryoshka, truncated to EMBEDDING_DIMENSIONS, default 768).
 * No cross-model fallback on purpose: vectors from different models are not comparable.
 * @param {string} text
 * @param {{taskType?: string, key?: string}} [opts] RETRIEVAL_DOCUMENT for chunks, RETRIEVAL_QUERY for questions; key pins one API key
 */
async function embedText(text, { taskType, key } = {}) {
  const model = resolveEmbeddingModel();
  const body = {
    model: `models/${model}`,
    content: { parts: [{ text: String(text) }] },
    outputDimensionality: embeddingDimensions(),
  };
  if (taskType) body.taskType = taskType;
  const json = await withKeyRotation((apiKey) => callApi(model, 'embedContent', body, 60000, apiKey), { key, label: 'embed' });
  const values = json && json.embedding && json.embedding.values;
  if (!Array.isArray(values) || !values.length) {
    throw new Error(`Invalid response received from Gemini Embedding API [${model}].`);
  }
  return values;
}

/** Non-secret summary of the effective AI configuration (used in startup logs and /health). */
function describeConfig() {
  let chain = [];
  try { chain = settings().getGeminiKeyChain(); } catch (_) { /* db not ready */ }
  return {
    apiBase: API_BASE,
    keyPresent: chain.length > 0 || Boolean(config.geminiApiKey),
    keyUsable: chain.length > 0,
    keyMasked: maskKey(config.geminiApiKey),
    keySources: chain.map((k) => `${k.source}(${maskKey(k.key)})`),
    generationModel: workingModel.get('chat') || resolveGenerationModel('GEMINI_MODEL'),
    ocrModel: workingModel.get('ocr') || resolveGenerationModel('OCR_MODEL'),
    transcriptionModel: workingModel.get('transcribe') || resolveGenerationModel('TRANSCRIPTION_MODEL'),
    embeddingModel: resolveEmbeddingModel(),
    embeddingDimensions: embeddingDimensions(),
  };
}

function getWorkingKey() {
  try {
    const chain = settings().getGeminiKeyChain();
    return (chain[0] && chain[0].key) || config.geminiApiKey || null;
  } catch (_) {
    return config.geminiApiKey || null;
  }
}

module.exports = {
  generateText,
  embedText,
  describeConfig,
  getWorkingKey,
  maskKey,
  resolveGenerationModel,
  resolveEmbeddingModel,
  GeminiHttpError,
  withKeyRotation,
  keyProblem,
  _resetCooldowns: () => cooldown.clear(),
  DEFAULT_GENERATION_MODEL,
  DEFAULT_EMBEDDING_MODEL,
};
