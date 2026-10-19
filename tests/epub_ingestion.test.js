// Acceptance test for Phase 5 Native EPUB Book Ingestion
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { parseEpub, cleanText, decodeHtmlEntities } = require('../src/utils/epubParser');
const documents = require('../src/services/documentService');
const pipeline = require('../src/services/processingPipeline');
const db = require('../src/db/database');
const storage = require('../src/services/storageService');
const { newId } = require('../src/utils/ids');
const { nowIso } = require('../src/utils/clock');

function buildSampleEpub(targetPath, { title = 'Kitab Al-Ilm', chapters = [] } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-src-'));
  try {
    fs.writeFileSync(path.join(tmp, 'mimetype'), 'application/epub+zip');
    fs.mkdirSync(path.join(tmp, 'META-INF'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'META-INF', 'container.xml'),
      '<?xml version="1.0"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
      '  <rootfiles>\n' +
      '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
      '  </rootfiles>\n' +
      '</container>'
    );

    fs.mkdirSync(path.join(tmp, 'OEBPS'), { recursive: true });
    let manifestItems = '';
    let spineItems = '';
    let navPoints = '';

    chapters.forEach((ch, idx) => {
      const fileName = `ch${idx + 1}.xhtml`;
      manifestItems += `    <item id="ch${idx + 1}" href="${fileName}" media-type="application/xhtml+xml"/>\n`;
      spineItems += `    <itemref idref="ch${idx + 1}"/>\n`;
      navPoints += `    <navPoint id="np${idx + 1}" playOrder="${idx + 1}"><navLabel><text>${ch.title}</text></navLabel><content src="${fileName}"/></navPoint>\n`;

      fs.writeFileSync(
        path.join(tmp, 'OEBPS', fileName),
        '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<!DOCTYPE html>\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
        `<head><title>${ch.title}</title></head>\n` +
        '<body>\n' +
        `  <h2>${ch.title}</h2>\n` +
        `  <div>${ch.html}</div>\n` +
        '</body>\n' +
        '</html>'
      );
    });

    fs.writeFileSync(
      path.join(tmp, 'OEBPS', 'toc.ncx'),
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n' +
      '  <head><meta name="dtb:uid" content="urn:uuid:test-epub"/></head>\n' +
      `  <docTitle><text>${title}</text></docTitle>\n` +
      `  <navMap>\n${navPoints}  </navMap>\n` +
      '</ncx>'
    );

    fs.writeFileSync(
      path.join(tmp, 'OEBPS', 'content.opf'),
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">\n' +
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
      `    <dc:title>${title}</dc:title>\n` +
      '    <dc:language>ar</dc:language>\n' +
      '    <dc:identifier id="BookId">urn:uuid:test-epub</dc:identifier>\n' +
      '  </metadata>\n' +
      '  <manifest>\n' +
      '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n' +
      `${manifestItems}` +
      '  </manifest>\n' +
      '  <spine toc="ncx">\n' +
      `${spineItems}` +
      '  </spine>\n' +
      '</package>'
    );

    execFileSync('zip', ['-0Xq', targetPath, 'mimetype'], { cwd: tmp });
    execFileSync('zip', ['-rq', targetPath, 'META-INF', 'OEBPS'], { cwd: tmp });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('EPUB text utilities and parsing', async (t) => {
  await t.test('cleanText and decodeHtmlEntities handle tags and entities', () => {
    const raw = '<p>Bismillah &amp; Al-Hamdulillah.</p><br/><div>Page &quot;one&quot; &apos;text&apos;.</div>';
    const cleaned = cleanText(raw);
    assert.match(cleaned, /Bismillah & Al-Hamdulillah/);
    assert.match(cleaned, /Page "one" 'text'/);
  });

  await t.test('parseEpub extracts metadata, chapters and full text', async () => {
    const tmpEpub = path.join(os.tmpdir(), `test-${Date.now()}.epub`);
    try {
      buildSampleEpub(tmpEpub, {
        title: 'Tafsir Collection',
        chapters: [
          { title: 'Chapter 1: The Opening', html: '<p>First chapter exposition with detailed commentary.</p>' },
          { title: 'Chapter 2: The Guidance', html: '<p>Second chapter with jurisprudential benefits.</p>' },
        ],
      });

      const parsed = await parseEpub(tmpEpub);
      assert.equal(parsed.title, 'Tafsir Collection');
      assert.equal(parsed.chapterCount, 2);
      assert.equal(parsed.chapters.length, 2);
      assert.match(parsed.chapters[0].text, /The Opening/);
      assert.match(parsed.chapters[0].text, /First chapter exposition/);
      assert.match(parsed.chapters[1].text, /The Guidance/);
      assert.match(parsed.chapters[1].text, /jurisprudential benefits/);
      assert.match(parsed.text, /First chapter exposition/);
      assert.match(parsed.text, /jurisprudential benefits/);
    } finally {
      try { fs.unlinkSync(tmpEpub); } catch (_) {}
    }
  });

  await t.test('parseEpub throws on invalid or corrupt file', async () => {
    const badFile = path.join(os.tmpdir(), `corrupt-${Date.now()}.epub`);
    fs.writeFileSync(badFile, 'not a valid zip file content');
    try {
      await assert.rejects(async () => {
        await parseEpub(badFile);
      });
    } finally {
      try { fs.unlinkSync(badFile); } catch (_) {}
    }
  });
});

test('EPUB classification and pipeline ingestion', async (t) => {
  await t.test('documentService classifies .epub as document', () => {
    assert.equal(documents.classifyExt('.epub'), 'document');
    assert.equal(documents.classifyExt('.EPUB'), 'document');
  });

  await t.test('processingPipeline processes EPUB with chapter-level pages', async () => {
    process.env.AI_PROVIDER = 'mock';

    const testEpub = path.join(os.tmpdir(), `book-${Date.now()}.epub`);
    buildSampleEpub(testEpub, {
      title: 'Scholarly Treatise',
      chapters: [
        { title: 'Fasl 1', html: '<p>Discussion regarding intentionality and knowledge acquisition.</p>' },
        { title: 'Fasl 2', html: '<p>Discussion regarding textual evidence and context preservation.</p>' },
      ],
    });

    const docId = newId('doc');
    const stored = await storage.saveFile(testEpub, docId, 'scholarly_treatise.epub');

    db.run(
      `INSERT INTO documents (
        id, title, original_filename, kind, file_type, mime_type, size_bytes,
        vault_path, sha256, upload_status, ocr_status, index_status,
        uploaded_at
      ) VALUES (?, '', ?, 'document', 'epub', 'application/epub+zip', ?, ?, 'fakehash', 'completed', 'not_applicable', 'queued', ?)`,
      docId, 'scholarly_treatise.epub', stored.size, stored.relPath, nowIso()
    );

    try {
      await pipeline.processDocument(docId);

      const updated = db.get('SELECT * FROM documents WHERE id = ?', docId);
      assert.equal(updated.index_status, 'completed');
      assert.equal(updated.title, 'Scholarly Treatise');
      assert.equal(updated.pages_total, 2);
      assert.equal(updated.pages_processed, 2);
      assert.ok(updated.char_count > 50);

      const chunks = db.all('SELECT * FROM chunks WHERE document_id = ? ORDER BY idx', docId);
      assert.ok(chunks.length >= 2);
      assert.equal(chunks[0].page, 1);
      assert.equal(chunks[chunks.length - 1].page, 2);
      assert.ok(chunks[0].embedding !== null);
    } finally {
      try { fs.unlinkSync(testEpub); } catch (_) {}
      try { storage.remove(stored.vaultPath); } catch (_) {}
      db.run('DELETE FROM chunks WHERE document_id = ?', docId);
      db.run('DELETE FROM documents WHERE id = ?', docId);
    }
  });
});
