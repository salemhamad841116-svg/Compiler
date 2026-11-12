const crypto = require('crypto');
const { getDb } = require('../db/database');
const { AppError } = require('../utils/errors');
const { nowIso } = require('../utils/clock');
const audit = require('./auditService');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token).trim()).digest('hex');
}

function parseJsonArray(str) {
  try {
    const val = JSON.parse(str || '[]');
    return Array.isArray(val) ? val : [];
  } catch (_) {
    return [];
  }
}

class ServiceKeyService {
  createServiceKey({ name, appSlug, scope = 'read', allowedCategoryIds = [], forbiddenCategoryIds = [], createdBy = null, actor = null }) {
    if (!name || !String(name).trim()) {
      throw new AppError(400, 'KEY_NAME_REQUIRED', 'Service key name is required.');
    }
    const cleanSlug = String(appSlug || 'app').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!cleanSlug) {
      throw new AppError(400, 'APP_SLUG_REQUIRED', 'Application slug identifier is required.');
    }
    const allowedScopes = new Set(['read', 'write', 'sync', 'admin']);
    if (!allowedScopes.has(scope)) {
      throw new AppError(400, 'INVALID_SCOPE', `Scope "${scope}" is invalid. Allowed: read, write, sync, admin.`);
    }

    const db = getDb();
    const id = `sak_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const rawSecret = crypto.randomBytes(24).toString('hex');
    const rawToken = `sk_live_${cleanSlug}_${rawSecret}`;
    const keyHash = hashToken(rawToken);
    const keyPrefix = `${rawToken.slice(0, 16)}...`;
    const now = nowIso();

    const allowedJson = JSON.stringify(Array.isArray(allowedCategoryIds) ? allowedCategoryIds : [allowedCategoryIds].filter(Boolean));
    const forbiddenJson = JSON.stringify(Array.isArray(forbiddenCategoryIds) ? forbiddenCategoryIds : [forbiddenCategoryIds].filter(Boolean));

    db.prepare(`
      INSERT INTO service_api_keys (
        id, name, app_slug, key_hash, key_prefix, scope,
        allowed_category_ids, forbidden_category_ids, is_active,
        created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      String(name).trim(),
      cleanSlug,
      keyHash,
      keyPrefix,
      scope,
      allowedJson,
      forbiddenJson,
      now,
      createdBy || (actor ? actor.id : null)
    );

    audit.record({
      action: 'service_key.created',
      actor: actor || { id: createdBy || 'system', name: 'System' },
      detail: { serviceKeyId: id, name, appSlug: cleanSlug, scope, allowedCategories: allowedCategoryIds, forbiddenCategories: forbiddenCategoryIds },
    });

    const created = this.getKeyById(id);
    return {
      ...created,
      rawToken, // Revealed once upon creation
    };
  }

  resolveKey(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new AppError(401, 'SERVICE_KEY_MISSING', 'Service API key is missing.');
    }
    const keyHash = hashToken(rawToken);
    const db = getDb();
    const row = db.prepare('SELECT * FROM service_api_keys WHERE key_hash = ?').get(keyHash);

    if (!row) {
      throw new AppError(401, 'SERVICE_KEY_INVALID', 'Invalid service API key.');
    }
    if (!row.is_active || row.revoked_at) {
      throw new AppError(403, 'SERVICE_KEY_REVOKED', 'This service API key has been revoked or deactivated.');
    }

    // Update last_used_at asynchronously
    const now = nowIso();
    try {
      db.prepare('UPDATE service_api_keys SET last_used_at = ? WHERE id = ?').run(now, row.id);
    } catch (_) {}

    return {
      id: row.id,
      name: row.name,
      appSlug: row.app_slug,
      keyPrefix: row.key_prefix,
      scope: row.scope,
      allowedCategoryIds: parseJsonArray(row.allowed_category_ids),
      forbiddenCategoryIds: parseJsonArray(row.forbidden_category_ids),
      isActive: !!row.is_active,
      createdAt: row.created_at,
      createdBy: row.created_by,
      lastUsedAt: now,
    };
  }

  getKeyById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM service_api_keys WHERE id = ?').get(id);
    if (!row) throw new AppError(404, 'SERVICE_KEY_NOT_FOUND', `Service key not found: ${id}`);
    return {
      id: row.id,
      name: row.name,
      appSlug: row.app_slug,
      keyPrefix: row.key_prefix,
      scope: row.scope,
      allowedCategoryIds: parseJsonArray(row.allowed_category_ids),
      forbiddenCategoryIds: parseJsonArray(row.forbidden_category_ids),
      isActive: !!row.is_active,
      createdAt: row.created_at,
      createdBy: row.created_by,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
    };
  }

  revokeKey(id, actor = null) {
    const existing = this.getKeyById(id);
    if (!existing.isActive || existing.revokedAt) {
      return { success: true, alreadyRevoked: true, id };
    }
    const db = getDb();
    const now = nowIso();
    db.prepare(`
      UPDATE service_api_keys
      SET is_active = 0, revoked_at = ?, revoked_by = ?
      WHERE id = ?
    `).run(now, actor ? actor.id : null, id);

    audit.record({
      action: 'service_key.revoked',
      actor: actor || { id: 'admin', name: 'Administrator' },
      detail: { serviceKeyId: id, name: existing.name, appSlug: existing.appSlug },
    });

    return { success: true, revokedId: id, revokedAt: now };
  }

  listKeys() {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM service_api_keys ORDER BY created_at DESC').all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      appSlug: r.app_slug,
      keyPrefix: r.key_prefix,
      scope: r.scope,
      allowedCategoryIds: parseJsonArray(r.allowed_category_ids),
      forbiddenCategoryIds: parseJsonArray(r.forbidden_category_ids),
      isActive: !!r.is_active && !r.revoked_at,
      createdAt: r.created_at,
      createdBy: r.created_by,
      lastUsedAt: r.last_used_at,
      revokedAt: r.revoked_at,
      revokedBy: r.revoked_by,
    }));
  }

  isCategoryAllowed(serviceClient, categoryId) {
    if (!serviceClient || !categoryId) return false;
    const catRef = String(categoryId).trim();

    const idsToCheck = [catRef];
    try {
      const categoryService = require('./categoryService');
      const resolved = categoryService.resolveCategory(catRef);
      if (resolved) {
        if (resolved.id) idsToCheck.push(resolved.id);
        if (resolved.name_key) idsToCheck.push(resolved.name_key);
        if (resolved.name) idsToCheck.push(resolved.name);
        if (resolved.parent_id) {
          idsToCheck.push(resolved.parent_id);
          const parent = categoryService.getCategory(resolved.parent_id);
          if (parent) {
            if (parent.name_key) idsToCheck.push(parent.name_key);
            if (parent.name) idsToCheck.push(parent.name);
          }
        }
      }
    } catch (_) {}

    // Check forbidden list first (Strict Exclusion)
    const forbidden = serviceClient.forbiddenCategoryIds || [];
    if (forbidden.includes('*') || idsToCheck.some((id) => forbidden.includes(id))) {
      return false;
    }

    // Check allowed list
    const allowed = serviceClient.allowedCategoryIds || [];
    if (allowed.includes('*') || idsToCheck.some((id) => allowed.includes(id))) {
      return true;
    }

    return false;
  }
}

module.exports = new ServiceKeyService();
