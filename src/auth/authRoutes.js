const express = require('express');
const authService = require('./authService');
const { requireAuth, asyncHandler, setSessionCookie, clearSessionCookie } = require('./middleware');
const config = require('../config');

const router = express.Router();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password, client } = req.body || {};
    const result = authService.login({
      email,
      password,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      client: client === 'mobile' ? 'mobile' : 'web',
    });
    setSessionCookie(req, res, result.token, result.expiresAt);
    res.json({
      success: true,
      user: result.user,
      session: { id: result.sessionId, expiresAt: result.expiresAt },
      policy: {
        heartbeatIntervalSeconds: config.heartbeatIntervalSec,
        offlineAfterSeconds: config.offlineAfterSec,
        awayAfterSeconds: config.awayAfterSec,
        displayTimeZone: config.displayTimeZone,
      },
      // Bearer token is returned only to native clients that cannot use the httpOnly cookie
      ...(client === 'mobile' ? { token: result.token } : {}),
    });
  })
);

router.post(
  '/logout',
  requireAuth({ passive: true }),
  asyncHandler(async (req, res) => {
    authService.logout(req.session, req.user, clientIp(req));
    clearSessionCookie(req, res);
    res.json({ success: true });
  })
);

router.get(
  '/me',
  requireAuth({ passive: true }),
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      user: authService.publicUser(req.user),
      session: { id: req.session.id, expiresAt: req.session.expires_at },
      policy: {
        heartbeatIntervalSeconds: config.heartbeatIntervalSec,
        offlineAfterSeconds: config.offlineAfterSec,
        awayAfterSeconds: config.awayAfterSec,
        displayTimeZone: config.displayTimeZone,
      },
    });
  })
);

router.post(
  '/heartbeat',
  requireAuth({ passive: true }),
  asyncHandler(async (req, res) => {
    const idle = Boolean(req.body && req.body.idle);
    authService.touchSession(req.session, { activity: !idle });
    res.json({ success: true, serverTime: new Date().toISOString(), idle });
  })
);

router.post(
  '/change-password',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    authService.changePassword(req.user, req.session, currentPassword, newPassword);
    res.json({ success: true });
  })
);

router.get(
  '/invitations/:token',
  asyncHandler(async (req, res) => {
    const { user, row } = authService.getInvitationByToken(req.params.token);
    res.json({
      success: true,
      invitation: { name: user.name, email: user.email, purpose: row.purpose, expiresAt: row.expires_at },
    });
  })
);

router.post(
  '/invitations/:token/accept',
  asyncHandler(async (req, res) => {
    const user = authService.acceptInvitation(req.params.token, (req.body || {}).password);
    res.json({ success: true, user });
  })
);

module.exports = router;
