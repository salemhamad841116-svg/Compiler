#!/usr/bin/env node
/**
 * i18n audit (no Arabic text in this file by design).
 *  1. Collects every i18n key referenced by the frontends (literal keys + known dynamic families).
 *  2. Verifies that en.json and ar.json both define them, and that both files have identical key sets.
 *  3. Verifies that no Arabic character exists in any source file (only locale JSON may contain Arabic).
 * Exit code 1 on any problem.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const NAMESPACES = ['common', 'auth', 'acct', 'adm', 'sup', 'up', 'docs', 'act', 'stats', 'status', 'kind', 'docstatus', 'attribution', 'source', 'errors', 'presence', 'sess', 'sevent', 'sys', 'cat', 'roles', 'accstatus', 'chat', 'categories', 'set', 'idx', 'e2e', 'live', 'pwa'];

const sourceFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['locales', 'node_modules', '.git'].includes(e.name)) continue;
      walk(p);
    } else if (/\.(js|html|css|ts|dart)$/.test(e.name)) {
      sourceFiles.push(p);
    }
  }
})(PUBLIC);
['src', 'tests', 'scripts'].forEach((d) => {
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html|css|ts|dart)$/.test(e.name)) sourceFiles.push(p);
    }
  })(path.join(ROOT, d));
});
const flutterDir = path.join(ROOT, 'flutter_client');
if (fs.existsSync(flutterDir)) {
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['build', '.dart_tool', 'assets'].includes(e.name)) continue;
        walk(p);
      } else if (/\.(dart|js|ts)$/.test(e.name)) sourceFiles.push(p);
    }
  })(flutterDir);
}

const problems = [];

// ---- 3. zero-Arabic audit
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
for (const f of sourceFiles) {
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (ARABIC.test(line)) problems.push(`ARABIC in source: ${path.relative(ROOT, f)}:${i + 1}`);
  });
}

// ---- 1. key collection
const keys = new Set();
const literal = new RegExp(`['"\`]((?:${NAMESPACES.join('|')})\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)['"\`]`, 'g');
const frontendFiles = sourceFiles.filter((f) => f.startsWith(PUBLIC) && !f.includes(`${path.sep}public${path.sep}locales`));
for (const f of frontendFiles) {
  if (f.endsWith(`${path.sep}js${path.sep}i18n.js`)) continue; // engine only; contains doc-comment examples
  let text = fs.readFileSync(f, 'utf8');
  text = text.replace(/const ACTIONS = \[[\s\S]*?\];/, ''); // audit action names are covered by the act.* family below
  let m;
  while ((m = literal.exec(text))) keys.add(m[1]);
  const attr = /data-i18n(?:-html)?="([^"]+)"/g;
  while ((m = attr.exec(text))) keys.add(m[1]);
  const attrs = /data-i18n-attr="([^"]+)"/g;
  while ((m = attrs.exec(text))) m[1].split(',').forEach((p) => keys.add(p.split(':')[1].trim()));
}

const family = (prefix, list) => list.forEach((x) => keys.add(`${prefix}${x}`));
family('status.', ['queued', 'processing', 'completed', 'failed']);
family('kind.', ['document', 'image', 'raw_text', 'media', 'url']);
family('docstatus.', ['stored', 'uploading', 'failed', 'not_applicable', 'not_started', 'pending', 'processing', 'completed']);
family('attribution.', ['verified', 'assigned_by_admin', 'unverified', 'inferred', 'unknown']);
family('source.', ['upload', 'legacy_import', 'reconciled']);
family('accstatus.', ['invited', 'active', 'disabled']);
family('presence.', ['online', 'away', 'offline']);
family('sess.end_', ['logout', 'expired', 'revoked', 'lost']);
family('sevent.', ['login', 'logout', 'session_expired', 'session_revoked', 'connection_lost', 'connection_restored']);
family('roles.', ['admin', 'supervisor']);
family('sys.mirror_', ['not_configured', 'active', 'unavailable_package_not_installed']);
family('sys.f_', ['orphanVaultFiles', 'documentsMissingFile', 'documentsWithoutOwner', 'documentsWithoutCategory', 'documentsWithoutAuditEvents', 'stuckOrFailedEligibleForRetry', 'failedNotRetryable']);
family('sys.u_', ['orphan_file_unsupported_type', 'file_missing_from_vault', 'processing_failure_content']);
family('up.st.', ['waiting', 'uploading', 'stored', 'processing', 'completed', 'upload_failed', 'index_failed', 'duplicate', 'not_sent']);
family('act.status_', ['success', 'failed', 'completed', 'stored']);
// System Settings (Phase 4 keys, Phase 5 open-source AI routing and search index)
family('set.st_', ['ok', 'invalid', 'rate_limited', 'error', 'undecryptable', 'untested', 'empty']);
family('set.slot_', ['primary', 'fallback1', 'fallback2', 'env']);
family('set.preset_', ['groq', 'together', 'google', 'custom']);
family('set.target_', ['cloud', 'local', 'tesseract', 'disabled']);
['chat', 'vision', 'embeddings', 'transcription'].forEach((r) => { keys.add(`set.role_${r}`); keys.add(`set.role_${r}_hint`); });
family('set.pdf_ocr_', ['auto', 'always', 'never']);
family('set.pull_', ['running', 'done', 'failed']);
family('idx.mode_', ['stale', 'all', 'failed']);
family('e2e.stage_', ['upload', 'processing', 'admin_visibility', 'chat_retrieval', 'chat_answer', 'cleanup']);

const widgets = fs.readFileSync(path.join(PUBLIC, 'js', 'widgets.js'), 'utf8');
const actions = /const ACTIONS = \[([\s\S]*?)\];/.exec(widgets);
if (actions) [...actions[1].matchAll(/'([a-z_.]+)'/g)].forEach((m) => keys.add(`act.${m[1]}`));

// error codes: every code the server can emit + client-side transport codes
const codeSet = new Set(['UNKNOWN', 'NETWORK_ERROR', 'NON_JSON_RESPONSE', 'EMPTY_RESPONSE', 'ABORTED', 'FIELDS_REQUIRED', 'INTERNAL_ERROR', 'REQUEST_ERROR', 'ROUTE_NOT_FOUND']);
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) {
      const text = fs.readFileSync(p, 'utf8');
      for (const m of text.matchAll(/(?:AppError\(\s*\d+\s*,\s*|code:\s*)'([A-Z][A-Z0-9_]{3,})'/g)) codeSet.add(m[1]);
      for (const m of text.matchAll(/(?:^|[^A-Za-z_])'((?:AI|URL|PDF|NO|OCR|TRANSCRIPT|FILE|UPLOAD|STORAGE|UNSUPPORTED|WRONG|EMPTY|INVALID|TEXT)_[A-Z_]+)'/g)) codeSet.add(m[1]);
    }
  }
})(path.join(ROOT, 'src'));
['LIMIT_', 'URL_'].forEach((p) => codeSet.delete(p));
// Environment variable names (e.g. 'OCR_MODEL') match the code-prefix heuristic but are config keys, not error codes.
[...codeSet].filter((c) => /_MODEL$/.test(c)).forEach((c) => codeSet.delete(c));
codeSet.forEach((c) => keys.add(`errors.${c}`));
['CSRF_REJECTED', 'SESSION_EXPIRED', 'SESSION_REVOKED'].forEach((c) => keys.add(`errors.${c}`));

// ---- 2. dictionary parity
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') flatten(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
}
const en = flatten(JSON.parse(fs.readFileSync(path.join(PUBLIC, 'locales', 'en.json'), 'utf8')));
const ar = flatten(JSON.parse(fs.readFileSync(path.join(PUBLIC, 'locales', 'ar.json'), 'utf8')));

for (const k of [...keys].sort()) {
  if (!(k in en)) problems.push(`missing in en.json: ${k}`);
  if (!(k in ar)) problems.push(`missing in ar.json: ${k}`);
}
for (const k of Object.keys(en)) if (!(k in ar)) problems.push(`en-only key (no ar translation): ${k}`);
for (const k of Object.keys(ar)) if (!(k in en)) problems.push(`ar-only key (no en source): ${k}`);
for (const [k, v] of Object.entries(ar)) {
  if (typeof v !== 'string' || !v.trim()) problems.push(`empty ar value: ${k}`);
  else if (!ARABIC.test(v) && !/^[\s\W\d{}A-Za-z_./:%-]*$/.test(v)) problems.push(`ar value has no Arabic: ${k}`);
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  if (k in en && vars(en[k]) !== vars(v)) problems.push(`placeholder mismatch: ${k} (en: ${vars(en[k])} / ar: ${vars(v)})`);
}

console.log(`source files scanned: ${sourceFiles.length}`);
console.log(`i18n keys referenced: ${keys.size} | en keys: ${Object.keys(en).length} | ar keys: ${Object.keys(ar).length}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach((p) => console.error(` - ${p}`));
  process.exit(1);
}
console.log('i18n audit passed: dictionaries complete and in parity; no Arabic characters in source files.');
