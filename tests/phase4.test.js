// Phase 4 acceptance: dynamic API keys (admin UI API), real-time events (SSE),
// true end-to-end interoperability (waraqa upload -> admin -> bahth chat) and PWA assets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-phase4-'));
process.env.DATA_DIR = dataDir;
process.env.AI_PROVIDER = 'mock';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin4@example.test';
process.env.ADMIN_INITIAL_PASSWORD = 'AdminPass123';
process.env.ADMIN_NAME = 'Phase4 Admin';
process.env.LLM_API_KEY = 'gsk_ENVFALLBACKKEY000000000000000';
delete process.env.SETTINGS_ENCRYPTION_KEY;

const server = require('../src/server');
const settings = require('../src/services/settingsService');
const { get } = require('../src/db/database');

const PRIMARY = 'gsk_PRIMARYKEYPRIMARYKEY0000001111';
const FALLBACK1 = 'gsk_FALLBACKONEKEYFALLBACK00002222';
const BADKEY = 'gsk_INVALIDKEYFORMOCKPROVIDER3333';

let baseUrl;
let httpServer;

function makeClient() {
  let cookie = '';
  const api = async (method, url, body) => {
    const h = { 'X-Requested-With': 'XMLHttpRequest' };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
    }
    const res = await fetch(baseUrl + url, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* non-json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    get: (u) => api('GET', u),
    post: (u, b) => api('POST', u, b === undefined ? {} : b),
    put: (u, b) => api('PUT', u, b),
    del: (u) => api('DELETE', u),
    cookie: () => cookie,
  };
}

/** Opens an SSE stream with the client's cookie and collects parsed events. */
async function openEvents(client) {
  const ctrl = new AbortController();
  const res = await fetch(`${baseUrl}/api/events`, { headers: { Cookie: client.cookie() }, signal: ctrl.signal });
  const events = [];
  const waiters = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const type = (raw.match(/^event: (.+)$/m) || [])[1];
          const data = (raw.match(/^data: (.+)$/m) || [])[1];
          if (!type) continue;
          events.push({ type, data: data ? JSON.parse(data) : null });
          waiters.forEach((w) => w());
        }
      }
    } catch (_) { /* aborted */ }
  })();
  const waitFor = (pred, ms = 8000) => new Promise((resolve, reject) => {
    const check = () => {
      const hit = events.find(pred);
      if (hit) { clearTimeout(timer); resolve(hit); return true; }
      return false;
    };
    const timer = setTimeout(() => reject(new Error(`SSE event not received. Got: ${events.map((e) => e.type).join(', ')}`)), ms);
    if (!check()) waiters.push(check);
  });
  return { res, events, waitFor, close: () => ctrl.abort() };
}

async function waitUntil(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('phase 4: API key manager, live events, end-to-end interoperability, PWA', async (t) => {
  server.startBackground();
  httpServer = await new Promise((resolve) => { const s = server.createApp().listen(0, () => resolve(s)); });
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  const streams = [];
  t.after(async () => {
    streams.forEach((s) => s.close());
    if (httpServer.closeAllConnections) httpServer.closeAllConnections();
    await new Promise((r) => httpServer.close(r));
    server.stopBackground();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const admin = makeClient();
  const sup = makeClient();
  const sup2 = makeClient();
  const anon = makeClient();
  let category;

  await t.test('setup: admin, two supervisors, a category', async () => {
    assert.equal((await admin.post('/api/auth/login', { email: 'admin4@example.test', password: 'AdminPass123' })).status, 200);
    for (const [client, email] of [[sup, 'sup-a@example.test'], [sup2, 'sup-b@example.test']]) {
      const created = await admin.post('/api/admin/supervisors', { name: email, email });
      assert.equal(created.status, 201, created.text);
      assert.equal((await client.post(`/api/auth/invitations/${created.json.invitation.token}/accept`, { password: 'SupPass12345' })).status, 200);
      assert.equal((await client.post('/api/auth/login', { email, password: 'SupPass12345' })).status, 200);
    }
    category = (await admin.get('/api/categories')).json.data[0];
    assert.ok(category && category.id);
  });

  await t.test('encryption at rest: AES-256-GCM round trip, random IV, tamper detection', () => {
    const a = settings._encrypt(PRIMARY);
    const b = settings._encrypt(PRIMARY);
    assert.notEqual(a, b, 'random IV per value');
    assert.ok(!a.includes(PRIMARY));
    assert.equal(settings._decrypt(a), PRIMARY);
    const parts = a.split(':');
    parts[3] = Buffer.from('tampered-data').toString('base64');
    assert.throws(() => settings._decrypt(parts.join(':')));
    assert.ok(fs.existsSync(path.join(dataDir, '.settings.key')), 'master key generated on the data volume');
  });

  await t.test('settings endpoints are admin-only', async () => {
    for (const [m, u] of [['get', '/api/admin/settings/ai'], ['put', '/api/admin/settings/ai/keys'], ['del', '/api/admin/settings/ai/keys/primary'], ['post', '/api/admin/settings/ai/keys/primary/test']]) {
      const r = await sup[m](u, m === 'put' ? { primary: PRIMARY } : undefined);
      assert.equal(r.status, 403, `${m} ${u}`);
      assert.equal((await anon[m](u, m === 'put' ? { primary: PRIMARY } : undefined)).status, 401);
    }
  });

  await t.test('initial state: only the .env key, used as the last fallback', async () => {
    const r = await admin.get('/api/admin/settings/ai');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.keys.effectiveOrder, ['env']);
    assert.equal(r.json.data.keys.env.configured, true);
    assert.equal(r.json.data.keys.env.last4, '0000');
    assert.ok(r.json.data.keys.slots.every((s) => s.status === 'empty' && !s.configured));
    assert.ok(r.json.data.config.roles.embeddings.model);
    assert.ok(r.json.data.embedTag);
  });

  await t.test('validation errors use stable codes', async () => {
    const bad = await admin.put('/api/admin/settings/ai/keys', { primary: 'short' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'INVALID_API_KEY_FORMAT');
    const placeholder = await admin.put('/api/admin/settings/ai/keys', { primary: 'your_groq_api_key_here_please' });
    assert.equal(placeholder.json.code, 'INVALID_API_KEY_FORMAT');
    const none = await admin.put('/api/admin/settings/ai/keys', { primary: '   ' });
    assert.equal(none.json.code, 'NO_KEYS_PROVIDED');
    const slot = await admin.del('/api/admin/settings/ai/keys/nope');
    assert.equal(slot.json.code, 'INVALID_SLOT');
    const empty = await admin.post('/api/admin/settings/ai/keys/fallback2/test');
    assert.equal(empty.json.code, 'KEY_SLOT_EMPTY');
  });

  await t.test('saving keys: encrypted in DB, never returned, applied immediately (no restart), audited', async () => {
    const adminEvents = await openEvents(admin);
    streams.push(adminEvents);
    const r = await admin.put('/api/admin/settings/ai/keys', { primary: ` "${PRIMARY}" `, fallback1: FALLBACK1 });
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes(PRIMARY) && !r.text.includes(FALLBACK1), 'plain keys never leave the server');
    const k = r.json.data.keys;
    assert.deepEqual(k.effectiveOrder, ['db:primary', 'db:fallback1', 'env']);
    assert.equal(k.slots[0].last4, PRIMARY.slice(-4));
    assert.equal(k.slots[0].status, 'untested');

    const row = get("SELECT value_enc FROM system_settings WHERE key = 'ai.cloud.key.primary'");
    assert.ok(row.value_enc.startsWith('v1:'));
    assert.ok(!row.value_enc.includes(PRIMARY));

    // The live chain used by the AI client reflects the change at once.
    assert.deepEqual(settings.getCloudKeyChain().map((c) => c.key), [PRIMARY, FALLBACK1, process.env.LLM_API_KEY]);

    await adminEvents.waitFor((e) => e.type === 'settings.changed');

    const get2 = await admin.get('/api/admin/settings/ai');
    assert.ok(!get2.text.includes(PRIMARY));

    const act = await admin.get('/api/admin/activity?action=settings.api_key_updated');
    assert.equal(act.status, 200);
    const items = act.json.data.items;
    assert.equal(items.length, 2);
    assert.ok(!act.text.includes(PRIMARY) && !act.text.includes(FALLBACK1), 'audit log stores last 4 only');
  });

  await t.test('per-slot test pins one key and records health', async () => {
    const ok = await admin.post('/api/admin/settings/ai/keys/primary/test');
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.data.result.status, 'ok');
    assert.equal(ok.json.data.keys.slots[0].status, 'ok');
    assert.ok(ok.json.data.keys.slots[0].lastCheckedAt);

    assert.equal((await admin.put('/api/admin/settings/ai/keys', { fallback2: BADKEY })).status, 200);
    const bad = await admin.post('/api/admin/settings/ai/keys/fallback2/test');
    assert.equal(bad.json.data.result.status, 'error');
    assert.equal(bad.json.data.result.error.code, 'AI_KEY_INVALID');
    assert.equal(bad.json.data.keys.slots[2].status, 'invalid');

    const env = await admin.post('/api/admin/settings/ai/keys/env/test');
    assert.equal(env.json.data.keys.env.status, 'ok');
  });

  await t.test('removing a key falls through to the next one', async () => {
    const r = await admin.del('/api/admin/settings/ai/keys/fallback2');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.keys.effectiveOrder, ['db:primary', 'db:fallback1', 'env']);
    const r2 = await admin.del('/api/admin/settings/ai/keys/primary');
    assert.deepEqual(r2.json.data.keys.effectiveOrder, ['db:fallback1', 'env']);
    const cleared = await admin.get('/api/admin/activity?action=settings.api_key_cleared');
    assert.equal(cleared.json.data.items.length, 2);
  });

  await t.test('waraqa upload -> live events -> admin dashboard -> bahth chat answers from that document', async () => {
    const supEvents = await openEvents(sup);
    const sup2Events = await openEvents(sup2);
    const adminEvents = await openEvents(admin);
    streams.push(supEvents, sup2Events, adminEvents);
    assert.equal(supEvents.res.headers.get('content-type').split(';')[0], 'text/event-stream');
    assert.equal(supEvents.res.headers.get('x-accel-buffering'), 'no');

    const before = (await admin.get('/api/admin/analytics')).json.data;

    const unique = 'Zanzibarian quokka cartography handbook';
    const up = await sup.post('/api/ingestion/raw-text', {
      title: 'Phase4 Interop Book',
      textContent: `${unique}. The ${unique} explains how quokka cartographers chart the islands of Zanzibar with brass sextants.`,
      categoryId: category.id,
    });
    assert.equal(up.status, 201, up.text);
    const docId = up.json.data.id;

    // Real-time: the owner and the admin see the full lifecycle; another supervisor sees nothing.
    await supEvents.waitFor((e) => e.type === 'document.uploaded' && e.data.documentId === docId);
    const done = await adminEvents.waitFor((e) => e.type === 'document.completed' && e.data.documentId === docId);
    assert.ok(done.data.chunks >= 1);
    await supEvents.waitFor((e) => e.type === 'document.completed' && e.data.documentId === docId);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!sup2Events.events.some((e) => e.data && e.data.documentId === docId), 'supervisors only receive their own documents');

    // Admin dashboard reflects it immediately.
    const docs = await admin.get(`/api/admin/documents?q=${encodeURIComponent('Phase4 Interop Book')}`);
    const row = docs.json.data.items.find((d) => d.id === docId);
    assert.equal(row.pipelineStatus, 'completed');
    const after = (await admin.get('/api/admin/analytics')).json.data;
    assert.equal(after.totalBooks, before.totalBooks + 1);

    // Public chat (anonymous, bahth) retrieves and cites that exact document.
    const chat = await anon.post('/api/chat/query', { question: `What does the ${unique} explain about quokka cartographers?` });
    assert.equal(chat.status, 200, chat.text);
    assert.ok(chat.json.sources.length >= 1, 'answer is grounded in at least one source');
    assert.equal(chat.json.sources[0].documentId, docId);
    assert.equal(chat.json.sources[0].bookTitle, 'Phase4 Interop Book');
    assert.ok(chat.json.answer.includes('Phase4 Interop Book'));

    // Deleting removes it from the chat at once (cache invalidated).
    assert.equal((await sup.del(`/api/documents/${docId}`)).status, 200);
    await adminEvents.waitFor((e) => e.type === 'document.deleted' && e.data.documentId === docId);
    const gone = await anon.post('/api/chat/query', { question: `What does the ${unique} explain about quokka cartographers?` });
    assert.ok(!gone.json.sources.some((s) => s.documentId === docId));
  });

  await t.test('admin end-to-end self-test passes every stage and cleans up', async () => {
    const lifeBefore = (await admin.get('/api/admin/overview')).json.data.lifetime;
    const r = await admin.post('/api/admin/system/e2e-test', { timeoutMs: 20000 });
    assert.equal(r.status, 200, r.text);
    const res = r.json.data;
    assert.ok(/^MSRQ-[0-9A-F]{8}$/.test(res.token));
    const stages = Object.fromEntries(res.stages.map((s) => [s.stage, s]));
    for (const s of ['upload', 'processing', 'admin_visibility', 'chat_retrieval', 'chat_answer', 'cleanup']) {
      assert.ok(stages[s], `stage ${s} present`);
      assert.equal(stages[s].ok, true, `${s}: ${JSON.stringify(stages[s].detail)}`);
    }
    assert.equal(res.ok, true);
    assert.equal(stages.chat_retrieval.detail.topIsProbe, true);
    const leftover = get('SELECT COUNT(*) AS n FROM documents WHERE title LIKE ?', `%${res.token}%`);
    assert.equal(leftover.n, 0, 'probe document removed');
    const lifeAfter = (await admin.get('/api/admin/overview')).json.data.lifetime;
    assert.deepEqual(lifeAfter, lifeBefore, 'self-test probes do not inflate lifetime counters');
    assert.deepEqual(res.stages.map((s) => s.stage), ['upload', 'processing', 'admin_visibility', 'chat_retrieval', 'chat_answer', 'cleanup']);
    const act = await admin.get('/api/admin/activity?action=system.e2e_test');
    assert.equal(act.json.data.items.length, 1);
    assert.equal((await sup.post('/api/admin/system/e2e-test')).status, 403);
  });

  await t.test('PWA assets are served for waraqa and bahth', async () => {
    for (const tier of ['supervisor', 'chat']) {
      const prefix = tier === 'chat' ? '' : `/${tier}`;
      const m = await fetch(`${baseUrl}${prefix}/manifest.webmanifest`);
      assert.equal(m.status, 200, `${tier} manifest`);
      assert.match(m.headers.get('content-type'), /application\/manifest\+json/);
      const manifest = await m.json();
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.start_url, './');
      assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
      for (const icon of manifest.icons) {
        const ir = await fetch(`${baseUrl}${prefix}/${icon.src}`);
        assert.equal(ir.status, 200, icon.src);
        assert.equal(ir.headers.get('content-type'), 'image/png');
      }
      const sw = await fetch(`${baseUrl}${prefix}/service-worker.js`);
      assert.equal(sw.status, 200);
      assert.match(await sw.text(), /importScripts\('\/js\/sw-core\.js'\)/);
      const html = await (await fetch(`${baseUrl}${prefix}/`)).text();
      assert.ok(html.includes('rel="manifest"') && html.includes('/js/pwa.js') && html.includes('name="theme-color"'), `${tier} index wires the PWA`);
      assert.equal((await fetch(`${baseUrl}${prefix}/offline.html`)).status, 200);
    }
    const core = await (await fetch(`${baseUrl}/js/sw-core.js`)).text();
    assert.ok(core.includes("url.pathname.startsWith('/api/')"), 'service worker never caches the API');
  });
});
