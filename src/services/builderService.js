const { get, all, run, tx } = require('../db/database');
const { newId } = require('../utils/ids');
const { nowIso } = require('../utils/clock');
const { AppError } = require('../utils/errors');
const audit = require('./auditService');
const authService = require('../auth/authService');

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || ('app-' + Date.now().toString(36));
}

function listUserProjects(userId) {
  const sql = `
    SELECT 
      p.*,
      (SELECT COUNT(*) FROM app_project_requests r WHERE r.project_id = p.id) AS requests_count,
      (SELECT COUNT(*) FROM app_project_files f WHERE f.project_id = p.id) AS files_count
    FROM app_projects p
    WHERE p.user_id = ?
    ORDER BY p.updated_at DESC
  `;
  return all(sql, userId);
}

function getProject(projectId, userId = null, isAdmin = false) {
  const project = get('SELECT * FROM app_projects WHERE id = ?', projectId);
  if (!project) {
    throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  }
  if (!isAdmin && userId && project.user_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied to this project.');
  }
  const requests = all(
    'SELECT * FROM app_project_requests WHERE project_id = ? ORDER BY created_at DESC',
    projectId
  );
  const files = all(
    'SELECT * FROM app_project_files WHERE project_id = ? ORDER BY created_at DESC',
    projectId
  );
  const owner = get('SELECT id, name, email FROM users WHERE id = ?', project.user_id);
  return {
    ...project,
    owner,
    requests,
    files,
  };
}

function createProject(userId, { name, description = '', prompt = '', slug = '', html = '' }, actor) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    throw new AppError(400, 'NAME_REQUIRED', 'Project name is required.');
  }
  const id = newId('proj');
  const now = nowIso();
  let cleanSlug = slugify(slug || cleanName);
  
  let existing = get('SELECT id FROM app_projects WHERE slug = ?', cleanSlug);
  if (existing) {
    cleanSlug = cleanSlug + '-' + Date.now().toString(36).slice(-4);
  }

  run(
    `INSERT INTO app_projects (id, user_id, name, description, prompt, slug, html, quality_status, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 'pending_review', ?, ?)`,
    id, userId, cleanName, description, prompt, cleanSlug, html, now, now
  );

  const project = get('SELECT * FROM app_projects WHERE id = ?', id);
  audit.record({
    action: 'builder.project.created',
    actor,
    detail: { projectId: id, name: cleanName, slug: cleanSlug },
  });

  return project;
}

function updateProject(projectId, userId, updates = {}, isAdmin = false, actor = null) {
  const project = get('SELECT * FROM app_projects WHERE id = ?', projectId);
  if (!project) {
    throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  }
  if (!isAdmin && project.user_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied.');
  }

  const now = nowIso();
  const fields = [];
  const params = [];

  if (updates.name !== undefined) {
    const cleanName = String(updates.name).trim();
    if (!cleanName) throw new AppError(400, 'NAME_REQUIRED', 'Name cannot be empty.');
    fields.push('name = ?');
    params.push(cleanName);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    params.push(String(updates.description));
  }
  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    params.push(String(updates.prompt));
  }
  if (updates.html !== undefined) {
    fields.push('html = ?');
    params.push(String(updates.html));
  }
  if (updates.quality_status !== undefined) {
    if (!['draft', 'verified'].includes(updates.quality_status)) {
      throw new AppError(400, 'INVALID_QUALITY_STATUS', 'Invalid quality status.');
    }
    fields.push('quality_status = ?');
    params.push(updates.quality_status);
  }
  if (isAdmin && updates.status !== undefined) {
    if (!['pending_review', 'in_progress', 'completed', 'cancelled'].includes(updates.status)) {
      throw new AppError(400, 'INVALID_STATUS', 'Invalid project status.');
    }
    fields.push('status = ?');
    params.push(updates.status);
  }

  if (fields.length === 0) return project;

  fields.push('updated_at = ?');
  params.push(now);
  params.push(projectId);

  run(`UPDATE app_projects SET ${fields.join(', ')} WHERE id = ?`, ...params);

  audit.record({
    action: 'builder.project.updated',
    actor,
    detail: { projectId, updates: Object.keys(updates) },
  });

  return get('SELECT * FROM app_projects WHERE id = ?', projectId);
}

function deleteProject(projectId, userId, isAdmin = false, actor = null) {
  const project = get('SELECT * FROM app_projects WHERE id = ?', projectId);
  if (!project) {
    throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  }
  if (!isAdmin && project.user_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied.');
  }

  run('DELETE FROM app_projects WHERE id = ?', projectId);

  audit.record({
    action: 'builder.project.deleted',
    actor,
    detail: { projectId, name: project.name },
  });

  return { ok: true, id: projectId };
}

function listProjectRequests(projectId, userId = null, isAdmin = false) {
  const project = get('SELECT id, user_id FROM app_projects WHERE id = ?', projectId);
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  if (!isAdmin && userId && project.user_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied.');
  }
  return all(
    'SELECT * FROM app_project_requests WHERE project_id = ? ORDER BY created_at DESC',
    projectId
  );
}

function createProjectRequest(projectId, userId, { request_type = 'feature', prompt }, actor) {
  const project = get('SELECT id, user_id FROM app_projects WHERE id = ?', projectId);
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  if (actor.role !== 'admin' && project.user_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied.');
  }
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw new AppError(400, 'PROMPT_REQUIRED', 'Prompt is required.');

  const id = newId('req');
  const now = nowIso();
  run(
    `INSERT INTO app_project_requests (id, project_id, user_id, request_type, prompt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending_review', ?, ?)`,
    id, projectId, userId, request_type, cleanPrompt, now, now
  );

  audit.record({
    action: 'builder.request.created',
    actor,
    detail: { requestId: id, projectId, request_type },
  });

  return get('SELECT * FROM app_project_requests WHERE id = ?', id);
}

function addProjectFile(projectId, userId, { filename, file_type = '', vault_path, size_bytes = 0 }, actor) {
  const project = get('SELECT id, user_id FROM app_projects WHERE id = ?', projectId);
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  if (actor.role !== 'admin' && project.user_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied.');
  }

  const id = newId('fil');
  const now = nowIso();
  run(
    `INSERT INTO app_project_files (id, project_id, user_id, filename, file_type, vault_path, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, projectId, userId, filename, file_type, vault_path, size_bytes, now
  );

  return get('SELECT * FROM app_project_files WHERE id = ?', id);
}

function listProjectFiles(projectId, userId = null, isAdmin = false) {
  const project = get('SELECT id, user_id FROM app_projects WHERE id = ?', projectId);
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  if (!isAdmin && userId && project.user_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied.');
  }
  return all('SELECT * FROM app_project_files WHERE project_id = ? ORDER BY created_at DESC', projectId);
}

function adminGetStats() {
  const activeClients = get(`
    SELECT COUNT(DISTINCT id) AS count 
    FROM users 
    WHERE (app_source = 'sanea' OR id IN (SELECT DISTINCT user_id FROM app_projects)) 
      AND status = 'active'
  `)?.count || 0;

  const totalProjects = get('SELECT COUNT(*) AS count FROM app_projects')?.count || 0;

  const pendingRequests = get(`
    SELECT 
      (SELECT COUNT(*) FROM app_project_requests WHERE status = 'pending_review') +
      (SELECT COUNT(*) FROM app_projects WHERE status = 'pending_review') AS count
  `)?.count || 0;

  const inProgressProjects = get("SELECT COUNT(*) AS count FROM app_projects WHERE status = 'in_progress'")?.count || 0;
  const completedProjects = get("SELECT COUNT(*) AS count FROM app_projects WHERE status = 'completed'")?.count || 0;

  return {
    activeClients,
    totalProjects,
    pendingRequests,
    inProgressProjects,
    completedProjects,
  };
}

function adminListClients({ search = '', status = '', limit = 50, offset = 0 } = {}) {
  let where = ["(u.app_source = 'sanea' OR u.id IN (SELECT DISTINCT user_id FROM app_projects))"];
  const params = [];

  if (status) {
    where.push('u.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS count FROM users u ${whereClause}`, ...params)?.count || 0;

  const items = all(
    `SELECT 
       u.id, u.name, u.email, u.status, u.app_source, u.created_at, u.last_login_at, u.disabled_at,
       (SELECT COUNT(*) FROM app_projects p WHERE p.user_id = u.id) AS projects_count
     FROM users u
     ${whereClause}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );

  return { items, total, limit, offset };
}

function adminUpdateClientStatus(clientId, status, actor) {
  if (!['active', 'disabled'].includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', 'Status must be active or disabled.');
  }
  const user = get('SELECT * FROM users WHERE id = ?', clientId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  const now = nowIso();
  run(
    'UPDATE users SET status = ?, disabled_at = ? WHERE id = ?',
    status,
    status === 'disabled' ? now : null,
    clientId
  );

  audit.record({
    action: status === 'disabled' ? 'account.disabled' : 'account.activated',
    actor,
    supervisor: user,
    detail: { userId: clientId, prevStatus: user.status, newStatus: status },
  });

  return get('SELECT id, name, email, status, app_source FROM users WHERE id = ?', clientId);
}

function adminListProjects({ status = '', search = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];

  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(p.name LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(
    `SELECT COUNT(*) AS count FROM app_projects p JOIN users u ON p.user_id = u.id ${whereClause}`,
    ...params
  )?.count || 0;

  const items = all(
    `SELECT 
       p.*,
       u.name AS user_name,
       u.email AS user_email,
       (SELECT COUNT(*) FROM app_project_requests r WHERE r.project_id = p.id) AS requests_count,
       (SELECT COUNT(*) FROM app_project_files f WHERE f.project_id = p.id) AS files_count
     FROM app_projects p
     JOIN users u ON p.user_id = u.id
     ${whereClause}
     ORDER BY p.updated_at DESC
     LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );

  return { items, total, limit, offset };
}

function adminUpdateProjectStatus(projectId, status, actor) {
  if (!['pending_review', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', 'Invalid status.');
  }
  const project = get('SELECT * FROM app_projects WHERE id = ?', projectId);
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const now = nowIso();
  run(
    'UPDATE app_projects SET status = ?, updated_at = ? WHERE id = ?',
    status,
    now,
    projectId
  );

  audit.record({
    action: 'builder.project.status_updated',
    actor,
    detail: { projectId, prevStatus: project.status, newStatus: status },
  });

  return get('SELECT * FROM app_projects WHERE id = ?', projectId);
}

function adminListRequests({ status = '', search = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];

  if (status) {
    where.push('r.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(r.prompt LIKE ? OR p.name LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(
    `SELECT COUNT(*) AS count 
     FROM app_project_requests r 
     JOIN users u ON r.user_id = u.id 
     LEFT JOIN app_projects p ON r.project_id = p.id 
     ${whereClause}`,
    ...params
  )?.count || 0;

  const items = all(
    `SELECT 
       r.*,
       p.name AS project_name,
       p.slug AS project_slug,
       u.name AS user_name,
       u.email AS user_email
     FROM app_project_requests r
     JOIN users u ON r.user_id = u.id
     LEFT JOIN app_projects p ON r.project_id = p.id
     ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );

  return { items, total, limit, offset };
}

function adminUpdateRequest(requestId, { status, admin_notes }, actor) {
  const request = get('SELECT * FROM app_project_requests WHERE id = ?', requestId);
  if (!request) throw new AppError(404, 'REQUEST_NOT_FOUND', 'Request not found.');

  const fields = [];
  const params = [];
  const now = nowIso();

  if (status !== undefined) {
    if (!['pending_review', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      throw new AppError(400, 'INVALID_STATUS', 'Invalid request status.');
    }
    fields.push('status = ?');
    params.push(status);
  }
  if (admin_notes !== undefined) {
    fields.push('admin_notes = ?');
    params.push(String(admin_notes));
  }

  if (fields.length === 0) return request;

  fields.push('updated_at = ?');
  params.push(now);
  params.push(requestId);

  run(`UPDATE app_project_requests SET ${fields.join(', ')} WHERE id = ?`, ...params);

  audit.record({
    action: 'builder.request.updated',
    actor,
    detail: { requestId, status, admin_notes },
  });

  return get('SELECT * FROM app_project_requests WHERE id = ?', requestId);
}

module.exports = {
  listUserProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  listProjectRequests,
  createProjectRequest,
  addProjectFile,
  listProjectFiles,
  adminGetStats,
  adminListClients,
  adminUpdateClientStatus,
  adminListProjects,
  adminUpdateProjectStatus,
  adminListRequests,
  adminUpdateRequest,
};
