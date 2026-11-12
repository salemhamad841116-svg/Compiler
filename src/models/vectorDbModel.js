const { all, get } = require('../db/database');

let cache = null; // { tag, records }

function invalidateCache() {
  cache = null;
}

function blobToFloats(blob) {
  const copy = new Uint8Array(blob); // copy guarantees 4-byte alignment
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

/** Identity of the active embedding model; chunks from other models are not comparable. */
function activeTag() {
  return require('../services/aiProvider').provider().embedTag();
}

/** Chunk counts for the active model vs. other (stale) models, for completed documents. */
function indexCoverage(tag = activeTag()) {
  const r = get(
    `SELECT SUM(CASE WHEN c.embed_model = ? THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN c.embed_model IS NOT ? THEN 1 ELSE 0 END) AS stale
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE d.index_status = 'completed' AND COALESCE(d.is_current, 1) = 1`,
    tag, tag
  );
  return { tag, active: (r && r.active) || 0, stale: (r && r.stale) || 0 };
}

function loadCache() {
  const tag = activeTag();
  if (cache && cache.tag === tag) return cache.records;
  const rows = all(
    `SELECT c.id, c.document_id, c.idx, c.page, c.text, c.embedding, c.version_number, c.verified_at,
            d.title, d.language, d.kind, d.owner_id, d.category_id, d.file_type, d.size_bytes, d.uploaded_at,
            d.is_current, d.version_number AS doc_version_number,
            d.dialect_code, d.speaker_tone, d.pronunciation_notes,
            cat.name AS category_name, cat.name_key AS category_name_key, cat.parent_id AS category_parent_id,
            u.email AS owner_email
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     LEFT JOIN categories cat ON cat.id = d.category_id
     LEFT JOIN users u ON u.id = d.owner_id
     WHERE d.index_status = 'completed'
       AND c.embed_model = ?
       AND COALESCE(d.is_current, 1) = 1
       AND (c.version_number IS NULL OR d.version_number IS NULL OR c.version_number = d.version_number)`,
    tag
  );
  const records = rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    chunkIndex: r.idx,
    page: r.page,
    chunk: r.text,
    vec: blobToFloats(r.embedding),
    versionNumber: r.version_number || r.doc_version_number || 1,
    isCurrent: r.is_current !== 0,
    verifiedAt: r.verified_at || r.uploaded_at,
    bookTitle: r.title,
    language: r.language,
    kind: r.kind,
    ownerId: r.owner_id,
    ownerEmail: r.owner_email,
    categoryId: r.category_id,
    categoryNameKey: r.category_name_key,
    categoryParentId: r.category_parent_id,
    category: r.category_name || 'Uncategorized',
    dialectCode: r.dialect_code || null,
    speakerTone: r.speaker_tone || null,
    pronunciationNotes: r.pronunciation_notes || null,
    fileType: r.file_type,
    uploadedAt: r.uploaded_at,
  }));
  cache = { tag, records };
  return records;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Searches indexed chunks. Only documents whose indexing COMPLETED are searchable.
 * Filters: category (id or name), allowedCategoryIds, forbiddenCategoryIds, language, uploadedBy.
 */
async function searchVectorDatabase(queryEmbedding, topK = 5, minSimilarity = 0.5, filterOptions = {}) {
  let records = loadCache();
  if (!records.length) return [];

  // 0. Active/Current version isolation: only active versions by default
  if (!filterOptions.includeArchived) {
    records = records.filter((r) => r.isCurrent !== false);
  }

  // 1. Single category filter
  if (filterOptions.category && filterOptions.category !== 'All') {
    const t = String(filterOptions.category).trim().toLowerCase();
    records = records.filter(
      (r) =>
        r.categoryId === filterOptions.category ||
        (r.categoryNameKey && r.categoryNameKey.toLowerCase() === t) ||
        r.category.toLowerCase() === t
    );
  }

  // 2. Multi-space allowed categories filter (Zero-leakage enforcement)
  if (Array.isArray(filterOptions.allowedCategoryIds) && !filterOptions.allowedCategoryIds.includes('*')) {
    const allowed = new Set(filterOptions.allowedCategoryIds.map((x) => String(x).toLowerCase()));
    records = records.filter(
      (r) =>
        allowed.has(String(r.categoryId).toLowerCase()) ||
        (r.categoryNameKey && allowed.has(String(r.categoryNameKey).toLowerCase())) ||
        (r.categoryParentId && allowed.has(String(r.categoryParentId).toLowerCase())) ||
        allowed.has(String(r.category).toLowerCase())
    );
  }

  // 3. Multi-space forbidden categories filter (Strict exclusion)
  if (Array.isArray(filterOptions.forbiddenCategoryIds) && filterOptions.forbiddenCategoryIds.length > 0) {
    const forbidden = new Set(filterOptions.forbiddenCategoryIds.map((x) => String(x).toLowerCase()));
    records = records.filter(
      (r) =>
        !forbidden.has(String(r.categoryId).toLowerCase()) &&
        (!r.categoryNameKey || !forbidden.has(String(r.categoryNameKey).toLowerCase())) &&
        (!r.categoryParentId || !forbidden.has(String(r.categoryParentId).toLowerCase())) &&
        !forbidden.has(String(r.category).toLowerCase())
    );
  }

  if (filterOptions.language && filterOptions.language !== 'All') {
    const t = String(filterOptions.language).trim().toLowerCase();
    records = records.filter((r) => (r.language || '').toLowerCase() === t);
  }
  if (filterOptions.uploadedBy) {
    const t = String(filterOptions.uploadedBy).trim().toLowerCase();
    records = records.filter((r) => (r.ownerEmail || '').toLowerCase() === t);
  }

  return records
    .map((r) => ({
      id: r.id,
      documentId: r.documentId,
      sourceId: r.documentId,
      bookTitle: r.bookTitle,
      category: r.category,
      categoryId: r.categoryId,
      categoryKey: r.categoryNameKey,
      dialectCode: r.dialectCode,
      speakerTone: r.speakerTone,
      pronunciationNotes: r.pronunciationNotes,
      language: r.language,
      chunk: r.chunk,
      page: r.page,
      pageNumber: r.page,
      versionNumber: r.versionNumber || 1,
      verifiedAt: r.verifiedAt || r.uploadedAt,
      similarity: cosineSimilarity(queryEmbedding, r.vec),
      uploadedBy: r.ownerEmail,
      uploadType: r.kind,
    }))
    .filter((r) => r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

function getDocumentChunks(documentId) {
  return all('SELECT id, idx, page, text, created_at FROM chunks WHERE document_id = ? ORDER BY idx', documentId).map((c) => ({
    id: c.id,
    chunkIndex: c.idx,
    page: c.page,
    chunk: c.text,
    characterCount: c.text.length,
    createdAt: c.created_at,
  }));
}

module.exports = { searchVectorDatabase, getDocumentChunks, cosineSimilarity, invalidateCache, indexCoverage, activeTag };
