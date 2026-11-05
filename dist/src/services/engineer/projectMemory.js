// ==============================================================================
// Engineer Project Memory Service (Pillar 5)
// Tracks architectural decisions, tech stack, and proven error fixes across sessions.
// ==============================================================================
const { get, run } = require('../../db/database');
const { nowIso } = require('../../utils/clock');

function getMemory(projectId) {
  const row = get('SELECT * FROM app_project_memory WHERE project_id = ?', projectId);
  if (!row) {
    return {
      projectId,
      techStack: {},
      decisions: [],
      learnedFixes: [],
      summary: '',
      updatedAt: nowIso(),
    };
  }
  return {
    projectId: row.project_id,
    techStack: safeJson(row.tech_stack, {}),
    decisions: safeJson(row.decisions, []),
    learnedFixes: safeJson(row.learned_fixes, []),
    summary: row.summary || '',
    updatedAt: row.updated_at,
  };
}

function saveMemory(projectId, data = {}) {
  const existing = get('SELECT project_id FROM app_project_memory WHERE project_id = ?', projectId);
  const now = nowIso();
  const techStack = JSON.stringify(data.techStack || {});
  const decisions = JSON.stringify(data.decisions || []);
  const learnedFixes = JSON.stringify(data.learnedFixes || []);
  const summary = String(data.summary || '');

  if (existing) {
    run(
      `UPDATE app_project_memory 
         SET tech_stack = ?, decisions = ?, learned_fixes = ?, summary = ?, updated_at = ?
         WHERE project_id = ?`,
      techStack, decisions, learnedFixes, summary, now, projectId
    );
  } else {
    run(
      `INSERT INTO app_project_memory (project_id, tech_stack, decisions, learned_fixes, summary, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      projectId, techStack, decisions, learnedFixes, summary, now
    );
  }
  return getMemory(projectId);
}

const updateMemory = saveMemory;

function recordDecision(projectId, decisionText) {
  const mem = getMemory(projectId);
  const item = {
    decision: String(decisionText).trim(),
    recordedAt: nowIso(),
  };
  mem.decisions.push(item);
  if (mem.decisions.length > 20) mem.decisions.shift();
  return saveMemory(projectId, mem);
}

function recordLearnedFix(projectId, { issue, fix, file = '', errorSnippet, fixDescription, appliedTo }) {
  const mem = getMemory(projectId);
  const item = {
    issue: String(errorSnippet || issue || '').slice(0, 300),
    fix: String(fixDescription || fix || '').slice(0, 300),
    file: String(appliedTo || file || ''),
    appliedTo: String(appliedTo || file || ''),
    appliedAt: nowIso(),
  };
  mem.learnedFixes.push(item);
  if (mem.learnedFixes.length > 15) mem.learnedFixes.shift();
  return saveMemory(projectId, mem);
}

function formatMemoryContext(projectId) {
  const mem = getMemory(projectId);
  const parts = [];

  if (Object.keys(mem.techStack).length > 0) {
    parts.push('Tech Stack: ' + JSON.stringify(mem.techStack));
  }
  if (mem.decisions.length > 0) {
    parts.push('Architectural Decisions:\n' + mem.decisions.map((d, i) => `- [${i + 1}] ${d.decision}`).join('\n'));
  }
  if (mem.learnedFixes.length > 0) {
    parts.push('Proven Past Fixes:\n' + mem.learnedFixes.map((f) => `- In ${f.file || 'code'}: ${f.issue} -> Fixed by: ${f.fix}`).join('\n'));
  }
  if (mem.summary) {
    parts.push('Project State Summary: ' + mem.summary);
  }

  return parts.join('\n\n');
}

function safeJson(str, def) {
  if (!str) return def;
  try { return JSON.parse(str); } catch (_) { return def; }
}

module.exports = {
  getMemory,
  saveMemory,
  updateMemory,
  recordDecision,
  recordLearnedFix,
  formatMemoryContext,
};
