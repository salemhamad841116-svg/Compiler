// Phase 5 acceptance: open-source AI through OpenAI-compatible endpoints (Groq/Together/Ollama/vLLM).
// A fake OpenAI-compatible server runs inside the test, so every real code path (HTTP payloads,
// key rotation, routing per role, error classification, embed_model filtering, index rebuild) is
// exercised without network access or real keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { PNG_1X1 } = require('./helpers/fixtures');

// ------------------------------------------------------------------ fake OpenAI-compatible server
const fake = { requests: [], failEmbedModel: null, visionMode: 'ok' };
const DIM = 64;
function vec(text) {
  const v = new Array(DIM).fill(0);
  const words = String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const w of words) v[crypto.createHash('md5').update(w).digest().readUInt16BE(0) % DIM] += 1;
  if (!words.length) v[0] = 1;
  return v;
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
const fakeServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const auth = req.headers.authorization || '';
    const scope = req.url.startsWith('/local/') ? 'local' : 'cloud';
    const route = req.url.replace(/^\/(cloud|local)\/v1/, '');
    const isJson = (req.headers['content-type'] || '').includes('application/json');
    const body = isJson && raw.length ? JSON.parse(raw.toString('utf8')) : null;
    fake.requests.push({ scope, route, method: req.method, auth, body, raw: isJson ? null : raw.toString('latin1'), contentType: req.headers['content-type'] || '' });
    if (scope === 'cloud') {
      if (/RATELIMIT/.test(auth)) return send(res, 429, { error: { message: 'Rate limit reached for model', type: 'tokens', code: 'rate_limit_exceeded' } }, { 'Retry-After': '0' });
      if (/BADKEY/.test(auth) || !auth) return send(res, 401, { error: { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' } });
    }
    if (route === '/models' && req.method === 'GET') {
      return send(res, 200, { object: 'list', data: ['fake-chat', 'fake-vision', 'fake-embed', 'fake-embed-v2', 'whisper-fake'].map((id) => ({ id, object: 'model' })) });
    }
    if (route === '/chat/completions') {
      const model = body.model;
      if (/missing/.test(model)) return send(res, 404, { error: { message: `The model \`${model}\` does not exist or you do not have access to it.`, code: 'model_not_found' } });
      const content = body.messages[body.messages.length - 1].content;
      if (Array.isArray(content)) {
        if (fake.visionMode === 'error') return send(res, 500, { error: { message: 'upstream vision failure' } });
        if (fake.visionMode === 'empty') return send(res, 200, { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] });
        return send(res, 200, { choices: [{ message: { role: 'assistant', content: '```\nVision transcript: the walrus lighthouse ledger of Tangier\n```' }, finish_reason: 'stop' }] });
      }
      const sys = body.messages.find((m) => m.role === 'system');
      const excerpt = String(content).slice(0, 4000);
      return send(res, 200, { choices: [{ message: { role: 'assistant', content: `<think>internal reasoning</think>Grounded answer (${sys ? 'with system prompt' : 'no system'}): ${excerpt.slice(0, 300)}` }, finish_reason: 'stop' }] });
    }
    if (route === '/embeddings') {
      if (fake.failEmbedModel && body.model === fake.failEmbedModel) return send(res, 404, { error: { message: `model "${body.model}" not found, try pulling it first` } });
      const data = body.input.map((t, index) => ({ object: 'embedding', index, embedding: vec(t) }));
      return send(res, 200, { object: 'list', model: body.model, data: data.reverse() }); // out of order on purpose
    }
    if (route === '/audio/transcriptions') {
      return send(res, 200, { text: ' spoken words about the walrus lighthouse ' });
    }
    return send(res, 404, { error: { message: `no route ${req.method} ${route}` } });
  });
});

// ------------------------------------------------------------------ isolated app environment
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-phase5-'));
let fakeBase;
let baseUrl;
let httpServer;

function makeClient() {
  let cookie = '';
  const api = async (method, url, body) => {
    const h = { 'X-Requested-With': 'XMLHttpRequest' };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(baseUrl + url, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* non-json */ }
    return { status: res.status, json, text };
  };
  return {
    get: (u) => api('GET', u),
    post: (u, b) => api('POST', u, b === undefined ? {} : b),
    put: (u, b) => api('PUT', u, b),
    del: (u) => api('DELETE', u),
    form: (u, fd) => api('POST', u, fd),
  };
}

test('phase 5: open-source AI client, routing, OCR chain, embed_model filtering and index rebuild', async (t) => {
  await new Promise((r) => fakeServer.listen(0, '127.0.0.1', r));
  fakeBase = `http://127.0.0.1:${fakeServer.address().port}`;
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    AI_PROVIDER: 'openai',
    NODE_ENV: 'test',
    ADMIN_EMAIL: 'admin5@example.test',
    ADMIN_INITIAL_PASSWORD: 'AdminPass123',
    ADMIN_NAME: 'Phase5 Admin',
    CLOUD_AI_PRESET: 'custom',
    CLOUD_AI_BASE_URL: `${fakeBase}/cloud/v1`,
    LOCAL_AI_BASE_URL: `${fakeBase}/local/v1`,
    CHAT_TARGET: 'cloud', CHAT_MODEL: 'fake-chat',
    VISION_TARGET: 'cloud', VISION_MODEL: 'fake-vision',
    EMBED_TARGET: 'local', EMBED_MODEL: 'fake-embed',
    TRANSCRIBE_TARGET: 'cloud', TRANSCRIBE_MODEL: 'whisper-fake',
    LLM_API_KEY: 'gsk_ENVKEYENVKEYENVKEY000000000009',
    AI_RATE_LIMIT_RETRIES: '0',
  });
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  delete process.env.RAG_SIMILARITY_THRESHOLD;

  const server = require('../src/server');
  const settings = require('../src/services/settingsService');
  const client = require('../src/services/ai/openaiCompatClient');
  const { provider, classifyError } = require('../src/services/aiProvider');
  const jobQueue = require('../src/services/jobQueue');
  const db = require('../src/db/database');

  server.startBackground();
  httpServer = await new Promise((resolve) => { const s = server.createApp().listen(0, () => resolve(s)); });
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  t.after(async () => {
    if (httpServer.closeAllConnections) httpServer.closeAllConnections();
    await new Promise((r) => httpServer.close(r));
    server.stopBackground();
    fakeServer.closeAllConnections && fakeServer.closeAllConnections();
    await new Promise((r) => fakeServer.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const admin = makeClient();
  const sup = makeClient();
  const anon = makeClient();
  let category;

  await t.test('setup: admin, supervisor, category', async () => {
    assert.equal((await admin.post('/api/auth/login', { email: 'admin5@example.test', password: 'AdminPass123' })).status, 200);
    const created = await admin.post('/api/admin/supervisors', { name: 'sup5', email: 'sup5@example.test' });
    assert.equal(created.status, 201, created.text);
    assert.equal((await sup.post(`/api/auth/invitations/${created.json.invitation.token}/accept`, { password: 'SupPass12345' })).status, 200);
    assert.equal((await sup.post('/api/auth/login', { email: 'sup5@example.test', password: 'SupPass12345' })).status, 200);
    category = (await admin.get('/api/categories')).json.data[0];
    assert.ok(category);
  });

  await t.test('client: chat strips reasoning, embeddings keep input order, vision and Whisper payload formats', async () => {
    fake.requests.length = 0;
    const text = await client.chat({ target: 'cloud', model: 'fake-chat', messages: [{ role: 'user', content: 'hello' }] });
    assert.ok(!text.includes('<think>') && text.startsWith('Grounded answer'));
    const chatReq = fake.requests.find((r) => r.route === '/chat/completions');
    assert.equal(chatReq.auth, `Bearer ${process.env.LLM_API_KEY}`);
    assert.equal(chatReq.body.stream, false);

    const vectors = await client.embed(['alpha one', 'beta two', 'gamma three'], { target: 'local', model: 'fake-embed' });
    assert.deepEqual(vectors, [vec('alpha one'), vec('beta two'), vec('gamma three')], 'sorted by index despite out-of-order response');
    const embReq = fake.requests.find((r) => r.route === '/embeddings');
    assert.equal(embReq.scope, 'local');
    assert.deepEqual(embReq.body.input, ['alpha one', 'beta two', 'gamma three'], 'one batched request');
    assert.equal(embReq.auth, '', 'no cloud key is sent to the local endpoint');

    const vis = await client.vision({ target: 'cloud', model: 'fake-vision', image: PNG_1X1, mime: 'image/png', prompt: 'read it' });
    assert.ok(vis.includes('walrus lighthouse'));
    const visReq = fake.requests.filter((r) => r.route === '/chat/completions').pop();
    const parts = visReq.body.messages[0].content;
    assert.equal(parts[0].type, 'text');
    assert.equal(parts[1].type, 'image_url');
    assert.equal(parts[1].image_url.url, `data:image/png;base64,${PNG_1X1.toString('base64')}`);

    const tr = await client.transcribe(Buffer.from('fake-audio'), { target: 'cloud', model: 'whisper-fake', filename: 'a.mp3' });
    assert.equal(tr, 'spoken words about the walrus lighthouse');
    const trReq = fake.requests.find((r) => r.route === '/audio/transcriptions');
    assert.match(trReq.contentType, /^multipart\/form-data; boundary=/);
    assert.ok(trReq.raw.includes('name="model"') && trReq.raw.includes('whisper-fake') && trReq.raw.includes('filename="a.mp3"'));

    assert.deepEqual(await client.listModels('cloud'), ['fake-chat', 'fake-embed', 'fake-embed-v2', 'fake-vision', 'whisper-fake']);
  });

  await t.test('key rotation: 429 and 401 rotate to the next key; 404 does not rotate', async () => {
    client._resetCooldowns();
    const put = await admin.put('/api/admin/settings/ai/keys', { primary: 'gsk_RATELIMITKEY0000000000000001', fallback1: 'gsk_BADKEYBADKEYBADKEY00000000002' });
    assert.equal(put.status, 200, put.text);
    assert.deepEqual(put.json.data.keys.effectiveOrder, ['db:primary', 'db:fallback1', 'env']);
    fake.requests.length = 0;
    const out = await client.chat({ target: 'cloud', model: 'fake-chat', messages: [{ role: 'user', content: 'rotate' }] });
    assert.ok(out.startsWith('Grounded answer'));
    assert.deepEqual(fake.requests.map((r) => r.auth.slice(-4)), ['0001', '0002', '0009'], 'primary (429) -> fallback1 (401) -> env key');
    const keys = settings.describeKeys();
    assert.equal(keys.slots[0].status, 'rate_limited');
    assert.equal(keys.slots[1].status, 'invalid');

    fake.requests.length = 0;
    await assert.rejects(client.chat({ target: 'cloud', model: 'missing-model', messages: [{ role: 'user', content: 'x' }] }), (e) => {
      assert.equal(classifyError(e).code, 'AI_MODEL_UNAVAILABLE');
      return true;
    });
    assert.equal(fake.requests.length, 1, 'a missing model is not a key problem');
    assert.equal((await admin.del('/api/admin/settings/ai/keys/primary')).status, 200);
    assert.equal((await admin.del('/api/admin/settings/ai/keys/fallback1')).status, 200);
    client._resetCooldowns();
  });

  await t.test('error classification maps OpenAI-style failures to stable AI_* codes', () => {
    const E = (status, msg) => new client.AiHttpError(status, msg, { op: 'x' });
    assert.equal(classifyError(E(401, 'bad')).code, 'AI_KEY_INVALID');
    assert.equal(classifyError(E(403, 'forbidden')).code, 'AI_KEY_INVALID');
    assert.equal(classifyError(E(404, 'nope')).code, 'AI_MODEL_UNAVAILABLE');
    assert.equal(classifyError(E(400, 'The model `x` has been decommissioned')).code, 'AI_MODEL_UNAVAILABLE');
    assert.equal(classifyError(E(400, 'image input is not supported by this model')).code, 'AI_MODEL_UNSUPPORTED');
    assert.equal(classifyError(E(413, 'too big')).code, 'AI_PAYLOAD_TOO_LARGE');
    const rl = classifyError(E(429, 'slow down'));
    assert.equal(rl.code, 'AI_RATE_LIMIT');
    assert.equal(rl.retryable, true);
    assert.equal(classifyError(E(503, 'overloaded')).code, 'AI_PROVIDER_ERROR');
    assert.equal(classifyError(new Error('AI network error [embed x @ h]: fetch failed (ECONNREFUSED)')).code, 'AI_NETWORK');
    assert.equal(classifyError(new client.AiNotConfiguredError('none')).code, 'AI_NOT_CONFIGURED');
  });

  await t.test('admin AI settings API: routing config, validation, model listing, per-role tests', async () => {
    const g = await admin.get('/api/admin/settings/ai');
    assert.equal(g.status, 200, g.text);
    const d = g.json.data;
    assert.equal(d.provider, 'openai');
    assert.equal(d.config.cloud.preset, 'custom');
    assert.equal(d.config.roles.embeddings.target, 'local');
    assert.equal(d.embedTag, 'fake-embed');
    assert.ok(d.presets.cloud.groq && d.presets.cloud.together && d.presets.roleTargets.vision.includes('tesseract'));
    assert.ok(d.tools.tesseract && typeof d.tools.tesseract.available === 'boolean');
    assert.ok(d.index && d.index.activeModel === 'fake-embed');
    assert.ok(!g.text.includes(process.env.LLM_API_KEY), 'keys never leave the server');

    const bad = await admin.put('/api/admin/settings/ai/config', { roles: { embeddings: { target: 'tesseract' } } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'INVALID_AI_CONFIG');
    const badUrl = await admin.put('/api/admin/settings/ai/config', { local: { baseUrl: 'ftp://nope' } });
    assert.equal(badUrl.json.code, 'INVALID_AI_CONFIG');
    const badTh = await admin.put('/api/admin/settings/ai/config', { similarityThreshold: 2 });
    assert.equal(badTh.json.code, 'INVALID_AI_CONFIG');
    assert.equal((await sup.put('/api/admin/settings/ai/config', { pdfOcr: 'always' })).status, 403);

    const ok = await admin.put('/api/admin/settings/ai/config', { similarityThreshold: 0.2, pdfOcr: 'auto' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.data.embeddingChanged, false);
    assert.equal(ok.json.data.config.similarityThreshold, 0.2);
    const audit = await admin.get('/api/admin/activity?action=settings.ai_config_updated');
    assert.equal(audit.json.data.items.length, 1);

    const models = await admin.get('/api/admin/settings/ai/models?target=local');
    assert.equal(models.status, 200, models.text);
    assert.ok(models.json.data.models.includes('fake-embed'));
    assert.equal((await admin.get('/api/admin/settings/ai/models?target=mars')).json.code, 'INVALID_TARGET');

    for (const role of ['chat', 'embeddings', 'vision', 'transcription']) {
      const r = await admin.post(`/api/admin/settings/ai/roles/${role}/test`);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.data.result.status, 'ok', `${role}: ${JSON.stringify(r.json.data.result)}`);
    }
    assert.equal((await admin.post('/api/admin/settings/ai/roles/embeddings/test')).json.data.result.dimensions, DIM);
    assert.equal((await admin.post('/api/admin/settings/ai/roles/teleport/test')).json.code, 'INVALID_ROLE');

    const keyTest = await admin.post('/api/admin/settings/ai/keys/env/test');
    assert.equal(keyTest.json.data.result.status, 'ok');
    assert.deepEqual(keyTest.json.data.result.missingModels, []);
  });

  await t.test('Google AI Studio support: auto-switch on AIzaSy key, Gemini routing presets', async () => {
    const g = await admin.get('/api/admin/settings/ai');
    assert.ok(g.json.data.presets.cloud.google);
    assert.equal(g.json.data.presets.cloud.google.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
    assert.deepEqual(g.json.data.presets.cloud.google.suggestedModels.chat, ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']);

    const ep = await client.withEndpoint('cloud', async (endpoint) => endpoint, { key: 'AIzaSyTestGoogleKey1234567890abcdef' });
    assert.equal(ep.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
    assert.equal(ep.key, 'AIzaSyTestGoogleKey1234567890abcdef');

    try {
      const saveKey = await admin.put('/api/admin/settings/ai/keys', { primary: 'AIzaSyFakeGoogleApiKey1234567890abcdef' });
      assert.equal(saveKey.status, 200);
      const cfg = saveKey.json.data.config;
      assert.equal(cfg.cloud.preset, 'google');
      assert.equal(cfg.cloud.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
      assert.equal(cfg.roles.chat.model, 'gemini-1.5-flash');
      assert.equal(cfg.roles.vision.model, 'gemini-1.5-flash');
    } finally {
      await admin.del('/api/admin/settings/ai/keys/primary');
      await admin.put('/api/admin/settings/ai/config', {
        cloud: { preset: 'custom', baseUrl: `${fakeBase}/cloud/v1` },
        roles: { chat: { model: 'fake-chat' }, vision: { model: 'fake-vision' } },
      });
      client._resetCooldowns();
    }
  });

  let textDocId;
  await t.test('pipeline: text is embedded locally, tagged with embed_model, and bahth answers through the chat model', async () => {
    const unique = 'Zellige astrolabe guild of Fez';
    const up = await sup.post('/api/ingestion/raw-text', {
      title: 'Phase5 Text Book',
      textContent: `${unique}. The ${unique} restored brass astrolabes for the Qarawiyyin library in the year 1350.`,
      categoryId: category.id,
    });
    assert.equal(up.status, 201, up.text);
    textDocId = up.json.data.id;
    await jobQueue.waitForIdle();
    const doc = (await sup.get(`/api/documents/${textDocId}`)).json.data;
    assert.equal(doc.pipelineStatus, 'completed', JSON.stringify(doc));
    const tags = db.all('SELECT DISTINCT embed_model FROM chunks WHERE document_id = ?', textDocId).map((r) => r.embed_model);
    assert.deepEqual(tags, ['fake-embed']);

    fake.requests.length = 0;
    const chat = await anon.post('/api/chat/query', { question: `What did the ${unique} restore?` });
    assert.equal(chat.status, 200, chat.text);
    assert.equal(chat.json.sources[0].documentId, textDocId);
    assert.ok(chat.json.answer.startsWith('Grounded answer (with system prompt)'));
    assert.ok(chat.json.answer.includes('Phase5 Text Book'), 'retrieved excerpt (with its book title) is sent to the model');
    const chatReq = fake.requests.find((r) => r.route === '/chat/completions');
    assert.equal(chatReq.body.model, 'fake-chat');
    assert.equal(chatReq.body.messages[0].role, 'system');
  });

  await t.test('image OCR goes through the vision model; failures fall back to Tesseract when installed', async () => {
    fake.visionMode = 'ok';
    const fd = new FormData();
    fd.append('bookFile', new Blob([Buffer.concat([PNG_1X1, Buffer.from('phase5-img')])], { type: 'image/png' }), 'scan_page.png');
    fd.append('categoryId', category.id);
    const up = await sup.form('/api/ingestion/upload-book', fd);
    assert.equal(up.status, 201, up.text);
    await jobQueue.waitForIdle();
    const doc = (await sup.get(`/api/documents/${up.json.data.id}`)).json.data;
    assert.equal(doc.pipelineStatus, 'completed', JSON.stringify(doc));
    const chunk = db.get('SELECT text FROM chunks WHERE document_id = ?', up.json.data.id);
    assert.ok(chunk.text.includes('walrus lighthouse ledger'), 'markdown fences stripped, transcript indexed');

    fake.visionMode = 'error';
    const ocr = require('../src/services/ai/ocrService');
    const tmp = path.join(dataDir, 'probe.png');
    fs.writeFileSync(tmp, PNG_1X1);
    const hasTesseract = await require('../src/services/ai/localTools').has('tesseract');
    if (hasTesseract) {
      // a blank 1x1 image gives Tesseract nothing to read: the primary (vision) error is reported
      await assert.rejects(ocr.ocrImage(tmp), (e) => classifyError(e).code === 'AI_PROVIDER_ERROR');
    } else {
      await assert.rejects(ocr.ocrImage(tmp), (e) => {
        assert.equal(classifyError(e).code, 'AI_PROVIDER_ERROR', 'vision error wins over a missing fallback tool');
        return true;
      });
    }
    fake.visionMode = 'empty';
    await assert.rejects(ocr.ocrImage(tmp), (e) => ['OCR_EMPTY', 'TOOL_MISSING'].includes(classifyError(e).code));
    fake.visionMode = 'ok';
  });

  await t.test('switching the embedding model makes old vectors stale; chat asks for a rebuild instead of mixing vectors', async () => {
    const r = await admin.put('/api/admin/settings/ai/config', { roles: { embeddings: { model: 'fake-embed-v2' } } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.data.embeddingChanged, true);
    assert.equal(r.json.data.index.activeModel, 'fake-embed-v2');
    assert.equal(r.json.data.index.chunksActive, 0);
    assert.ok(r.json.data.index.chunksStale >= 2);
    const overview = (await admin.get('/api/admin/overview')).json.data;
    assert.equal(overview.current.chunks, 0, 'searchable chunks only count the active model');
    const chat = await anon.post('/api/chat/query', { question: 'What did the Zellige astrolabe guild of Fez restore?' });
    assert.equal(chat.status, 503, chat.text);
    assert.equal(chat.json.code, 'INDEX_REBUILD_REQUIRED');
  });

  await t.test('rebuild: dry run changes nothing; failed pre-flight aborts before deleting; real run re-indexes', async () => {
    const chunksBefore = db.get('SELECT COUNT(*) AS n FROM chunks').n;
    const dry = await admin.post('/api/admin/index/rebuild', { mode: 'stale', dryRun: true });
    assert.equal(dry.status, 200, dry.text);
    assert.equal(dry.json.data.report.preflight.ok, true);
    assert.equal(dry.json.data.report.queued, 0);
    assert.ok(dry.json.data.report.chunksToPurge >= 2);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM chunks').n, chunksBefore);

    fake.failEmbedModel = 'fake-embed-v2';
    const aborted = await admin.post('/api/admin/index/rebuild', { mode: 'stale' });
    assert.equal(aborted.status, 502, aborted.text);
    assert.equal(aborted.json.code, 'AI_MODEL_UNAVAILABLE');
    assert.equal(db.get('SELECT COUNT(*) AS n FROM chunks').n, chunksBefore, 'nothing deleted');
    fake.failEmbedModel = null;

    assert.equal((await sup.post('/api/admin/index/rebuild', {})).status, 403);
    assert.equal((await admin.post('/api/admin/index/rebuild', { mode: 'everything' })).json.code, 'INVALID_REBUILD_MODE');

    const real = await admin.post('/api/admin/index/rebuild', { mode: 'stale' });
    assert.equal(real.status, 200, real.text);
    assert.ok(real.json.data.report.queued >= 2);
    assert.equal(real.json.data.report.chunksPurged, chunksBefore);
    await jobQueue.waitForIdle();
    const tags = db.all('SELECT embed_model, COUNT(*) AS n FROM chunks GROUP BY embed_model');
    assert.deepEqual(tags.map((x) => x.embed_model), ['fake-embed-v2']);
    const st = (await admin.get('/api/admin/index/status')).json.data;
    assert.equal(st.chunksStale, 0);
    assert.ok(st.lastRebuild && st.lastRebuild.mode === 'stale');
    const chat = await anon.post('/api/chat/query', { question: 'What did the Zellige astrolabe guild of Fez restore?' });
    assert.equal(chat.status, 200, chat.text);
    assert.equal(chat.json.sources[0].documentId, textDocId);
    assert.equal((await admin.get('/api/admin/activity?action=index.rebuild_started')).json.data.items.length, 1);
  });

  await t.test('scripts/reindex-all.js --dry-run reports against the shared database without changes', async () => {
    // async: the fake AI server lives in this process and must keep answering the script's pre-flight call
    const { stdout: out } = await promisify(execFile)(process.execPath, [path.join(__dirname, '..', 'scripts', 'reindex-all.js'), '--dry-run'], { env: { ...process.env }, encoding: 'utf8', timeout: 60000 });
    assert.match(out, /Active embedding model : fake-embed-v2/);
    assert.match(out, /Pre-flight embedding {3}: OK/);
    assert.match(out, /dry run - nothing will be changed/);
  });

  await t.test('legacy Gemini keys are purged once and audited; health reports the open-source stack', async () => {
    db.run("INSERT INTO system_settings (key, value_enc, is_secret, meta, updated_at) VALUES ('gemini.key.primary', 'v1:x', 1, NULL, '2026-01-01T00:00:00Z')");
    settings.purgeLegacyGeminiKeys();
    assert.equal(db.get("SELECT COUNT(*) AS n FROM system_settings WHERE key LIKE 'gemini.%'").n, 0);
    const act = await admin.get('/api/admin/activity?action=settings.legacy_keys_purged');
    assert.equal(act.json.data.items.length, 1);
    const h = await (await fetch(`${baseUrl}/health`)).json();
    assert.equal(h.aiProvider, 'openai');
    assert.equal(h.aiConfigured, true);
    const p = provider();
    assert.equal(p.name, 'openai');
    const health = await p.health({ check: true });
    assert.equal(health.status, 'ok', JSON.stringify(health));
    assert.equal(health.embeddingModel, 'fake-embed-v2');
  });
});
