const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-gate-isolation-'));
process.env.DATA_DIR = dataDir;
process.env.AI_PROVIDER = 'mock';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin_iso@example.test';
process.env.ADMIN_INITIAL_PASSWORD = 'AdminPass123';
process.env.ADMIN_NAME = 'Isolation Admin';
delete process.env.SETTINGS_ENCRYPTION_KEY;

const server = require('../src/server');
const serviceKeyService = require('../src/services/serviceKeyService');
const categoryService = require('../src/services/categoryService');
const vectorDbModel = require('../src/models/vectorDbModel');
const { getDb } = require('../src/db/database');
const { nowIso } = require('../src/utils/clock');

let baseUrl;
let httpServer;

function makeServiceClient(token) {
  const api = async (method, endpoint, body) => {
    const headers = {
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${token}`,
    };
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${baseUrl}${endpoint}`, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {}
    return { status: res.status, json, text };
  };
  return {
    get: (u) => api('GET', u),
    post: (u, b) => api('POST', u, b),
    put: (u, b) => api('PUT', u, b),
    del: (u) => api('DELETE', u),
  };
}

const { provider, mockEmbedding } = require('../src/services/aiProvider');

function insertMockDocumentAndChunk(db, { id, title, categoryId, text, ownerId }) {
  const now = nowIso();
  const activeEmbedTag = provider().embedTag();
  db.prepare(`
    INSERT INTO documents (
      id, title, original_filename, kind, file_type, size_bytes,
      vault_path, category_id, upload_status, ocr_status, index_status,
      uploaded_at, version_number, is_current, owner_id
    ) VALUES (?, ?, ?, 'document', 'txt', 100, 'mock_vault', ?, 'stored', 'not_applicable', 'completed', ?, 1, 1, ?)
  `).run(id, title, `${id}.txt`, categoryId, now, ownerId);

  const vec = mockEmbedding(text);
  const mockEmbeddingBuffer = Buffer.from(new Float32Array(vec).buffer);
  db.prepare(`
    INSERT INTO chunks (
      id, document_id, idx, page, text, embedding, embed_model, created_at, version_number, verified_at
    ) VALUES (?, ?, 0, 1, ?, ?, ?, ?, 1, ?)
  `).run(`chk_${id}`, id, text, mockEmbeddingBuffer, activeEmbedTag, now, now);
}

test('Quality Gate 1: Isolation and Space Permissions (0% Data Leakage)', async (t) => {
  const app = server.createApp();
  await new Promise((resolve) => {
    httpServer = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
      resolve();
    });
  });

  const db = getDb();
  categoryService.seedIfNeeded();

  const catCamel = categoryService.resolveCategory('cat.camel_heritage');
  const catEng = categoryService.resolveCategory('cat.programming_engineering');
  const catPrivate = categoryService.resolveCategory('cat.private_personal');

  // Create admin user for foreign key satisfaction
  const adminId = 'usr_iso_admin_1';
  db.prepare(`
    INSERT OR IGNORE INTO users (id, role, name, email, password_hash, status, created_at, app_source)
    VALUES (?, 'admin', 'Isolation Admin', 'admin_iso@example.test', 'hash', 'active', datetime('now'), 'chathsm')
  `).run(adminId);

  // Create isolated documents across the 4 spaces
  insertMockDocumentAndChunk(db, {
    id: 'doc_camel_01',
    title: 'Camel Breeding and Heritage Guide',
    categoryId: catCamel.id,
    text: 'Camel heritage, pure breeds, and desert races techniques.',
    ownerId: adminId,
  });

  insertMockDocumentAndChunk(db, {
    id: 'doc_eng_01',
    title: 'Software Engineering and Clean Architecture',
    categoryId: catEng.id,
    text: 'Software architecture patterns, microservices, and distributed pipelines.',
    ownerId: adminId,
  });

  insertMockDocumentAndChunk(db, {
    id: 'doc_private_01',
    title: 'Master Private Personal Vault',
    categoryId: catPrivate.id,
    text: 'Strictly confidential personal assets, credentials, and master notes.',
    ownerId: adminId,
  });

  vectorDbModel.invalidateCache();

  // Create Service Keys
  const camelKey = serviceKeyService.createServiceKey({
    name: 'Camel Market Consumer Key',
    appSlug: 'camel-market',
    scope: 'sync',
    allowedCategoryIds: ['cat.camel_heritage', 'cat.camel_breeds', 'cat.camel_races', 'cat.camel_terms', catCamel.id],
    forbiddenCategoryIds: ['cat.programming_engineering', 'cat.private_personal', catEng.id, catPrivate.id],
    createdBy: adminId,
  });

  const engineerKey = serviceKeyService.createServiceKey({
    name: 'Engineer Programming Agent Key',
    appSlug: 'engineer-app',
    scope: 'sync',
    allowedCategoryIds: ['cat.programming_engineering', catEng.id],
    forbiddenCategoryIds: ['cat.camel_heritage', 'cat.private_personal', catCamel.id, catPrivate.id],
    createdBy: adminId,
  });

  const masterKey = serviceKeyService.createServiceKey({
    name: 'Master Owner Private Key',
    appSlug: 'master-owner',
    scope: 'admin',
    allowedCategoryIds: ['*'],
    forbiddenCategoryIds: [],
    createdBy: adminId,
  });

  const camelClient = makeServiceClient(camelKey.rawToken);
  const engineerClient = makeServiceClient(engineerKey.rawToken);
  const masterClient = makeServiceClient(masterKey.rawToken);

  await t.test('1. Camel key can read camel books but is strictly blocked from programming and private vault', async () => {
    // Authorized query
    const resCamelOk = await camelClient.post('/api/service/books/query', {
      query: 'Camel heritage',
      categoryId: 'cat.camel_heritage',
    });
    assert.equal(resCamelOk.status, 200);
    assert.ok(resCamelOk.json.sources.length > 0);
    assert.equal(resCamelOk.json.sources[0].categoryId, catCamel.id);

    // Attempt to access programming category
    const resForbiddenProg = await camelClient.post('/api/service/books/query', {
      query: 'Software architecture',
      categoryId: 'cat.programming_engineering',
    });
    assert.equal(resForbiddenProg.status, 403);
    assert.equal(resForbiddenProg.json.code, 'CATEGORY_ACCESS_FORBIDDEN');

    // Attempt to access private personal vault
    const resForbiddenPrivate = await camelClient.post('/api/service/books/query', {
      query: 'Secret assets',
      categoryId: 'cat.private_personal',
    });
    assert.equal(resForbiddenPrivate.status, 403);
    assert.equal(resForbiddenPrivate.json.code, 'CATEGORY_ACCESS_FORBIDDEN');

    // Scoped listing only returns camel books
    const listCamel = await camelClient.get('/api/service/books');
    assert.equal(listCamel.status, 200);
    assert.ok(listCamel.json.documents.every((d) => d.categoryId === catCamel.id));
    assert.ok(!listCamel.json.documents.some((d) => d.categoryId === catEng.id));
    assert.ok(!listCamel.json.documents.some((d) => d.categoryId === catPrivate.id));
  });

  await t.test('2. Engineer key can read programming books but is blocked from camel and private vault', async () => {
    const resEngOk = await engineerClient.post('/api/service/books/query', {
      query: 'Architecture patterns',
      categoryId: 'cat.programming_engineering',
    });
    assert.equal(resEngOk.status, 200);
    assert.ok(resEngOk.json.sources.length > 0);
    assert.equal(resEngOk.json.sources[0].categoryId, catEng.id);

    const resForbiddenCamel = await engineerClient.post('/api/service/books/query', {
      query: 'Camel races',
      categoryId: 'cat.camel_heritage',
    });
    assert.equal(resForbiddenCamel.status, 403);

    const resForbiddenPrivate = await engineerClient.post('/api/service/books/query', {
      query: 'Private notes',
      categoryId: 'cat.private_personal',
    });
    assert.equal(resForbiddenPrivate.status, 403);
  });

  await t.test('3. Master Owner key has full access including private personal vault', async () => {
    const resMasterPrivate = await masterClient.post('/api/service/books/query', {
      query: 'Confidential notes',
      categoryId: 'cat.private_personal',
    });
    assert.equal(resMasterPrivate.status, 200);
    assert.ok(resMasterPrivate.json.sources.length > 0);
    assert.equal(resMasterPrivate.json.sources[0].categoryId, catPrivate.id);

    const resMasterCamel = await masterClient.post('/api/service/books/query', {
      query: 'Desert heritage',
      categoryId: 'cat.camel_heritage',
    });
    assert.equal(resMasterCamel.status, 200);
  });

  await t.test('4. Public chat endpoint enforces privacy wall and hides secret personal vault', async () => {
    const resPublic = await fetch(`${baseUrl}/api/chat/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ question: 'Personal secret notes', category: 'cat.private_personal' }),
    });
    const json = await resPublic.json();
    assert.equal(resPublic.status, 200);
    assert.ok(!json.sources || !json.sources.some((s) => s.categoryId === catPrivate.id));
  });

  await t.test('5. Read vs write scope separation (read keys strictly rejected from ingest, update, delete)', async () => {
    const readOnlyKey = serviceKeyService.createServiceKey({
      name: 'Read Only Chat Key',
      appSlug: 'chat-read-only',
      scope: 'read',
      allowedCategoryIds: ['cat.camel_heritage', catCamel.id],
      createdBy: adminId,
    });
    const readClient = makeServiceClient(readOnlyKey.rawToken);

    // Read query is permitted
    const queryRes = await readClient.post('/api/service/books/query', {
      query: 'Camel heritage',
      categoryId: 'cat.camel_heritage',
    });
    assert.equal(queryRes.status, 200);

    // Ingest is forbidden
    const ingestRes = await readClient.post('/api/service/books/ingest', {
      title: 'Attempted Write Book',
      text: 'Sample text payload',
      category: 'cat.camel_heritage',
    });
    assert.equal(ingestRes.status, 403);
    assert.equal(ingestRes.json.code, 'INSUFFICIENT_SCOPE');

    // Update is forbidden
    const updateRes = await readClient.put('/api/service/books/doc_camel_01', {
      title: 'Attempted Update Title',
    });
    assert.equal(updateRes.status, 403);
    assert.equal(updateRes.json.code, 'INSUFFICIENT_SCOPE');

    // Delete is forbidden
    const deleteRes = await readClient.del('/api/service/books/doc_camel_01');
    assert.equal(deleteRes.status, 403);
    assert.equal(deleteRes.json.code, 'INSUFFICIENT_SCOPE');
  });

  await t.test('6. Category seeds expansion: public audience, translation glossary, and voice dialects with parent-child linkage', async () => {
    categoryService.seedIfNeeded();
    const publicAudience = categoryService.resolveCategory('cat.public_audience');
    const translationGlossary = categoryService.resolveCategory('cat.translation_glossary');
    const voiceDialects = categoryService.resolveCategory('cat.voice_dialects');
    const dialectEmirati = categoryService.resolveCategory('cat.dialect_emirati');
    const dialectOmani = categoryService.resolveCategory('cat.dialect_omani');
    const dialectCamelCommentary = categoryService.resolveCategory('cat.dialect_camel_commentary');
    const dialectAuctioneer = categoryService.resolveCategory('cat.dialect_auctioneer');

    assert.ok(publicAudience, 'Public Audience category should exist');
    assert.ok(translationGlossary, 'Translation Glossary category should exist');
    assert.ok(voiceDialects, 'Voice & Dialects Data main category should exist');
    assert.ok(dialectEmirati, 'Emirati Dialect category should exist');
    assert.ok(dialectOmani, 'Omani Dialect category should exist');
    assert.ok(dialectCamelCommentary, 'Camel Commentary category should exist');
    assert.ok(dialectAuctioneer, 'Auctioneer Dialect category should exist');

    assert.equal(dialectEmirati.parent_id, voiceDialects.id, 'Emirati dialect parent must be voice_dialects');
    assert.equal(dialectOmani.parent_id, voiceDialects.id, 'Omani dialect parent must be voice_dialects');
    assert.equal(dialectCamelCommentary.parent_id, voiceDialects.id, 'Camel commentary parent must be voice_dialects');
    assert.equal(dialectAuctioneer.parent_id, voiceDialects.id, 'Auctioneer parent must be voice_dialects');
  });

  await t.test('7. Audio Ingestion & Whisper Transcription Pipeline with acoustic training metadata', async () => {
    const emiratiKey = serviceKeyService.createServiceKey({
      name: 'Emirati Dialect Ingestion Key',
      appSlug: 'emirati-dialect-service',
      scope: 'write',
      allowedCategoryIds: ['cat.dialect_emirati'],
      createdBy: adminId,
    });

    // Create a 1-second silent WAV buffer
    const samples = 16000;
    const wavBuffer = Buffer.alloc(44 + samples * 2);
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + samples * 2, 4);
    wavBuffer.write('WAVE', 8);
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16);
    wavBuffer.writeUInt16LE(1, 20);
    wavBuffer.writeUInt16LE(1, 22);
    wavBuffer.writeUInt32LE(16000, 24);
    wavBuffer.writeUInt32LE(32000, 28);
    wavBuffer.writeUInt16LE(2, 32);
    wavBuffer.writeUInt16LE(16, 34);
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(samples * 2, 40);

    const formData = new FormData();
    const fileBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', fileBlob, 'al_dhafra_race_chant.wav');
    formData.append('category', 'cat.dialect_emirati');
    formData.append('title', 'Al Dhafra Race Heritage Chant');
    formData.append('transcriptText', 'Al Dhafra Camel Festival and heritage race chant in the local Emirati dialect');
    formData.append('dialectCode', 'ar-AE');
    formData.append('speakerTone', 'energetic_heritage');
    formData.append('pronunciationNotes', 'Northern emirates intonation and camel racing terms');

    const ingestRes = await fetch(`${baseUrl}/api/service/books/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${emiratiKey.rawToken}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formData,
    });
    const ingestJson = await ingestRes.json();
    assert.equal(ingestRes.status, 201);
    assert.equal(ingestJson.success, true);
    assert.equal(ingestJson.document.kind, 'media');
    assert.equal(ingestJson.document.fileType, 'wav');
    assert.equal(ingestJson.document.dialectCode, 'ar-AE');
    assert.equal(ingestJson.document.speakerTone, 'energetic_heritage');
    assert.equal(ingestJson.document.pronunciationNotes, 'Northern emirates intonation and camel racing terms');
    assert.ok(ingestJson.document.vaultPath, 'Vault path must be recorded');
    assert.ok(ingestJson.document.transcriptText, 'Transcription text must be populated');

    // Verify row in database
    const dbDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(ingestJson.documentId);
    assert.ok(dbDoc);
    assert.equal(dbDoc.dialect_code, 'ar-AE');
    assert.equal(dbDoc.speaker_tone, 'energetic_heritage');
    assert.equal(dbDoc.kind, 'media');
    assert.equal(dbDoc.version_number, 1);
    assert.equal(dbDoc.is_current, 1);
  });

  await t.test('8. Strict isolation across dialect sub-branches using independent Service API keys', async () => {
    const emiratiKey = serviceKeyService.createServiceKey({
      name: 'Emirati Agent Key',
      appSlug: 'emirati-agent',
      scope: 'read',
      allowedCategoryIds: ['cat.dialect_emirati'],
      createdBy: adminId,
    });

    const omaniKey = serviceKeyService.createServiceKey({
      name: 'Omani Agent Key',
      appSlug: 'omani-agent',
      scope: 'write',
      allowedCategoryIds: ['cat.dialect_omani'],
      createdBy: adminId,
    });

    const emiratiClient = makeServiceClient(emiratiKey.rawToken);
    const omaniClient = makeServiceClient(omaniKey.rawToken);

    // Emirati key queries emirati dialect -> 200 OK with dialectCode returned in sources
    const resEmiratiQuery = await emiratiClient.post('/api/service/books/query', {
      query: 'Al Dhafra Camel Festival',
      categoryId: 'cat.dialect_emirati',
      minSimilarity: 0.1,
    });
    assert.equal(resEmiratiQuery.status, 200);
    assert.ok(resEmiratiQuery.json.sources.length > 0);
    assert.equal(resEmiratiQuery.json.sources[0].dialectCode, 'ar-AE');
    assert.equal(resEmiratiQuery.json.sources[0].speakerTone, 'energetic_heritage');

    // Emirati key tries to query omani dialect -> 403 Forbidden
    const resForbiddenOmani = await emiratiClient.post('/api/service/books/query', {
      query: 'Omani speech',
      categoryId: 'cat.dialect_omani',
    });
    assert.equal(resForbiddenOmani.status, 403);
    assert.equal(resForbiddenOmani.json.code, 'CATEGORY_ACCESS_FORBIDDEN');

    // Emirati key tries to query programming -> 403 Forbidden
    const resForbiddenProg = await emiratiClient.post('/api/service/books/query', {
      query: 'Software architecture',
      categoryId: 'cat.programming_engineering',
    });
    assert.equal(resForbiddenProg.status, 403);

    // Emirati key tries to query private vault -> 403 Forbidden
    const resForbiddenVault = await emiratiClient.post('/api/service/books/query', {
      query: 'Private credentials',
      categoryId: 'cat.private_personal',
    });
    assert.equal(resForbiddenVault.status, 403);

    // Omani key tries to write into emirati dialect -> 403 Forbidden
    const resForbiddenCrossWrite = await omaniClient.post('/api/service/books/ingest', {
      title: 'Attempted Cross Dialect Ingest',
      rawText: 'Text intended for wrong dialect',
      category: 'cat.dialect_emirati',
    });
    assert.equal(resForbiddenCrossWrite.status, 403);
    assert.equal(resForbiddenCrossWrite.json.code, 'CATEGORY_ACCESS_FORBIDDEN');
  });

  t.after(async () => {
    if (httpServer) {
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections();
      }
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });
});
