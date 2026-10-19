require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { getDb, closeDb, get } = require('./db/database');
const { requestContext, errorHandler, notFoundApi, requireAuth } = require('./auth/middleware');

const PUBLIC_DIR = path.join(__dirname, '../public');
const TIER_DIRS = {
  chat: path.join(PUBLIC_DIR, 'chat'),
  supervisor: path.join(PUBLIC_DIR, 'supervisor'),
  admin: path.join(PUBLIC_DIR, 'admin'),
};

/** Decides which front-end tier a request belongs to: by host name first, then by path prefix. */
function tierFor(req) {
  const host = (req.hostname || '').toLowerCase();
  if (host.startsWith('bahth.')) return 'chat';
  if (host.startsWith('waraqa.')) return 'supervisor';
  if (host.startsWith('logs.') || host.startsWith('admin.')) return 'admin';
  return null;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  const allowed = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Cookies are same-origin only. CORS is for the native app / explicit origins and never allows credentials wildcard.
  app.use(
    cors({
      origin: allowed.length ? allowed : true,
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    })
  );
  app.use(requestContext);
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Public health: no secrets, no business data.
  app.get('/health', (req, res) => {
    let database = 'ok';
    try {
      get('SELECT 1 AS ok');
    } catch (_) {
      database = 'error';
    }
    const storage = require('./services/storageService').health();
    const healthy = database === 'ok' && storage.writable;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      database,
      storageWritable: storage.writable,
      aiProvider: config.aiProvider,
      aiConfigured: (() => { try { return require('./services/aiProvider').provider().available(); } catch (_) { return false; } })(),
    });
  });

  // API
  app.use('/api/auth', require('./auth/authRoutes'));
  app.use('/api/ingestion', require('./routes/ingestionRoutes'));
  app.use('/api/chat', require('./routes/chatRoutes'));
  app.use('/api/admin', require('./routes/adminRoutes'));
  app.use('/api/categories', require('./routes/categoryRoutes'));
  const documentRoutes = require('./routes/documentRoutes');
  app.use('/api/documents', documentRoutes.docs);
  app.use('/api/me', documentRoutes.me);
  app.use('/api/locales', require('./routes/localeRoutes'));
  // Real-time document / settings events (Server-Sent Events). Same-origin cookie auth.
  app.get('/api/events', requireAuth(), require('./services/eventBus').sseHandler);
  app.use('/api', notFoundApi);

  // Shared static assets
  const staticOpts = { index: false, fallthrough: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
  app.use('/locales', express.static(path.join(PUBLIC_DIR, 'locales'), staticOpts));
  app.use('/js', express.static(path.join(PUBLIC_DIR, 'js'), staticOpts));
  app.use('/css', express.static(path.join(PUBLIC_DIR, 'css'), staticOpts));

  // Host-based tier dispatch happens BEFORE any static handler so that a tier's files are never
  // served on another tier's host (previous version served the chat page on every host's "/").
  const tierStatics = {};
  for (const [name, dir] of Object.entries(TIER_DIRS)) tierStatics[name] = express.static(dir, { ...staticOpts, index: 'index.html' });

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const hostTier = tierFor(req);
    if (hostTier) return tierStatics[hostTier](req, res, next);
    next();
  });

  // Path-based tiers for single-host deployments
  for (const name of ['chat', 'supervisor', 'admin']) {
    // Exact match only (Express routing is non-strict, so app.get('/admin') would also match '/admin/' and loop).
    app.use((req, res, next) => (req.path === `/${name}` && (req.method === 'GET' || req.method === 'HEAD') ? res.redirect(301, `/${name}/${req.url.slice(req.path.length)}`) : next()));
    app.use(`/${name}`, (req, res, next) => (tierFor(req) ? next() : tierStatics[name](req, res, next)));
  }
  // Default (no recognised host): chat interface at the site root
  app.use((req, res, next) => (tierFor(req) ? next() : tierStatics.chat(req, res, next)));

  // SPA fallback only for extension-less document navigations, never for missing assets
  app.get('*', (req, res, next) => {
    if (path.extname(req.path)) return next();
    const tier = tierFor(req) || ['supervisor', 'admin'].find((n) => req.path === `/${n}` || req.path.startsWith(`/${n}/`)) || 'chat';
    const file = path.join(TIER_DIRS[tier], 'index.html');
    if (!fs.existsSync(file)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(file);
  });

  app.use((req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  app.use(errorHandler);
  return app;
}

let background = [];

/** Prints the effective (non-secret) AI configuration once at startup so misconfiguration is visible in `docker logs`. */
function logAiConfiguration() {
  try {
    const envFile = path.join(__dirname, '../.env');
    console.log('[AI] ----------------------------------------------------------');
    console.log(`[AI] provider=${config.aiProvider} (open-source models)  .env file inside container: ${fs.existsSync(envFile) ? 'present' : 'absent (variables must come from docker env_file/environment)'}`);
    if (config.aiProvider === 'mock') {
      console.log('[AI] MOCK provider active (tests only) - no real OCR/embeddings.');
    } else {
      const settings = require('./services/settingsService');
      const client = require('./services/ai/openaiCompatClient');
      const cfg = settings.getAiConfig();
      const chain = settings.getCloudKeyChain();
      console.log(`[AI] cloud: ${cfg.cloud.preset} @ ${client.hostOf(cfg.cloud.baseUrl)}  keys: ${chain.length ? chain.map((k) => `${k.source}(${client.maskKey(k.key)})`).join(' -> ') : 'NONE'}`);
      console.log(`[AI] local: ${client.hostOf(cfg.local.baseUrl)}`);
      for (const [role, r] of Object.entries(cfg.roles)) {
        console.log(`[AI] ${role.padEnd(13)} -> ${r.target}${r.target === 'tesseract' || r.target === 'disabled' ? '' : `:${r.model}`}${role === 'vision' && r.tesseractFallback && r.target !== 'tesseract' ? ' (+ tesseract fallback)' : ''}`);
      }
      console.log(`[AI] embedding identity: ${settings.embedTagFor(cfg)}  similarity threshold: ${cfg.similarityThreshold}  pdf OCR: ${cfg.pdfOcr}`);
      if (process.env.GEMINI_API_KEY) console.warn('[AI] GEMINI_API_KEY is set but no longer used (Phase 5: open-source models). You can remove it from the env file.');
      if (!require('./services/aiProvider').provider().available()) {
        console.error('[AI] ERROR: a role is routed to the cloud provider but no API key is set. Add one in Admin > System Settings (applies immediately), or set LLM_API_KEY.');
      }
      require('./services/ai/localTools').toolStatus().then((t) => {
        console.log(`[AI] local tools: ${Object.entries(t).map(([k, v]) => `${k}=${v.available ? 'yes' : 'MISSING'}`).join(' ')}`);
      }).catch(() => {});
    }
    console.log('[AI] ----------------------------------------------------------');
  } catch (e) {
    console.error('[AI] Could not describe AI configuration:', e);
  }
}

function startBackground() {
  const authService = require('./auth/authService');
  const jobQueue = require('./services/jobQueue');
  const audit = require('./services/auditService');
  getDb();
  require('./services/storageService').ensureDirs();
  require('./services/categoryService').seedIfNeeded();
  try {
    require('./db/legacyImport').importLegacyData();
  } catch (e) {
    console.error('[Startup] Legacy data import failed (service continues):', e);
  }
  authService.bootstrapAdmin();
  logAiConfiguration();
  jobQueue.start();
  const t1 = setInterval(() => {
    try {
      authService.sweepSessions();
    } catch (e) {
      console.error('[Sessions] sweep failed:', e.message);
    }
  }, 30000);
  const t2 = setInterval(() => {
    try {
      audit.purgeExpiredAuditEvents(config.auditRetentionDays);
    } catch (e) {
      console.error('[Audit] retention purge failed:', e.message);
    }
  }, 6 * 3600000);
  t1.unref();
  t2.unref();
  background = [t1, t2];
}

function stopBackground() {
  require('./services/jobQueue').stop();
  background.forEach(clearInterval);
  background = [];
  closeDb();
}

const app = createApp();

if (require.main === module) {
  startBackground();
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    console.log('================================================================');
    console.log(`Multi-domain RAG and Data Vault server listening on port ${PORT}`);
    console.log(`  Chat:       http://localhost:${PORT}/        (bahth.*)`);
    console.log(`  Supervisor: http://localhost:${PORT}/supervisor/   (waraqa.*)`);
    console.log(`  Admin:      http://localhost:${PORT}/admin/        (logs.* / admin.*)`);
    console.log(`  Data dir:   ${config.dataDir}`);
    console.log('================================================================');
  });
  // 30-minute request timeout for massive 1GB historical book uploads
  server.requestTimeout = 30 * 60 * 1000;
  server.headersTimeout = 35 * 60 * 1000;
  server.keepAliveTimeout = 65000;
  const shutdown = () => {
    console.log('[Server] Shutting down...');
    // Long-lived SSE streams would otherwise hold server.close() open until the 10 s timeout.
    require('./services/eventBus').closeAll();
    server.close(() => {
      stopBackground();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.startBackground = startBackground;
module.exports.stopBackground = stopBackground;
