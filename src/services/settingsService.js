// ==============================================================================
// Runtime system settings (Phase 4). Gemini API keys are stored encrypted
// (AES-256-GCM) in the system_settings table and can be rotated from the admin
// UI without restarting the container. Plain keys are NEVER returned by any API.
//
// Key resolution order used by geminiClient:
//   DB primary -> DB fallback1 -> DB fallback2 -> GEMINI_API_KEY from the environment.
// ==============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { get, all, run } = require('../db/database');
const { nowIso } = require('../utils/clock');
const { AppError } = require('../utils/errors');

const SLOTS = ['primary', 'fallback1', 'fallback2'];
const slotKey = (slot) => `gemini.key.${slot}`;
const CACHE_TTL_MS = 30000;

let masterKeyBuf = null;
let cache = null; // { at, rows: Map<slot, {key, meta, updatedAt, updatedBy}> }
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

function load() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const rows = new Map();
  for (const r of all("SELECT key, value_enc, meta, updated_at, updated_by FROM system_settings WHERE key LIKE 'gemini.key.%'")) {
    const slot = r.key.slice('gemini.key.'.length);
    if (!SLOTS.includes(slot)) continue;
    const meta = parseMeta(r.meta);
    let key = null;
    if (r.value_enc) {
      try {
        key = decrypt(r.value_enc);
      } catch (e) {
        console.error(`[Settings] Could not decrypt API key slot "${slot}" (encryption key changed?): ${e.message}`);
        meta.status = 'undecryptable';
      }
    }
    rows.set(slot, { key, meta, updatedAt: r.updated_at, updatedBy: r.updated_by });
  }
  cache = { at: Date.now(), rows };
  return rows;
}

function invalidate() {
  cache = null;
}

function onChange() {
  invalidate();
  try { require('./eventBus').publish('settings.changed', { scope: 'ai' }); } catch (_) { /* optional */ }
}

// ------------------------------------------------------------------ public API
/**
 * Ordered, de-duplicated list of usable keys.
 * @returns {Array<{source: string, slot: string|null, key: string, fp: string}>}
 */
function getGeminiKeyChain() {
  const rows = load();
  const chain = [];
  const seen = new Set();
  for (const slot of SLOTS) {
    const r = rows.get(slot);
    if (r && r.key && !isPlaceholder(r.key) && !seen.has(r.key)) {
      seen.add(r.key);
      chain.push({ source: `db:${slot}`, slot, key: r.key, fp: fingerprint(r.key) });
    }
  }
  const envKey = config.geminiApiKey;
  if (envKey && !isPlaceholder(envKey) && !seen.has(envKey)) {
    chain.push({ source: 'env', slot: null, key: envKey, fp: fingerprint(envKey) });
  }
  return chain;
}

function hasUsableGeminiKey() {
  try {
    return getGeminiKeyChain().length > 0;
  } catch (e) {
    console.error('[Settings] key lookup failed:', e.message);
    return config.geminiKeyUsable;
  }
}

/** Key for one slot ('primary'|'fallback1'|'fallback2'|'env'), used by the per-slot test button. */
function getKeyForSlot(slot) {
  if (slot === 'env') return config.geminiKeyUsable ? config.geminiApiKey : null;
  const r = load().get(slot);
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

/**
 * Saves any provided slots. Empty / missing values leave the stored key untouched.
 * @param {{primary?: string, fallback1?: string, fallback2?: string}} input
 */
function setGeminiKeys(input, actor, { ip } = {}) {
  const changes = [];
  for (const slot of SLOTS) {
    const val = sanitizeKey(input && input[slot]);
    if (!val) continue;
    validateKey(val);
    changes.push({ slot, val });
  }
  if (!changes.length) throw new AppError(400, 'NO_KEYS_PROVIDED', 'Enter at least one API key to save.');
  const at = nowIso();
  for (const { slot, val } of changes) {
    const meta = { last4: val.slice(-4), status: 'untested', lastCheckedAt: null, lastErrorCode: null };
    run(
      `INSERT INTO system_settings (key, value_enc, is_secret, meta, updated_at, updated_by) VALUES (?,?,1,?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, meta = excluded.meta, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      slotKey(slot), encrypt(val), JSON.stringify(meta), at, actor && actor.id ? actor.id : null
    );
    require('./auditService').record({ action: 'settings.api_key_updated', actor, ip, detail: { slot, last4: meta.last4 } });
  }
  onChange();
  return describeKeys();
}

function clearGeminiKey(slot, actor, { ip } = {}) {
  assertSlot(slot);
  const existing = get('SELECT meta FROM system_settings WHERE key = ?', slotKey(slot));
  run('DELETE FROM system_settings WHERE key = ?', slotKey(slot));
  if (existing) {
    require('./auditService').record({ action: 'settings.api_key_cleared', actor, ip, detail: { slot, last4: parseMeta(existing.meta).last4 || null } });
  }
  onChange();
  return describeKeys();
}

/** Stores the last observed health of a key (never the key itself). */
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
  const rows = load();
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
  const envKey = config.geminiApiKey;
  return {
    slots,
    env: {
      configured: config.geminiKeyUsable,
      placeholder: Boolean(envKey) && !config.geminiKeyUsable,
      last4: config.geminiKeyUsable ? envKey.slice(-4) : null,
      ...envHealth,
    },
    effectiveOrder: getGeminiKeyChain().map((k) => k.source),
  };
}

module.exports = {
  SLOTS,
  getGeminiKeyChain,
  hasUsableGeminiKey,
  getKeyForSlot,
  setGeminiKeys,
  clearGeminiKey,
  recordKeyHealth,
  describeKeys,
  invalidate,
  fingerprint,
  // exported for tests
  _encrypt: encrypt,
  _decrypt: decrypt,
};
