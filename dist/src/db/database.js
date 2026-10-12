const fs = require('fs');
const path = require('path');
const config = require('../config');

let db = null;
let DatabaseSync = null;

const MIGRATIONS = [
  {
    id: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','supervisor')),
  password_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('invited','active','disabled')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  last_login_at TEXT,
  last_logout_at TEXT,
  disabled_at TEXT,
  is_legacy_placeholder INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'invite',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT,
  connection_lost_noted INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT,
  client TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id, ended_at);

CREATE TABLE session_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  event TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX idx_session_events_user ON session_events(user_id, at);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT,
  created_by TEXT
);

CREATE TABLE upload_batches (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id),
  actor_id TEXT REFERENCES users(id),
  declared_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES upload_batches(id),
  owner_id TEXT REFERENCES users(id),
  actor_id TEXT REFERENCES users(id),
  title TEXT NOT NULL,
  original_filename TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('document','image','raw_text','media','url')),
  file_type TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  category_id TEXT REFERENCES categories(id),
  language TEXT NOT NULL DEFAULT 'Arabic',
  vault_path TEXT,
  storage_reference TEXT,
  source_url TEXT,
  upload_status TEXT NOT NULL DEFAULT 'stored',
  ocr_status TEXT NOT NULL DEFAULT 'not_applicable',
  index_status TEXT NOT NULL DEFAULT 'pending',
  pages_kind TEXT NOT NULL DEFAULT 'none',
  pages_total INTEGER,
  pages_processed INTEGER NOT NULL DEFAULT 0,
  pages_failed INTEGER NOT NULL DEFAULT 0,
  pages_estimated INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT,
  failure_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'upload',
  attribution TEXT NOT NULL DEFAULT 'verified',
  legacy_uploader TEXT,
  uploaded_at TEXT,
  processing_started_at TEXT,
  completed_at TEXT,
  lifetime_counted INTEGER NOT NULL DEFAULT 0,
  duplicate_of TEXT
);
CREATE INDEX idx_documents_owner ON documents(owner_id);
CREATE INDEX idx_documents_category ON documents(category_id);
CREATE INDEX idx_documents_batch ON documents(batch_id);
CREATE INDEX idx_documents_sha ON documents(sha256);
CREATE INDEX idx_documents_status ON documents(index_status);

CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  attempt INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE UNIQUE INDEX idx_jobs_active_doc ON processing_jobs(document_id) WHERE status IN ('queued','running');

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  page INTEGER,
  text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_chunks_doc ON chunks(document_id);

CREATE TABLE system_flags (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  actor_role TEXT,
  supervisor_id TEXT,
  supervisor_name TEXT,
  document_id TEXT,
  batch_id TEXT,
  title TEXT,
  filename TEXT,
  kind TEXT,
  file_type TEXT,
  size_bytes INTEGER,
  category_id TEXT,
  category_name TEXT,
  pages_total INTEGER,
  pages_processed INTEGER,
  pages_failed INTEGER,
  upload_status TEXT,
  ocr_status TEXT,
  index_status TEXT,
  outcome TEXT NOT NULL DEFAULT 'success',
  failure_reason TEXT,
  completed_at TEXT,
  counts_lifetime INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  ip TEXT
);
CREATE INDEX idx_audit_at ON audit_events(at);
CREATE INDEX idx_audit_supervisor ON audit_events(supervisor_id, at);
CREATE INDEX idx_audit_action ON audit_events(action);
CREATE INDEX idx_audit_doc ON audit_events(document_id);
CREATE INDEX idx_audit_batch ON audit_events(batch_id);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
WHEN COALESCE((SELECT value FROM system_flags WHERE key = 'audit_purge'), '0') != '1'
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE TRIGGER session_events_no_update BEFORE UPDATE ON session_events
BEGIN SELECT RAISE(ABORT, 'session_events is append-only'); END;

CREATE TRIGGER session_events_no_delete BEFORE DELETE ON session_events
BEGIN SELECT RAISE(ABORT, 'session_events is append-only'); END;
`,
  },
];

function openDb() {
  if (db) return db;
  ({ DatabaseSync } = require('node:sqlite'));
  const dbPath = config.dbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  runMigrations(db);
  return db;
}

function runMigrations(handle) {
  handle.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
  );
  const applied = new Set(handle.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    handle.exec('BEGIN');
    try {
      handle.exec(m.sql);
      handle
        .prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(m.id, m.name, new Date().toISOString());
      handle.exec('COMMIT');
    } catch (err) {
      handle.exec('ROLLBACK');
      throw new Error(`Migration ${m.id} (${m.name}) failed: ${err.message}`);
    }
  }
}

function getDb() {
  return db || openDb();
}

function closeDb() {
  if (db) {
    try {
      db.close();
    } catch (_) {
      /* ignore */
    }
    db = null;
  }
}

/** Runs fn inside an IMMEDIATE transaction. Do not nest. */
function tx(fn) {
  const handle = getDb();
  handle.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(handle);
    handle.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      handle.exec('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw err;
  }
}

function get(sql, ...params) {
  return getDb().prepare(sql).get(...params);
}

function all(sql, ...params) {
  return getDb().prepare(sql).all(...params);
}

function run(sql, ...params) {
  return getDb().prepare(sql).run(...params);
}

module.exports = { getDb, closeDb, tx, get, all, run, MIGRATIONS };
