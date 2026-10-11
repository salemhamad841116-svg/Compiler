const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const DB_FILE_PATH = process.env.VECTOR_DB_PATH || path.join(DATA_DIR, 'vector_store.json');
const BACKUP_FILE_PATH = `${DB_FILE_PATH}.bak`;

function ensureStorageExists() {
  const dir = path.dirname(DB_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE_PATH)) {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify([]), 'utf-8');
  }
}

function loadRecords() {
  ensureStorageExists();
  try {
    const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('Error reading vector store file, checking backup:', err.message);
    if (fs.existsSync(BACKUP_FILE_PATH)) {
      try {
        const backupRaw = fs.readFileSync(BACKUP_FILE_PATH, 'utf-8');
        return JSON.parse(backupRaw || '[]');
      } catch (backupErr) {
        console.error('Error reading backup file:', backupErr.message);
      }
    }
    return [];
  }
}

function saveRecords(records) {
  ensureStorageExists();
  const tempPath = `${DB_FILE_PATH}.${Date.now()}.tmp`;
  try {
    // Write atomically to temporary file first
    fs.writeFileSync(tempPath, JSON.stringify(records, null, 2), 'utf-8');

    // Create backup of previous database file if it exists
    if (fs.existsSync(DB_FILE_PATH)) {
      fs.copyFileSync(DB_FILE_PATH, BACKUP_FILE_PATH);
    }

    // Atomically replace database file
    fs.renameSync(tempPath, DB_FILE_PATH);
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    throw err;
  }
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Inserts a chunk record with category, language, supervisor attribution, and Data Vault references.
 *
 * @param {string} bookTitle - Title of the book or raw note.
 * @param {string} chunk - Text segment content.
 * @param {number[]} embeddingVector - Numerical embedding array.
 * @param {Object} options - Metadata including category, language, and Data Vault URLs.
 * @returns {Promise<Object>} Created document record.
 */
async function insertIntoVectorDatabase(bookTitle, chunk, embeddingVector, options = {}) {
  const records = loadRecords();

  const category = (options.category || 'General').trim();
  const language = (options.language || 'Arabic').trim();
  const totalPages = typeof options.totalPages === 'number' && options.totalPages > 0 ? options.totalPages : 1;
  const createdAt = options.createdAt || options.uploadedAt || new Date().toISOString();

  const record = {
    id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    bookTitle: bookTitle || 'Untitled Document',
    category,
    language,
    chunk,
    embedding: embeddingVector,
    uploadedBy: options.uploadedBy || 'supervisor_default@masruq.com',
    uploadType: options.uploadType || 'book', // 'book', 'raw-text', 'media', 'url'
    totalPages,
    createdAt,
    rawFileUrl: options.rawFileUrl || null,
    storageReference: options.storageReference || null,
    metadata: {
      category,
      language,
      totalPages,
      createdAt,
      chunkIndex: options.chunkIndex ?? 0,
      totalChunks: options.totalChunks ?? 1,
      sourceType: options.sourceType || 'pdf',
      characterCount: options.characterCount || chunk.length,
      fileSize: options.fileSize || 0,
      uploadedAt: createdAt,
      rawFileUrl: options.rawFileUrl || null,
      storageReference: options.storageReference || null,
    },
  };

  records.push(record);
  saveRecords(records);

  return record;
}

/**
 * Searches the vector database with optional category, language, and supervisor metadata filtering.
 *
 * @param {number[]} queryEmbedding - Vector embedding of the search query.
 * @param {number} [topK=5] - Number of top results.
 * @param {number} [minSimilarity=0.5] - Minimum cosine similarity threshold.
 * @param {Object} [filterOptions={}] - Optional metadata filters { category, language, uploadedBy }.
 * @returns {Promise<Array>} Scored matching records.
 */
async function searchVectorDatabase(queryEmbedding, topK = 5, minSimilarity = 0.5, filterOptions = {}) {
  const records = loadRecords();

  if (records.length === 0) {
    return [];
  }

  // Apply optional metadata filters (e.g., category: "Religion", language: "Arabic")
  let filteredRecords = records;

  if (filterOptions.category && filterOptions.category !== 'All') {
    const targetCat = filterOptions.category.trim().toLowerCase();
    filteredRecords = filteredRecords.filter((r) => {
      const cat = (r.category || r.metadata?.category || '').toLowerCase();
      return cat === targetCat;
    });
  }

  if (filterOptions.language && filterOptions.language !== 'All') {
    const targetLang = filterOptions.language.trim().toLowerCase();
    filteredRecords = filteredRecords.filter((r) => {
      const lang = (r.language || r.metadata?.language || '').toLowerCase();
      return lang === targetLang;
    });
  }

  if (filterOptions.uploadedBy) {
    const targetSupervisor = filterOptions.uploadedBy.trim().toLowerCase();
    filteredRecords = filteredRecords.filter((r) => {
      const sup = (r.uploadedBy || '').toLowerCase();
      return sup === targetSupervisor;
    });
  }

  const scoredRecords = filteredRecords
    .map((record) => {
      const similarity = cosineSimilarity(queryEmbedding, record.embedding);
      return {
        id: record.id,
        bookTitle: record.bookTitle,
        category: record.category || record.metadata?.category || 'General',
        language: record.language || record.metadata?.language || 'Arabic',
        chunk: record.chunk,
        similarity,
        uploadedBy: record.uploadedBy,
        uploadType: record.uploadType,
        rawFileUrl: record.rawFileUrl,
        storageReference: record.storageReference,
        metadata: record.metadata,
      };
    })
    .filter((item) => item.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return scoredRecords;
}

async function getStoredBooksSummary() {
  const records = loadRecords();
  const summaryMap = {};

  for (const item of records) {
    const title = item.bookTitle || 'Untitled';
    if (!summaryMap[title]) {
      summaryMap[title] = {
        bookTitle: title,
        category: item.category || item.metadata?.category || 'General',
        language: item.language || item.metadata?.language || 'Arabic',
        totalPages: item.totalPages || item.metadata?.totalPages || 1,
        totalChunks: 0,
        uploadedBy: item.uploadedBy || 'unknown',
        uploadType: item.uploadType || 'book',
        sourceType: item.metadata?.sourceType || 'pdf',
        rawFileUrl: item.rawFileUrl || item.metadata?.rawFileUrl || null,
        storageReference: item.storageReference || item.metadata?.storageReference || null,
        createdAt: item.createdAt || item.metadata?.createdAt || item.metadata?.uploadedAt || null,
        uploadedAt: item.metadata?.uploadedAt || item.createdAt || null,
      };
    }
    summaryMap[title].totalChunks += 1;
  }

  return Object.values(summaryMap);
}

async function getSupervisorAnalytics(supervisorId = null) {
  const records = loadRecords();
  const supervisorMap = {};

  for (const record of records) {
    const sup = record.uploadedBy || 'supervisor_default@masruq.com';
    const title = record.bookTitle || 'Untitled Document';
    const type = record.uploadType || 'book';

    if (!supervisorMap[sup]) {
      supervisorMap[sup] = {
        supervisorId: sup,
        totalBooksUploaded: 0,
        totalRawTextsPasted: 0,
        totalPagesUploaded: 0,
        totalChunksIndexed: 0,
        documentsMap: {},
      };
    }

    supervisorMap[sup].totalChunksIndexed += 1;

    if (!supervisorMap[sup].documentsMap[title]) {
      const docPages = record.totalPages || record.metadata?.totalPages || 1;
      const createdAt = record.createdAt || record.metadata?.createdAt || record.metadata?.uploadedAt || new Date().toISOString();

      supervisorMap[sup].totalPagesUploaded += docPages;

      supervisorMap[sup].documentsMap[title] = {
        title,
        category: record.category || record.metadata?.category || 'General',
        language: record.language || record.metadata?.language || 'Arabic',
        uploadType: type,
        sourceType: record.metadata?.sourceType || (type === 'raw-text' ? 'raw-text' : 'pdf'),
        totalPages: docPages,
        rawFileUrl: record.rawFileUrl || record.metadata?.rawFileUrl || null,
        storageReference: record.storageReference || record.metadata?.storageReference || null,
        createdAt,
        uploadedAt: record.metadata?.uploadedAt || createdAt,
        totalChunks: 0,
      };

      if (type === 'raw-text' || type === 'url') {
        supervisorMap[sup].totalRawTextsPasted += 1;
      } else {
        supervisorMap[sup].totalBooksUploaded += 1;
      }
    }

    supervisorMap[sup].documentsMap[title].totalChunks += 1;
  }

  const formattedSupervisors = Object.values(supervisorMap).map((sup) => ({
    supervisorId: sup.supervisorId,
    supervisorName: sup.supervisorId.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    totalBooksUploaded: sup.totalBooksUploaded,
    totalRawTextsPasted: sup.totalRawTextsPasted,
    totalDocuments: sup.totalBooksUploaded + sup.totalRawTextsPasted,
    totalPagesUploaded: sup.totalPagesUploaded,
    totalChunksIndexed: sup.totalChunksIndexed,
    documents: Object.values(sup.documentsMap),
  }));

  if (supervisorId) {
    return (
      formattedSupervisors.find(
        (s) => s.supervisorId.toLowerCase() === supervisorId.toLowerCase()
      ) || {
        supervisorId,
        supervisorName: supervisorId.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        totalBooksUploaded: 0,
        totalRawTextsPasted: 0,
        totalDocuments: 0,
        totalPagesUploaded: 0,
        totalChunksIndexed: 0,
        documents: [],
      }
    );
  }

  return formattedSupervisors;
}

/**
 * Retrieves comprehensive supervisor audit logs and aggregated metrics down to the minute.
 *
 * @param {string|null} [supervisorId=null] - Optional supervisor email filter.
 * @returns {Promise<{ supervisors: Array, auditLogs: Array, totalLifetimePages: number }>}
 */
async function getSupervisorAuditLogs(supervisorId = null) {
  const supervisors = await getSupervisorAnalytics(supervisorId);
  const supervisorList = Array.isArray(supervisors) ? supervisors : [supervisors];

  const auditLogs = [];
  let totalLifetimePages = 0;

  for (const sup of supervisorList) {
    totalLifetimePages += sup.totalPagesUploaded || 0;

    for (const doc of sup.documents || []) {
      const createdDate = new Date(doc.createdAt || doc.uploadedAt || Date.now());

      // Exact Date & Day in English: e.g. "Monday, Oct 12, 2026"
      const exactDateAndDay = createdDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

      // Exact Time down to the minute/second: e.g. "14:30:45"
      const exactTime = createdDate.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      auditLogs.push({
        id: `audit_${encodeURIComponent(sup.supervisorId)}_${encodeURIComponent(doc.title)}`,
        supervisorId: sup.supervisorId,
        supervisorName: sup.supervisorName || sup.supervisorId.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        bookTitle: doc.title,
        category: doc.category || 'General',
        language: doc.language || 'Arabic',
        uploadType: doc.uploadType || 'book',
        sourceType: doc.sourceType || 'pdf',
        totalPages: doc.totalPages || 1,
        totalChunks: doc.totalChunks || 1,
        rawFileUrl: doc.rawFileUrl || null,
        storageReference: doc.storageReference || null,
        createdAt: doc.createdAt || createdDate.toISOString(),
        exactDateAndDay,
        exactTime,
      });
    }
  }

  // Sort audit logs chronologically descending (newest first)
  auditLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    supervisors: supervisorList.map((s) => ({
      supervisorId: s.supervisorId,
      supervisorName: s.supervisorName,
      totalBooksUploaded: s.totalBooksUploaded,
      totalRawTextsPasted: s.totalRawTextsPasted,
      totalDocuments: s.totalDocuments,
      totalPagesUploaded: s.totalPagesUploaded,
      totalChunksIndexed: s.totalChunksIndexed,
    })),
    auditLogs,
    totalLifetimePages,
  };
}

async function getSystemOverviewStats() {
  const records = loadRecords();
  const booksSummary = await getStoredBooksSummary();
  const supervisors = await getSupervisorAnalytics();

  let totalBooks = 0;
  let totalRawTexts = 0;
  let totalLifetimePages = 0;

  for (const sup of supervisors) {
    totalLifetimePages += sup.totalPagesUploaded || 0;
  }

  for (const doc of booksSummary) {
    if (doc.uploadType === 'raw-text' || doc.uploadType === 'url') {
      totalRawTexts += 1;
    } else {
      totalBooks += 1;
    }
  }

  return {
    totalDocuments: booksSummary.length,
    totalBooks,
    totalRawTexts,
    totalLifetimePages,
    totalVectorChunks: records.length,
    totalSupervisors: supervisors.length,
    dataVaultStatus: 'Active (Permanent Cloud/Local Storage)',
    vectorDimension: 768,
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-004',
    llmModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    systemStatus: 'Operational',
  };
}

/**
 * Deletes all chunks and vector embeddings of a document by title.
 *
 * @param {string} bookTitle - Title of the document to purge.
 * @returns {Promise<{ success: boolean, title: string, deletedChunks: number }>}
 */
async function deleteDocumentByTitle(bookTitle) {
  if (!bookTitle) {
    throw new Error('Document title is required for deletion');
  }
  const records = loadRecords();
  const normalizedTarget = bookTitle.trim().toLowerCase();
  const remainingRecords = records.filter(
    (r) => (r.bookTitle || '').trim().toLowerCase() !== normalizedTarget
  );
  const deletedChunks = records.length - remainingRecords.length;

  if (deletedChunks > 0) {
    saveRecords(remainingRecords);
  }

  return {
    success: true,
    title: bookTitle,
    deletedChunks,
  };
}

/**
 * Updates metadata (title, category, language) across all chunks of a document.
 *
 * @param {string} oldTitle - Current title of the document.
 * @param {Object} newMetadata - { newTitle, category, language }
 * @returns {Promise<{ success: boolean, updatedChunks: number, newTitle: string }>}
 */
async function updateDocumentMetadata(oldTitle, newMetadata = {}) {
  if (!oldTitle) {
    throw new Error('Original document title is required');
  }
  const records = loadRecords();
  const normalizedTarget = oldTitle.trim().toLowerCase();
  const newTitle = (newMetadata.newTitle || oldTitle).trim();
  const category = (newMetadata.category || '').trim();
  const language = (newMetadata.language || '').trim();

  let updatedChunks = 0;
  for (const record of records) {
    if ((record.bookTitle || '').trim().toLowerCase() === normalizedTarget) {
      if (newTitle) record.bookTitle = newTitle;
      if (category) {
        record.category = category;
        if (record.metadata) record.metadata.category = category;
      }
      if (language) {
        record.language = language;
        if (record.metadata) record.metadata.language = language;
      }
      updatedChunks += 1;
    }
  }

  if (updatedChunks > 0) {
    saveRecords(records);
  }

  return {
    success: true,
    updatedChunks,
    newTitle,
    category,
    language,
  };
}

/**
 * Retrieves all individual chunks and text snippets for a given document.
 *
 * @param {string} bookTitle - Title of the document.
 * @returns {Promise<Array>} List of chunk objects.
 */
async function getDocumentChunks(bookTitle) {
  if (!bookTitle) return [];
  const records = loadRecords();
  const normalizedTarget = bookTitle.trim().toLowerCase();
  return records
    .filter((r) => (r.bookTitle || '').trim().toLowerCase() === normalizedTarget)
    .map((r, index) => ({
      id: r.id,
      chunkIndex: r.metadata?.chunkIndex ?? index,
      chunk: r.chunk,
      characterCount: r.chunk?.length || 0,
      createdAt: r.createdAt || r.metadata?.createdAt,
    }));
}

module.exports = {
  insertIntoVectorDatabase,
  searchVectorDatabase,
  getStoredBooksSummary,
  getSupervisorAnalytics,
  getSupervisorAuditLogs,
  getSystemOverviewStats,
  deleteDocumentByTitle,
  updateDocumentMetadata,
  getDocumentChunks,
  cosineSimilarity,
};
