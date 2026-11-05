const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DB_PATH = path.join(__dirname, '..', 'data', `test_engineer_${Date.now()}.sqlite`);

const { getDb, closeDb } = require('../src/db/database');
const builder = require('../src/services/builderService');
const { retrieveCodingKnowledge } = require('../src/services/engineer/knowledgeRetriever');
const { getMemory, updateMemory, recordLearnedFix } = require('../src/services/engineer/projectMemory');
const { runBrowserSuite } = require('../src/services/engineer/browserRunner');
const { orchestrateProject, assembleHtml, autoRepairFiles, listProjectRuns } = require('../src/services/engineer/orchestrator');
const { runBenchmarkSuite, listBenchmarkResults, BENCHMARK_TASKS } = require('../src/services/engineer/benchmarkSuite');

test('Phase 7: Engineer Advanced Coding Intelligence V2 Suite', async (t) => {
  const db = getDb();

  const adminActor = {
    id: 'usr_admin_eng_test',
    name: 'Engineer Admin',
    email: 'engineer_admin@misruq.com',
    role: 'admin',
  };

  db.prepare(`
    INSERT OR IGNORE INTO users (id, role, name, email, password_hash, status, created_at, app_source)
    VALUES (?, ?, ?, ?, 'hash', 'active', datetime('now'), 'sanea')
  `).run(adminActor.id, adminActor.role, adminActor.name, adminActor.email);

  await t.test('1. Migration 7: tables and schema exist', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'app_%'").all().map(r => r.name);
    assert.ok(tables.includes('app_project_versions'), 'app_project_versions exists');
    assert.ok(tables.includes('app_project_files_v2'), 'app_project_files_v2 exists');
    assert.ok(tables.includes('app_project_memory'), 'app_project_memory exists');
    assert.ok(tables.includes('app_project_runs'), 'app_project_runs exists');
    assert.ok(tables.includes('app_benchmark_results'), 'app_benchmark_results exists');
  });

  await t.test('2. Pillar 1: Knowledge Base & RAG retrieval with license and attribution', () => {
    const docs = retrieveCodingKnowledge({
      prompt: 'Build responsive grid with RTL support using CSS and JavaScript',
      limit: 4,
    });
    assert.ok(Array.isArray(docs));
    assert.ok(docs.length > 0, 'Returns retrieved knowledge documents');
    const first = docs[0];
    assert.ok(first.title);
    assert.ok(first.framework);
    assert.ok(first.license);
    assert.ok(first.version);
    assert.ok(first.snippet);
  });

  await t.test('3. Pillar 3 & 4: Isolated Sandbox & Browser Testing Runner', async () => {
    // 3a. Clean HTML passes with zero errors
    const validHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Test</title></head>
<body><div id="app"><h1>Hello</h1><button id="btn">Click</button></div>
<script>
  localStorage.setItem('k', 'v');
  document.getElementById('btn').onclick = function() { document.getElementById('app').innerHTML = 'Updated'; };
</script>
</body></html>`;

    const report = await runBrowserSuite({
      html: validHtml,
      requirements: [{ id: 'r1', title: 'Interactive button' }],
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.failed, 0);
    assert.ok(report.passRate >= 1.0);
    assert.equal(report.consoleErrors.length, 0);

    // 3b. HTML with console error fails zero-console-errors test
    const buggyHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head><body>
<script>console.error('Simulated runtime failure');</script>
</body></html>`;

    const failReport = await runBrowserSuite({
      html: buggyHtml,
      requirements: [],
    });

    assert.equal(failReport.status, 'failed');
    assert.ok(failReport.consoleErrors.length > 0);
    const zeroErrorTest = failReport.results.find(r => r.id === 'test_zero_console_errors');
    assert.ok(zeroErrorTest && !zeroErrorTest.pass);
  });

  await t.test('4. Pillar 5: Project Memory tracks decisions and learned fixes', () => {
    const memProj = builder.createProject(adminActor.id, {
      name: 'Memory Test App',
      description: 'Testing memory',
      prompt: 'Prompt for memory',
      slug: 'memory-test-app',
    }, adminActor);
    const projId = memProj.id;
    const initial = getMemory(projId);
    assert.equal(initial.projectId, projId);
    assert.deepEqual(initial.decisions, []);

    // Update memory
    updateMemory(projId, {
      techStack: { framework: 'vanilla-js', styling: 'custom-css' },
      decisions: [{ timestamp: new Date().toISOString(), decision: 'Used localStorage for offline data' }],
      summary: 'Smart offline app',
    });

    const updated = getMemory(projId);
    assert.equal(updated.techStack.framework, 'vanilla-js');
    assert.equal(updated.decisions.length, 1);

    // Record learned fix
    recordLearnedFix(projId, {
      errorSnippet: 'TypeError: Cannot read properties of null',
      fixDescription: 'Added DOMContentLoaded guard before accessing document elements',
      appliedTo: 'app.js',
    });

    const withFixes = getMemory(projId);
    assert.equal(withFixes.learnedFixes.length, 1);
    assert.equal(withFixes.learnedFixes[0].appliedTo, 'app.js');
  });

  let testProjectId = null;

  await t.test('5. Pillars 2, 3, 4: Multi-Role Orchestrator Pipeline', async () => {
    // Create a project first
    const p = builder.createProject(adminActor.id, {
      name: 'Smart Task App',
      description: 'Productivity manager',
      prompt: 'Build a smart todo list application with local storage and RTL layout',
      slug: 'smart-task-app',
    }, adminActor);
    testProjectId = p.id;

    // Run orchestrator
    const outcome = await orchestrateProject({
      projectId: testProjectId,
      prompt: 'Build a smart todo list application with local storage, filter buttons, and RTL layout',
      actor: adminActor,
    });

    assert.ok(outcome.runId);
    assert.ok(outcome.versionId);
    assert.equal(outcome.status, 'verified');
    assert.ok(outcome.assembledHtml.includes('<!DOCTYPE html>'));
    assert.ok(outcome.assembledHtml.includes('todo-input'));
    assert.equal(outcome.testReport.status, 'passed');

    // Verify DB records
    const runs = listProjectRuns(testProjectId);
    assert.ok(runs.length >= 1);
    assert.equal(runs[0].status, 'passed');

    const versions = db.prepare('SELECT * FROM app_project_versions WHERE project_id = ?').all(testProjectId);
    assert.ok(versions.length >= 1);
    assert.equal(versions[0].status, 'verified');

    const files = db.prepare('SELECT * FROM app_project_files_v2 WHERE project_id = ?').all(testProjectId);
    assert.ok(files.length >= 3);
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('index.html'));
    assert.ok(paths.includes('styles.css'));
    assert.ok(paths.includes('app.js'));
  });

  await t.test('6. Auto-Repair Loop triggers on test failure and records fix', async () => {
    const brokenFiles = {
      'index.html': '<div>Broken</div>',
      'styles.css': 'body { color: red; }',
      'app.js': 'throw new Error("Syntax broken");',
    };

    const repairOutcome = await autoRepairFiles({
      files: brokenFiles,
      testReport: {
        consoleErrors: ['Uncaught Error: Syntax broken'],
        results: [{ id: 'test_syntax', pass: false, message: 'Syntax broken' }],
      },
      prompt: 'Fix broken app',
      memory: { learnedFixes: [] },
      attempt: 1,
    });

    assert.ok(repairOutcome.files['app.js']);
    assert.ok(repairOutcome.fixDescription);
  });

  await t.test('7. Pillar 6: Continuous Evaluation & Benchmark Suite', async () => {
    assert.ok(BENCHMARK_TASKS.length >= 4);

    const report = await runBenchmarkSuite({
      taskName: 'todo_productivity',
      modelName: 'test-orchestrator-v2',
      actor: adminActor,
    });

    assert.ok(report.benchmarkId);
    assert.equal(report.overallStatus, 'passed');
    assert.equal(report.passRate, 1.0);
    assert.equal(report.passedCount, 1);
    assert.ok(report.totalDurationMs >= 0);
    assert.ok(report.totalTokens > 0);

    // List benchmark results
    const list = listBenchmarkResults();
    assert.ok(list.length >= 1);
    assert.equal(list[0].id, report.benchmarkId);
    assert.equal(list[0].status, 'passed');
  });

  t.after(() => {
    closeDb();
  });
});
