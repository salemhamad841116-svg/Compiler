#!/usr/bin/env node
// ==============================================================================
// Live AI diagnostics (Phase 5: open-source models). Run inside the backend container:
//   docker exec masruq_rag_backend node scripts/ai-diagnose.js
// Prints the effective routing per role (cloud/local endpoint + model), the cloud key
// order (masked) and local tool availability, then makes one real tiny call per role
// through exactly the same code path the pipeline uses, printing the provider's error.
// Exit code 0 = chat, OCR, embeddings (and transcription unless disabled) are working.
// ==============================================================================
require('dotenv').config();
const config = require('../src/config');
const settings = require('../src/services/settingsService');
const client = require('../src/services/ai/openaiCompatClient');
const tools = require('../src/services/ai/localTools');
const { provider } = require('../src/services/aiProvider');
const { closeDb } = require('../src/db/database');

(async () => {
  let ok = true;
  try {
    const cfg = settings.getAiConfig();
    const chain = settings.getCloudKeyChain();
    console.log('AI provider        :', config.aiProvider);
    console.log('Cloud endpoint     :', `${cfg.cloud.preset} @ ${cfg.cloud.baseUrl}`);
    console.log('Cloud key order    :', chain.length ? chain.map((k) => `${k.source} ${client.maskKey(k.key)}`).join(' -> ') : 'NONE (add a key in Admin > System Settings or set LLM_API_KEY)');
    console.log('Local endpoint     :', cfg.local.baseUrl);
    for (const [role, r] of Object.entries(cfg.roles)) {
      const extra = role === 'vision' && r.target !== 'tesseract' && r.tesseractFallback ? ' (+ tesseract fallback)' : '';
      console.log(`${(`Route ${role}`).padEnd(19)}:`, `${r.target}${r.target === 'tesseract' || r.target === 'disabled' ? '' : ` -> ${r.model}`}${extra}`);
    }
    console.log('Embedding identity :', settings.embedTagFor(cfg), `| similarity threshold ${cfg.similarityThreshold} | PDF OCR ${cfg.pdfOcr}`);
    if (process.env.GEMINI_API_KEY) console.log('Note               : GEMINI_API_KEY is set but no longer used; it can be removed.');
    const t = await tools.toolStatus();
    console.log('Local tools        :', Object.entries(t).map(([k, v]) => `${k}=${v.available ? 'yes' : 'MISSING'}`).join(' '));

    console.log('');
    for (const role of ['embeddings', 'chat', 'vision', 'transcription']) {
      const r = await provider().testRole(role);
      if (r.status === 'ok') {
        const info = r.dimensions ? `${r.dimensions} dimensions` : r.sample ? `"${String(r.sample).slice(0, 40)}"` : 'OK';
        console.log(`${role.padEnd(19)}: OK (${info}, ${r.ms} ms)`);
      } else {
        ok = false;
        console.error(`${role.padEnd(19)}: FAIL [${r.error.code}] ${r.error.message}`);
      }
    }
    if (cfg.roles.vision.tesseractFallback || cfg.roles.vision.target === 'tesseract') {
      if (!t.tesseract || !t.tesseract.available) console.warn('Warning            : Tesseract is not installed, so the OCR fallback is unavailable.');
    }
  } catch (e) {
    ok = false;
    console.error('Diagnostics failed:', e.message);
  } finally {
    closeDb();
  }
  console.log(ok ? '\nRESULT: AI pipeline is healthy.' : '\nRESULT: AI pipeline is NOT healthy (see errors above).');
  process.exit(ok ? 0 : 1);
})();
