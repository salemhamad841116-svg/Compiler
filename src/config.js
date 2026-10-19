const path = require('path');

function int(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

/**
 * Central runtime configuration. Values are read lazily so tests can set env vars before use.
 */
const config = {
  get dataDir() {
    return process.env.DATA_DIR || path.join(__dirname, '../data');
  },
  get dbPath() {
    return process.env.DB_PATH || path.join(this.dataDir, 'app.db');
  },
  get vaultDir() {
    return process.env.DATA_VAULT_PATH || path.join(this.dataDir, 'vault');
  },
  get tempUploadDir() {
    return process.env.TEMP_UPLOAD_DIR || path.join(this.dataDir, 'tmp_uploads');
  },
  get legacyVectorStorePath() {
    return process.env.VECTOR_DB_PATH || path.join(this.dataDir, 'vector_store.json');
  },
  get legacyCategoriesPath() {
    return process.env.CATEGORIES_FILE_PATH || path.join(this.dataDir, 'categories.json');
  },
  // Presence & session policy (seconds unless noted)
  get heartbeatIntervalSec() { return int('HEARTBEAT_INTERVAL_SECONDS', 30); },
  get offlineAfterSec() { return int('PRESENCE_OFFLINE_SECONDS', 120); },
  get awayAfterSec() { return int('PRESENCE_AWAY_SECONDS', 300); },
  get sessionIdleMinutes() { return int('SESSION_IDLE_MINUTES', 120); },
  get sessionAbsoluteHours() { return int('SESSION_ABSOLUTE_HOURS', 24); },
  get invitationHours() { return int('INVITATION_HOURS', 72); },
  get maxFailedLogins() { return int('MAX_FAILED_LOGINS', 5); },
  get lockoutMinutes() { return int('LOCKOUT_MINUTES', 15); },
  get jobConcurrency() { return int('JOB_CONCURRENCY', 2); },
  get embeddingRetries() { return int('EMBEDDING_RETRIES', 2); },
  get auditRetentionDays() { return parseInt(process.env.AUDIT_RETENTION_DAYS, 10) || 0; },
  get maxFileMb() { return int('MAX_FILE_MB', 1024); },
  get maxMediaMb() { return int('MAX_MEDIA_MB', 1024); },
  /** 'mock' (tests only) or the live open-source stack (any other value; 'openai' is the documented one). */
  get aiProvider() {
    const v = (process.env.AI_PROVIDER || 'openai').toLowerCase();
    if (v === 'mock') return 'mock';
    if (v === 'gemini') return 'gemini';
    return 'openai';
  },
  get aiTmpDir() { return path.join(this.tempUploadDir, 'ai-work'); },
  get cookieName() { return 'sid'; },
  get displayTimeZone() { return 'Asia/Dubai'; },
  get isProduction() { return process.env.NODE_ENV === 'production'; },
  /**
   * Cloud AI provider key from the environment (last fallback after the System Settings keys).
   * LLM_API_KEY, with GROQ_API_KEY / TOGETHER_API_KEY accepted as aliases. Surrounding quotes,
   * whitespace and Windows CR are removed (common when pasted into an env_file).
   */
  get cloudApiKey() {
    const raw = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || process.env.TOGETHER_API_KEY || '';
    return String(raw).replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '').trim();
  },
  get cloudKeyUsable() {
    const k = this.cloudApiKey;
    return Boolean(k) && !/your_|_here|placeholder|changeme/i.test(k);
  },
  /** Optional key for the local endpoint (Ollama needs none; vLLM can be started with --api-key). */
  get localApiKey() {
    return String(process.env.LOCAL_AI_API_KEY || '').replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '').trim();
  },
  get geminiApiKey() {
    const raw = process.env.GEMINI_API_KEY || '';
    return String(raw).replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '').trim();
  },
  get geminiKeyUsable() {
    const k = this.geminiApiKey;
    return Boolean(k) && !/your_|_here|placeholder|changeme/i.test(k);
  },
};

module.exports = config;
