const serviceKeyService = require('../services/serviceKeyService');
const { AppError } = require('../utils/errors');
const audit = require('../services/auditService');

function extractServiceToken(req) {
  const auth = req.headers.authorization || '';
  if (/^Bearer /i.test(auth)) {
    return auth.slice(7).trim();
  }
  const customHeader = req.headers['x-service-key'];
  if (customHeader) {
    return String(customHeader).trim();
  }
  return null;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

function requireServiceKey({ scope = 'read', categoryRequired = false } = {}) {
  return (req, res, next) => {
    try {
      const token = extractServiceToken(req);
      if (!token) {
        throw new AppError(401, 'SERVICE_KEY_MISSING', 'Service API key is missing. Provide Authorization: Bearer sk_live_...');
      }

      const client = serviceKeyService.resolveKey(token);

      // Verify scope hierarchy
      if ((scope === 'write' || scope === 'delete') && !['write', 'sync', 'admin'].includes(client.scope)) {
        throw new AppError(403, 'INSUFFICIENT_SCOPE', 'Service key requires write/delete permissions.');
      }
      if (scope === 'sync' && !['sync', 'admin'].includes(client.scope)) {
        throw new AppError(403, 'INSUFFICIENT_SCOPE', 'Service key requires sync permissions.');
      }
      if (scope === 'admin' && client.scope !== 'admin') {
        throw new AppError(403, 'INSUFFICIENT_SCOPE', 'Service key requires admin scope.');
      }

      // Check category if provided
      const targetCategory = req.body?.categoryId || req.body?.category || req.query?.categoryId || req.query?.category || req.params?.categoryId;
      if (targetCategory && !serviceKeyService.isCategoryAllowed(client, targetCategory)) {
        throw new AppError(403, 'CATEGORY_ACCESS_FORBIDDEN', `Access to knowledge space "${targetCategory}" is forbidden for this service key.`);
      }

      if (categoryRequired && !targetCategory) {
        throw new AppError(400, 'CATEGORY_REQUIRED', 'Category identifier is required for this operation.');
      }

      req.serviceClient = client;
      req.actor = {
        id: client.id,
        name: client.name,
        role: 'service_client',
        appSlug: client.appSlug,
      };

      // Record access in audit log
      audit.record({
        action: 'service_key.access',
        actor: req.actor,
        ip: clientIp(req),
        detail: {
          appSlug: client.appSlug,
          scope: client.scope,
          endpoint: req.originalUrl || req.url,
          method: req.method,
          targetCategory: targetCategory || null,
        },
      });

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  requireServiceKey,
  extractServiceToken,
};
