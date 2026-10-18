const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

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
};

// ------------------------------------------------------------------ gemini provider
const geminiProvider = {
  name: 'gemini',
  async embed(text, opts = {}) {
    if (!config.geminiKeyUsable) throw new AiError('AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not configured on the server.', false);
    try {
      return await require('./embeddingService').generateVectorEmbedding(text, opts);
    } catch (e) {
      throw classifyError(e);
    }
  },
  async ocrImage(filePath) {
    if (!config.geminiKeyUsable) throw new AiError('AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not configured on the server.', false);
    try {
      return await require('../utils/imageOcr').extractTextFromImage(filePath);
    } catch (e) {
      throw classifyError(e);
    }
  },
  async transcribe(filePath) {
    if (!config.geminiKeyUsable) throw new AiError('AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not configured on the server.', false);
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
      configured: config.geminiKeyUsable,
      keyLooksLikePlaceholder: Boolean(config.geminiApiKey) && !config.geminiKeyUsable,
      embeddingModel: d.embeddingModel,
      embeddingDimensions: d.embeddingDimensions,
      generationModel: d.generationModel,
      ocrModel: d.ocrModel,
      status: config.geminiKeyUsable ? 'unchecked' : 'not_configured',
    };
    if (!config.geminiKeyUsable) {
      info.error = { code: 'AI_NOT_CONFIGURED', message: 'GEMINI_API_KEY is missing or still a placeholder value.' };
      return info;
    }
    if (check) {
      try {
        await this.embed('health check', { taskType: 'RETRIEVAL_QUERY' });
        await require('./geminiClient').generateText({ purpose: 'ocr', modelEnv: 'OCR_MODEL', parts: [{ text: 'Reply with the single word OK.' }], generationConfig: { maxOutputTokens: 512 }, timeoutMs: 30000 });
        info.ocrModel = require('./geminiClient').describeConfig().ocrModel;
        info.status = 'ok';
      } catch (e) {
        info.status = 'error';
        info.error = { code: e.code || 'AI_FAILED', message: e.message };
      }
    }
    return info;
  },
};

function provider() {
  return config.aiProvider === 'mock' ? mockProvider : geminiProvider;
}

module.exports = { provider, AiError, classifyError, mockEmbedding };
