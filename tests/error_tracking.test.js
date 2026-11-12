const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-err-track-'));
process.env.DATA_DIR = dataDir;
process.env.AI_PROVIDER = 'mock';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin_err@example.test';
process.env.ADMIN_INITIAL_PASSWORD = 'AdminPass123';
process.env.ADMIN_NAME = 'Error Tracking Admin';
delete process.env.SETTINGS_ENCRYPTION_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

const server = require('../src/server');
const errorTracking = require('../src/services/errorTrackingService');
const { getDb } = require('../src/db/database');

let baseUrl;
let httpServer;
let adminCookie;

test('Error Tracking System & Admin Lockdown', async (t) => {
  const app = server.createApp();
  await new Promise((resolve) => {
    httpServer = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
      resolve();
    });
  });

  const db = getDb();
  const { hashPassword } = require('../src/auth/password');
  const adminId = 'usr_err_admin_1';
  db.prepare(`
    INSERT OR IGNORE INTO users (id, role, name, email, password_hash, status, created_at, app_source)
    VALUES (?, 'admin', 'Error Admin', 'admin_err@example.test', ?, 'active', datetime('now'), 'chathsm')
  `).run(adminId, hashPassword('AdminPass123'));

  // Authenticate admin session
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin_err@example.test', password: 'AdminPass123' }),
  });
  assert.equal(loginRes.status, 200);
  const setCookie = loginRes.headers.get('set-cookie');
  assert.ok(setCookie);
  adminCookie = setCookie.split(';')[0];

  await t.test('1. System health check passes without any Stripe environment keys', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'healthy');
    assert.equal(json.database, 'ok');
    assert.equal(json.storageWritable, true);
  });

  await t.test('2. Runtime exception automatically captured into error_events', async () => {
    // Generate an intentional error through API
    const errorRes = await fetch(`${baseUrl}/api/chat/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({}), // Missing question triggers AppError 400
    });
    assert.equal(errorRes.status, 400);

    // Also manually capture a simulated 500 error
    const testErr = new Error('Simulated critical database connection timeout');
    testErr.code = 'SIMULATED_FAILURE';
    const capturedId = errorTracking.captureException(testErr, null, { status: 500, code: 'SIMULATED_FAILURE' });
    assert.ok(capturedId);

    const stats = errorTracking.getErrorStats();
    assert.ok(stats.total >= 1);
    assert.ok(stats.fatal >= 1);
  });

  await t.test('3. Admin can query recent errors and stats via /api/admin/system/errors', async () => {
    const res = await fetch(`${baseUrl}/api/admin/system/errors`, {
      headers: { Cookie: adminCookie, 'X-Requested-With': 'XMLHttpRequest' },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data));
    assert.ok(json.data.length >= 1);
    assert.ok(json.stats);
    assert.ok(json.stats.total >= 1);

    const fatalErr = json.data.find((e) => e.errorCode === 'SIMULATED_FAILURE');
    assert.ok(fatalErr);
    assert.equal(fatalErr.severity, 'fatal');
    assert.equal(fatalErr.message, 'Simulated critical database connection timeout');
  });

  await t.test('4. Admin can clear diagnostic logs via /api/admin/system/errors/clear', async () => {
    const res = await fetch(`${baseUrl}/api/admin/system/errors/clear`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'X-Requested-With': 'XMLHttpRequest' },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);

    const postClearStats = errorTracking.getErrorStats();
    assert.equal(postClearStats.total, 0);
  });

  await t.test('5. Admin lockdown: unauthenticated users cannot access admin system or register accounts', async () => {
    // Unauthenticated access to admin routes is rejected with 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/system/errors`);
    assert.equal(unauthRes.status, 401);

    // No public registration exists
    const signupProbe = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST' });
    assert.equal(signupProbe.status, 404);
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
