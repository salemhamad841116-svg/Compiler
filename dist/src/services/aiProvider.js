// ==============================================================================
// AI provider facade (Phase 5: open-source models). Everything else in the app
// (pipeline, chat, admin, self-test) talks to provider() only.
//
//  - 'openai' (live): OpenAI-compatible endpoints configured per role in System
//    Settings: Llama on Groq/Together (cloud) and/or Ollama/vLLM (local), local
//    Tesseract OCR fallback, Whisper transcription. Gemini is no longer used.
//  - 'mock': deterministic offline provider for tests.
// ==============================================================================
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');

function settings() {
  return require('./settingsService');
}

/** Machine-readable AI failure with a stable code and retry hint. */
class AiError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

// Codes produced by our own AI/tool layer that must survive classification unchanged.
const PASSTHROUGH = {
  AI_NOT_CONFIGURED: false,
  OCR_EMPTY: false,
  TOOL_MISSING: false,
  TOOL_FAILED: false,
  AI_TRANSCRIPTION_DISABLED: false,
  AI_PAYLOAD_TOO_LARGE: false,
};

function classifyError(err) {
  if (err instanceof AiError) return err;
  const msg = String((err && err.message) || err || 'Unknown AI error');
  const short = msg.slice(0, 300);
  if (err && Object.prototype.hasOwnProperty.call(PASSTHROUGH, err.code)) return new AiError(err.code, short, PASSTHROUGH[err.code]);
  const status = err && err.httpStatus;
  if (status) {
    if (status === 401 || status === 403) return new AiError('AI_KEY_INVALID', `The AI provider rejected the API key (HTTP ${status}). ${short}`, false);
    if (status === 404) return new AiError('AI_MODEL_UNAVAILABLE', `The configured AI model is unavailable on this endpoint: ${short}`, false);
    if (status === 413) return new AiError('AI_PAYLOAD_TOO_LARGE', `The request is too large for the AI provider: ${short}`, false);
    if (status === 429) return new AiError('AI_RATE_LIMIT', 'AI provider rate limit reached. The file can be retried later.', true);
    if (status === 408) return new AiError('AI_NETWORK', `The AI provider timed out: ${short}`, true);
    if (status >= 500) return new AiError('AI_PROVIDER_ERROR', `AI provider error: ${short}`, true);
    if (/model.{0,40}(not found|does not exist|decommissioned|not available|unknown)/i.test(msg)) {
      return new AiError('AI_MODEL_UNAVAILABLE', `The configured AI model is unavailable on this endpoint: ${short}`, false);
    }
    if (/(image|vision|multimodal|image_url).{0,60}(not supported|unsupported|does not support|invalid)/i.test(msg) || /does not support (image|vision)/i.test(msg)) {
      return new AiError('AI_MODEL_UNSUPPORTED', `The selected model cannot read images: ${short}`, false);
    }
    return new AiError('AI_FAILED', short, false);
  }
  if (/AI network error|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|timeout after/i.test(msg)) {
    return new AiError('AI_NETWORK', `Could not reach the AI endpoint: ${short}`, true);
  }
  if (/not configured/i.test(msg)) return new AiError('AI_NOT_CONFIGURED', short, false);
  return new AiError('AI_FAILED', short, false);
}

// Tiny probe assets for role tests (no files needed).
/** 96x32 grayscale PNG (white with a black bar) generated at runtime: enough for a vision model to accept. */
function makeProbePng() {
  const zlib = require('zlib');
  const w = 96;
  const hgt = 32;
  const raw = Buffer.alloc((w + 1) * hgt, 255);
  for (let y = 0; y < hgt; y++) {
    raw[y * (w + 1)] = 0; // filter: none
    if (y >= 12 && y < 20) for (let x = 8; x < w - 8; x++) raw[y * (w + 1) + 1 + x] = 0;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let probePng = null;
const PROBE_PNG = () => probePng || (probePng = makeProbePng());

/** 1 second of 16 kHz mono silence as a WAV file. */
function silentWav() {
  const samples = 16000;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

/** Shared per-slot cloud key test: pins ONE key (no rotation) and stores the observed health. */
async function runKeyTest(slot, probe) {
  const s = settings();
  const source = slot === 'env' ? 'env' : `db:${slot}`;
  const { AppError } = require('../utils/errors');
  if (slot !== 'env' && !s.SLOTS.includes(slot)) throw new AppError(400, 'INVALID_SLOT', `Unknown key slot "${slot}".`);
  const key = s.getKeyForSlot(slot);
  if (!key) throw new AppError(400, 'KEY_SLOT_EMPTY', 'No API key is stored in this slot.');
  const t0 = Date.now();
  try {
    const info = await probe(key);
    s.recordKeyHealth(source, true);
    return { slot, status: 'ok', ms: Date.now() - t0, ...info };
  } catch (e) {
    const c = classifyError(e);
    s.recordKeyHealth(source, false, c.code);
    return { slot, status: 'error', ms: Date.now() - t0, error: { code: c.code, message: c.message } };
  }
}

/** Shared per-role test runner (real tiny call through the configured route). */
async function runRoleTest(role, probe) {
  const { AppError } = require('../utils/errors');
  const { ROLES } = require('./ai/presets');
  if (!ROLES.includes(role)) throw new AppError(400, 'INVALID_ROLE', `Unknown AI role "${role}".`);
  const r = settings().getAiConfig().roles[role];
  const t0 = Date.now();
  try {
    const info = (await probe(r)) || {};
    return { role, target: r.target, model: r.model, status: 'ok', ms: Date.now() - t0, ...info };
  } catch (e) {
    const c = classifyError(e);
    return { role, target: r.target, model: r.model, status: 'error', ms: Date.now() - t0, error: { code: c.code, message: c.message } };
  }
}

function embedBatchSize() {
  const n = parseInt(process.env.EMBED_BATCH_SIZE, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 128) : 16;
}

/** Roles currently routed to the cloud provider (they need a cloud API key). */
function cloudRoles(cfg) {
  return Object.entries(cfg.roles).filter(([, r]) => r.target === 'cloud').map(([name]) => name);
}

// ------------------------------------------------------------------ mock provider (tests only)
const MOCK_DIM = 768;

function mockEmbedding(text) {
  const vec = new Array(MOCK_DIM).fill(0);
  const words = String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const w of words) {
    const h = crypto.createHash('md5').update(w).digest();
    vec[h.readUInt16BE(0) % MOCK_DIM] += 1;
    vec[h.readUInt16BE(2) % MOCK_DIM] += 0.5;
  }
  if (words.length === 0) vec[0] = 1;
  return vec;
}

const mockProvider = {
  name: 'mock',
  embedTag() {
    return `mock:${settings().embedTagFor(settings().getAiConfig())}`;
  },
  async embed(text) {
    if (String(text).includes('[[FAIL_EMBED]]')) throw new AiError('AI_PROVIDER_ERROR', 'Injected embedding failure (mock provider).', true);
    if (/FAIL/.test(settings().getAiConfig().roles.embeddings.model)) throw new AiError('AI_MODEL_UNAVAILABLE', 'Injected embedding model failure (mock provider).', false);
    return mockEmbedding(text);
  },
  async embedBatch(texts) {
    const out = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  },
  async ocrImage(filePath, originalName = '') {
    if (/fail_ocr/i.test(originalName)) throw new AiError('AI_FAILED', 'Injected OCR failure (mock provider).', false);
    const stat = fs.statSync(filePath);
    return `Mock OCR text for image ${originalName}. Invoice number 12345. Knowledge about mock images (${stat.size} bytes).`;
  },
  async transcribe(filePath, originalName = '') {
    if (/fail_transcribe/i.test(originalName)) throw new AiError('AI_FAILED', 'Injected transcription failure (mock provider).', false);
    return `Mock transcript for ${originalName}. Spoken words about mock audio.`;
  },
  async answer(question, chunks) {
    return `Mock answer for "${question}" based on ${chunks[0].bookTitle}: ${chunks[0].chunk.slice(0, 120)}`;
  },
  available() {
    return true;
  },
  async health() {
    const cfg = settings().getAiConfig();
    return {
      provider: 'mock', configured: true, status: 'ok', note: 'Mock provider (tests only). Not for production.',
      embeddingModel: cfg.roles.embeddings.model, generationModel: cfg.roles.chat.model, embedTag: this.embedTag(),
    };
  },
  async testKey(slot) {
    // Keys containing "INVALID" simulate a rejected key so tests can exercise the failure path.
    return runKeyTest(slot, async (key) => {
      if (/INVALID/.test(key)) throw new AiError('AI_KEY_INVALID', 'Injected invalid key (mock provider).', false);
      return { models: 1 };
    });
  },
  async testRole(role) {
    return runRoleTest(role, async (r) => {
      if (/FAIL/.test(r.model || '')) throw new AiError('AI_MODEL_UNAVAILABLE', 'Injected model failure (mock provider).', false);
      return role === 'embeddings' ? { dimensions: MOCK_DIM } : { sample: 'OK' };
    });
  },
};

// ------------------------------------------------------------------ live open-source provider
const liveProvider = {
  name: 'openai',
  embedTag() {
    return settings().embedTagFor(settings().getAiConfig());
  },
  async embedBatch(texts) {
    const r = settings().getAiConfig().roles.embeddings;
    const client = require('./ai/openaiCompatClient');
    const out = [];
    const size = embedBatchSize();
    try {
      for (let i = 0; i < texts.length; i += size) {
        out.push(...(await client.embed(texts.slice(i, i + size), { target: r.target, model: r.model })));
      }
    } catch (e) {
      throw classifyError(e);
    }
    return out;
  },
  async embed(text) {
    return (await this.embedBatch([text]))[0];
  },
  async ocrImage(filePath, originalName = '') {
    try {
      return (await require('./ai/ocrService').ocrImage(filePath, { label: originalName })).text;
    } catch (e) {
      throw classifyError(e);
    }
  },
  async transcribe(filePath) {
    try {
      return await require('./ai/transcriber').transcribeMediaFile(filePath);
    } catch (e) {
      throw classifyError(e);
    }
  },
  async answer(question, chunks) {
    try {
      return await require('./ai/ragAnswer').generateConstrainedAnswer(question, chunks);
    } catch (e) {
      throw classifyError(e);
    }
  },
  /** False when a role is routed to the cloud provider but no cloud key exists. */
  available() {
    return !(cloudRoles(settings().getAiConfig()).length && !settings().hasUsableCloudKey());
  },
  async health({ check = false } = {}) {
    const cfg = settings().getAiConfig();
    const client = require('./ai/openaiCompatClient');
    const needsKey = cloudRoles(cfg);
    const hasKey = settings().hasUsableCloudKey();
    const info = {
      provider: 'openai',
      configured: !(needsKey.length && !hasKey),
      cloud: { preset: cfg.cloud.preset, host: client.hostOf(cfg.cloud.baseUrl), keySources: settings().getCloudKeyChain().map((k) => k.source) },
      local: { host: client.hostOf(cfg.local.baseUrl) },
      roles: cfg.roles,
      embeddingModel: cfg.roles.embeddings.model,
      generationModel: cfg.roles.chat.model,
      ocrModel: cfg.roles.vision.target === 'tesseract' ? 'tesseract' : cfg.roles.vision.model,
      transcriptionModel: cfg.roles.transcription.model,
      embedTag: this.embedTag(),
      status: 'unchecked',
    };
    if (!info.configured) {
      info.status = 'not_configured';
      info.error = { code: 'AI_NOT_CONFIGURED', message: `No cloud API key: add one in System Settings (needed for: ${needsKey.join(', ')}).` };
      return info;
    }
    if (check) {
      const results = [await this.testRole('embeddings'), await this.testRole('chat')];
      info.roleChecks = results;
      const bad = results.find((r) => r.status !== 'ok');
      info.status = bad ? 'error' : 'ok';
      if (bad) info.error = { code: bad.error.code, message: `${bad.role}: ${bad.error.message}` };
    }
    return info;
  },
  async testKey(slot) {
    return runKeyTest(slot, async (key) => {
      const client = require('./ai/openaiCompatClient');
      const models = await client.listModels('cloud', { key });
      const cfg = settings().getAiConfig();
      const missing = cloudRoles(cfg).map((r) => cfg.roles[r].model).filter((m, i, a) => m && a.indexOf(m) === i && !models.includes(m));
      return { models: models.length, missingModels: missing };
    });
  },
  async testRole(role) {
    const client = require('./ai/openaiCompatClient');
    return runRoleTest(role, async (r) => {
      if (role === 'chat') {
        const text = await client.chat({ target: r.target, model: r.model, maxTokens: 16, temperature: 0, timeoutMs: 60000, label: 'test-chat', messages: [{ role: 'user', content: 'Reply with the single word OK.' }] });
        return { sample: text.slice(0, 40) };
      }
      if (role === 'embeddings') {
        const [v] = await client.embed(['health check'], { target: r.target, model: r.model, timeoutMs: 60000 });
        return { dimensions: v.length };
      }
      if (role === 'vision') {
        if (r.target === 'tesseract') {
          const tools = require('./ai/localTools');
          if (!(await tools.has('tesseract'))) throw Object.assign(new Error('Tesseract is not installed on this server.'), { code: 'TOOL_MISSING' });
          return { sample: 'tesseract' };
        }
        const text = await client.vision({ target: r.target, model: r.model, image: PROBE_PNG(), mime: 'image/png', prompt: 'Describe this image in at most five words.', maxTokens: 32, timeoutMs: 60000 });
        return { sample: text.slice(0, 40) };
      }
      if (role === 'transcription') {
        if (r.target === 'disabled') return { sample: 'disabled' };
        await client.transcribe(silentWav(), { target: r.target, model: r.model, filename: 'probe.wav', mime: 'audio/wav', timeoutMs: 60000 });
        return { sample: 'OK' };
      }
      return {};
    });
  },
};

const geminiProvider = {
  name: 'gemini',
  embedTag() {
    return 'gemini-embedding-001';
  },
  async embedBatch(texts) {
    const gc = require('./geminiClient');
    const out = [];
    for (const t of texts) {
      out.push(await gc.embedText(t));
    }
    return out;
  },
  async embed(text, opts = {}) {
    try {
      return await require('./embeddingService').generateVectorEmbedding(text, opts);
    } catch (e) {
      throw classifyError(e);
    }
  },
  async ocrImage(filePath, _originalName = '') {
    try {
      return await require('../utils/imageOcr').extractTextFromImage(filePath);
    } catch (e) {
      throw classifyError(e);
    }
  },
  async transcribe(filePath) {
    try {
      return await require('../utils/mediaTranscriber').transcribeMediaFile(filePath);
    } catch (e) {
      throw classifyError(e);
    }
  },
  async answer(question, chunks) {
    try {
      return await require('./geminiService').generateConstrainedAnswer(question, chunks);
    } catch (e) {
      throw classifyError(e);
    }
  },
  available() {
    try {
      const gc = require('./geminiClient');
      return Boolean(gc.getWorkingKey && gc.getWorkingKey());
    } catch (_) {
      return false;
    }
  },
  async health({ check = false } = {}) {
    const gc = require('./geminiClient');
    const d = gc.describeConfig();
    let hasKey = false;
    try {
      hasKey = Boolean(gc.getWorkingKey());
    } catch (_) {
      hasKey = false;
    }
    const info = {
      provider: 'gemini',
      configured: hasKey,
      keySources: d.keySources,
      embeddingModel: d.embeddingModel,
      embeddingDimensions: d.embeddingDimensions,
      generationModel: d.generationModel,
      ocrModel: d.ocrModel,
      embedTag: this.embedTag(),
      status: hasKey ? 'unchecked' : 'not_configured',
    };
    if (!hasKey) {
      info.error = { code: 'AI_NOT_CONFIGURED', message: 'No Gemini API key available.' };
      return info;
    }
    if (check) {
      try {
        await this.embed('health check', { taskType: 'RETRIEVAL_QUERY' });
        info.status = 'ok';
      } catch (e) {
        const c = classifyError(e);
        info.status = 'error';
        info.error = { code: c.code, message: c.message };
      }
    }
    return info;
  },
  async testKey(slot) {
    return runKeyTest(slot, async (key) => {
      const gc = require('./geminiClient');
      const vec = await gc.embedText('health check', { taskType: 'RETRIEVAL_QUERY', key });
      await gc.generateText({ purpose: 'chat', modelEnv: 'GEMINI_MODEL', parts: [{ text: 'Reply with the single word OK.' }], generationConfig: { maxOutputTokens: 512 }, timeoutMs: 30000, key });
      const d = gc.describeConfig();
      return { embeddingDimensions: Array.isArray(vec) ? vec.length : null, embeddingModel: d.embeddingModel, generationModel: d.generationModel };
    });
  },
  async testRole() {
    return {};
  },
};

function provider() {
  if (config.aiProvider === 'mock') return mockProvider;
  if (config.aiProvider === 'gemini') return geminiProvider;
  return liveProvider;
}

module.exports = { provider, AiError, classifyError, mockEmbedding };
