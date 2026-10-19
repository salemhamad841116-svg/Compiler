const express = require('express');
const { requireAuth, requireRole, asyncHandler } = require('../auth/middleware');
const authService = require('../auth/authService');
const audit = require('../services/auditService');
const presence = require('../services/presenceService');
const stats = require('../services/statsService');
const documents = require('../services/documentService');
const jobQueue = require('../services/jobQueue');
const storage = require('../services/storageService');
const reconcile = require('../services/reconcileService');
const { provider, classifyError } = require('../services/aiProvider');
const { searchVectorDatabase } = require('../models/vectorDbModel');
const { AppError } = require('../utils/errors');
const { nowIso } = require('../utils/clock');
const config = require('../config');
const settings = require('../services/settingsService');
const e2e = require('../services/e2eService');

const router = express.Router();
router.use(requireAuth(), requireRole('admin'));

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

function invitationPayload(inv) {
  return {
    path: `/?invite=${inv.token}`,
    token: inv.token,
    expiresAt: inv.expiresAt,
    purpose: inv.purpose,
    note: 'Share this one-time link with the supervisor through a secure channel. It is shown only once.',
  };
}

// ----------------------------------------------------------- overview / stats
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: {
        ...stats.overview({}),
        queue: jobQueue.queueStats(),
        users: {
          supervisors: authService.listUsers().filter((u) => u.role === 'supervisor').length,
        },
      },
    });
  })
);

router.get(
  '/stats/supervisors',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: stats.perSupervisor() });
  })
);

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: stats.ingestionAnalytics() });
  })
);

// ----------------------------------------------------------- accounts
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: authService.listUsers() });
  })
);

/** Supervisors with live presence and per-supervisor stats in a single, consistent payload. */
router.get(
  '/supervisors',
  asyncHandler(async (req, res) => {
    const pres = new Map(presence.computePresence().map((p) => [p.id, p]));
    const per = new Map(stats.perSupervisor().items.map((i) => [i.supervisor.id, i]));
    const items = authService
      .listUsers()
      .filter((u) => u.role === 'supervisor')
      .map((u) => ({ ...u, presence: pres.get(u.id) || null, stats: per.get(u.id) || null }));
    res.json({ success: true, count: items.length, data: items, unattributedDocuments: stats.perSupervisor().unattributedDocuments });
  })
);

router.post(
  '/supervisors',
  asyncHandler(async (req, res) => {
    const { name, email } = req.body || {};
    const { user, invitation } = authService.createUser({ name, email, role: 'supervisor' }, req.user);
    res.status(201).json({ success: true, data: user, invitation: invitationPayload(invitation) });
  })
);

router.patch(
  '/supervisors/:id',
  asyncHandler(async (req, res) => {
    const { name, status } = req.body || {};
    res.json({ success: true, data: authService.updateUser(req.params.id, { name, status }, req.user) });
  })
);

router.post(
  '/supervisors/:id/invitation',
  asyncHandler(async (req, res) => {
    res.json({ success: true, invitation: invitationPayload(authService.issueInvitationForUser(req.params.id, req.user)) });
  })
);

router.post(
  '/supervisors/:id/revoke-sessions',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: { revoked: authService.revokeUserSessions(req.params.id, req.user) } });
  })
);

// ----------------------------------------------------------- presence
router.get(
  '/presence',
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      generatedAt: nowIso(),
      policy: { heartbeatIntervalSeconds: config.heartbeatIntervalSec, offlineAfterSeconds: config.offlineAfterSec, awayAfterSeconds: config.awayAfterSec, displayTimeZone: config.displayTimeZone },
      data: presence.computePresence(),
    });
  })
);

router.get(
  '/presence/:id/sessions',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: { sessions: presence.listUserSessions(req.params.id), events: presence.listSessionEvents(req.params.id) } });
  })
);

// ----------------------------------------------------------- activity
router.get(
  '/activity',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: audit.listActivity(req.query, null) });
  })
);

router.get(
  '/activity.csv',
  asyncHandler(async (req, res) => {
    const rows = audit.exportActivityRows(req.query, null);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="activity-log.csv"');
    res.send(audit.activityToCsv(rows));
  })
);

// ----------------------------------------------------------- documents (admin-wide)
router.get(
  '/documents',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: documents.listDocuments(req.query, req.user) });
  })
);

router.post(
  '/documents/retry-failed',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: jobQueue.retryAllFailed(req.user, { ip: clientIp(req) }) });
  })
);

router.post(
  '/documents/:id/retry',
  asyncHandler(async (req, res) => {
    const force = req.body && req.body.force === true;
    res.json({ success: true, data: jobQueue.retryDocument(req.params.id, req.user, { force, ip: clientIp(req) }) });
  })
);

// ----------------------------------------------------------- system
router.get(
  '/system/health',
  asyncHandler(async (req, res) => {
    const check = req.query.check === '1';
    const ai = await provider().health({ check });
    res.json({
      success: true,
      data: { time: nowIso(), ai, storage: storage.health(), queue: jobQueue.queueStats(), lastReconciliation: reconcile.lastReport() },
    });
  })
);

router.get(
  '/system/reconcile',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: reconcile.lastReport() });
  })
);

router.post(
  '/system/reconcile',
  asyncHandler(async (req, res) => {
    const apply = Boolean(req.body && req.body.apply);
    res.json({ success: true, data: reconcile.runReconciliation({ apply, actor: req.user }) });
  })
);

router.post(
  '/search-test',
  asyncHandler(async (req, res) => {
    const { query, category, language, topK = 5, minSimilarity = 0.3 } = req.body || {};
    if (!query || !String(query).trim()) throw new AppError(400, 'QUERY_REQUIRED', 'Search query is required.');
    const filterOptions = {};
    if (category && category !== 'All') filterOptions.category = category;
    if (language && language !== 'All') filterOptions.language = language;
    try {
      const emb = await provider().embed(String(query).trim());
      const parsedMin = parseFloat(minSimilarity);
      const results = await searchVectorDatabase(emb, parseInt(topK, 10) || 5, Number.isFinite(parsedMin) ? parsedMin : 0.3, filterOptions);
      res.json({ success: true, query: String(query).trim(), matchesFound: results.length, data: results });
    } catch (e) {
      if (e instanceof AppError) throw e;
      const c = classifyError(e);
      throw new AppError(c.retryable ? 503 : 502, c.code, c.message);
    }
  })
);

// ----------------------------------------------------------- system settings: open-source AI (Phase 4 keys, Phase 5 routing)
// Keys are write-only: no endpoint ever returns a stored key, only masked status (last 4 chars).
async function aiSettingsPayload() {
  const { CLOUD_PRESETS, LOCAL_PRESET, ROLE_TARGETS } = require('../services/ai/presets');
  const cfg = settings.getAiConfig();
  return {
    provider: config.aiProvider,
    keys: settings.describeKeys(),
    config: cfg,
    embedTag: provider().embedTag(),
    presets: {
      cloud: Object.fromEntries(Object.entries(CLOUD_PRESETS).map(([k, v]) => [k, { baseUrl: v.baseUrl, models: v.models }])),
      local: { baseUrl: LOCAL_PRESET.baseUrl, models: LOCAL_PRESET.models },
      roleTargets: ROLE_TARGETS,
    },
    tools: await require('../services/ai/localTools').toolStatus(),
    localPulls: require('../services/ai/localModels').list(),
    index: require('../services/indexService').status(),
  };
}

router.get(
  '/settings/ai',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await aiSettingsPayload() });
  })
);

router.put(
  '/settings/ai/keys',
  asyncHandler(async (req, res) => {
    const { primary, fallback1, fallback2 } = req.body || {};
    settings.setCloudKeys({ primary, fallback1, fallback2 }, req.user, { ip: clientIp(req) });
    res.json({ success: true, data: await aiSettingsPayload() });
  })
);

router.delete(
  '/settings/ai/keys/:slot',
  asyncHandler(async (req, res) => {
    settings.clearCloudKey(req.params.slot, req.user, { ip: clientIp(req) });
    res.json({ success: true, data: await aiSettingsPayload() });
  })
);

router.post(
  '/settings/ai/keys/:slot/test',
  asyncHandler(async (req, res) => {
    const result = await provider().testKey(req.params.slot);
    res.json({ success: true, data: { result, ...(await aiSettingsPayload()) } });
  })
);

router.put(
  '/settings/ai/local-key',
  asyncHandler(async (req, res) => {
    settings.setLocalKey(req.body && req.body.key, req.user, { ip: clientIp(req) });
    res.json({ success: true, data: await aiSettingsPayload() });
  })
);

router.delete(
  '/settings/ai/local-key',
  asyncHandler(async (req, res) => {
    settings.clearLocalKey(req.user, { ip: clientIp(req) });
    res.json({ success: true, data: await aiSettingsPayload() });
  })
);

router.put(
  '/settings/ai/config',
  asyncHandler(async (req, res) => {
    const { embeddingChanged } = settings.updateAiConfig(req.body || {}, req.user, { ip: clientIp(req) });
    res.json({ success: true, data: { embeddingChanged, ...(await aiSettingsPayload()) } });
  })
);

router.get(
  '/settings/ai/models',
  asyncHandler(async (req, res) => {
    const target = req.query.target === 'local' ? 'local' : req.query.target === 'cloud' ? 'cloud' : null;
    if (!target) throw new AppError(400, 'INVALID_TARGET', 'target must be "cloud" or "local".');
    try {
      const models = config.aiProvider === 'mock' ? ['mock-chat', 'mock-embed'] : await require('../services/ai/openaiCompatClient').listModels(target);
      res.json({ success: true, data: { target, models } });
    } catch (e) {
      const c = classifyError(e);
      throw new AppError(c.retryable ? 503 : 502, c.code, c.message);
    }
  })
);

router.post(
  '/settings/ai/roles/:role/test',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: { result: await provider().testRole(req.params.role) } });
  })
);

router.post(
  '/settings/ai/local/pull',
  asyncHandler(async (req, res) => {
    const model = String((req.body && req.body.model) || '').trim();
    if (!model || !/^[\w.:/@+-]{1,200}$/.test(model)) throw new AppError(400, 'MODEL_REQUIRED', 'Enter a valid model name to download.');
    const cfg = settings.getAiConfig();
    const rec = require('../services/ai/localModels').startPull(model, { baseUrl: cfg.local.baseUrl, key: settings.getLocalKey() });
    audit.record({ action: 'settings.local_model_pull', actor: req.user, ip: clientIp(req), detail: { model } });
    res.status(202).json({ success: true, data: rec });
  })
);

// ----------------------------------------------------------- search index (Phase 5)
router.get(
  '/index/status',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: require('../services/indexService').status() });
  })
);

router.post(
  '/index/rebuild',
  asyncHandler(async (req, res) => {
    const { mode = 'stale', dryRun = false } = req.body || {};
    const report = await require('../services/indexService').rebuild({ mode, dryRun: dryRun === true, actor: req.user, ip: clientIp(req) });
    res.json({ success: true, data: { report, index: require('../services/indexService').status() } });
  })
);

// ----------------------------------------------------------- end-to-end self-test (Phase 4)
router.post(
  '/system/e2e-test',
  asyncHandler(async (req, res) => {
    const timeoutMs = Math.min(Math.max(parseInt((req.body && req.body.timeoutMs) || 180000, 10) || 180000, 5000), 600000);
    res.json({ success: true, data: await e2e.runSelfTest(req.user, { ip: clientIp(req), timeoutMs }) });
  })
);

module.exports = router;
