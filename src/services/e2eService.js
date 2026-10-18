// ==============================================================================
// End-to-end self-test (Phase 4). Proves, with the LIVE AI provider, that the
// full chain works across the platform:
//   supervisor-style upload -> job queue -> extraction -> embeddings -> chunks
//   -> admin visibility (stats/analytics) -> public chat retrieval + grounded answer.
// The probe document is deleted afterwards. Note: like any real upload, the probe
// is recorded in the append-only audit log (visible in the activity log) but is excluded from the
// lifetime counters by its title prefix (statsService.E2E_PROBE_TITLE_PREFIX).
// ==============================================================================
const crypto = require('crypto');
const { get } = require('../db/database');
const documents = require('./documentService');
const jobQueue = require('./jobQueue');
const stats = require('./statsService');
const audit = require('./auditService');

let running = false;

async function waitForTerminal(docId, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const d = get('SELECT id, index_status, ocr_status, chunk_count, failure_code, failure_reason FROM documents WHERE id = ?', docId);
    if (!d) throw Object.assign(new Error('Probe document disappeared.'), { code: 'E2E_PROBE_MISSING' });
    if (d.index_status === 'completed' || d.index_status === 'failed' || d.ocr_status === 'failed') return d;
    if (Date.now() - t0 > timeoutMs) throw Object.assign(new Error(`Processing did not finish within ${timeoutMs / 1000}s.`), { code: 'E2E_TIMEOUT' });
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * @param {Object} actor - admin running the test (becomes the probe owner)
 * @returns {Promise<{ok: boolean, token: string, stages: Array<{stage: string, ok: boolean, ms: number, detail: Object}>}>}
 */
async function runSelfTest(actor, { ip, timeoutMs = 180000 } = {}) {
  if (running) {
    const { AppError } = require('../utils/errors');
    throw new AppError(409, 'E2E_ALREADY_RUNNING', 'An end-to-end self-test is already running.');
  }
  running = true;
  const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
  const token = `MSRQ-${hex}`;
  const stages = [];
  let probeId = null;
  const step = async (stage, fn) => {
    const t0 = Date.now();
    try {
      const detail = (await fn()) || {};
      const ok = detail.ok !== false;
      delete detail.ok;
      stages.push({ stage, ok, ms: Date.now() - t0, detail });
      return ok;
    } catch (e) {
      stages.push({ stage, ok: false, ms: Date.now() - t0, detail: { code: e.code || 'E2E_ERROR', message: String(e.message).slice(0, 400) } });
      return false;
    }
  };
  console.log(`[E2E] self-test ${token} started by ${actor.email || actor.id}`);

  try {
    const cat = get('SELECT id, name FROM categories ORDER BY created_at LIMIT 1');
    const text = [
      `Misruq platform end-to-end verification record.`,
      `The secret verification code for this self-test is ${token}.`,
      `This record exists only to verify OCR, embeddings, indexing and chat retrieval, and is deleted automatically.`,
    ].join(' ');

    let ok = await step('upload', async () => {
      const doc = await documents.storeRawText({
        title: `${stats.E2E_PROBE_TITLE_PREFIX}${hex}`, textContent: text, body: { categoryId: cat && cat.id, language: 'English' }, actor, ip,
      });
      probeId = doc.id;
      jobQueue.enqueue(doc.id);
      return { documentId: doc.id, category: cat && cat.name };
    });

    if (ok) {
      ok = await step('processing', async () => {
        const d = await waitForTerminal(probeId, timeoutMs);
        if (d.index_status !== 'completed') {
          return { ok: false, code: d.failure_code, message: d.failure_reason };
        }
        return { chunks: d.chunk_count };
      });
    }

    if (ok) {
      ok = await step('admin_visibility', async () => {
        const listed = documents.listDocuments({ q: probeId }, actor);
        const items = listed.items || listed.data || listed;
        const row = Array.isArray(items) ? items.find((x) => x.id === probeId) : null;
        const analytics = stats.ingestionAnalytics();
        return { ok: Boolean(row && row.pipelineStatus === 'completed'), listedStatus: row ? row.pipelineStatus : null, totalBooks: analytics.totalBooks };
      });
    }

    if (ok) {
      let answerStage = null;
      ok = await step('chat_retrieval', async () => {
        const { retrieveAndAnswer } = require('../controllers/chatController');
        const question = 'What is the secret verification code for the Misruq end-to-end self-test?';
        // Threshold 0 here so we can REPORT the real score; the check below compares it to the chat threshold.
        const { answer, chunks, threshold } = await retrieveAndAnswer(question, { topK: 5, minSimilarity: 0 });
        const chatThreshold = (() => { const v = parseFloat(process.env.SIMILARITY_THRESHOLD); return Number.isFinite(v) ? v : 0.45; })();
        const top = chunks[0];
        const topIsProbe = Boolean(top && top.documentId === probeId);
        const similarity = top ? Number(top.similarity.toFixed(4)) : null;
        const answerHasToken = String(answer).includes(token);
        answerStage = { stage: 'chat_answer', ok: answerHasToken, ms: 0, detail: { answerHasToken, answerPreview: String(answer).slice(0, 240) } };
        return {
          ok: topIsProbe && similarity >= chatThreshold,
          topIsProbe,
          similarity,
          chatThreshold,
          usedThreshold: threshold,
          candidates: chunks.length,
        };
      });
      if (answerStage) stages.push(answerStage); // reported right after retrieval, in pipeline order
    }
  } finally {
    if (probeId) {
      await step('cleanup', async () => {
        const r = documents.deleteDocument(probeId, actor);
        return { deleted: r.deleted, chunksDeleted: r.chunksDeleted };
      });
    }
    running = false;
  }

  const ok = stages.length > 0 && stages.every((s) => s.ok);
  audit.record({ action: 'system.e2e_test', actor, ip, outcome: ok ? 'success' : 'failed', detail: { token, stages: stages.map((s) => ({ stage: s.stage, ok: s.ok, ms: s.ms })) } });
  console.log(`[E2E] self-test ${token} ${ok ? 'PASSED' : 'FAILED'}: ${stages.map((s) => `${s.stage}=${s.ok ? 'ok' : 'FAIL'}`).join(' ')}`);
  return { ok, token, stages };
}

module.exports = { runSelfTest };
