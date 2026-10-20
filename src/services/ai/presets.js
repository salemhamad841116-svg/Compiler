// ==============================================================================
// AI presets (Phase 5). Every engine below speaks the OpenAI-compatible HTTP API
// (/v1/chat/completions, /v1/embeddings, /v1/audio/transcriptions, /v1/models),
// so switching between a managed open-source provider (Groq, Together AI) and a
// fully local engine (Ollama, vLLM) is a settings change, never a code change.
//
// Model IDs here are only SUGGESTIONS used to pre-fill the admin UI; the admin
// can pick any model the endpoint lists via /v1/models.
// ==============================================================================

const CLOUD_PRESETS = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    models: {
      chat: 'meta-llama/llama-4-scout-17b-16e-instruct',
      vision: 'meta-llama/llama-4-scout-17b-16e-instruct',
      embeddings: null, // Groq has no embeddings API: embeddings default to the local engine
      transcription: 'whisper-large-v3-turbo',
    },
    limits: { audioMb: 25, imageMb: 4 },
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    models: {
      chat: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      vision: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
      embeddings: null, // Embeddings route to the local bge-m3 engine
      transcription: 'openai/whisper-large-v3',
    },
    limits: { audioMb: 25, imageMb: 4 },
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: {
      chat: 'gemini-2.5-flash',
      vision: 'gemini-2.5-flash',
      embeddings: 'text-embedding-004',
      transcription: null,
    },
    suggestedModels: {
      chat: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'],
      vision: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'],
      embeddings: ['text-embedding-004'],
    },
    limits: { audioMb: 25, imageMb: 20 },
  },
  custom: {
    baseUrl: '',
    models: { chat: '', vision: '', embeddings: '', transcription: '' },
    limits: { audioMb: 25, imageMb: 4 },
  },
};

const LOCAL_PRESET = {
  baseUrl: 'http://masruq_ollama:11434/v1',
  models: {
    chat: 'llama3.1:8b',
    vision: 'llama3.2-vision',
    embeddings: 'bge-m3',
    // Ollama does not serve Whisper; this only applies if the local endpoint is an
    // OpenAI-compatible speech server (e.g. vLLM or a faster-whisper server).
    transcription: 'whisper-large-v3',
  },
  limits: { audioMb: 100, imageMb: 20 },
};

const ROLES = ['chat', 'vision', 'embeddings', 'transcription'];

const ROLE_TARGETS = {
  chat: ['cloud', 'local'],
  vision: ['cloud', 'local', 'tesseract'],
  embeddings: ['cloud', 'local'],
  transcription: ['cloud', 'local', 'disabled'],
};

/** Suggested model for a role on a target (used when a role has no explicit model). */
function suggestedModel(role, target, cloudPreset) {
  if (target === 'local') return LOCAL_PRESET.models[role] || '';
  if (target === 'cloud') {
    const p = CLOUD_PRESETS[cloudPreset] || CLOUD_PRESETS.together;
    return p.models[role] || '';
  }
  return '';
}

/**
 * Normalizes model names across all providers.
 * Specifically for Gemini / Google AI Studio:
 *  - Strips leading "models/" prefix (Google OpenAI wrapper translates models/X into models/models/X -> 404)
 *  - Strips trailing "-latest" or ":latest" (e.g. gemini-1.5-flash-latest -> gemini-1.5-flash) which Google's OpenAI API rejects with 404
 *  - Maps legacy aliases (gemini-flash-latest -> gemini-1.5-flash, gemini-pro-latest -> gemini-1.5-pro)
 */
function normalizeAiModel(model) {
  if (!model) return model;
  let m = String(model).trim().replace(/^models\//i, '');
  if (/^gemini-/i.test(m)) {
    if (/^gemini-1(\.[05])?-pro/i.test(m) || /^gemini-pro(?:[:\-]latest)?$/i.test(m)) return 'gemini-2.5-pro';
    if (/^gemini-1(\.[05])?-flash/i.test(m) || /^gemini-flash(?:[:\-]latest)?$/i.test(m)) return 'gemini-2.5-flash';
    m = m.replace(/[:\-]latest$/i, '');
  }
  return m;
}

module.exports = { CLOUD_PRESETS, LOCAL_PRESET, ROLES, ROLE_TARGETS, suggestedModel, normalizeAiModel };
