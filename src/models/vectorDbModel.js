const fs = require('fs');
const path = require('path');

const DB_FILE_PATH = path.join(__dirname, '../../data/vector_store.json');

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
    console.error('Error reading vector store file:', err);
    return [];
  }
}

function saveRecords(records) {
  ensureStorageExists();
  fs.writeFileSync(DB_FILE_PATH, JSON.stringify(records, null, 2), 'utf-8');
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

  const record = {
    id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    bookTitle: bookTitle || 'Untitled Document',
    category,
    language,
    chunk,
    embedding: embeddingVector,
    uploadedBy: options.uploadedBy || 'supervisor_default@masruq.com',
    uploadType: options.uploadType || 'book', // 'book', 'raw-text', 'media', 'url'
    rawFileUrl: options.rawFileUrl || null,
    storageReference: options.storageReference || null,
    metadata: {
      category,
      language,
      chunkIndex: options.chunkIndex ?? 0,
      totalChunks: options.totalChunks ?? 1,
      sourceType: options.sourceType || 'pdf',
      characterCount: options.characterCount || chunk.length,
      fileSize: options.fileSize || 0,
      uploadedAt: options.uploadedAt || new Date().toISOString(),
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
        totalChunks: 0,
        uploadedBy: item.uploadedBy || 'unknown',
        uploadType: item.uploadType || 'book',
        sourceType: item.metadata?.sourceType || 'pdf',
        rawFileUrl: item.rawFileUrl || item.metadata?.rawFileUrl || null,
        storageReference: item.storageReference || item.metadata?.storageReference || null,
        uploadedAt: item.metadata?.uploadedAt || null,
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
    const type = record.uploadType === 'raw-text' ? 'raw-text' : 'book';

    if (!supervisorMap[sup]) {
      supervisorMap[sup] = {
        supervisorId: sup,
        totalBooksUploaded: 0,
        totalRawTextsPasted: 0,
        totalChunksIndexed: 0,
        documentsMap: {},
      };
    }

    supervisorMap[sup].totalChunksIndexed += 1;

    if (!supervisorMap[sup].documentsMap[title]) {
      supervisorMap[sup].documentsMap[title] = {
        title,
        category: record.category || record.metadata?.category || 'General',
        language: record.language || record.metadata?.language || 'Arabic',
        uploadType: type,
        sourceType: record.metadata?.sourceType || (type === 'raw-text' ? 'raw-text' : 'pdf'),
        rawFileUrl: record.rawFileUrl || record.metadata?.rawFileUrl || null,
        storageReference: record.storageReference || record.metadata?.storageReference || null,
        uploadedAt: record.metadata?.uploadedAt || new Date().toISOString(),
        totalChunks: 0,
      };

      if (type === 'book') {
        supervisorMap[sup].totalBooksUploaded += 1;
      } else {
        supervisorMap[sup].totalRawTextsPasted += 1;
      }
    }

    supervisorMap[sup].documentsMap[title].totalChunks += 1;
  }

  const formattedSupervisors = Object.values(supervisorMap).map((sup) => ({
    supervisorId: sup.supervisorId,
    totalBooksUploaded: sup.totalBooksUploaded,
    totalRawTextsPasted: sup.totalRawTextsPasted,
    totalDocuments: sup.totalBooksUploaded + sup.totalRawTextsPasted,
    totalChunksIndexed: sup.totalChunksIndexed,
    documents: Object.values(sup.documentsMap),
  }));

  if (supervisorId) {
    return (
      formattedSupervisors.find(
        (s) => s.supervisorId.toLowerCase() === supervisorId.toLowerCase()
      ) || {
        supervisorId,
        totalBooksUploaded: 0,
        totalRawTextsPasted: 0,
        totalDocuments: 0,
        totalChunksIndexed: 0,
        documents: [],
      }
    );
  }

  return formattedSupervisors;
}

async function getSystemOverviewStats() {
  const records = loadRecords();
  const booksSummary = await getStoredBooksSummary();
  const supervisors = await getSupervisorAnalytics();

  let totalBooks = 0;
  let totalRawTexts = 0;

  for (const doc of booksSummary) {
    if (doc.uploadType === 'raw-text') {
      totalRawTexts += 1;
    } else {
      totalBooks += 1;
    }
  }

  return {
    totalDocuments: booksSummary.length,
    totalBooks,
    totalRawTexts,
    totalVectorChunks: records.length,
    totalSupervisors: supervisors.length,
    dataVaultStatus: 'Active (Permanent Cloud/Local Storage)',
    vectorDimension: 768,
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-004',
    llmModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    systemStatus: 'Operational',
  };
}

module.exports = {
  insertIntoVectorDatabase,
  searchVectorDatabase,
  getStoredBooksSummary,
  getSupervisorAnalytics,
  getSystemOverviewStats,
  cosineSimilarity,
};
