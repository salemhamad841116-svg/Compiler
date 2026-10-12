const fs = require('fs');
const path = require('path');
const config = require('../config');
const { get, run, tx } = require('./database');
const { newId } = require('../utils/ids');
const { nowIso } = require('../utils/clock');
const storage = require('../services/storageService');
const categories = require('../services/categoryService');
const audit = require('../services/auditService');

const KIND_MAP = { book: 'document', image: 'image', 'raw-text': 'raw_text', media: 'media', url: 'url' };

function readJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.error(`[Legacy] Could not parse ${p}: ${e.message}`);
    return null;
  }
}

function toBlob(arr) {
  const f = new Float32Array(arr);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

/**
 * One-time import of the previous JSON-file stores (vector_store.json, categories.json).
 * Legacy uploader identity and times are carried over but flagged as unverified: legacy records had
 * no authentication, so nothing is attributed to an account and nothing is fabricated.
 */
function importLegacyData() {
  if (get("SELECT value FROM system_flags WHERE key = 'legacy_imported'")) return { skipped: true };

  const result = { categories: 0, documents: 0, chunks: 0, missingFiles: 0 };
  const legacyCats = readJson(config.legacyCategoriesPath);
  const legacyChunks = readJson(config.legacyVectorStorePath);

  tx(() => {
    if (Array.isArray(legacyCats) && legacyCats.length) {
      for (const c of legacyCats) {
        if (!c || !c.name || categories.findByName(c.name)) continue;
        run('INSERT INTO categories (id, name, description, created_at) VALUES (?,?,?,?)', newId('cat'), String(c.name).trim(), c.description || '', c.createdAt || nowIso());
        result.categories++;
      }
    }
    if (Array.isArray(legacyChunks) && legacyChunks.length) {
      const groups = new Map();
      for (const r of legacyChunks) {
        if (!r || !r.chunk || !Array.isArray(r.embedding)) continue;
        const key = [r.bookTitle, r.uploadedBy, r.rawFileUrl || r.storageReference || '', r.createdAt || ''].join('|');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      for (const list of groups.values()) {
        list.sort((a, b) => (a.metadata?.chunkIndex ?? 0) - (b.metadata?.chunkIndex ?? 0));
        const first = list[0];
        const catName = String(first.category || first.metadata?.category || 'Uncategorized').trim();
        let cat = categories.findByName(catName);
        if (!cat) {
          const cid = newId('cat');
          run('INSERT INTO categories (id, name, description, created_at) VALUES (?,?,?,?)', cid, catName, 'Imported from legacy data', nowIso());
          cat = categories.getCategory(cid);
          result.categories++;
        }
        const kind = KIND_MAP[first.uploadType] || 'document';
        const sourceType = first.metadata?.sourceType || (kind === 'raw_text' ? 'txt' : 'pdf');
        const url = first.rawFileUrl || first.metadata?.rawFileUrl || '';
        const fname = url ? decodeURIComponent(url.split('/').pop()) : null;
        const catFolder = url ? decodeURIComponent(url.split('/').slice(-2, -1)[0] || '') : null;
        const vaultPath = fname ? storage.findLegacyFile(fname, catFolder) : null;
        if (fname && !vaultPath) result.missingFiles++;
        const docId = newId('doc');
        const isPdf = sourceType === 'pdf';
        run(
          `INSERT INTO documents (id, owner_id, actor_id, title, original_filename, kind, file_type, size_bytes, category_id, language,
             vault_path, storage_reference, upload_status, ocr_status, index_status, pages_kind, pages_total, pages_processed, pages_failed,
             pages_estimated, chunk_count, char_count, source, attribution, legacy_uploader, uploaded_at, completed_at, lifetime_counted)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          docId, null, null, first.bookTitle || 'Untitled Document', fname, kind, sourceType, first.metadata?.fileSize || null,
          cat.id, first.language || 'Arabic', vaultPath, first.storageReference || null,
          'stored', kind === 'image' || kind === 'media' ? 'completed' : 'not_applicable', 'completed',
          isPdf ? 'pdf' : kind === 'image' ? 'image' : 'estimated',
          isPdf ? first.totalPages || null : null, isPdf ? first.totalPages || 0 : 0, 0,
          !isPdf && kind !== 'image' ? first.totalPages || null : null,
          list.length, first.metadata?.characterCount || 0, 'legacy_import', 'unverified',
          first.uploadedBy || null, first.createdAt || first.metadata?.uploadedAt || null, first.createdAt || null, 0
        );
        list.forEach((r, idx) => {
          run('INSERT INTO chunks (id, document_id, idx, page, text, embedding, created_at) VALUES (?,?,?,?,?,?,?)', newId('chk'), docId, idx, null, r.chunk, toBlob(r.embedding), r.createdAt || nowIso());
          result.chunks++;
        });
        result.documents++;
      }
    }
    run("INSERT OR REPLACE INTO system_flags (key, value) VALUES ('legacy_imported', ?)", nowIso());
  });

  if (result.documents || result.categories) {
    audit.record({ action: 'system.legacy_import', detail: result });
    console.log('[Legacy] Imported previous data:', result);
  }
  return result;
}

module.exports = { importLegacyData };
