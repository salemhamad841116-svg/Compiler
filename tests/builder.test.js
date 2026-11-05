const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DB_PATH = path.join(__dirname, '..', 'data', `test_builder_${Date.now()}.sqlite`);

const { getDb, closeDb } = require('../src/db/database');
const builder = require('../src/services/builderService');
const authService = require('../src/auth/authService');

test('Phase 6: Sanea App Builder Integration Suite', async (t) => {
  const db = getDb();

  const adminActor = {
    id: 'usr_admin_test_1',
    name: 'Master Admin',
    email: 'admin_test@misruq.com',
    role: 'admin',
  };

  db.prepare(`
    INSERT OR IGNORE INTO users (id, role, name, email, password_hash, status, created_at, app_source)
    VALUES (?, ?, ?, ?, 'hash', 'active', datetime('now'), 'chathsm')
  `).run(adminActor.id, adminActor.role, adminActor.name, adminActor.email);

  await t.test('1. Migration 6: tables and columns exist in database', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'app_%'").all().map(r => r.name);
    assert.ok(tables.includes('app_projects'), 'app_projects table exists');
    assert.ok(tables.includes('app_project_requests'), 'app_project_requests table exists');
    assert.ok(tables.includes('app_project_files'), 'app_project_files table exists');

    const userCols = db.prepare("PRAGMA table_info('users')").all().map(c => c.name);
    assert.ok(userCols.includes('app_source'), 'users table has app_source column');
  });

  let client1 = null;
  let client2 = null;

  await t.test('2. Admin creates App Builder client with app_source=sanea', () => {
    const res1 = authService.createUser({
      name: 'Client Alpha',
      email: 'client.alpha@example.com',
      role: 'supervisor',
      appSource: 'sanea',
    }, adminActor);

    assert.ok(res1.user.id);
    assert.equal(res1.user.name, 'Client Alpha');
    assert.equal(res1.user.appSource, 'sanea');
    assert.ok(res1.invitation.token);

    client1 = res1.user;

    const res2 = authService.createUser({
      name: 'Client Beta',
      email: 'client.beta@example.com',
      role: 'supervisor',
      appSource: 'sanea',
    }, adminActor);
    client2 = res2.user;
  });

  let project1 = null;

  await t.test('3. Client creates a project and scopes are enforced', () => {
    project1 = builder.createProject(client1.id, {
      name: 'Alpha E-Commerce App',
      description: 'Online store for local crafts',
      prompt: 'Build a responsive store with shopping cart and dark mode',
      slug: 'alpha-store',
      html: '<!DOCTYPE html><html><body><h1>Alpha Store</h1></body></html>',
    }, client1);

    assert.ok(project1.id);
    assert.equal(project1.name, 'Alpha E-Commerce App');
    assert.equal(project1.status, 'pending_review');
    assert.equal(project1.user_id, client1.id);

    // Client 1 sees their project
    const client1Projects = builder.listUserProjects(client1.id);
    assert.equal(client1Projects.length, 1);
    assert.equal(client1Projects[0].id, project1.id);

    // Client 2 sees 0 projects
    const client2Projects = builder.listUserProjects(client2.id);
    assert.equal(client2Projects.length, 0);

    // Client 2 cannot access Client 1 project
    assert.throws(() => {
      builder.getProject(project1.id, client2.id, false);
    }, (err) => err.code === 'FORBIDDEN');

    // Admin can access Client 1 project
    const adminView = builder.getProject(project1.id, adminActor.id, true);
    assert.equal(adminView.id, project1.id);
    assert.equal(adminView.owner.email, 'client.alpha@example.com');
  });

  await t.test('4. Client adds requests and files to their project', () => {
    const req = builder.createProjectRequest(project1.id, client1.id, {
      request_type: 'feature',
      prompt: 'Add Apple Pay and Stripe checkout integration',
    }, client1);

    assert.ok(req.id);
    assert.equal(req.status, 'pending_review');
    assert.equal(req.request_type, 'feature');

    const file = builder.addProjectFile(project1.id, client1.id, {
      filename: 'architecture-diagram.png',
      file_type: 'image/png',
      vault_path: 'vault/test/architecture-diagram.png',
      size_bytes: 4096,
    }, client1);

    assert.ok(file.id);
    assert.equal(file.filename, 'architecture-diagram.png');

    const projectDetails = builder.getProject(project1.id, client1.id, false);
    assert.equal(projectDetails.requests.length, 1);
    assert.equal(projectDetails.files.length, 1);
  });

  await t.test('5. Admin lists clients, projects, requests, and updates statuses', () => {
    // List clients
    const clients = builder.adminListClients();
    assert.ok(clients.items.length >= 2);
    const alpha = clients.items.find(c => c.id === client1.id);
    assert.ok(alpha);
    assert.equal(alpha.projects_count, 1);

    // List projects
    const projects = builder.adminListProjects({ status: 'pending_review' });
    assert.ok(projects.items.length >= 1);
    const p = projects.items.find(item => item.id === project1.id);
    assert.ok(p);
    assert.equal(p.user_name, 'Client Alpha');

    // Admin updates project status to in_progress
    const updatedProject = builder.adminUpdateProjectStatus(project1.id, 'in_progress', adminActor);
    assert.equal(updatedProject.status, 'in_progress');

    // List requests
    const requests = builder.adminListRequests();
    assert.ok(requests.items.length >= 1);
    const targetReq = requests.items[0];

    // Admin updates request
    const updatedReq = builder.adminUpdateRequest(targetReq.id, {
      status: 'in_progress',
      admin_notes: 'Under review by core engineering team',
    }, adminActor);
    assert.equal(updatedReq.status, 'in_progress');
    assert.equal(updatedReq.admin_notes, 'Under review by core engineering team');

    // Admin toggles client status
    const disabledClient = builder.adminUpdateClientStatus(client2.id, 'disabled', adminActor);
    assert.equal(disabledClient.status, 'disabled');
  });

  await t.test('6. Mini-dashboard stats reflect actual platform state', () => {
    const stats = builder.adminGetStats();
    assert.ok(stats.totalProjects >= 1);
    assert.ok(stats.inProgressProjects >= 1);
    assert.ok(typeof stats.activeClients === 'number');
    assert.ok(typeof stats.pendingRequests === 'number');
  });

  t.after(() => {
    closeDb();
  });
});
