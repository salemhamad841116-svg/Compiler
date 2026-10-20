// ==============================================================================
// OpenAI-compatible AI client (Phase 5). The single place for every model call:
// chat (RAG answers), vision (OCR), embeddings and audio transcription.
//
// Works unchanged with Groq, Together AI, Ollama (/v1), vLLM and any other
// OpenAI-compatible server. Which endpoint and model each role uses comes from
// System Settings (settingsService.getAiConfig()).
//
//  - Cloud keys rotate on key problems only (429 rate limit, 401/403 rejected key),
//    with cool-downs, exactly like the Phase 4 Gemini rotation.
//  - When every key is rate limited, the call waits (Retry-After, capped) and retries
//    a few times instead of failing a whole book on a short burst limit.
//  - Every failure is an AiHttpError carrying the HTTP status, the provider's error
//    message, the operation, the model and the host, so classifyError() maps it to a
//    stable code and `docker logs` shows the real reason.
// ==============================================================================

const COOLDOWN_RATE_LIMIT_MS = 60 * 1000;
const COOLDOWN_INVALID_MS = 10 * 60 * 1000;
const cooldown = new Map(); // key fingerprint -> until (ms)

function settings() {
  return require('../settingsService');
}

class AiHttpError extends Error {
  constructor(status, apiMessage, { op, model, host, retryAfterMs = null, apiCode = null } = {}) {
    super(`AI API ${status}${apiCode ? ` ${apiCode}` : ''} [${op} ${model || '-'} @ ${host || '-'}]: ${apiMessage || 'no error message'}`);
    this.name = 'AiHttpError';
    this.httpStatus = status;
    this.apiCode = apiCode;
    this.op = op;
    this.model = model;
    this.host = host;
    this.retryAfterMs = retryAfterMs;
  }
}

class AiNotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiNotConfiguredError';
    this.code = 'AI_NOT_CONFIGURED';
  }
}

function hostOf(url) {
  try { return new URL(url).host; } catch (_) { return String(url).slice(0, 60); }
}

/** Masks a key for logs: never prints more than the last 4 characters. */
function maskKey(k) {
  if (!k) return '(none)';
  return `${'*'.repeat(Math.max(0, Math.min(k.length - 4, 8)))}${k.slice(-4)} (len ${k.length})`;
}

function parseRetryAfter(res) {
  const h = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
  if (!h) return null;
  const s = parseFloat(h);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * One HTTP call to an OpenAI-compatible endpoint.
 * @param {{baseUrl: string, key: string|null}} ep
 * @param {string} path - e.g. '/chat/completions'
 * @param {{json?: object, form?: FormData, method?: string, timeoutMs?: number, op: string, model?: string}} o
 */
async function request(ep, path, { json, form, method, timeoutMs = 120000, op, model }) {
  const url = `${ep.baseUrl}${path}`;
  const host = hostOf(ep.baseUrl);
  const headers = { Accept: 'application/json' };
  if (ep.key) headers.Authorization = `Bearer ${ep.key}`;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  let res;
  try {
    res = await fetch(url, { method: method || (body ? 'POST' : 'GET'), headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const reason = e && e.name === 'TimeoutError' ? `timeout after ${timeoutMs} ms` : (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || String(e);
    throw new Error(`AI network error [${op} ${model || '-'} @ ${host}]: fetch failed (${reason})`);
  }
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { /* non-JSON body */ }
  if (!res.ok) {
    const err = (data && (data.error || data)) || {};
    const message = typeof err === 'string' ? err : err.message || err.detail || raw.slice(0, 300);
    const apiCode = typeof err === 'object' ? err.code || err.type || null : null;
    throw new AiHttpError(res.status, String(message).slice(0, 400), { op, model, host, retryAfterMs: parseRetryAfter(res), apiCode: apiCode ? String(apiCode).slice(0, 60) : null });
  }
  if (data === null) throw new Error(`AI API returned an empty/non-JSON response [${op} ${model || '-'} @ ${host}].`);
  return data;
}

// ------------------------------------------------------------------ endpoints & key rotation
/** Key problems trigger rotation; anything else (404 model, 400 bad input, 5xx, network) does not. */
function keyProblem(e) {
  if (!(e instanceof AiHttpError)) return null;
  if (e.httpStatus === 429) return 'AI_RATE_LIMIT';
  if (e.httpStatus === 401 || e.httpStatus === 403) return 'AI_KEY_INVALID';
  return null;
}

function safeHealth(source, ok, code) {
  try { settings().recordKeyHealth(source, ok, code); } catch (_) { /* never break a call on bookkeeping */ }
}

/** Resolves a target ('cloud' | 'local') to its base URL. */
function baseUrlFor(target) {
  const cfg = settings().getAiConfig();
  return target === 'local' ? cfg.local.baseUrl : cfg.cloud.baseUrl;
}

function rateLimitRetries() {
  const n = parseInt(process.env.AI_RATE_LIMIT_RETRIES, 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isGoogleKey(k) {
  return typeof k === 'string' && k.startsWith('AIzaSy');
}

/**
 * Runs fn(endpoint) against a target, rotating cloud keys on key problems.
 * @param {'cloud'|'local'} target
 * @param {(ep: {baseUrl: string, key: string|null, source: string}) => Promise<any>} fn
 * @param {{key?: string, label?: string, baseUrl?: string}} [opts] - key pins ONE key (per-slot test)
 */
async function withEndpoint(target, fn, { key, label = 'call', baseUrl } = {}) {
  const defaultUrl = (baseUrl || baseUrlFor(target) || '').replace(/\/+$/, '');
  if (!defaultUrl) throw new AiNotConfiguredError(`No endpoint URL is configured for the ${target} AI provider.`);
  if (target === 'local') {
    return fn({ baseUrl: defaultUrl, key: key || settings().getLocalKey(), source: 'local' });
  }
  const presets = require('./presets').CLOUD_PRESETS;
  const googleBaseUrl = presets.google && presets.google.baseUrl;
  if (key) {
    const url = (!baseUrl && isGoogleKey(key) && googleBaseUrl) ? googleBaseUrl : defaultUrl;
    return fn({ baseUrl: url, key, source: 'pinned' });
  }

  const chain = settings().getCloudKeyChain();
  if (!chain.length) throw new AiNotConfiguredError('No cloud AI API key is configured (System Settings or LLM_API_KEY).');
  let lastErr;
  for (let round = 0; round <= rateLimitRetries(); round++) {
    const now = Date.now();
    let order = chain.filter((k) => !(cooldown.get(k.fp) > now));
    if (!order.length) order = chain; // every key cooling down: try them all rather than fail outright
    let allRateLimited = true;
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      const url = (!baseUrl && isGoogleKey(k.key) && googleBaseUrl) ? googleBaseUrl : defaultUrl;
      try {
        const out = await fn({ baseUrl: url, key: k.key, source: k.source });
        cooldown.delete(k.fp);
        safeHealth(k.source, true);
        return out;
      } catch (e) {
        const problem = keyProblem(e);
        if (!problem) throw e;
        lastErr = e;
        if (problem !== 'AI_RATE_LIMIT') allRateLimited = false;
        cooldown.set(k.fp, Date.now() + (problem === 'AI_RATE_LIMIT' ? COOLDOWN_RATE_LIMIT_MS : COOLDOWN_INVALID_MS));
        safeHealth(k.source, false, problem);
        const next = order[i + 1];
        console.warn(`[AI] ${label}: key ${k.source} failed (${problem}: ${e.message.slice(0, 160)})${next ? ` -> rotating to ${next.source}` : ' -> no more keys'}`);
      }
    }
    // Only a pure rate-limit situation is worth waiting for; rejected keys will not recover.
    if (!allRateLimited || round === rateLimitRetries()) break;
    const wait = Math.min(Math.max((lastErr && lastErr.retryAfterMs) || 2000 * 2 ** round, 500), 60000);
    console.warn(`[AI] ${label}: every key is rate limited; waiting ${(wait / 1000).toFixed(1)}s before retry ${round + 1}/${rateLimitRetries()}`);
    for (const k of chain) cooldown.delete(k.fp);
    await sleep(wait);
  }
  throw lastErr;
}

// ------------------------------------------------------------------ response helpers
/** Removes reasoning blocks some open models emit before the visible answer. */
function stripReasoning(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*<think>[\s\S]*$/i, '').trim();
}

function textFromChat(data, ctx) {
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  if (!choice) throw new Error(`AI API returned no choices [${ctx.op} ${ctx.model}].`);
  const content = choice.message ? choice.message.content : choice.text;
  const raw = Array.isArray(content) ? content.map((p) => (p && (p.text || '')) || '').join('') : content;
  const text = stripReasoning(raw);
  if (!text) {
    throw Object.assign(new Error(`AI API returned no text [${ctx.op} ${ctx.model}] (finish_reason: ${choice.finish_reason || 'unknown'}).`), { code: 'AI_EMPTY_RESPONSE' });
  }
  return text;
}

// ------------------------------------------------------------------ public API
/**
 * Chat completion.
 * @param {{target: 'cloud'|'local', model: string, messages: Array, temperature?: number, maxTokens?: number,
 *          timeoutMs?: number, key?: string, label?: string}} o
 * @returns {Promise<string>}
 */
async function chat({ target, model, messages, temperature = 0.2, maxTokens = 2048, timeoutMs = 120000, key, label = 'chat', baseUrl }) {
  if (!model) throw new AiNotConfiguredError(`No model is configured for ${label}.`);
  return withEndpoint(target, async (ep) => {
    const data = await request(ep, '/chat/completions', {
      json: { model, messages, temperature, max_tokens: maxTokens, stream: false },
      timeoutMs, op: label, model,
    });
    return textFromChat(data, { op: label, model });
  }, { key, label, baseUrl });
}

/**
 * Vision: one image + an instruction, returns the model's text.
 * @param {{target, model, image: Buffer, mime: string, prompt: string, maxTokens?: number, timeoutMs?: number, key?: string}} o
 */
async function vision({ target, model, image, mime, prompt, maxTokens = 4096, timeoutMs = 180000, key, baseUrl }) {
  const url = `data:${mime};base64,${Buffer.from(image).toString('base64')}`;
  return chat({
    target, model, key, baseUrl, timeoutMs, maxTokens, temperature: 0, label: 'vision',
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] }],
  });
}

/**
 * Embeddings for a batch of texts (one request). Returned in input order.
 * @param {string[]} texts
 * @param {{target, model, key?: string, timeoutMs?: number}} o
 * @returns {Promise<number[][]>}
 */
async function embed(texts, { target, model, key, timeoutMs = 120000, baseUrl }) {
  if (!model) throw new AiNotConfiguredError('No embedding model is configured.');
  const input = texts.map((t) => String(t));
  return withEndpoint(target, async (ep) => {
    const data = await request(ep, '/embeddings', { json: { model, input, encoding_format: 'float' }, timeoutMs, op: 'embed', model });
    const rows = Array.isArray(data && data.data) ? data.data.slice() : [];
    rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = rows.map((r) => r && r.embedding);
    if (vectors.length !== input.length || vectors.some((v) => !Array.isArray(v) || !v.length)) {
      throw new Error(`Invalid embeddings response [embed ${model} @ ${hostOf(ep.baseUrl)}]: expected ${input.length} vectors, got ${vectors.length}.`);
    }
    return vectors;
  }, { key, label: 'embed', baseUrl });
}

/**
 * Speech-to-text (Whisper) for one audio file.
 * @param {Buffer} audio
 * @param {{target, model, filename: string, mime?: string, language?: string, timeoutMs?: number, key?: string}} o
 * @returns {Promise<string>}
 */
async function transcribe(audio, { target, model, filename, mime = 'audio/mpeg', language, timeoutMs = 300000, key, baseUrl }) {
  if (!model) throw new AiNotConfiguredError('No transcription model is configured.');
  return withEndpoint(target, async (ep) => {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime }), filename);
    form.append('model', model);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (language) form.append('language', language);
    const data = await request(ep, '/audio/transcriptions', { form, timeoutMs, op: 'transcribe', model });
    return String((data && data.text) || '').trim();
  }, { key, label: 'transcribe', baseUrl });
}

/** Lists model IDs served by a target endpoint (GET /models). */
async function listModels(target, { key, baseUrl } = {}) {
  return withEndpoint(target, async (ep) => {
    const data = await request(ep, '/models', { timeoutMs: 20000, op: 'models', model: '-' });
    const list = Array.isArray(data && data.data) ? data.data : Array.isArray(data && data.models) ? data.models : [];
    const out = [];
    for (const m of list) {
      const id = typeof m === 'string' ? m : m && (m.id || m.name);
      if (!id) continue;
      out.push(id);
      if (id.startsWith('models/')) out.push(id.replace(/^models\//, ''));
    }
    return [...new Set(out)].sort();
  }, { key, label: 'models', baseUrl });
}

module.exports = {
  chat,
  vision,
  embed,
  transcribe,
  listModels,
  request,
  withEndpoint,
  keyProblem,
  stripReasoning,
  maskKey,
  hostOf,
  AiHttpError,
  AiNotConfiguredError,
  _resetCooldowns: () => cooldown.clear(),
};
