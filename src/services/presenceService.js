const config = require('../config');
const { all, get } = require('../db/database');
const { nowMs } = require('../utils/clock');

/**
 * Presence is derived from real session heartbeats - never a permanent indicator.
 *  online  : at least one valid session heard from within offlineAfter AND with recent user activity
 *  away    : a valid session is heartbeating but the user has been idle longer than awayAfter
 *  offline : no valid session heard from within offlineAfter
 */
function computePresence() {
  const now = nowMs();
  const offlineMs = config.offlineAfterSec * 1000;
  const awayMs = config.awayAfterSec * 1000;
  const idleMs = config.sessionIdleMinutes * 60000;

  const users = all("SELECT * FROM users WHERE is_legacy_placeholder = 0 AND role = 'supervisor' ORDER BY name COLLATE NOCASE");
  return users.map((u) => {
    const sessions = all('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC', u.id);
    const valid = sessions.filter(
      (s) =>
        !s.ended_at &&
        Date.parse(s.expires_at) > now &&
        now - Date.parse(s.last_activity_at) <= idleMs
    );
    const live = valid.filter((s) => now - Date.parse(s.last_seen_at) <= offlineMs);
    let status = 'offline';
    if (live.some((s) => now - Date.parse(s.last_activity_at) <= awayMs)) status = 'online';
    else if (live.length) status = 'away';

    const lastSeen = sessions.reduce((m, s) => (s.last_seen_at > m ? s.last_seen_at : m), '');
    const lastActivity = sessions.reduce((m, s) => (s.last_activity_at > m ? s.last_activity_at : m), '');
    const current = live.length ? live.reduce((a, b) => (a.created_at < b.created_at ? a : b)) : null;

    // Honest description of why the user is offline (never an invented departure time)
    let offlineReason = null;
    let offlineDetail = null;
    if (status === 'offline') {
      // The session in which the user was most recently PRESENT: an explicit logout is evidence at ended_at,
      // anything else is evidence only up to the last heartbeat.
      const evidence = (x) => (x.ended_reason === 'logout' && x.ended_at ? x.ended_at : x.last_seen_at);
      const latest = sessions.slice().sort((a, b) => (evidence(a) < evidence(b) ? 1 : -1))[0];
      if (!latest) {
        offlineReason = 'never_logged_in';
      } else if (latest.ended_at && latest.ended_reason === 'logout') {
        offlineReason = 'logout';
        offlineDetail = { endedAt: latest.ended_at };
      } else if (latest.ended_at && latest.ended_reason === 'expired') {
        offlineReason = 'session_expired';
        offlineDetail = { lastSeenAt: latest.last_seen_at, recordedAt: latest.ended_at };
      } else if (latest.ended_at && latest.ended_reason === 'revoked') {
        offlineReason = 'session_revoked';
        offlineDetail = { endedAt: latest.ended_at };
      } else {
        offlineReason = 'connection_lost';
        offlineDetail = { lastSeenAt: latest.last_seen_at };
      }
    }

    const lastEnded = sessions.filter((s) => s.ended_at).sort((a, b) => (a.ended_at < b.ended_at ? 1 : -1))[0];
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      accountStatus: u.status,
      presence: status,
      activeSessions: live.length,
      currentSessionStartedAt: current ? current.created_at : null,
      lastActivityAt: lastActivity || null,
      lastSeenAt: lastSeen || null,
      lastLoginAt: u.last_login_at,
      lastLogoutAt: u.last_logout_at,
      lastSessionEnd: lastEnded
        ? { at: lastEnded.ended_at, reason: lastEnded.ended_reason === 'logout' ? 'logout' : lastEnded.ended_reason === 'expired' ? 'session_expired' : lastEnded.ended_reason, lastSeenAt: lastEnded.last_seen_at }
        : null,
      offlineReason,
      offlineDetail,
    };
  });
}

function listUserSessions(userId, limit = 50) {
  return all('SELECT id, created_at, last_seen_at, last_activity_at, ended_at, ended_reason, ip, user_agent, client FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit).map((s) => ({
    id: s.id,
    startedAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    lastActivityAt: s.last_activity_at,
    endedAt: s.ended_at,
    endReason: s.ended_reason,
    ip: s.ip,
    client: s.client,
    userAgent: s.user_agent,
  }));
}

function listSessionEvents(userId, limit = 100) {
  return all('SELECT id, at, session_id, event, detail FROM session_events WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT ?', userId, limit).map((e) => ({
    id: e.id, at: e.at, sessionId: e.session_id, event: e.event, detail: e.detail ? JSON.parse(e.detail) : null,
  }));
}

module.exports = { computePresence, listUserSessions, listSessionEvents, get };
