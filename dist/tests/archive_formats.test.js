// Acceptance test for Phase 5 Expanded 1GB Limits and Internet Archive Formats (ZIP, JP2, EPUB, TXT)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

const config = require('../src/config');
const documents = require('../src/services/documentService');
const pipeline = require('../src/services/processingPipeline');
const db = require('../src/db/database');
const storage = require('../src/services/storageService');
const { inspectZip, naturalCompare } = require('../src/utils/zipParser');
const { convertJp2ToImage } = require('../src/services/ai/localTools');
const { newId } = require('../src/utils/ids');
const { nowIso } = require('../src/utils/clock');
const { PNG_1X1 } = require('./helpers/fixtures');

test('Phase 5 - 1GB Limits and Format Whitelisting', async (t) => {
  await t.test('Server config enforces 1024 MB (1 GB) upload limits', () => {
    assert.equal(config.maxFileMb, 1024);
    assert.equal(config.maxMediaMb, 1024);
  });

  await t.test('Document extensions include ZIP, EPUB, and JP2', () => {
    assert.equal(documents.classifyExt('.zip'), 'document');
    assert.equal(documents.classifyExt('.ZIP'), 'document');
    assert.equal(documents.classifyExt('.epub'), 'document');
    assert.equal(documents.classifyExt('.jp2'), 'image');
    assert.equal(documents.classifyExt('.JP2'), 'image');
    assert.equal(documents.classifyExt('.txt'), 'document');
    assert.equal(documents.classifyExt('.pdf'), 'document');
    assert.equal(documents.classifyExt('', 'application/epub+zip'), 'document');
    assert.equal(documents.classifyExt('.bin', 'application/epub+zip'), 'document');
    assert.equal(documents.classifyExt(null, 'application/x-epub'), 'document');
  });

  await t.test('Natural sort compares filenames with numbers correctly', () => {
    const list = ['page_10.jp2', 'page_1.jp2', 'page_2.jp2', 'page_20.jp2'];
    list.sort(naturalCompare);
    assert.deepEqual(list, ['page_1.jp2', 'page_2.jp2', 'page_10.jp2', 'page_20.jp2']);
  });
});

test('Phase 5 - ZIP Archive Inspection', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));

  await t.test('inspectZip filters macOS metadata and classifies image archives', () => {
    const zip = new AdmZip();
    zip.addFile('__MACOSX/._0001.jp2', Buffer.from('metadata'));
    zip.addFile('__MACOSX/._0002.jp2', Buffer.from('metadata'));
    zip.addFile('.DS_Store', Buffer.from('ds_store'));
    zip.addFile('vol1/0002.png', PNG_1X1);
    zip.addFile('vol1/0001.png', PNG_1X1);

    const zipPath = path.join(tmpDir, 'scanned_images.zip');
    zip.writeZip(zipPath);

    const inspection = inspectZip(zipPath);
    assert.equal(inspection.kind, 'images');
    assert.equal(inspection.entries.length, 2);
    assert.equal(inspection.entries[0].entryName, 'vol1/0001.png');
    assert.equal(inspection.entries[1].entryName, 'vol1/0002.png');
  });

  await t.test('inspectZip classifies text archives', () => {
    const zip = new AdmZip();
    zip.addFile('chapter1.txt', Buffer.from('Text of chapter 1'));
    zip.addFile('chapter2.txt', Buffer.from('Text of chapter 2'));

    const zipPath = path.join(tmpDir, 'text_collection.zip');
    zip.writeZip(zipPath);

    const inspection = inspectZip(zipPath);
    assert.equal(inspection.kind, 'text');
    assert.equal(inspection.entries.length, 2);
  });

  await t.test('inspectZip classifies single sub-document archives', () => {
    const zip = new AdmZip();
    zip.addFile('book.epub', Buffer.from('mock epub content'));

    const zipPath = path.join(tmpDir, 'single_book.zip');
    zip.writeZip(zipPath);

    const inspection = inspectZip(zipPath);
    assert.equal(inspection.kind, 'single_doc');
    assert.equal(inspection.subDocExt, '.epub');
  });

  // Cleanup tmpDir
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Phase 5 - JP2 Conversion Safety', async (t) => {
  await t.test('convertJp2ToImage handles non-existent files gracefully', async () => {
    const result = await convertJp2ToImage('/non/existent/page.jp2', os.tmpdir());
    assert.equal(result, '/non/existent/page.jp2');
  });
});

test('Phase 5 - End-to-End ZIP Ingestion Pipeline', async (t) => {
  process.env.AI_PROVIDER = 'mock';

  await t.test('Pipeline extracts and indexes text files from ZIP archive', async () => {
    const zip = new AdmZip();
    zip.addFile('01_Introduction.txt', Buffer.from('Classical history treatise regarding epistemology and method.'));
    zip.addFile('02_Sources.txt', Buffer.from('Critical review of foundational manuscripts and historical citations.'));

    const tmpZip = path.join(os.tmpdir(), `archive-${Date.now()}.zip`);
    zip.writeZip(tmpZip);

    const docId = newId('doc');
    const stored = await storage.saveFile(tmpZip, docId, 'classical_archive.zip');

    db.run(
      `INSERT INTO documents (
        id, title, original_filename, kind, file_type, mime_type, size_bytes,
        vault_path, sha256, upload_status, ocr_status, index_status,
        uploaded_at
      ) VALUES (?, '', ?, 'document', 'zip', 'application/zip', ?, ?, 'ziphash1', 'completed', 'not_applicable', 'queued', ?)`,
      docId, 'classical_archive.zip', stored.size, stored.relPath, nowIso()
    );

    try {
      await pipeline.processDocument(docId);

      const doc = db.get('SELECT * FROM documents WHERE id = ?', docId);
      assert.equal(doc.index_status, 'completed');
      assert.equal(doc.pages_total, 2);
      assert.equal(doc.pages_processed, 2);
      assert.ok(doc.char_count > 50);

      const chunks = db.all('SELECT * FROM chunks WHERE document_id = ? ORDER BY idx', docId);
      assert.ok(chunks.length >= 2);
      assert.equal(chunks[0].page, 1);
      assert.equal(chunks[1].page, 2);
      assert.ok(chunks[0].text.includes('epistemology'));
      assert.ok(chunks[1].text.includes('manuscripts'));
    } finally {
      try { fs.unlinkSync(tmpZip); } catch (_) {}
      try { storage.remove(stored.vaultPath); } catch (_) {}
      db.run('DELETE FROM chunks WHERE document_id = ?', docId);
      db.run('DELETE FROM documents WHERE id = ?', docId);
    }
  });

  await t.test('Pipeline extracts and OCR indexes image archive from ZIP', async () => {
    const zip = new AdmZip();
    zip.addFile('p01.png', PNG_1X1);
    zip.addFile('p02.png', PNG_1X1);

    const tmpZip = path.join(os.tmpdir(), `images-${Date.now()}.zip`);
    zip.writeZip(tmpZip);

    const docId = newId('doc');
    const stored = await storage.saveFile(tmpZip, docId, 'images_archive.zip');

    db.run(
      `INSERT INTO documents (
        id, title, original_filename, kind, file_type, mime_type, size_bytes,
        vault_path, sha256, upload_status, ocr_status, index_status,
        uploaded_at
      ) VALUES (?, '', ?, 'document', 'zip', 'application/zip', ?, ?, 'ziphash2', 'completed', 'not_applicable', 'queued', ?)`,
      docId, 'images_archive.zip', stored.size, stored.relPath, nowIso()
    );

    try {
      await pipeline.processDocument(docId);

      const doc = db.get('SELECT * FROM documents WHERE id = ?', docId);
      assert.equal(doc.index_status, 'completed');
      assert.equal(doc.pages_total, 2);
      assert.equal(doc.pages_processed, 2);
    } finally {
      try { fs.unlinkSync(tmpZip); } catch (_) {}
      try { storage.remove(stored.vaultPath); } catch (_) {}
      db.run('DELETE FROM chunks WHERE document_id = ?', docId);
      db.run('DELETE FROM documents WHERE id = ?', docId);
    }
  });
});
