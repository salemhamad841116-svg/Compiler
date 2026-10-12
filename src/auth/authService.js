const config = require('../config');
const { get, all, run, tx } = require('../db/database');
const { newId, randomToken, sha256Hex } = require('../utils/ids');
const { nowMs, nowIso, toIso } = require('../utils/clock');
const { AppError } = require('../utils/errors');
const { hashPassword, verifyPassword, verifyDummy, validatePasswordStrength } = require('./password');
const audit = require('../services/auditService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    lastLogoutAt: u.last_logout_at,
    disabledAt: u.disabled_at,
  };
}

function sessionEvent(userId, sessionId, event, detail) {
  run(
    'INSERT INTO session_events (id, at, user_id, session_id, event, detail) VALUES (?,?,?,?,?,?)',
    newId('sev'),
    nowIso(),
    userId,
    sessionId,
    event,
    detail ? JSON.stringify(detail) : null
  );
}

// ---------------------------------------------------------------- accounts

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function bootstrapAdmin() {
  const existing = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existing) return { created: false };
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password) {
    console.warn('[Auth] No administrator exists. Set ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD (or run scripts/create-admin.js) to create the first administrator.');
    return { created: false, missingConfig: true };
  }
  const weak = validatePasswordStrength(password);
  if (weak || !EMAIL_RE.test(email)) {
    console.warn(`[Auth] Cannot bootstrap administrator: ${weak || 'ADMIN_EMAIL is not a valid email address.'}`);
    return { created: false, invalidConfig: true };
  }
  const id = newId('usr');
  run(
    `INSERT INTO users (id, email, name, role, password_hash, status, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, email, process.env.ADMIN_NAME || 'Administrator', 'admin', hashPassword(password), 'active', nowIso(), 'bootstrap'
  );
  audit.record({ action: 'account.created', supervisor: null, detail: { userId: id, email, role: 'admin', via: 'bootstrap' } });
  console.log(`[Auth] Bootstrapped first administrator account: ${email}`);
  return { created: true, id };
}

function createInvitation(userId, purpose, createdBy) {
  // Only one outstanding invitation per user
  run("UPDATE invitations SET used_at = ? WHERE user_id = ? AND used_at IS NULL", nowIso(), userId);
  const token = randomToken(32);
  const expiresAt = toIso(nowMs() + config.invitationHours * 3600000);
  run(
    `INSERT INTO invitations (id, user_id, token_hash, purpose, expires_at, created_at, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    newId('inv'), userId, sha256Hex(token), purpose, expiresAt, nowIso(), createdBy || null
  );
  return { token, expiresAt, purpose };
}

function createUser({ name, email, role = 'supervisor' }, actor) {
  const cleanName = String(name || '').trim();
  const cleanEmail = normalizeEmail(email);
  if (!cleanName) throw new AppError(400, 'NAME_REQUIRED', 'Name is required.');
  if (!EMAIL_RE.test(cleanEmail)) throw new AppError(400, 'EMAIL_INVALID', 'A valid email address is required.');
  if (!['admin', 'supervisor'].includes(role)) throw new AppError(400, 'ROLE_INVALID', 'Role must be admin or supervisor.');
  if (get('SELECT id FROM users WHERE email = ?', cleanEmail)) {
    throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
  }
  const id = newId('usr');
  run(
    `INSERT INTO users (id, email, name, role, status, created_at, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    id, cleanEmail, cleanName, role, 'invited', nowIso(), actor.id
  );
  const invitation = createInvitation(id, 'invite', actor.id);
  const user = get('SELECT * FROM users WHERE id = ?', id);
  audit.record({
    action: 'account.created', actor, supervisor: role === 'supervisor' ? user : null,
    detail: { userId: id, email: cleanEmail, role },
  });
  return { user: publicUser(user), invitation };
}

function getInvitationByToken(token) {
  const row = get('SELECT * FROM invitations WHERE token_hash = ?', sha256Hex(String(token || '')));
  if (!row) throw new AppError(404, 'INVITATION_INVALID', 'This invitation link is not valid.');
  if (row.used_at) throw new AppError(410, 'INVITATION_USED', 'This invitation link has already been used or replaced.');
  if (row.expires_at < nowIso()) throw new AppError(410, 'INVITATION_EXPIRED', 'This invitation link has expired. Ask the administrator for a new one.');
  const user = get('SELECT * FROM users WHERE id = ?', row.user_id);
  if (!user || user.status === 'disabled') throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled.');
  return { row, user };
}

function acceptInvitation(token, password) {
  const { row, user } = getInvitationByToken(token);
  const weak = validatePasswordStrength(password);
  if (weak) throw new AppError(400, 'PASSWORD_WEAK', weak);
  tx(() => {
    run('UPDATE users SET password_hash = ?, status = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', hashPassword(password), 'active', user.id);
    run('UPDATE invitations SET used_at = ? WHERE id = ?', nowIso(), row.id);
  });
  endUserSessions(user.id, 'revoked', null);
  audit.record({
    action: row.purpose === 'reset' ? 'account.password_reset' : 'account.activated',
    actor: { id: user.id, name: user.name, role: user.role },
    supervisor: user.role === 'supervisor' ? user : null,
    detail: { userId: user.id },
  });
  return publicUser(get('SELECT * FROM users WHERE id = ?', user.id));
}

function listUsers() {
  return all('SELECT * FROM users WHERE is_legacy_placeholder = 0 ORDER BY created_at DESC').map(publicUser);
}

function updateUser(id, patch, actor) {
  const user = get('SELECT * FROM users WHERE id = ?', id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found.');
  const changes = {};
  if (patch.name !== undefined) {
    const n = String(patch.name).trim();
    if (!n) throw new AppError(400, 'NAME_REQUIRED', 'Name cannot be empty.');
    if (n !== user.name) changes.name = n;
  }
  if (patch.status !== undefined && patch.status !== user.status) {
    if (!['active', 'disabled'].includes(patch.status)) throw new AppError(400, 'STATUS_INVALID', 'Status must be active or disabled.');
    if (user.status === 'invited' && patch.status === 'active') throw new AppError(409, 'NOT_ACTIVATED', 'The supervisor has not activated this account yet.');
    if (user.id === actor.id && patch.status === 'disabled') throw new AppError(409, 'CANNOT_DISABLE_SELF', 'You cannot disable your own account.');
    changes.status = patch.status;
  }
  if (!Object.keys(changes).length) return publicUser(user);
  tx(() => {
    if (changes.name) run('UPDATE users SET name = ? WHERE id = ?', changes.name, id);
    if (changes.status) {
      run('UPDATE users SET status = ?, disabled_at = ? WHERE id = ?', changes.status, changes.status === 'disabled' ? nowIso() : null, id);
    }
  });
  if (changes.status === 'disabled') endUserSessions(id, 'revoked', actor);
  const updated = get('SELECT * FROM users WHERE id = ?', id);
  audit.record({
    action: changes.status ? (changes.status === 'disabled' ? 'account.disabled' : 'account.enabled') : 'account.updated',
    actor, supervisor: updated.role === 'supervisor' ? updated : null, detail: { userId: id, changes },
  });
  return publicUser(updated);
}

function issueInvitationForUser(id, actor) {
  const user = get('SELECT * FROM users WHERE id = ?', id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found.');
  if (user.status === 'disabled') throw new AppError(409, 'ACCOUNT_DISABLED', 'Enable the account before issuing a link.');
  const purpose = user.status === 'invited' ? 'invite' : 'reset';
  const invitation = createInvitation(id, purpose, actor.id);
  audit.record({
    action: purpose === 'reset' ? 'account.reset_link_issued' : 'account.invitation_issued',
    actor, supervisor: user.role === 'supervisor' ? user : null, detail: { userId: id },
  });
  return invitation;
}

// ---------------------------------------------------------------- sessions

function endSession(session, reason, actor) {
  if (session.ended_at) return false;
  const now = nowIso();
  run('UPDATE sessions SET ended_at = ?, ended_reason = ? WHERE id = ? AND ended_at IS NULL', now, reason, session.id);
  sessionEvent(session.user_id, session.id, reason === 'logout' ? 'logout' : `session_${reason}`, {
    lastSeenAt: session.last_seen_at,
    by: actor ? actor.id : null,
  });
  return true;
}

function endUserSessions(userId, reason, actor) {
  const rows = all('SELECT * FROM sessions WHERE user_id = ? AND ended_at IS NULL', userId);
  let n = 0;
  for (const s of rows) if (endSession(s, reason, actor)) n++;
  return n;
}

function revokeUserSessions(userId, actor) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found.');
  const n = endUserSessions(userId, 'revoked', actor);
  audit.record({ action: 'account.sessions_revoked', actor, supervisor: user.role === 'supervisor' ? user : null, detail: { userId, sessions: n } });
  return n;
}

const failedByIp = new Map();
function ipThrottle(ip) {
  const now = nowMs();
  const rec = failedByIp.get(ip) || { count: 0, first: now };
  if (now - rec.first > 15 * 60000) {
    rec.count = 0;
    rec.first = now;
  }
  failedByIp.set(ip, rec);
  return rec;
}

function login({ email, password, ip, userAgent, client }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !password) throw new AppError(400, 'MISSING_FIELDS', 'Email and password are required.');
  const ipRec = ipThrottle(ip || 'unknown');
  if (ipRec.count >= config.maxFailedLogins * 4) {
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts from this network. Try again later.');
  }
  const user = get('SELECT * FROM users WHERE email = ?', cleanEmail);
  const failAudit = (reason) =>
    audit.record({
      action: 'auth.login_failed', outcome: 'failed', supervisor: user && user.role === 'supervisor' ? user : null,
      actor: user ? { id: user.id, name: user.name, role: user.role } : null, ip,
      failureReason: reason, detail: { email: cleanEmail },
    });

  if (!user) {
    verifyDummy();
    ipRec.count++;
    failAudit('unknown_account');
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  if (user.locked_until && user.locked_until > nowIso()) {
    failAudit('locked');
    throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. The account is temporarily locked.', { lockedUntil: user.locked_until });
  }
  if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
    ipRec.count++;
    const failed = user.failed_logins + 1;
    const lockedUntil = failed >= config.maxFailedLogins ? toIso(nowMs() + config.lockoutMinutes * 60000) : null;
    run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lockedUntil ? 0 : failed, lockedUntil, user.id);
    failAudit(user.status === 'invited' ? 'not_activated' : 'bad_password');
    if (user.status === 'invited' && !user.password_hash) {
      // Only accounts an administrator explicitly invited reveal this state, so the supervisor knows to use the link.
      throw new AppError(403, 'ACCOUNT_NOT_ACTIVATED', 'This account has not been activated yet. Use your invitation link.');
    }
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  // credentials are correct from here on
  if (user.status === 'disabled') {
    failAudit('disabled');
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Contact the administrator.');
  }
  if (user.status === 'invited') {
    throw new AppError(403, 'ACCOUNT_NOT_ACTIVATED', 'This account has not been activated yet. Use your invitation link.');
  }

  const token = randomToken(32);
  const sessionId = newId('ses');
  const now = nowIso();
  const expiresAt = toIso(nowMs() + config.sessionAbsoluteHours * 3600000);
  tx(() => {
    run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', now, user.id);
    run(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, last_activity_at, expires_at, ip, user_agent, client)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      sessionId, user.id, sha256Hex(token), now, now, now, expiresAt, ip || null, (userAgent || '').slice(0, 300), client || 'web'
    );
    sessionEvent(user.id, sessionId, 'login', { ip, client: client || 'web' });
  });
  audit.record({
    action: 'auth.login', actor: { id: user.id, name: user.name, role: user.role },
    supervisor: user.role === 'supervisor' ? user : null, ip, detail: { sessionId, client: client || 'web' },
  });
  return { token, sessionId, expiresAt, user: publicUser(get('SELECT * FROM users WHERE id = ?', user.id)) };
}

/**
 * Resolves a raw session token into { session, user } or throws a coded AppError.
 * Sliding inactivity timeout + absolute lifetime enforced here (server-side).
 */
function resolveSession(token) {
  if (!token) throw new AppError(401, 'NOT_AUTHENTICATED', 'Authentication required.');
  const session = get('SELECT * FROM sessions WHERE token_hash = ?', sha256Hex(token));
  if (!session) throw new AppError(401, 'NOT_AUTHENTICATED', 'Authentication required.');
  if (session.ended_at) {
    const map = { logout: 'NOT_AUTHENTICATED', expired: 'SESSION_EXPIRED', revoked: 'SESSION_REVOKED' };
    const code = map[session.ended_reason] || 'NOT_AUTHENTICATED';
    throw new AppError(401, code, code === 'SESSION_EXPIRED' ? 'Your session has expired. Please sign in again.' : code === 'SESSION_REVOKED' ? 'Your session was ended by an administrator.' : 'Authentication required.');
  }
  const now = nowMs();
  const idleMs = config.sessionIdleMinutes * 60000;
  if (session.expires_at <= nowIso() || now - Date.parse(session.last_activity_at) > idleMs) {
    endSession(session, 'expired', null);
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  const user = get('SELECT * FROM users WHERE id = ?', session.user_id);
  if (!user || user.status !== 'active') {
    endSession(session, 'revoked', null);
    throw new AppError(401, 'SESSION_REVOKED', 'This account is no longer active.');
  }
  return { session, user };
}

/** Marks contact from a session. activity=true means a real user interaction (extends the idle timer). */
function touchSession(session, { activity }) {
  const now = nowIso();
  const lost = session.connection_lost_noted === 1;
  if (activity) {
    run('UPDATE sessions SET last_seen_at = ?, last_activity_at = ?, connection_lost_noted = 0 WHERE id = ?', now, now, session.id);
  } else {
    run('UPDATE sessions SET last_seen_at = ?, connection_lost_noted = 0 WHERE id = ?', now, session.id);
  }
  if (lost) sessionEvent(session.user_id, session.id, 'connection_restored', { previousLastSeen: session.last_seen_at });
}

function logout(session, user, ip) {
  endSession(session, 'logout', user);
  run('UPDATE users SET last_logout_at = ? WHERE id = ?', nowIso(), user.id);
  audit.record({
    action: 'auth.logout', actor: { id: user.id, name: user.name, role: user.role },
    supervisor: user.role === 'supervisor' ? user : null, ip, detail: { sessionId: session.id },
  });
}

function changePassword(user, session, currentPassword, newPassword) {
  const row = get('SELECT * FROM users WHERE id = ?', user.id);
  if (!verifyPassword(currentPassword || '', row.password_hash)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  }
  const weak = validatePasswordStrength(newPassword);
  if (weak) throw new AppError(400, 'PASSWORD_WEAK', weak);
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(newPassword), user.id);
  for (const s of all('SELECT * FROM sessions WHERE user_id = ? AND ended_at IS NULL AND id != ?', user.id, session.id)) {
    endSession(s, 'revoked', user);
  }
  audit.record({ action: 'account.password_changed', actor: { id: user.id, name: user.name, role: user.role }, supervisor: user.role === 'supervisor' ? row : null });
}

/**
 * Periodic housekeeping: expires stale sessions and records honest "connection lost" markers
 * (the exact departure time is unknowable, so only last-seen time is stored).
 */
function sweepSessions() {
  const now = nowMs();
  const idleMs = config.sessionIdleMinutes * 60000;
  let expired = 0;
  let lost = 0;
  for (const s of all('SELECT * FROM sessions WHERE ended_at IS NULL')) {
    if (s.expires_at <= nowIso() || now - Date.parse(s.last_activity_at) > idleMs) {
      endSession(s, 'expired', null);
      expired++;
    } else if (!s.connection_lost_noted && now - Date.parse(s.last_seen_at) > config.offlineAfterSec * 1000) {
      run('UPDATE sessions SET connection_lost_noted = 1 WHERE id = ?', s.id);
      sessionEvent(s.user_id, s.id, 'connection_lost', { lastSeenAt: s.last_seen_at });
      lost++;
    }
  }
  return { expired, lost };
}

module.exports = {
  publicUser, bootstrapAdmin, createUser, listUsers, updateUser, issueInvitationForUser,
  getInvitationByToken, acceptInvitation, login, resolveSession, touchSession, logout,
  changePassword, revokeUserSessions, sweepSessions, endUserSessions, normalizeEmail, EMAIL_RE,
};
