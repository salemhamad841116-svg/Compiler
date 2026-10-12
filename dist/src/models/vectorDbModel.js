const { all } = require('../db/database');

let cache = null;

function invalidateCache() {
  cache = null;
}

function blobToFloats(blob) {
  const copy = new Uint8Array(blob); // copy guarantees 4-byte alignment
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

function loadCache() {
  if (cache) return cache;
  const rows = all(
    `SELECT c.id, c.document_id, c.idx, c.page, c.text, c.embedding,
            d.title, d.language, d.kind, d.owner_id, d.category_id, d.file_type, d.size_bytes, d.uploaded_at,
            cat.name AS category_name, u.email AS owner_email
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     LEFT JOIN categories cat ON cat.id = d.category_id
     LEFT JOIN users u ON u.id = d.owner_id
     WHERE d.index_status = 'completed'`
  );
  cache = rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    chunkIndex: r.idx,
    page: r.page,
    chunk: r.text,
    vec: blobToFloats(r.embedding),
    bookTitle: r.title,
    language: r.language,
    kind: r.kind,
    ownerId: r.owner_id,
    ownerEmail: r.owner_email,
    categoryId: r.category_id,
    category: r.category_name || 'Uncategorized',
    fileType: r.file_type,
    uploadedAt: r.uploaded_at,
  }));
  return cache;
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
 * Filters: category (id or name), language, uploadedBy (owner email).
 */
async function searchVectorDatabase(queryEmbedding, topK = 5, minSimilarity = 0.5, filterOptions = {}) {
  let records = loadCache();
  if (!records.length) return [];

  if (filterOptions.category && filterOptions.category !== 'All') {
    const t = String(filterOptions.category).trim().toLowerCase();
    records = records.filter((r) => r.categoryId === filterOptions.category || r.category.toLowerCase() === t);
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
      bookTitle: r.bookTitle,
      category: r.category,
      language: r.language,
      chunk: r.chunk,
      page: r.page,
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

module.exports = { searchVectorDatabase, getDocumentChunks, cosineSimilarity, invalidateCache };
