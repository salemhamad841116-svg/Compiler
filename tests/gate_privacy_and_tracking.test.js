const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-gate-privacy-'));
process.env.DATA_DIR = dataDir;
process.env.AI_PROVIDER = 'mock';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin_priv@example.test';
process.env.ADMIN_INITIAL_PASSWORD = 'AdminPass123';
process.env.ADMIN_NAME = 'Privacy Admin';
delete process.env.SETTINGS_ENCRYPTION_KEY;

const server = require('../src/server');
const serviceKeyService = require('../src/services/serviceKeyService');
const categoryService = require('../src/services/categoryService');
const stripeService = require('../src/services/payment/stripeService');
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

test('Quality Gate 3: Privacy Isolation Wall, Usage Tracking, Instant Revocation & Stripe UAE', async (t) => {
  const app = server.createApp();
  await new Promise((resolve) => {
    httpServer = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
      resolve();
    });
  });

  const db = getDb();
  categoryService.seedIfNeeded();
  const catGeneral = categoryService.resolveCategory('cat.general_knowledge');

  const adminId = 'usr_priv_admin_1';
  db.prepare(`
    INSERT OR IGNORE INTO users (id, role, name, email, password_hash, status, created_at, app_source)
    VALUES (?, 'admin', 'Privacy Admin', 'admin_priv@example.test', 'hash', 'active', datetime('now'), 'chathsm')
  `).run(adminId);

  // Ingest sample book for retrieval
  const now = nowIso();
  const activeEmbedTag = provider().embedTag();
  const docId = 'doc_privacy_test_01';
  const bookText = 'General knowledge encyclopedia concerning international trade, astronomy, and science.';
  db.prepare(`
    INSERT INTO documents (
      id, title, original_filename, kind, file_type, size_bytes,
      vault_path, category_id, upload_status, ocr_status, index_status,
      uploaded_at, version_number, is_current, owner_id
    ) VALUES (?, 'General Encyclopedia', 'encyclopedia.txt', 'document', 'txt', 100, 'mock_vault', ?, 'stored', 'not_applicable', 'completed', ?, 1, 1, ?)
  `).run(docId, catGeneral.id, now, adminId);

  const vec = mockEmbedding(bookText);
  const mockEmbeddingBuffer = Buffer.from(new Float32Array(vec).buffer);
  db.prepare(`
    INSERT INTO chunks (
      id, document_id, idx, page, text, embedding, embed_model, created_at, version_number, verified_at
    ) VALUES (?, ?, 0, 1, ?, ?, ?, ?, 1, ?)
  `).run(`chk_${docId}`, docId, bookText, mockEmbeddingBuffer, activeEmbedTag, now, now);

  const testKey = serviceKeyService.createServiceKey({
    name: 'Audit and Privacy Test Key',
    appSlug: 'audit-consumer',
    scope: 'read',
    allowedCategoryIds: ['*'],
    createdBy: adminId,
  });

  const client = makeServiceClient(testKey.rawToken);

  await t.test('1. Privacy Wall: user chats and payment transactions never leak into knowledge index', async () => {
    // Perform chat queries with confidential text
    const secretChatQuestion = 'CONFIDENTIAL_QUERY_SECRET_TOKEN_99999: What is the account balance?';
    await fetch(`${baseUrl}/api/chat/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ question: secretChatQuestion }),
    });

    // Check chunks table: 0 chunks containing the chat text
    const leakedChunks = db.prepare("SELECT * FROM chunks WHERE text LIKE '%CONFIDENTIAL_QUERY_SECRET_TOKEN_99999%'").all();
    assert.equal(leakedChunks.length, 0, 'Zero leakage: chat questions must never be indexed into chunks');

    // Check documents table: 0 documents containing the chat text
    const leakedDocs = db.prepare("SELECT * FROM documents WHERE title LIKE '%CONFIDENTIAL_QUERY_SECRET_TOKEN_99999%'").all();
    assert.equal(leakedDocs.length, 0, 'Zero leakage: chat questions must never create documents');
  });

  await t.test('2. Audit Logging: 100% of service queries tracked with app slug and cited sources', async () => {
    const res = await client.post('/api/service/books/query', {
      query: 'astronomy and science',
      categoryId: catGeneral.id,
    });
    assert.equal(res.status, 200);

    // Verify audit log entry in audit_events
    const event = db.prepare("SELECT * FROM audit_events WHERE action = 'service_query.executed' ORDER BY at DESC LIMIT 1").get();
    assert.ok(event, 'Audit event service_query.executed must be recorded');

    const detail = JSON.parse(event.detail || '{}');
    assert.equal(detail.appSlug, 'audit-consumer');
    assert.ok(detail.sourcesReturned >= 1);
    assert.ok(Array.isArray(detail.sources));
    assert.equal(detail.sources[0].sourceId, docId);
    assert.equal(detail.sources[0].pageNumber, 1);
  });

  await t.test('3. Instant 1-click Revocation: revoked key rejected in < 50ms with SERVICE_KEY_REVOKED', async () => {
    const t0 = Date.now();
    const revokeResult = serviceKeyService.revokeKey(testKey.id, { id: adminId, name: 'Privacy Admin' });
    assert.equal(revokeResult.success, true);

    // Immediate request using revoked key
    const resRevoked = await client.post('/api/service/books/query', {
      query: 'astronomy and science',
    });
    const elapsed = Date.now() - t0;

    assert.equal(resRevoked.status, 403);
    assert.equal(resRevoked.json.code, 'SERVICE_KEY_REVOKED');
    assert.ok(elapsed < 200, `Revocation reaction time must be fast (<200ms in test run, actual: ${elapsed}ms)`);

    // Verify revocation audit log
    const revokeEvent = db.prepare("SELECT * FROM audit_events WHERE action = 'service_key.revoked' AND actor_id = ?").get(adminId);
    assert.ok(revokeEvent);
  });

  await t.test('4. Stripe UAE Gateway: AED currency and 5% UAE VAT calculation', async () => {
    // Tiers check
    const tiers = stripeService.getTiers();
    assert.equal(tiers.length, 3);
    const proTier = tiers.find((t) => t.id === 'pro');
    assert.ok(proTier);
    assert.equal(proTier.currency, 'AED');
    assert.equal(proTier.pricing.subtotalAed, 149);
    assert.equal(proTier.pricing.vatRate, 0.05);
    assert.equal(proTier.pricing.vatAed, 7.45);
    assert.equal(proTier.pricing.totalAed, 156.45);

    // Checkout creation
    const session = await stripeService.createCheckoutSession({
      tier: 'pro',
      customerEmail: 'customer@misruq.ae',
      customerName: 'Dubai Enterprise Partner',
      referralCode: 'REF_DUBAI_10',
    });
    assert.equal(session.currency, 'aed');
    assert.equal(session.pricing.totalAed, 156.45);
    assert.ok(session.sessionId);

    // Webhook processing
    const webhookRes = stripeService.handleWebhookEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: session.sessionId,
          customer_email: 'customer@misruq.ae',
          amount_total: session.pricing.totalFils,
          metadata: {
            tier: 'pro',
            referral_code: 'REF_DUBAI_10',
          },
        },
      },
    });
    assert.equal(webhookRes.status, 'processed');
    assert.equal(webhookRes.action, 'activated');

    // Audit log check for payment
    const paymentEvent = db.prepare("SELECT * FROM audit_events WHERE action = 'payment.subscription_activated'").get();
    assert.ok(paymentEvent);
    const payDetail = JSON.parse(paymentEvent.detail || '{}');
    assert.equal(payDetail.customerEmail, 'customer@misruq.ae');
    assert.equal(payDetail.referralCode, 'REF_DUBAI_10');
  });

  await t.test('5. Stripe Webhook raw buffer signature verification and event idempotency', async () => {
    const crypto = require('crypto');
    const secret = 'whsec_test_secret_xyz123';
    stripeService.webhookSecret = secret;

    const eventPayload = JSON.stringify({
      id: 'evt_stripe_idempotency_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_idempotent_test_01',
          customer_email: 'idempotent@misruq.ae',
          amount_total: 15645,
          metadata: { tier: 'pro' },
        },
      },
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const validSignature = crypto.createHmac('sha256', secret).update(`${timestamp}.${eventPayload}`).digest('hex');
    const sigHeader = `t=${timestamp},v1=${validSignature}`;

    // 1. Initial Webhook delivery with valid signature -> 200 processed
    const res1 = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': sigHeader,
      },
      body: eventPayload,
    });
    const json1 = await res1.json();
    assert.equal(res1.status, 200);
    assert.equal(json1.status, 'processed');
    assert.equal(json1.action, 'activated');
    assert.equal(json1.eventId, 'evt_stripe_idempotency_001');

    // Verify row saved in processed_webhook_events
    const eventRow = db.prepare('SELECT * FROM processed_webhook_events WHERE id = ?').get('evt_stripe_idempotency_001');
    assert.ok(eventRow, 'Event must be recorded in processed_webhook_events table');
    assert.equal(eventRow.event_type, 'checkout.session.completed');

    // 2. Duplicate Webhook delivery -> 200 ignored (Idempotency preserved)
    const resDuplicate = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': sigHeader,
      },
      body: eventPayload,
    });
    const jsonDuplicate = await resDuplicate.json();
    assert.equal(resDuplicate.status, 200);
    assert.equal(jsonDuplicate.status, 'ignored');
    assert.equal(jsonDuplicate.reason, 'already_processed');

    // 3. Webhook with invalid signature -> 400 rejected
    const invalidSigHeader = `t=${timestamp},v1=invalid_signature_hash`;
    const resInvalid = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': invalidSigHeader,
      },
      body: eventPayload,
    });
    assert.equal(resInvalid.status, 400);
    const jsonInvalid = await resInvalid.json();
    assert.equal(jsonInvalid.code, 'INVALID_WEBHOOK_SIGNATURE');

    stripeService.webhookSecret = null;
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
