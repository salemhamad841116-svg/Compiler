const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makePdf, PNG_1X1 } = require('./helpers/fixtures');

// ---- isolated environment (set BEFORE requiring the app)
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-acceptance-'));
process.env.DATA_DIR = dataDir;
process.env.AI_PROVIDER = 'mock';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin@example.test';
process.env.ADMIN_INITIAL_PASSWORD = 'AdminPass123';
process.env.ADMIN_NAME = 'Test Admin';

const server = require('../src/server');
const clock = require('../src/utils/clock');
const authService = require('../src/auth/authService');
const jobQueue = require('../src/services/jobQueue');
const presenceService = require('../src/services/presenceService');

let baseUrl;
let httpServer;

/** Tiny HTTP client with a cookie jar, mimicking a browser tab/device. */
function makeClient() {
  let cookie = '';
  const api = async (method, url, body, { headers = {}, raw = false } = {}) => {
    const h = { 'X-Requested-With': 'XMLHttpRequest', ...headers };
    if (cookie) h.Cookie = cookie;
    let payload = body;
    if (body && !(body instanceof FormData)) {
      payload = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
    }
    const res = await fetch(baseUrl + url, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* non-json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    get: (u, o) => api('GET', u, undefined, o),
    post: (u, b, o) => api('POST', u, b, o),
    patch: (u, b, o) => api('PATCH', u, b, o),
    put: (u, b, o) => api('PUT', u, b, o),
    del: (u, o) => api('DELETE', u, undefined, o),
    form: (u, fd) => api('POST', u, fd),
    hasCookie: () => Boolean(cookie),
  };
}

function fileForm(field, name, buf, mime, fields = {}) {
  const fd = new FormData();
  fd.append(field, new Blob([buf], { type: mime }), name);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, v);
  return fd;
}
const textForm = (name, text, fields) => fileForm('bookFile', name, Buffer.from(text), 'text/plain', fields);

test('acceptance: admin dashboard, supervisor auth, categories, uploads, stats, activity, presence', async (t) => {
  server.startBackground();
  httpServer = await new Promise((resolve) => {
    const s = server.createApp().listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const admin = makeClient();
  const sup = makeClient();
  const sup2 = makeClient();
  let supUser;
  let sup2User;
  let catHadith;

  t.after(async () => {
    await new Promise((r) => httpServer.close(r));
    server.stopBackground();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test('health and unauthenticated access is rejected with JSON errors', async () => {
    const h = await admin.get('/health');
    assert.equal(h.status, 200);
    assert.equal(h.json.database, 'ok');
    for (const url of ['/api/admin/overview', '/api/ingestion/books', '/api/categories', '/api/documents', '/api/me/stats']) {
      const r = await admin.get(url);
      assert.equal(r.status, 401, url);
      assert.equal(r.json.code, 'NOT_AUTHENTICATED');
      assert.ok(r.json.requestId);
    }
    const pub = await admin.get('/api/categories/public');
    assert.equal(pub.status, 200);
    assert.ok(pub.json.data.length >= 6);
    const unknown = await admin.get('/api/nope');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.code, 'ROUTE_NOT_FOUND');
  });

  await t.test('(1) supervisor invitation, activation, login, wrong credentials, disabled, refresh persistence, logout', async () => {
    const bad = await admin.post('/api/auth/login', { email: 'admin@example.test', password: 'wrong-password-1' });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.code, 'INVALID_CREDENTIALS');
    const unknown = await admin.post('/api/auth/login', { email: 'nobody@example.test', password: 'wrong-password-1' });
    assert.equal(unknown.json.code, 'INVALID_CREDENTIALS');

    const ok = await admin.post('/api/auth/login', { email: 'admin@example.test', password: 'AdminPass123' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.role, 'admin');
    assert.ok(!('token' in ok.json), 'web login must not expose bearer token');

    const created = await admin.post('/api/admin/supervisors', { name: 'Alice Supervisor', email: 'alice@example.test' });
    assert.equal(created.status, 201);
    supUser = created.json.data;
    assert.equal(supUser.status, 'invited');
    const inv = created.json.invitation.token;

    // not yet activated
    const early = await sup.post('/api/auth/login', { email: 'alice@example.test', password: 'AlicePass123' });
    assert.equal(early.json.code, 'ACCOUNT_NOT_ACTIVATED');

    const weak = await sup.post(`/api/auth/invitations/${inv}/accept`, { password: 'short' });
    assert.equal(weak.status, 400);
    const acc = await sup.post(`/api/auth/invitations/${inv}/accept`, { password: 'AlicePass123' });
    assert.equal(acc.status, 200);
    const reuse = await sup.post(`/api/auth/invitations/${inv}/accept`, { password: 'AlicePass123' });
    assert.equal(reuse.status, 410);

    const login = await sup.post('/api/auth/login', { email: 'alice@example.test', password: 'AlicePass123' });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.role, 'supervisor');
    // "refresh": a brand new request using only the stored cookie
    const me = await sup.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, 'alice@example.test');
    // CSRF: cookie-authenticated unsafe request without header is rejected
    const noHeader = await fetch(`${baseUrl}/api/auth/heartbeat`, { method: 'POST', headers: { Cookie: `sid=x` } });
    assert.equal(noHeader.status, 401);

    // disable -> existing session revoked, login blocked; enable -> works
    const dis = await admin.patch(`/api/admin/supervisors/${supUser.id}`, { status: 'disabled' });
    assert.equal(dis.json.data.status, 'disabled');
    const afterDisable = await sup.get('/api/auth/me');
    assert.equal(afterDisable.status, 401);
    const loginDisabled = await sup.post('/api/auth/login', { email: 'alice@example.test', password: 'AlicePass123' });
    assert.equal(loginDisabled.json.code, 'ACCOUNT_DISABLED');
    await admin.patch(`/api/admin/supervisors/${supUser.id}`, { status: 'active' });
    const again = await sup.post('/api/auth/login', { email: 'alice@example.test', password: 'AlicePass123' });
    assert.equal(again.status, 200);

    // second supervisor for isolation tests
    const c2 = await admin.post('/api/admin/supervisors', { name: 'Bob Supervisor', email: 'bob@example.test' });
    sup2User = c2.json.data;
    await sup2.post(`/api/auth/invitations/${c2.json.invitation.token}/accept`, { password: 'BobPass12345' });
    const l2 = await sup2.post('/api/auth/login', { email: 'bob@example.test', password: 'BobPass12345' });
    assert.equal(l2.status, 200);

    // logout really ends the session
    const tmp = makeClient();
    await tmp.post('/api/auth/login', { email: 'alice@example.test', password: 'AlicePass123' });
    assert.equal((await tmp.post('/api/auth/logout')).status, 200);
    assert.equal((await tmp.get('/api/auth/me')).status, 401);
  });

  await t.test('lockout after repeated failures, and idle expiry reports SESSION_EXPIRED', async () => {
    const victim = makeClient();
    for (let i = 0; i < 5; i++) await victim.post('/api/auth/login', { email: 'bob@example.test', password: 'nope-nope-1' });
    const locked = await victim.post('/api/auth/login', { email: 'bob@example.test', password: 'BobPass12345' });
    assert.equal(locked.json.code, 'ACCOUNT_LOCKED');
    clock.__advance(16 * 60000);
    const unlocked = await victim.post('/api/auth/login', { email: 'bob@example.test', password: 'BobPass12345' });
    assert.equal(unlocked.status, 200);

    const idle = makeClient();
    await idle.post('/api/auth/login', { email: 'alice@example.test', password: 'AlicePass123' });
    clock.__advance(125 * 60000);
    const expired = await idle.get('/api/auth/me');
    assert.equal(expired.status, 401);
    assert.equal(expired.json.code, 'SESSION_EXPIRED');
    // refresh clients that were open before the time jump
    await sup.post('/api/auth/login', { email: 'alice@example.test', password: 'AlicePass123' });
    await sup2.post('/api/auth/login', { email: 'bob@example.test', password: 'BobPass12345' });
    await admin.post('/api/auth/login', { email: 'admin@example.test', password: 'AdminPass123' });
  });

  await t.test('(2) admin-created category appears for the supervisor without re-login; id-based rename', async () => {
    const created = await admin.post('/api/categories', { name: 'Brand New Category', description: 'x' });
    assert.equal(created.status, 201);
    const catId = created.json.data.id;
    const list = await sup.get('/api/categories');
    assert.equal(list.status, 200);
    assert.ok(list.json.data.some((c) => c.id === catId && c.name === 'Brand New Category'));
    const dup = await admin.post('/api/categories', { name: 'Brand New Category' });
    assert.equal(dup.status, 409);
    const forbidden = await sup.post('/api/categories', { name: 'Supervisor Cat' });
    assert.equal(forbidden.status, 403);
    catHadith = list.json.data.find((c) => c.name === 'Hadith');
    assert.ok(catHadith);
    const empty = await admin.post('/api/categories', { name: '   ' });
    assert.equal(empty.status, 400);
  });

  let imageDocId;
  let pdfDocId;
  await t.test('(3) supervisor uploads image + PDF; records, stats and activity are correct', async () => {
    const before = (await sup.get('/api/me/stats')).json.data;
    assert.equal(before.current.filesStored.total, 0);

    const img = await sup.form('/api/ingestion/upload-book', fileForm('bookFile', 'scan1.png', PNG_1X1, 'image/png', { categoryId: catHadith.id, title: 'Scan One' }));
    assert.equal(img.status, 201, img.text);
    imageDocId = img.json.data.id;
    assert.equal(img.json.data.kind, 'image');
    const pdf = await sup.form('/api/ingestion/upload-book', fileForm('bookFile', 'book3.pdf', makePdf(3), 'application/pdf', { categoryId: catHadith.id }));
    assert.equal(pdf.status, 201, pdf.text);
    pdfDocId = pdf.json.data.id;

    // stored immediately, before processing ends
    const mid = (await sup.get('/api/me/stats')).json.data;
    assert.equal(mid.current.filesStored.total, 2);
    assert.equal(mid.current.filesStored.images, 1);
    assert.equal(mid.current.filesStored.documents, 1);

    await jobQueue.waitForIdle();
    const after = (await sup.get('/api/me/stats')).json.data;
    assert.equal(after.current.filesStored.total, 2);
    assert.equal(after.current.indexed.documents, 1);
    assert.equal(after.current.indexed.images, 1);
    assert.equal(after.current.pipeline.completed, 2);
    assert.equal(after.current.pages.pdfTotal, 3);
    assert.equal(after.current.pages.pdfProcessed, 3);

    const doc = (await sup.get(`/api/documents/${pdfDocId}`)).json.data;
    assert.equal(doc.owner.id, supUser.id);
    assert.equal(doc.category.id, catHadith.id);
    assert.equal(doc.statuses.index, 'completed');
    assert.equal(doc.pages.total, 3);
    assert.equal(doc.pages.processed, 3);
    assert.equal(doc.pages.kind, 'pdf');
    assert.ok(doc.completedAt && doc.uploadedAt);
    const imgDoc = (await sup.get(`/api/documents/${imageDocId}`)).json.data;
    assert.equal(imgDoc.statuses.ocr, 'completed');
    assert.equal(imgDoc.pages.kind, 'image');

    // admin dashboard sees the same
    const ov = (await admin.get('/api/admin/overview')).json.data;
    assert.ok(ov.current.filesStored.total >= 2);
    assert.ok(ov.current.filesStored.images >= 1);

    const act = (await sup.get('/api/me/activity?pageSize=100')).json.data;
    const uploaded = act.items.filter((e) => e.action === 'document.uploaded');
    assert.equal(uploaded.length, 2);
    for (const e of uploaded) {
      assert.equal(e.supervisor.id, supUser.id);
      assert.equal(e.actor.id, supUser.id);
      assert.ok(e.documentId && e.filename && e.sizeBytes && e.category && e.at);
    }
    const completed = act.items.filter((e) => e.action === 'document.processing_completed');
    assert.equal(completed.length, 2);

    // file download works for the owner
    const file = await sup.get(`/api/documents/${pdfDocId}/file`, { raw: true });
    assert.equal(file.status, 200);
    assert.equal((await file.arrayBuffer()).byteLength, makePdf(3).length);
  });

  await t.test('(5) PDFs with known page counts are reported exactly; text files are labelled estimated', async () => {
    const pdf7 = await sup.form('/api/ingestion/upload-book', fileForm('bookFile', 'seven.pdf', makePdf(7, (n) => `Seven page doc, page ${n} unique ${n * 31}`), 'application/pdf', { categoryId: catHadith.id }));
    // 2 pages, second without text layer -> failed page reported
    const pdfMixed = await sup.form('/api/ingestion/upload-book', fileForm('bookFile', 'mixed.pdf', makePdf(2, (n) => (n === 1 ? 'Only first page has text' : '')), 'application/pdf', { categoryId: catHadith.id }));
    const txt = await sup.form('/api/ingestion/upload-book', textForm('notes.txt', 'Plain text knowledge about nothing.\n'.repeat(5), { categoryId: catHadith.id }));
    await jobQueue.waitForIdle();
    const d7 = (await sup.get(`/api/documents/${pdf7.json.data.id}`)).json.data;
    assert.equal(d7.pages.total, 7);
    assert.equal(d7.pages.processed, 7);
    assert.equal(d7.pages.failed, 0);
    const dm = (await sup.get(`/api/documents/${pdfMixed.json.data.id}`)).json.data;
    assert.equal(dm.pages.total, 2);
    assert.equal(dm.pages.processed, 1);
    assert.equal(dm.pages.failed, 1);
    const dt = (await sup.get(`/api/documents/${txt.json.data.id}`)).json.data;
    assert.equal(dt.pages.kind, 'estimated');
    assert.equal(dt.pages.total, null);
    assert.ok(dt.pages.estimated >= 1);
  });

  await t.test('(6) upload failures vs processing failures are distinguishable; retry is safe and idempotent', async () => {
    // validation failure (never stored)
    const bad = await sup.form('/api/ingestion/upload-book', fileForm('bookFile', 'evil.exe', Buffer.from('MZ'), 'application/octet-stream'));
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'UNSUPPORTED_FILE_TYPE');
    const empty = await sup.form('/api/ingestion/upload-book', fileForm('bookFile', 'empty.txt', Buffer.alloc(0), 'text/plain'));
    assert.equal(empty.status, 422);
    const fails = (await sup.get('/api/me/activity?action=document.upload_failed&pageSize=50')).json.data;
    assert.ok(fails.items.length >= 2);
    assert.ok(fails.items.every((e) => e.statuses.upload === 'failed' && e.failureReason));

    // OCR failure on an image: stored, OCR failed, indexing not started
    const ocr = await sup.form('/api/ingestion/upload-book', fileForm('bookFile', 'fail_ocr_scan.png', Buffer.concat([PNG_1X1, Buffer.from('unique-ocr-fail')]), 'image/png', { categoryId: catHadith.id }));
    assert.equal(ocr.status, 201);
    // embedding failure on text
    const emb = await sup.form('/api/ingestion/upload-book', textForm('embedfail.txt', 'This will fail [[FAIL_EMBED]] always', { categoryId: catHadith.id }));
    // transient failure (provider not configured), recoverable by retry
    process.env.AI_PROVIDER = 'gemini';
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'your_api_key_here';
    const transient = await sup.form('/api/ingestion/upload-book', textForm('transient.txt', 'Transient failure content about retries', { categoryId: catHadith.id }));
    await jobQueue.waitForIdle();
    process.env.AI_PROVIDER = 'mock';
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;

    const dOcr = (await sup.get(`/api/documents/${ocr.json.data.id}`)).json.data;
    assert.equal(dOcr.statuses.upload, 'stored');
    assert.equal(dOcr.statuses.ocr, 'failed');
    assert.equal(dOcr.statuses.index, 'not_started');
    assert.equal(dOcr.pipelineStatus, 'failed');
    const dEmb = (await sup.get(`/api/documents/${emb.json.data.id}`)).json.data;
    assert.equal(dEmb.statuses.index, 'failed');
    assert.ok(dEmb.failureReason);
    const dTr = (await sup.get(`/api/documents/${transient.json.data.id}`)).json.data;
    assert.equal(dTr.pipelineStatus, 'failed');
    assert.equal(dTr.failureCode, 'AI_NOT_CONFIGURED');

    const statsBefore = (await sup.get('/api/me/stats')).json.data;
    const lifetimeBefore = statsBefore.lifetime.processingCompleted;

    // retry succeeds now that the provider works; second retry is rejected (already processed)
    const r1 = await sup.post(`/api/documents/${transient.json.data.id}/retry`);
    assert.equal(r1.status, 200, r1.text);
    await jobQueue.waitForIdle();
    const fixed = (await sup.get(`/api/documents/${transient.json.data.id}`)).json.data;
    assert.equal(fixed.pipelineStatus, 'completed');
    const r2 = await sup.post(`/api/documents/${transient.json.data.id}/retry`);
    assert.equal(r2.status, 409);
    assert.equal(r2.json.code, 'NOT_FAILED');

    // double retry of a deterministic failure is idempotent (no duplicate documents)
    const total = (await sup.get('/api/me/stats')).json.data.current.filesStored.total;
    await Promise.all([sup.post(`/api/documents/${emb.json.data.id}/retry`), sup.post(`/api/documents/${emb.json.data.id}/retry`)]);
    await jobQueue.waitForIdle();
    const afterTotal = (await sup.get('/api/me/stats')).json.data.current.filesStored.total;
    assert.equal(afterTotal, total);
    const statsAfter = (await sup.get('/api/me/stats')).json.data;
    assert.equal(statsAfter.lifetime.processingCompleted, lifetimeBefore + 1, 'retry counted once, retries of failures never inflate');

    // identical file rejected as duplicate and not stored twice
    const dup = await sup.form('/api/ingestion/upload-book', fileForm('bookFile', 'book3_copy.pdf', makePdf(3), 'application/pdf', { categoryId: catHadith.id }));
    assert.equal(dup.status, 409);
    assert.equal(dup.json.code, 'DUPLICATE_FILE');
  });

  await t.test('(4) 100-file and 500-file batches produce exact batch summaries and per-file records without duplicates', async () => {
    for (const N of [100, 500]) {
      const batch = (await sup.post('/api/ingestion/batches', { declaredCount: N })).json.data;
      const queue = Array.from({ length: N }, (_, i) => i);
      const worker = async () => {
        while (queue.length) {
          const i = queue.shift();
          const r = await sup.form('/api/ingestion/upload-book', textForm(`bulk_${N}_${i}.txt`, `Bulk document ${N}-${i} with unique value ${i * 7919 + N}. `.repeat(3), { batchId: batch.id, categoryId: catHadith.id }));
          assert.equal(r.status, 201, `${N}/${i}: ${r.text}`);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      await jobQueue.waitForIdle(180000);
      const sum = (await sup.get(`/api/ingestion/batches/${batch.id}`)).json.data;
      assert.equal(sum.declaredCount, N);
      assert.equal(sum.stored, N);
      assert.equal(sum.files.length, N);
      assert.equal(sum.pipeline.completed, N);
      assert.equal(sum.pipeline.failed, 0);
      assert.equal(sum.uploadFailed, 0);
      assert.equal(new Set(sum.files.map((f) => f.id)).size, N);
      const events = (await sup.get(`/api/me/activity?batchId=${batch.id}&action=document.uploaded&pageSize=200`)).json.data;
      assert.equal(events.total, N);
      // another supervisor cannot see this batch
      const other = await sup2.get(`/api/ingestion/batches/${batch.id}`);
      assert.equal(other.status, 404);
    }
  });

  await t.test('(9) admin sees everything; supervisors cannot read other accounts or admin APIs', async () => {
    const up = await sup2.form('/api/ingestion/upload-book', textForm('bobs.txt', 'Bobs private document text content', { categoryId: catHadith.id }));
    assert.equal(up.status, 201);
    await jobQueue.waitForIdle();
    const bobDoc = up.json.data.id;

    assert.equal((await sup.get(`/api/documents/${bobDoc}`)).status, 404);
    assert.equal((await sup.get(`/api/documents/${bobDoc}/file`, { raw: true })).status, 404);
    assert.equal((await sup.del(`/api/documents/${bobDoc}`)).status, 404);
    assert.equal((await sup.get('/api/admin/overview')).status, 403);
    assert.equal((await sup.get('/api/admin/activity')).status, 403);
    assert.equal((await sup.get('/api/admin/supervisors')).status, 403);
    assert.equal((await sup.get('/api/admin/presence')).status, 403);
    assert.equal((await sup.get(`/api/me/activity?supervisorId=${sup2User.id}&pageSize=200`)).json.data.items.every((e) => e.supervisor.id === supUser.id), true);
    const supList = (await sup.get('/api/documents?pageSize=200')).json.data;
    assert.ok(supList.items.every((d) => d.owner.id === supUser.id));

    const adminList = (await admin.get(`/api/admin/documents?ownerId=${sup2User.id}`)).json.data;
    assert.equal(adminList.total, 1);
    const adminAll = (await admin.get('/api/admin/documents?pageSize=1')).json.data;
    assert.ok(adminAll.total > 600);
    const per = (await admin.get('/api/admin/stats/supervisors')).json.data;
    const alice = per.items.find((i) => i.supervisor.id === supUser.id);
    const bob = per.items.find((i) => i.supervisor.id === sup2User.id);
    assert.equal(bob.current.filesStored.total, 1);
    assert.ok(alice.current.filesStored.total > 600);
    // overall equals sum of the parts (plus any unattributed)
    const ov = (await admin.get('/api/admin/overview')).json.data;
    const sumParts = per.items.reduce((s, i) => s + i.current.filesStored.total, 0) + per.unattributedDocuments;
    assert.equal(ov.current.filesStored.total, sumParts);
  });

  await t.test('admin on behalf: both the actor and the assigned supervisor are recorded', async () => {
    const r = await admin.form('/api/ingestion/upload-book', textForm('onbehalf.txt', 'Uploaded by admin for Bob', { supervisorId: sup2User.id, categoryId: catHadith.id }));
    assert.equal(r.status, 201);
    assert.equal(r.json.data.owner.id, sup2User.id);
    assert.equal(r.json.data.actor.role, 'admin');
    assert.equal(r.json.data.onBehalf, true);
    await jobQueue.waitForIdle();
    const ev = (await admin.get(`/api/admin/activity?q=${r.json.data.id}&action=document.uploaded`)).json.data.items[0];
    assert.equal(ev.supervisor.id, sup2User.id);
    assert.equal(ev.actor.role, 'admin');
    const bobsView = (await sup2.get('/api/documents/' + r.json.data.id)).json.data;
    assert.equal(bobsView.owner.id, sup2User.id);
  });

  await t.test('category deletion of an in-use category requires explicit reassignment; documents keep links on rename', async () => {
    const c = (await admin.post('/api/categories', { name: 'Temp Cat' })).json.data;
    const u = await sup.form('/api/ingestion/upload-book', textForm('tempcat.txt', 'Doc in temp category unique 8841', { categoryId: c.id }));
    assert.equal(u.status, 201);
    await jobQueue.waitForIdle();
    const ren = await admin.put(`/api/categories/${c.id}`, { name: 'Temp Cat Renamed' });
    assert.equal(ren.json.data.name, 'Temp Cat Renamed');
    assert.equal((await sup.get(`/api/documents/${u.json.data.id}`)).json.data.category.name, 'Temp Cat Renamed');
    const blocked = await admin.del(`/api/categories/${c.id}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, 'CATEGORY_IN_USE');
    const done = await admin.del(`/api/categories/${c.id}?reassignTo=${catHadith.id}`);
    assert.equal(done.status, 200);
    assert.equal((await sup.get(`/api/documents/${u.json.data.id}`)).json.data.category.id, catHadith.id);
    const ev = (await admin.get('/api/admin/activity?action=category.deleted')).json.data;
    assert.ok(ev.items.length >= 1);
  });

  await t.test('activity log: filters, pagination, CSV export, immutability, history survives file deletion', async () => {
    const page1 = (await admin.get('/api/admin/activity?pageSize=10&page=1')).json.data;
    assert.equal(page1.items.length, 10);
    assert.ok(page1.total > 1000);
    const page2 = (await admin.get('/api/admin/activity?pageSize=10&page=2')).json.data;
    assert.notEqual(page1.items[0].id, page2.items[0].id);
    const byName = (await admin.get('/api/admin/activity?q=book3.pdf')).json.data;
    assert.ok(byName.items.length >= 2);
    const bySup = (await admin.get(`/api/admin/activity?supervisorId=${sup2User.id}&pageSize=200`)).json.data;
    assert.ok(bySup.items.every((e) => e.supervisor && e.supervisor.id === sup2User.id));
    const future = (await admin.get(`/api/admin/activity?from=${new Date(Date.now() + 10 * 86400000).toISOString()}`)).json.data;
    assert.equal(future.total, 0);

    const csv = await admin.get('/api/admin/activity.csv?action=document.uploaded', { raw: true });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const body = await csv.text();
    assert.match(body, /event_id,time_utc,time_asia_dubai/);
    assert.match(body, /GST\(UTC\+4\)/);
    assert.equal((await sup.get('/api/admin/activity.csv', { raw: true })).status, 403);

    // no HTTP route can modify/delete events
    assert.equal((await admin.del('/api/admin/activity')).status, 404);
    assert.equal((await sup.del('/api/me/activity')).status, 404);
    const { run } = require('../src/db/database');
    assert.throws(() => run('DELETE FROM audit_events'), /append-only|audit/i);
    assert.throws(() => run("UPDATE audit_events SET title = 'x'"), /append-only|audit/i);

    // history is preserved when the file is deleted
    const evBefore = (await admin.get(`/api/admin/activity?q=${pdfDocId}`)).json.data.total;
    const del = await sup.del(`/api/documents/${pdfDocId}`);
    assert.equal(del.status, 200);
    assert.equal((await sup.get(`/api/documents/${pdfDocId}`)).status, 404);
    const evAfter = (await admin.get(`/api/admin/activity?q=${pdfDocId}`)).json.data;
    assert.equal(evAfter.total, evBefore + 1);
    assert.equal(evAfter.items.find((e) => e.action === 'document.uploaded').documentDeleted, true);
    assert.equal(evAfter.items.find((e) => e.action === 'document.uploaded').title, 'book3');
    const st = (await sup.get('/api/me/stats')).json.data;
    assert.ok(st.lifetime.documentsDeleted >= 1);
  });

  await t.test('(7) presence: online, multiple sessions, logout vs connection lost vs session expired', async () => {
    const p0 = (await admin.get('/api/admin/presence')).json;
    assert.equal(p0.policy.heartbeatIntervalSeconds, 30);
    assert.equal(p0.policy.offlineAfterSeconds, 120);
    const aliceNow = () => admin.get('/api/admin/presence').then((r) => r.json.data.find((p) => p.id === supUser.id));

    // Alice has two sessions (two devices)
    const dev2 = makeClient();
    await dev2.post('/api/auth/login', { email: 'alice@example.test', password: 'AlicePass123' });
    await sup.post('/api/auth/heartbeat', {});
    await dev2.post('/api/auth/heartbeat', {});
    let a = await aliceNow();
    assert.equal(a.presence, 'online');
    assert.equal(a.activeSessions, 2);
    assert.ok(a.currentSessionStartedAt && a.lastLoginAt);

    // explicit logout of one device keeps her online through the other
    await dev2.post('/api/auth/logout');
    a = await aliceNow();
    assert.equal(a.presence, 'online');
    assert.equal(a.activeSessions, 1);
    await sup.post('/api/auth/heartbeat', {}); // the remaining tab keeps beating after the other device left

    // heartbeat stops (browser closed / network lost): offline after 120 s, reported honestly
    clock.__advance(100 * 1000);
    assert.equal((await aliceNow()).presence, 'online');
    clock.__advance(30 * 1000);
    a = await aliceNow();
    assert.equal(a.presence, 'offline');
    assert.equal(a.offlineReason, 'connection_lost');
    assert.ok(a.offlineDetail.lastSeenAt);
    assert.ok(!a.lastLogoutAt || a.lastLogoutAt !== a.offlineDetail.lastSeenAt);
    authService.sweepSessions(); // the background sweeper (every 30 s in production) records the marker once
    authService.sweepSessions();

    // reconnect: the session resumes (connection restored) while still valid
    await sup.post('/api/auth/heartbeat', {});
    a = await aliceNow();
    assert.equal(a.presence, 'online');

    // explicit logout
    await sup.post('/api/auth/logout');
    a = await aliceNow();
    assert.equal(a.presence, 'offline');
    assert.equal(a.offlineReason, 'logout');
    assert.ok(a.lastLogoutAt);

    // session expiry is distinct from logout
    const s3 = makeClient();
    await s3.post('/api/auth/login', { email: 'alice@example.test', password: 'AlicePass123' });
    clock.__advance(3 * 3600 * 1000);
    authService.sweepSessions();
    await admin.post('/api/auth/login', { email: 'admin@example.test', password: 'AdminPass123' });
    a = await aliceNow();
    assert.equal(a.presence, 'offline');
    assert.equal(a.offlineReason, 'session_expired');
    const hist = (await admin.get(`/api/admin/presence/${supUser.id}/sessions`)).json.data;
    assert.ok(hist.sessions.length >= 4);
    assert.ok(hist.events.some((e) => e.event === 'logout'));
    assert.ok(hist.events.some((e) => e.event === 'session_expired'));
    assert.equal(hist.events.filter((e) => e.event === 'connection_lost').length, 1, 'recorded exactly once');
    assert.ok(hist.events.some((e) => e.event === 'connection_restored'));

    // never-logged-in supervisor is reported as such
    const c = await admin.post('/api/admin/supervisors', { name: 'Carol', email: 'carol@example.test' });
    const carol = (await admin.get('/api/admin/presence')).json.data.find((p) => p.id === c.json.data.id);
    assert.equal(carol.presence, 'offline');
    assert.equal(carol.offlineReason, 'never_logged_in');
    assert.equal(carol.lastLoginAt, null);
    await sup.post('/api/auth/login', { email: 'alice@example.test', password: 'AlicePass123' });
    await sup2.post('/api/auth/login', { email: 'bob@example.test', password: 'BobPass12345' });
    await admin.post('/api/auth/login', { email: 'admin@example.test', password: 'AdminPass123' });
  });

  await t.test('(8) data persists across a process restart (db reopen) and admin APIs expose consistent totals', async () => {
    const before = (await admin.get('/api/admin/overview')).json.data;
    server.stopBackground(); // closes the database
    server.startBackground(); // reopens, runs recovery
    const after = (await admin.get('/api/admin/overview')).json.data;
    assert.equal(after.current.filesStored.total, before.current.filesStored.total);
    assert.equal(after.current.chunks, before.current.chunks);
    assert.equal(after.lifetime.uploadsStored, before.lifetime.uploadsStored);
  });

  await t.test('chat answers only from indexed content and surfaces provider errors with codes', async () => {
    const c = makeClient();
    const ok = await c.post('/api/chat/query', { question: 'Bulk document 100-5 unique value', minSimilarity: 0.1 });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.sources.length > 0);
    process.env.AI_PROVIDER = 'gemini';
    const prevKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'your_api_key_here';
    const err = await c.post('/api/chat/query', { question: 'anything at all' });
    process.env.AI_PROVIDER = 'mock';
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevKey;
    assert.equal(err.status, 502);
    assert.equal(err.json.code, 'AI_NOT_CONFIGURED');
  });

  await t.test('reconciliation reports orphan vault files and applies only with evidence', async () => {
    const orphanDir = path.join(dataDir, 'vault', 'Hadith');
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, 'orphan_file.txt'), 'orphan content from legacy storage');
    const dry = await admin.post('/api/admin/system/reconcile', { apply: false });
    assert.equal(dry.status, 200, dry.text);
    assert.ok(JSON.stringify(dry.json.data).includes('orphan_file.txt'));
    const health = await admin.get('/api/admin/system/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.data.ai.provider, 'mock');
    assert.equal(health.json.data.storage.writable, true);
  });
});
