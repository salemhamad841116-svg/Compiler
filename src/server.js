require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { getDb, closeDb, get } = require('./db/database');
const { requestContext, errorHandler, notFoundApi } = require('./auth/middleware');

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
      aiConfigured: config.aiProvider === 'mock' ? true : config.geminiKeyUsable,
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
  app.use('/api', notFoundApi);

  // Shared static assets
  const staticOpts = { index: false, fallthrough: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
  app.use('/locales', express.static(path.join(PUBLIC_DIR, 'locales'), staticOpts));
  app.use('/js', express.static(path.join(PUBLIC_DIR, 'js'), staticOpts));

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
    app.get(`/${name}`, (req, res) => res.redirect(301, `/${name}/`));
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
  const shutdown = () => {
    console.log('[Server] Shutting down...');
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
