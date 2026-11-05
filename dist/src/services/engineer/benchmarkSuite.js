// ==============================================================================
// Engineer Continuous Evaluation & Benchmark Suite (Pillar 6)
// Standard benchmark suite evaluating pass rate, latency, tokens and costs.
// Tasks: Todo App, E-Commerce Store, Notes & Auth Portal, Analytics Dashboard.
// ==============================================================================

const crypto = require('node:crypto');
const { get, run, all } = require('../../db/database');
const { nowIso } = require('../../utils/clock');
const { orchestrateProject } = require('./orchestrator');

const BENCHMARK_TASKS = [
  {
    name: 'todo_productivity',
    title: 'Smart Todo & Task Manager',
    prompt: 'Build a smart task and todo management application with local storage persistence, active and completed filters, task counter, and RTL layout.',
    expectedElements: ['todo-input', 'todo-list', 'todo-form'],
  },
  {
    name: 'ecommerce_cart',
    title: 'Online Store & Shopping Cart',
    prompt: 'Build an e-commerce catalog with product cards, dynamic add to cart buttons, cart item list with quantity, price total calculation, and checkout modal.',
    expectedElements: ['product-grid', 'cart-count', 'cart-total', 'checkout-btn'],
  },
  {
    name: 'notes_auth_portal',
    title: 'User Workspace & Note Taking',
    prompt: 'Build a private notes portal with item creation, search input, persistent local entries, and responsive card styling with RTL support.',
    expectedElements: ['data-input', 'save-btn', 'data-entries'],
  },
  {
    name: 'analytics_dashboard',
    title: 'Executive Analytics Dashboard',
    prompt: 'Build an analytics dashboard with key metric stat cards, dynamic data entries, status indicators, and clean layout.',
    expectedElements: ['data-input', 'save-btn', 'data-entries'],
  },
];

/**
 * Runs a single benchmark task or the complete benchmark suite.
 */
async function runBenchmarkSuite({ taskName = null, modelName = 'default-model', actor = null } = {}) {
  const startedAt = Date.now();
  const tasksToRun = taskName
    ? BENCHMARK_TASKS.filter(t => t.name === taskName)
    : BENCHMARK_TASKS;

  if (tasksToRun.length === 0) {
    throw new Error('Unknown benchmark task: ' + taskName);
  }

  const results = [];
  let totalPassed = 0;
  let totalDurationMs = 0;
  let totalTokens = 0;

  for (const task of tasksToRun) {
    const taskStart = Date.now();
    const benchmarkProjectId = 'bench_' + task.name + '_' + Date.now().toString(36);

    // Create a temporary project record for the benchmark
    const now = nowIso();
    const ownerId = actor?.id || 'usr_system_bench';
    
    // Ensure owner exists or insert fallback
    const owner = get('SELECT id FROM users WHERE id = ?', ownerId);
    if (!owner) {
      run(`
        INSERT OR IGNORE INTO users (id, role, name, email, password_hash, status, created_at, app_source)
        VALUES (?, 'admin', 'Benchmark Agent', 'bench@misruq.com', 'hash', 'active', ?, 'sanea')
      `, ownerId, now);
    }

    run(`
      INSERT INTO app_projects (id, user_id, name, slug, description, prompt, status, html, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'in_progress', '', ?, ?)
    `, benchmarkProjectId, ownerId, task.title, 'bench-' + task.name, 'Automated benchmark task', task.prompt, now, now);

    try {
      const outcome = await orchestrateProject({
        projectId: benchmarkProjectId,
        prompt: task.prompt,
        actor: actor || { id: ownerId, name: 'Benchmark Agent', role: 'admin' },
      });

      const passed = outcome.status === 'verified';
      if (passed) totalPassed += 1;

      const durationMs = Date.now() - taskStart;
      totalDurationMs += durationMs;
      const tokensEstimate = 1500 + outcome.repairAttempts * 450;
      totalTokens += tokensEstimate;

      results.push({
        task: task.name,
        title: task.title,
        status: outcome.status,
        passed,
        repairAttempts: outcome.repairAttempts,
        passRate: outcome.testReport?.passRate || (passed ? 1.0 : 0.0),
        durationMs,
        tokensEstimate,
        runId: outcome.runId,
      });
    } catch (err) {
      results.push({
        task: task.name,
        title: task.title,
        status: 'failed',
        passed: false,
        error: err.message,
        durationMs: Date.now() - taskStart,
        tokensEstimate: 0,
      });
    }
  }

  const overallPassRate = tasksToRun.length > 0 ? (totalPassed / tasksToRun.length) : 0;
  const benchmarkId = 'bm_' + crypto.randomUUID().slice(0, 12);
  const costEstimate = Number(((totalTokens / 1000) * 0.002).toFixed(4));
  const overallStatus = overallPassRate >= 1.0 ? 'passed' : 'failed';

  const report = {
    benchmarkId,
    modelName,
    overallStatus,
    tasksCount: tasksToRun.length,
    passedCount: totalPassed,
    passRate: overallPassRate,
    totalDurationMs,
    totalTokens,
    costEstimate,
    results,
    createdAt: nowIso(),
  };

  run(`
    INSERT INTO app_benchmark_results (id, benchmark_name, model_name, status, pass_rate, duration_ms, tokens_used, cost_estimate, report_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    benchmarkId,
    taskName || 'full_suite',
    modelName,
    overallStatus,
    overallPassRate,
    totalDurationMs,
    totalTokens,
    costEstimate,
    JSON.stringify(report),
    report.createdAt
  );

  return report;
}

/**
 * List historical benchmark runs
 */
function listBenchmarkResults(limit = 20) {
  const rows = all('SELECT * FROM app_benchmark_results ORDER BY created_at DESC LIMIT ?', limit);
  return rows.map(r => ({
    ...r,
    report: r.report_json ? JSON.parse(r.report_json) : null,
  }));
}

module.exports = {
  BENCHMARK_TASKS,
  runBenchmarkSuite,
  listBenchmarkResults,
};
