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
  get maxFileMb() { return int('MAX_FILE_MB', 50); },
  get maxMediaMb() { return int('MAX_MEDIA_MB', 100); },
  get aiProvider() { return (process.env.AI_PROVIDER || 'gemini').toLowerCase(); },
  get cookieName() { return 'sid'; },
  get displayTimeZone() { return 'Asia/Dubai'; },
  get isProduction() { return process.env.NODE_ENV === 'production'; },
  /**
   * GEMINI_API_KEY with surrounding quotes / whitespace / Windows CR removed
   * (common when the key is pasted into an env_file as KEY="..." or with CRLF line endings).
   */
  get geminiApiKey() {
    return String(process.env.GEMINI_API_KEY || '').replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '').trim();
  },
  get geminiKeyUsable() {
    const k = this.geminiApiKey;
    return Boolean(k) && !/your_|_here|placeholder|changeme/i.test(k);
  },
};

module.exports = config;
