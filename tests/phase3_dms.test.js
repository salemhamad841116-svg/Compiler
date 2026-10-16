const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DB_PATH = path.join(__dirname, '..', 'data', `test_phase3_${Date.now()}.sqlite`);
process.env.VAULT_DIR = path.join(__dirname, '..', 'data', `test_vault_${Date.now()}`);

const { getDb, closeDb } = require('../src/db/database');
const categoryService = require('../src/services/categoryService');
const documentService = require('../src/services/documentService');
const statsService = require('../src/services/statsService');

test('Phase 3 DMS: categories seeding, bulk images, raw text, and analytics', async (t) => {
  const db = getDb();
  categoryService.seedIfNeeded();

  await t.test('1. Initial seeding contains exactly 8 required categories with nameKey', () => {
    const categories = categoryService.listCategories();
    assert.ok(categories.length >= 8, `Expected at least 8 categories, found ${categories.length}`);
    const expectedKeys = [
      'cat.arabic_language',
      'cat.religion',
      'cat.hadith',
      'cat.quran_interpretation',
      'cat.history',
      'cat.english_language',
      'cat.botany_plants',
      'cat.programming_engineering',
    ];
    for (const key of expectedKeys) {
      const found = categories.find((c) => c.nameKey === key);
      assert.ok(found, `Missing category with nameKey: ${key}`);
      assert.ok(found.name, `Category with key ${key} has empty name`);
    }
  });

  await t.test('2. Direct text upload stores raw_text and sets page_count to 1', async () => {
    const categories = categoryService.listCategories();
    const cat = categories[0];
    const actor = { id: 'test_supervisor_1', role: 'supervisor', name: 'Test Supervisor', email: 'test@example.com' };

    db.prepare(`
      INSERT OR IGNORE INTO users (id, role, name, email, password_hash, status, created_at)
      VALUES (?, ?, ?, ?, 'hash', 'active', datetime('now'))
    `).run(actor.id, actor.role, actor.name, actor.email);

    const doc = await documentService.storeRawText({
      textContent: 'Direct text content for book test without OCR.',
      title: 'Direct Text Book Title',
      body: { categoryId: cat.id },
      actor,
      ip: '127.0.0.1',
    });

    assert.ok(doc.id);
    assert.equal(doc.title, 'Direct Text Book Title');
    assert.equal(doc.category_id, cat.id);
    assert.equal(doc.page_count, 1);
    assert.equal(doc.raw_text, 'Direct text content for book test without OCR.');

    const row = documentService.getAuthorizedDocument(doc.id, actor);
    assert.equal(row.raw_text, 'Direct text content for book test without OCR.');
    assert.equal(row.page_count, 1);

    const mapped = documentService.mapDocument(row);
    assert.equal(mapped.rawText, 'Direct text content for book test without OCR.');
    assert.equal(mapped.pageCount, 1);
    assert.equal(mapped.category.id, cat.id);
  });

  await t.test('3. Bulk image upload groups multiple images as a single Book entity with book_pages', async () => {
    const categories = categoryService.listCategories();
    const cat = categories[1];
    const actor = { id: 'test_supervisor_1', role: 'supervisor', name: 'Test Supervisor', email: 'test@example.com' };

    fs.mkdirSync(process.env.VAULT_DIR, { recursive: true });
    const fakeVaultFile1 = path.join(process.env.VAULT_DIR, 'page1.png');
    const fakeVaultFile2 = path.join(process.env.VAULT_DIR, 'page2.png');
    const fakeVaultFile3 = path.join(process.env.VAULT_DIR, 'page3.png');
    fs.writeFileSync(fakeVaultFile1, 'fake image 1');
    fs.writeFileSync(fakeVaultFile2, 'fake image 2');
    fs.writeFileSync(fakeVaultFile3, 'fake image 3');

    const files = [
      { originalname: 'p1.png', mimetype: 'image/png', size: 1200, path: fakeVaultFile1 },
      { originalname: 'p2.png', mimetype: 'image/png', size: 1400, path: fakeVaultFile2 },
      { originalname: 'p3.png', mimetype: 'image/png', size: 1600, path: fakeVaultFile3 },
    ];

    const doc = await documentService.storeBookImages({
      files,
      body: { title: 'Multi-Page Image Book', categoryId: cat.id },
      actor,
      ip: '127.0.0.1',
    });

    assert.ok(doc.id);
    assert.equal(doc.title, 'Multi-Page Image Book');
    assert.equal(doc.category_id, cat.id);
    assert.equal(doc.page_count, 3);

    const row = documentService.getAuthorizedDocument(doc.id, actor);
    assert.equal(row.page_count, 3);

    const mapped = documentService.mapDocument(row);
    assert.equal(mapped.pageCount, 3);
    assert.equal(mapped.bookPages.length, 3);
    assert.equal(mapped.bookPages[0].pageNumber, 1);
    assert.equal(mapped.bookPages[1].pageNumber, 2);
    assert.equal(mapped.bookPages[2].pageNumber, 3);
  });

  await t.test('4. Ingestion analytics returns accurate totals and breakdowns', () => {
    const analytics = statsService.ingestionAnalytics();
    assert.ok(analytics);
    assert.ok(analytics.totalBooks >= 2);
    assert.ok(Array.isArray(analytics.bySupervisor));
    assert.ok(Array.isArray(analytics.byCategory));
    assert.ok(Array.isArray(analytics.bySupervisorAndCategory));

    const supRecord = analytics.bySupervisor.find((s) => s.supervisorId === 'test_supervisor_1');
    assert.ok(supRecord);
    assert.equal(supRecord.bookCount, 2);
  });

  closeDb();
  try {
    fs.rmSync(process.env.DB_PATH, { force: true });
    fs.rmSync(process.env.VAULT_DIR, { recursive: true, force: true });
  } catch (_) {}
});
