const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

/** True when at least one usable Gemini key exists (System Settings DB slots or environment). */
function keyAvailable() {
  return require('./settingsService').hasUsableGeminiKey();
}

/** Machine-readable AI failure with a stable code and retry hint. */
class AiError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function classifyError(err) {
  if (err instanceof AiError) return err;
  const msg = String((err && err.message) || err || 'Unknown AI error');
  if (/API key not valid|API_KEY_INVALID|API key.*invalid|API key expired/i.test(msg)) {
    return new AiError('AI_KEY_INVALID', 'The Gemini API key is invalid. Set a valid GEMINI_API_KEY on the server.', false);
  }
  if (/\b403\b|PERMISSION_DENIED|leaked|SERVICE_DISABLED|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED/i.test(msg)) {
    return new AiError('AI_KEY_INVALID', `The Gemini API key was rejected (permission denied: API not enabled, key restricted, or key revoked). ${msg.slice(0, 220)}`, false);
  }
  if (/User location is not supported|FAILED_PRECONDITION/i.test(msg)) {
    return new AiError('AI_PROVIDER_ERROR', `The Gemini API refused the request for this project/region: ${msg.slice(0, 220)}`, false);
  }
  if (/not configured|not defined|GEMINI_API_KEY/i.test(msg) && !/invalid/i.test(msg)) {
    return new AiError('AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not configured on the server.', false);
  }
  if (/\b404\b|not found for API|is not supported|no longer available|deprecated/i.test(msg)) {
    return new AiError('AI_MODEL_UNAVAILABLE', `The configured AI model is unavailable: ${msg.slice(0, 200)}`, false);
  }
  if (/\b429\b|quota|rate limit|RESOURCE_EXHAUSTED/i.test(msg)) {
    return new AiError('AI_RATE_LIMIT', 'AI provider rate limit reached. The file can be retried later.', true);
  }
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(msg)) {
    return new AiError('AI_NETWORK', 'Could not reach the AI provider (network error).', true);
  }
  if (/\b5\d\d\b|overloaded|unavailable/i.test(msg)) {
    return new AiError('AI_PROVIDER_ERROR', `AI provider error: ${msg.slice(0, 200)}`, true);
  }
  return new AiError('AI_FAILED', msg.slice(0, 300), false);
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
  async embed(text, _opts) {
    if (String(text).includes('[[FAIL_EMBED]]')) throw new AiError('AI_PROVIDER_ERROR', 'Injected embedding failure (mock provider).', true);
    return mockEmbedding(text);
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
  async health() {
    return { provider: 'mock', configured: true, status: 'ok', note: 'Mock provider (tests only). Not for production.' };
  },
  async testKey(slot) {
    // Keys containing "INVALID" simulate a rejected key so tests can exercise the failure path.
    return runKeyTest(slot, async (key) => {
      if (/INVALID/.test(key)) throw new AiError('AI_KEY_INVALID', 'Injected invalid key (mock provider).', false);
      return { embeddingDimensions: MOCK_DIM, generationModel: 'mock' };
    });
  },
};

/** Shared per-slot test runner: pins ONE key (no rotation) and stores the observed health. */
async function runKeyTest(slot, probe) {
  const settings = require('./settingsService');
  const source = slot === 'env' ? 'env' : `db:${slot}`;
  if (slot !== 'env' && !settings.SLOTS.includes(slot)) {
    const { AppError } = require('../utils/errors');
    throw new AppError(400, 'INVALID_SLOT', `Unknown key slot "${slot}".`);
  }
  const key = settings.getKeyForSlot(slot);
  if (!key) {
    const { AppError } = require('../utils/errors');
    throw new AppError(400, 'KEY_SLOT_EMPTY', 'No API key is stored in this slot.');
  }
  const t0 = Date.now();
  try {
    const info = await probe(key);
    settings.recordKeyHealth(source, true);
    return { slot, status: 'ok', ms: Date.now() - t0, ...info };
  } catch (e) {
    const c = classifyError(e);
    settings.recordKeyHealth(source, false, c.code);
    return { slot, status: 'error', ms: Date.now() - t0, error: { code: c.code, message: c.message } };
  }
}

// ------------------------------------------------------------------ gemini provider
const geminiProvider = {
  name: 'gemini',
  async embed(text, opts = {}) {
    if (!keyAvailable()) throw new AiError('AI_NOT_CONFIGURED', 'No Gemini API key is configured (System Settings or GEMINI_API_KEY).', false);
    try {
      return await require('./embeddingService').generateVectorEmbedding(text, opts);
    } catch (e) {
      throw classifyError(e);
    }
  },
  async ocrImage(filePath) {
    if (!keyAvailable()) throw new AiError('AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not configured on the server.', false);
    try {
      return await require('../utils/imageOcr').extractTextFromImage(filePath);
    } catch (e) {
      throw classifyError(e);
    }
  },
  async transcribe(filePath) {
    if (!keyAvailable()) throw new AiError('AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not configured on the server.', false);
    try {
      return await require('../utils/mediaTranscriber').transcribeMediaFile(filePath);
    } catch (e) {
      throw classifyError(e);
    }
  },
  async health({ check = false } = {}) {
    const d = require('./geminiClient').describeConfig();
    const info = {
      provider: 'gemini',
      configured: keyAvailable(),
      keySources: d.keySources,
      keyLooksLikePlaceholder: Boolean(config.geminiApiKey) && !config.geminiKeyUsable && !keyAvailable(),
      embeddingModel: d.embeddingModel,
      embeddingDimensions: d.embeddingDimensions,
      generationModel: d.generationModel,
      ocrModel: d.ocrModel,
      status: keyAvailable() ? 'unchecked' : 'not_configured',
    };
    if (!keyAvailable()) {
      info.error = { code: 'AI_NOT_CONFIGURED', message: 'No Gemini API key: add one in System Settings (or GEMINI_API_KEY in the environment).' };
      return info;
    }
    if (check) {
      try {
        await this.embed('health check', { taskType: 'RETRIEVAL_QUERY' });
        await require('./geminiClient').generateText({ purpose: 'ocr', modelEnv: 'OCR_MODEL', parts: [{ text: 'Reply with the single word OK.' }], generationConfig: { maxOutputTokens: 512 }, timeoutMs: 30000 });
        info.ocrModel = require('./geminiClient').describeConfig().ocrModel;
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
};

function provider() {
  return config.aiProvider === 'mock' ? mockProvider : geminiProvider;
}

module.exports = { provider, AiError, classifyError, mockEmbedding };
