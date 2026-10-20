// ==============================================================================
// Runtime system settings (Phase 4, extended in Phase 5 for the open-source AI
// stack). Stored in the system_settings table and applied without restarting
// the container.
//
//  - Cloud provider API keys (Groq / Together AI / custom OpenAI-compatible):
//    encrypted (AES-256-GCM), write-only, rotated in this order:
//      DB primary -> DB fallback1 -> DB fallback2 -> LLM_API_KEY from the environment.
//  - Optional local endpoint key (Ollama needs none; vLLM may use --api-key).
//  - AI routing config (non-secret JSON): cloud preset + base URL, local base URL,
//    and for each role (chat, vision/OCR, embeddings, transcription) the target
//    engine and the model. Environment variables provide the defaults.
// Plain keys are NEVER returned by any API; only the last 4 characters are shown.
// ==============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { get, all, run } = require('../db/database');
const { nowIso } = require('../utils/clock');
const { AppError } = require('../utils/errors');
const { CLOUD_PRESETS, LOCAL_PRESET, ROLES, ROLE_TARGETS, suggestedModel, normalizeAiModel } = require('./ai/presets');

const SLOTS = ['primary', 'fallback1', 'fallback2'];
const slotKey = (slot) => `ai.cloud.key.${slot}`;
const LOCAL_KEY = 'ai.local.key';
const CONFIG_KEY = 'ai.config';
const CACHE_TTL_MS = 30000;

let masterKeyBuf = null;
let cache = null; // { at, rows: Map<slot, {key, meta, updatedAt, updatedBy}>, local, cfg }
const envHealth = { status: 'untested', lastCheckedAt: null, lastErrorCode: null };

// ------------------------------------------------------------------ crypto
function masterKey() {
  if (masterKeyBuf) return masterKeyBuf;
  const fromEnv = String(process.env.SETTINGS_ENCRYPTION_KEY || '').trim();
  if (fromEnv) {
    masterKeyBuf = crypto.createHash('sha256').update(fromEnv).digest();
    return masterKeyBuf;
  }
  const file = path.join(config.dataDir, '.settings.key');
  if (fs.existsSync(file)) {
    masterKeyBuf = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    masterKeyBuf = crypto.randomBytes(32);
    fs.writeFileSync(file, masterKeyBuf.toString('hex'), { mode: 0o600 });
    console.log(`[Settings] Generated a new settings encryption key at ${file} (keep it with the data volume).`);
  }
  if (masterKeyBuf.length !== 32) throw new Error('Settings encryption key file is corrupt (expected 32 bytes).');
  return masterKeyBuf;
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

function decrypt(blob) {
  const [v, iv, tag, data] = String(blob || '').split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported settings ciphertext format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// ------------------------------------------------------------------ helpers
function sanitizeKey(raw) {
  return String(raw == null ? '' : raw).replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '').trim();
}

function isPlaceholder(k) {
  return !k || /your_|_here|placeholder|changeme/i.test(k);
}

function fingerprint(k) {
  return crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 12);
}

function parseMeta(s) {
  try { return s ? JSON.parse(s) : {}; } catch (_) { return {}; }
}

function decryptRow(r, label) {
  const meta = parseMeta(r.meta);
  let key = null;
  if (r.value_enc) {
    try {
      key = decrypt(r.value_enc);
    } catch (e) {
      console.error(`[Settings] Could not decrypt ${label} (encryption key changed?): ${e.message}`);
      meta.status = 'undecryptable';
    }
  }
  return { key, meta, updatedAt: r.updated_at, updatedBy: r.updated_by };
}

function load() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  const rows = new Map();
  let local = null;
  let cfg = {};
  for (const r of all("SELECT key, value_enc, is_secret, meta, updated_at, updated_by FROM system_settings WHERE key LIKE 'ai.%'")) {
    if (r.key.startsWith('ai.cloud.key.')) {
      const slot = r.key.slice('ai.cloud.key.'.length);
      if (SLOTS.includes(slot)) rows.set(slot, decryptRow(r, `cloud API key slot "${slot}"`));
    } else if (r.key === LOCAL_KEY) {
      local = decryptRow(r, 'local endpoint key');
    } else if (r.key === CONFIG_KEY) {
      cfg = parseMeta(r.value_enc);
      if (cfg && cfg.roles) {
        let changed = false;
        for (const roleName of Object.keys(cfg.roles)) {
          const cur = cfg.roles[roleName] && cfg.roles[roleName].model;
          if (cur) {
            const norm = normalizeAiModel(cur);
            if (norm !== cur) {
              cfg.roles[roleName].model = norm;
              changed = true;
            }
          }
        }
        if (changed) {
          try {
            run('UPDATE system_settings SET value_enc = ? WHERE key = ?', JSON.stringify(cfg), CONFIG_KEY);
            console.log('[Settings] Auto-sanitized stored AI model names in database (e.g. gemini-2.5-flash -> gemini-3.8-flash).');
          } catch (_) { /* non-blocking */ }
        }
      }
    }
  }
  cache = { at: Date.now(), rows, local, cfg };
  return cache;
}

function invalidate() {
  cache = null;
}

function onChange(scope = 'ai') {
  invalidate();
  try { require('../models/vectorDbModel').invalidateCache(); } catch (_) { /* optional */ }
  try { require('./eventBus').publish('settings.changed', { scope }); } catch (_) { /* optional */ }
}

function audit(action, actor, ip, detail) {
  require('./auditService').record({ action, actor, ip, detail });
}

// ------------------------------------------------------------------ cloud keys
/**
 * Ordered, de-duplicated list of usable cloud keys.
 * @returns {Array<{source: string, slot: string|null, key: string, fp: string}>}
 */
function getCloudKeyChain() {
  const { rows } = load();
  const chain = [];
  const seen = new Set();
  for (const slot of SLOTS) {
    const r = rows.get(slot);
    if (r && r.key && !isPlaceholder(r.key) && !seen.has(r.key)) {
      seen.add(r.key);
      chain.push({ source: `db:${slot}`, slot, key: r.key, fp: fingerprint(r.key) });
    }
  }
  const envKey = config.cloudApiKey;
  if (envKey && !isPlaceholder(envKey) && !seen.has(envKey)) {
    chain.push({ source: 'env', slot: null, key: envKey, fp: fingerprint(envKey) });
  }
  return chain;
}

function hasUsableCloudKey() {
  try {
    return getCloudKeyChain().length > 0;
  } catch (e) {
    console.error('[Settings] key lookup failed:', e.message);
    return config.cloudKeyUsable;
  }
}

/** Key for one slot ('primary'|'fallback1'|'fallback2'|'env'), used by the per-slot test button. */
function getKeyForSlot(slot) {
  if (slot === 'env') return config.cloudKeyUsable ? config.cloudApiKey : null;
  const r = load().rows.get(slot);
  return r && r.key && !isPlaceholder(r.key) ? r.key : null;
}

function assertSlot(slot) {
  if (!SLOTS.includes(slot)) throw new AppError(400, 'INVALID_SLOT', `Unknown key slot "${slot}".`);
}

function validateKey(k) {
  if (k.length < 20 || k.length > 200 || /\s/.test(k)) {
    throw new AppError(400, 'INVALID_API_KEY_FORMAT', 'The API key format is not valid (20-200 characters, no spaces).');
  }
  if (isPlaceholder(k)) throw new AppError(400, 'INVALID_API_KEY_FORMAT', 'The API key looks like a placeholder value.');
}

function upsertSecret(key, val, actor) {
  const meta = { last4: val.slice(-4), status: 'untested', lastCheckedAt: null, lastErrorCode: null };
  run(
    `INSERT INTO system_settings (key, value_enc, is_secret, meta, updated_at, updated_by) VALUES (?,?,1,?,?,?)
     ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, meta = excluded.meta, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    key, encrypt(val), JSON.stringify(meta), nowIso(), actor && actor.id ? actor.id : null
  );
  return meta;
}

/**
 * Saves any provided cloud key slots. Empty / missing values leave the stored key untouched.
 * @param {{primary?: string, fallback1?: string, fallback2?: string}} input
 */
function setCloudKeys(input, actor, { ip } = {}) {
  const changes = [];
  for (const slot of SLOTS) {
    const val = sanitizeKey(input && input[slot]);
    if (!val) continue;
    validateKey(val);
    changes.push({ slot, val });
  }
  if (!changes.length) throw new AppError(400, 'NO_KEYS_PROVIDED', 'Enter at least one API key to save.');
  for (const { slot, val } of changes) {
    const meta = upsertSecret(slotKey(slot), val, actor);
    audit('settings.api_key_updated', actor, ip, { slot, last4: meta.last4 });
  }
  const hasGoogleKey = changes.some((c) => c.val.startsWith('AIzaSy'));
  const currentCfg = getAiConfig();
  if (hasGoogleKey && currentCfg.cloud.preset !== 'google') {
    try {
      updateAiConfig({ cloud: { preset: 'google', baseUrl: CLOUD_PRESETS.google.baseUrl } }, actor, { ip });
    } catch (e) {
      console.warn('[Settings] Failed to auto-switch cloud preset to google:', e.message);
    }
  }
  onChange();
  return describeKeys();
}

function clearCloudKey(slot, actor, { ip } = {}) {
  assertSlot(slot);
  const existing = get('SELECT meta FROM system_settings WHERE key = ?', slotKey(slot));
  run('DELETE FROM system_settings WHERE key = ?', slotKey(slot));
  if (existing) audit('settings.api_key_cleared', actor, ip, { slot, last4: parseMeta(existing.meta).last4 || null });
  onChange();
  return describeKeys();
}

// ------------------------------------------------------------------ local endpoint key
function getLocalKey() {
  const l = load().local;
  if (l && l.key) return l.key;
  return config.localApiKey || null;
}

function setLocalKey(raw, actor, { ip } = {}) {
  const val = sanitizeKey(raw);
  if (!val) throw new AppError(400, 'NO_KEYS_PROVIDED', 'Enter a key to save.');
  if (val.length < 4 || val.length > 200 || /\s/.test(val)) {
    throw new AppError(400, 'INVALID_API_KEY_FORMAT', 'The key format is not valid (4-200 characters, no spaces).');
  }
  const meta = upsertSecret(LOCAL_KEY, val, actor);
  audit('settings.api_key_updated', actor, ip, { slot: 'local', last4: meta.last4 });
  onChange();
}

function clearLocalKey(actor, { ip } = {}) {
  const existing = get('SELECT meta FROM system_settings WHERE key = ?', LOCAL_KEY);
  run('DELETE FROM system_settings WHERE key = ?', LOCAL_KEY);
  if (existing) audit('settings.api_key_cleared', actor, ip, { slot: 'local', last4: parseMeta(existing.meta).last4 || null });
  onChange();
}

// ------------------------------------------------------------------ key health
/** Stores the last observed health of a cloud key (never the key itself). */
function recordKeyHealth(source, ok, code = null) {
  const status = ok ? 'ok' : code === 'AI_RATE_LIMIT' ? 'rate_limited' : code === 'AI_KEY_INVALID' ? 'invalid' : 'error';
  const at = nowIso();
  if (source === 'env') {
    Object.assign(envHealth, { status, lastCheckedAt: at, lastErrorCode: ok ? null : code });
    return;
  }
  const slot = String(source || '').replace(/^db:/, '');
  if (!SLOTS.includes(slot)) return;
  const row = get('SELECT meta FROM system_settings WHERE key = ?', slotKey(slot));
  if (!row) return;
  const meta = { ...parseMeta(row.meta), status, lastCheckedAt: at, lastErrorCode: ok ? null : code };
  run('UPDATE system_settings SET meta = ? WHERE key = ?', JSON.stringify(meta), slotKey(slot));
  const cached = cache && cache.rows.get(slot);
  if (cached) cached.meta = meta;
}

/** Safe, masked description for the admin UI. */
function describeKeys() {
  const { rows, local } = load();
  const userName = (id) => (id ? (get('SELECT name FROM users WHERE id = ?', id) || {}).name || null : null);
  const slots = SLOTS.map((slot) => {
    const r = rows.get(slot);
    return {
      slot,
      configured: Boolean(r && r.key),
      last4: r && r.meta.last4 ? r.meta.last4 : null,
      status: r ? r.meta.status || 'untested' : 'empty',
      lastCheckedAt: r ? r.meta.lastCheckedAt || null : null,
      lastErrorCode: r ? r.meta.lastErrorCode || null : null,
      updatedAt: r ? r.updatedAt : null,
      updatedBy: r ? userName(r.updatedBy) : null,
    };
  });
  const envKey = config.cloudApiKey;
  return {
    slots,
    env: {
      configured: config.cloudKeyUsable,
      placeholder: Boolean(envKey) && !config.cloudKeyUsable,
      last4: config.cloudKeyUsable ? envKey.slice(-4) : null,
      ...envHealth,
    },
    local: {
      configured: Boolean((local && local.key) || config.localApiKey),
      source: local && local.key ? 'db' : config.localApiKey ? 'env' : null,
      last4: local && local.key ? local.meta.last4 || null : config.localApiKey ? config.localApiKey.slice(-4) : null,
    },
    effectiveOrder: getCloudKeyChain().map((k) => k.source),
  };
}

// ------------------------------------------------------------------ AI routing config
const MODEL_RE = /^[\w.:/@+-]{1,200}$/;
const PDF_OCR_MODES = ['auto', 'always', 'never'];

function envNum(name) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : null;
}

function trimUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

/** Defaults from the environment (DB values override these field by field). */
function envDefaults() {
  const preset = String(process.env.CLOUD_AI_PRESET || 'together').toLowerCase();
  const cloudPreset = CLOUD_PRESETS[preset] ? preset : 'together';
  const role = (name, envTarget, envModel, defTarget) => {
    const target = String(process.env[envTarget] || defTarget).toLowerCase();
    const t = ROLE_TARGETS[name].includes(target) ? target : defTarget;
    const m = normalizeAiModel(process.env[envModel]);
    return { target: t, model: m || null };
  };
  return {
    cloud: { preset: cloudPreset, baseUrl: trimUrl(process.env.CLOUD_AI_BASE_URL) || CLOUD_PRESETS[cloudPreset].baseUrl },
    local: { baseUrl: trimUrl(process.env.LOCAL_AI_BASE_URL) || LOCAL_PRESET.baseUrl },
    roles: {
      chat: role('chat', 'CHAT_TARGET', 'CHAT_MODEL', 'cloud'),
      vision: { ...role('vision', 'VISION_TARGET', 'VISION_MODEL', 'cloud'), tesseractFallback: process.env.OCR_TESSERACT_FALLBACK !== '0' },
      embeddings: role('embeddings', 'EMBED_TARGET', 'EMBED_MODEL', 'local'),
      transcription: role('transcription', 'TRANSCRIBE_TARGET', 'TRANSCRIBE_MODEL', 'cloud'),
    },
    pdfOcr: PDF_OCR_MODES.includes(process.env.PDF_OCR) ? process.env.PDF_OCR : 'auto',
    similarityThreshold: envNum('RAG_SIMILARITY_THRESHOLD'),
  };
}

const DEFAULT_THRESHOLD = 0.4;

/**
 * Effective AI configuration: env defaults overridden by the admin's saved values.
 * Every role always has a concrete target and model.
 */
function getAiConfig() {
  const d = envDefaults();
  const db = load().cfg || {};
  const cloud = { ...d.cloud, ...(db.cloud || {}) };
  if (!CLOUD_PRESETS[cloud.preset]) cloud.preset = 'together';
  if (db.cloud && db.cloud.preset && !db.cloud.baseUrl) cloud.baseUrl = CLOUD_PRESETS[cloud.preset].baseUrl;
  if (!cloud.baseUrl) cloud.baseUrl = CLOUD_PRESETS[cloud.preset].baseUrl;
  const local = { ...d.local, ...(db.local || {}) };
  const roles = {};
  for (const r of ROLES) {
    const merged = { ...d.roles[r], ...((db.roles && db.roles[r]) || {}) };
    if (!ROLE_TARGETS[r].includes(merged.target)) merged.target = d.roles[r].target;
    if (!merged.model) merged.model = suggestedModel(r, merged.target, cloud.preset);
    if (merged.model) merged.model = normalizeAiModel(merged.model);
    roles[r] = merged;
  }
  const threshold = typeof db.similarityThreshold === 'number' ? db.similarityThreshold : d.similarityThreshold;
  return {
    cloud,
    local,
    roles,
    pdfOcr: PDF_OCR_MODES.includes(db.pdfOcr) ? db.pdfOcr : d.pdfOcr,
    similarityThreshold: typeof threshold === 'number' ? threshold : DEFAULT_THRESHOLD,
  };
}

function badConfig(message, field) {
  return new AppError(400, 'INVALID_AI_CONFIG', message, { field });
}

function validUrl(u, field) {
  const s = trimUrl(u);
  if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s) || s.length > 300) throw badConfig('The endpoint URL must start with http:// or https://.', field);
  return s;
}

/** Normalized identity of an embedding model: chunks indexed with another identity are stale. */
function embedTagFor(cfg) {
  return String(normalizeAiModel(cfg.roles.embeddings.model) || '').trim().toLowerCase().replace(/:latest$/, '');
}

/**
 * Validates and saves a partial config patch. Returns the new effective config and whether
 * the embedding model identity changed (which makes the existing index stale).
 */
function updateAiConfig(patch, actor, { ip } = {}) {
  if (!patch || typeof patch !== 'object') throw badConfig('Nothing to save.', null);
  const before = getAiConfig();
  const stored = JSON.parse(JSON.stringify(load().cfg || {}));
  const changed = [];

  if (patch.cloud) {
    stored.cloud = stored.cloud || {};
    if (patch.cloud.preset !== undefined) {
      if (!CLOUD_PRESETS[patch.cloud.preset]) throw badConfig('Unknown cloud provider preset.', 'cloud.preset');
      const prevPreset = stored.cloud.preset || before.cloud.preset;
      stored.cloud.preset = patch.cloud.preset;
      if (patch.cloud.baseUrl === undefined) delete stored.cloud.baseUrl;
      changed.push('cloud.preset');
      if (prevPreset !== patch.cloud.preset && !patch.roles) {
        stored.roles = stored.roles || {};
        for (const r of ['chat', 'vision']) {
          const cur = stored.roles[r] || {};
          const prevDef = (CLOUD_PRESETS[prevPreset] && CLOUD_PRESETS[prevPreset].models[r]) || '';
          if (!cur.model || cur.model === prevDef) {
            cur.model = CLOUD_PRESETS[patch.cloud.preset].models[r] || cur.model;
            stored.roles[r] = cur;
          }
        }
      }
    }
    if (patch.cloud.baseUrl !== undefined) {
      stored.cloud.baseUrl = patch.cloud.baseUrl ? validUrl(patch.cloud.baseUrl, 'cloud.baseUrl') : CLOUD_PRESETS[stored.cloud.preset || before.cloud.preset].baseUrl;
      if (!stored.cloud.baseUrl) throw badConfig('A custom provider needs an endpoint URL.', 'cloud.baseUrl');
      changed.push('cloud.baseUrl');
    }
  }
  if (patch.local && patch.local.baseUrl !== undefined) {
    stored.local = { baseUrl: patch.local.baseUrl ? validUrl(patch.local.baseUrl, 'local.baseUrl') : LOCAL_PRESET.baseUrl };
    changed.push('local.baseUrl');
  }
  if (patch.roles) {
    stored.roles = stored.roles || {};
    for (const [name, val] of Object.entries(patch.roles)) {
      if (!ROLES.includes(name)) throw badConfig(`Unknown AI role "${name}".`, `roles.${name}`);
      if (!val || typeof val !== 'object') continue;
      const next = { ...(stored.roles[name] || {}) };
      if (val.target !== undefined) {
        if (!ROLE_TARGETS[name].includes(val.target)) throw badConfig(`Target "${val.target}" is not allowed for ${name}.`, `roles.${name}.target`);
        next.target = val.target;
      }
      if (val.model !== undefined) {
        const m = normalizeAiModel(val.model);
        if (m && !MODEL_RE.test(m)) throw badConfig('The model name contains invalid characters.', `roles.${name}.model`);
        next.model = m || null;
      }
      if (name === 'vision' && val.tesseractFallback !== undefined) next.tesseractFallback = Boolean(val.tesseractFallback);
      stored.roles[name] = next;
      changed.push(`roles.${name}`);
    }
  }
  if (patch.pdfOcr !== undefined) {
    if (!PDF_OCR_MODES.includes(patch.pdfOcr)) throw badConfig('Unknown PDF OCR mode.', 'pdfOcr');
    stored.pdfOcr = patch.pdfOcr;
    changed.push('pdfOcr');
  }
  if (patch.similarityThreshold !== undefined) {
    if (patch.similarityThreshold === null || patch.similarityThreshold === '') {
      delete stored.similarityThreshold;
    } else {
      const v = Number(patch.similarityThreshold);
      if (!Number.isFinite(v) || v < 0.05 || v > 0.95) throw badConfig('The similarity threshold must be between 0.05 and 0.95.', 'similarityThreshold');
      stored.similarityThreshold = Math.round(v * 1000) / 1000;
    }
    changed.push('similarityThreshold');
  }
  if (!changed.length) throw badConfig('Nothing to save.', null);

  run(
    `INSERT INTO system_settings (key, value_enc, is_secret, meta, updated_at, updated_by) VALUES (?,?,0,NULL,?,?)
     ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    CONFIG_KEY, JSON.stringify(stored), nowIso(), actor && actor.id ? actor.id : null
  );
  invalidate();
  const after = getAiConfig();
  const embeddingChanged = embedTagFor(before) !== embedTagFor(after);
  audit('settings.ai_config_updated', actor, ip, {
    changed,
    chat: `${after.roles.chat.target}:${after.roles.chat.model}`,
    vision: `${after.roles.vision.target}:${after.roles.vision.model}`,
    embeddings: `${after.roles.embeddings.target}:${after.roles.embeddings.model}`,
    transcription: `${after.roles.transcription.target}:${after.roles.transcription.model}`,
    embeddingChanged,
  });
  onChange();
  return { config: after, embeddingChanged };
}

/** Emergency fallback: retrieves Gemini keys from database or env. */
function getGeminiKeyChain() {
  const chain = [];
  const seen = new Set();
  for (const slot of SLOTS) {
    const r = get("SELECT value_enc, meta FROM system_settings WHERE key = ?", `gemini.key.${slot}`);
    if (r && r.value_enc) {
      try {
        const decrypted = decrypt(r.value_enc);
        if (decrypted && !isPlaceholder(decrypted) && !seen.has(decrypted)) {
          seen.add(decrypted);
          chain.push({ source: `db:${slot}`, slot, key: decrypted, fp: fingerprint(decrypted) });
        }
      } catch (_) {}
    }
  }
  const envKey = config.geminiApiKey;
  if (envKey && !isPlaceholder(envKey) && !seen.has(envKey)) {
    chain.push({ source: 'env', slot: null, key: envKey, fp: fingerprint(envKey) });
  }
  return chain;
}

// ------------------------------------------------------------------ legacy cleanup
/** Phase 5 pivot: Gemini is no longer used, so any stored Gemini keys are deleted once (audited). */
function purgeLegacyGeminiKeys() {
  const rows = all("SELECT key, meta FROM system_settings WHERE key LIKE 'gemini.%'");
  if (!rows.length) return 0;
  run("DELETE FROM system_settings WHERE key LIKE 'gemini.%'");
  audit('settings.legacy_keys_purged', null, null, { provider: 'gemini', removed: rows.length, slots: rows.map((r) => r.key.split('.').pop()) });
  console.log(`[Settings] Removed ${rows.length} stored Gemini key(s): Gemini is no longer used (Phase 5 open-source AI).`);
  invalidate();
  return rows.length;
}

module.exports = {
  SLOTS,
  getCloudKeyChain,
  hasUsableCloudKey,
  getGeminiKeyChain,
  getKeyForSlot,
  setCloudKeys,
  clearCloudKey,
  getLocalKey,
  setLocalKey,
  clearLocalKey,
  recordKeyHealth,
  describeKeys,
  getAiConfig,
  updateAiConfig,
  embedTagFor,
  purgeLegacyGeminiKeys,
  invalidate,
  fingerprint,
  DEFAULT_THRESHOLD,
  // exported for tests
  _encrypt: encrypt,
  _decrypt: decrypt,
};
