const crypto = require('crypto');
const config = require('../config');
const authService = require('./authService');
const { AppError } = require('../utils/errors');

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function requestContext(req, res, next) {
  req.id = `req_${crypto.randomBytes(6).toString('hex')}`;
  res.setHeader('X-Request-Id', req.id);
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (/^Bearer /i.test(auth)) return { token: auth.slice(7).trim(), via: 'bearer' };
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[config.cookieName]) return { token: cookies[config.cookieName], via: 'cookie' };
  return { token: null, via: null };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Requires a valid session. Cookie-authenticated unsafe requests must carry the custom
 * X-Requested-With header (cannot be set cross-site without a CORS preflight) as CSRF defence.
 */
function requireAuth(options = {}) {
  return (req, res, next) => {
    try {
      const { token, via } = extractToken(req);
      const { session, user } = authService.resolveSession(token);
      if (via === 'cookie' && !SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
        throw new AppError(403, 'CSRF_REJECTED', 'Missing X-Requested-With header.');
      }
      req.session = session;
      req.user = user;
      // Any authenticated API call proves liveness; only real activity extends the idle timer.
      if (!options.passive) authService.touchSession(session, { activity: !options.heartbeat });
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError(401, 'NOT_AUTHENTICATED', 'Authentication required.'));
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
    }
    next();
  };
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function setSessionCookie(req, res, token, expiresAt) {
  const parts = [
    `${config.cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [`${config.cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

/** Terminal error handler producing the uniform JSON error contract. */
function errorHandler(err, req, res, _next) {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  const code = err.code && typeof err.code === 'string' && err.status ? err.code : status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
  if (status >= 500) console.error(`[${req.id}] ${req.method} ${req.originalUrl}`, err);
  res.status(status).json({
    success: false,
    error: status >= 500 && config.isProduction ? 'Internal server error.' : err.message || 'Request failed.',
    code,
    requestId: req.id,
    ...(err.extra || {}),
  });
}

function notFoundApi(req, res) {
  res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND',
    requestId: req.id,
  });
}

module.exports = {
  parseCookies, requestContext, requireAuth, requireRole, asyncHandler,
  setSessionCookie, clearSessionCookie, errorHandler, notFoundApi, extractToken,
};
