const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-gate-prov-'));
process.env.DATA_DIR = dataDir;
process.env.AI_PROVIDER = 'mock';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin_prov@example.test';
process.env.ADMIN_INITIAL_PASSWORD = 'AdminPass123';
process.env.ADMIN_NAME = 'Provenance Admin';
delete process.env.SETTINGS_ENCRYPTION_KEY;

const server = require('../src/server');
const serviceKeyService = require('../src/services/serviceKeyService');
const categoryService = require('../src/services/categoryService');
const { getDb } = require('../src/db/database');
const { nowIso } = require('../src/utils/clock');
const { provider, mockEmbedding } = require('../src/services/aiProvider');

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

test('Quality Gate 2: Provenance Footprint and Versioning Governance', async (t) => {
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

  const adminId = 'usr_prov_admin_1';
  db.prepare(`
    INSERT OR IGNORE INTO users (id, role, name, email, password_hash, status, created_at, app_source)
    VALUES (?, 'admin', 'Provenance Admin', 'admin_prov@example.test', 'hash', 'active', datetime('now'), 'chathsm')
  `).run(adminId);

  const syncKey = serviceKeyService.createServiceKey({
    name: 'Sync and Provenance Key',
    appSlug: 'sync-agent',
    scope: 'sync',
    allowedCategoryIds: ['*'],
    createdBy: adminId,
  });

  const client = makeServiceClient(syncKey.rawToken);
  let createdDocId = null;

  await t.test('1. Ingestion of raw book content through service API', async () => {
    const res = await client.post('/api/service/books/ingest', {
      title: 'Historical Camel Lineages and Pedigrees',
      text: 'Detailed records of authentic desert camel pedigrees and bloodlines across centuries.',
      category: 'cat.camel_heritage',
    });

    assert.equal(res.status, 201);
    assert.ok(res.json.documentId);
    assert.equal(res.json.versionNumber, 1);
    assert.ok(res.json.chunkCount > 0);
    createdDocId = res.json.documentId;
  });

  await t.test('2. 100% Provenance footprint returned on query', async () => {
    const res = await client.post('/api/service/books/query', {
      query: 'authentic desert camel pedigrees',
      category: 'cat.camel_heritage',
    });

    assert.equal(res.status, 200);
    assert.ok(res.json.sources.length > 0);

    for (const source of res.json.sources) {
      assert.ok(source.sourceId, 'Missing sourceId');
      assert.equal(source.sourceId, createdDocId);
      assert.ok(source.bookTitle, 'Missing bookTitle');
      assert.equal(source.bookTitle, 'Historical Camel Lineages and Pedigrees');
      assert.equal(typeof source.pageNumber, 'number');
      assert.ok(source.pageNumber >= 1);
      assert.equal(typeof source.versionNumber, 'number');
      assert.equal(source.versionNumber, 1);
      assert.ok(source.verifiedAt, 'Missing verifiedAt ISO string');
      assert.ok(!isNaN(Date.parse(source.verifiedAt)));
      assert.equal(typeof source.similarity, 'number');
      assert.ok(source.similarity >= 0 && source.similarity <= 1);
    }
  });

  await t.test('3. Book update preserves historical version in document_versions table', async () => {
    const updateRes = await client.put(`/api/service/books/${createdDocId}`, {
      title: 'Historical Camel Lineages - Second Edition',
      text: 'Updated records of authentic desert camel pedigrees with modern genetic analysis and lineage registries.',
      category: 'cat.camel_heritage',
    });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.json.newVersion, 2);

    // Verify historical version in document_versions
    const historicalRow = db.prepare('SELECT * FROM document_versions WHERE document_id = ? AND version_number = 1').get(createdDocId);
    assert.ok(historicalRow, 'Historical version 1 must exist in document_versions');
    assert.equal(historicalRow.title, 'Historical Camel Lineages and Pedigrees');

    // Verify current document updated to version 2
    const currentDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(createdDocId);
    assert.equal(currentDoc.version_number, 2);
    assert.equal(currentDoc.is_current, 1);
    assert.equal(currentDoc.title, 'Historical Camel Lineages - Second Edition');

    // Verify chunks updated to version 2
    const chunks = db.prepare('SELECT * FROM chunks WHERE document_id = ?').all(createdDocId);
    assert.ok(chunks.length > 0);
    assert.ok(chunks.every((c) => c.version_number === 2));

    // Verify query returns version 2 exclusively
    const queryV2 = await client.post('/api/service/books/query', {
      query: 'authentic desert camel pedigrees genetic analysis',
      category: 'cat.camel_heritage',
    });
    assert.equal(queryV2.status, 200);
    assert.ok(queryV2.json.sources.length > 0);
    assert.ok(queryV2.json.sources.every((s) => s.versionNumber === 2));
    assert.equal(queryV2.json.sources[0].bookTitle, 'Historical Camel Lineages - Second Edition');
  });

  await t.test('4. Instant deletion synchronization (immediate DB purge, cascading chunk purge, and vector cache invalidation)', async () => {
    const delRes = await client.del(`/api/service/books/${createdDocId}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.json.success, true);
    assert.equal(delRes.json.deletedId, createdDocId);

    // Verify document deleted from documents
    const docCheck = db.prepare('SELECT * FROM documents WHERE id = ?').get(createdDocId);
    assert.equal(docCheck, undefined);

    // Verify chunks deleted
    const chunksCheck = db.prepare('SELECT COUNT(*) as cnt FROM chunks WHERE document_id = ?').get(createdDocId);
    assert.equal(chunksCheck.cnt, 0);

    // Verify query returns 0 sources for this document
    const queryAfter = await client.post('/api/service/books/query', {
      query: 'authentic desert camel pedigrees',
      category: 'cat.camel_heritage',
    });
    assert.equal(queryAfter.status, 200);
    assert.ok(!queryAfter.json.sources || queryAfter.json.sources.length === 0);
  });

  await t.test('5. Archived versions isolation from search (is_current = 0 excluded from RAG)', async () => {
    const tempRes = await client.post('/api/service/books/ingest', {
      title: 'Archived Camel Lore',
      text: 'Archived camel training methods from antiquity.',
      category: 'cat.camel_heritage',
    });
    assert.equal(tempRes.status, 201);
    const tempId = tempRes.json.documentId;

    // Verify searchable when current
    const resBefore = await client.post('/api/service/books/query', {
      query: 'Archived camel training',
      category: 'cat.camel_heritage',
    });
    assert.equal(resBefore.status, 200);
    assert.ok(resBefore.json.sources.some((s) => s.sourceId === tempId));

    // Mark as archived (is_current = 0)
    db.prepare('UPDATE documents SET is_current = 0 WHERE id = ?').run(tempId);
    require('../src/models/vectorDbModel').invalidateCache();

    // Verify excluded from search
    const resAfter = await client.post('/api/service/books/query', {
      query: 'Archived camel training',
      category: 'cat.camel_heritage',
    });
    assert.equal(resAfter.status, 200);
    assert.ok(!resAfter.json.sources.some((s) => s.sourceId === tempId));

    // Cleanup
    db.prepare('DELETE FROM chunks WHERE document_id = ?').run(tempId);
    db.prepare('DELETE FROM documents WHERE id = ?').run(tempId);
    require('../src/models/vectorDbModel').invalidateCache();
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
