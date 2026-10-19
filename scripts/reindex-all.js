#!/usr/bin/env node
// ==============================================================================
// Rebuilds the search index with the ACTIVE embedding model (Phase 5 migration:
// Gemini vectors -> open-source bge-m3). Same logic as the admin button
// "Rebuild search index" (System Settings > Search index).
//
// Run inside the backend container while the server is running:
//   docker exec masruq_rag_backend node scripts/reindex-all.js --dry-run
//   docker exec masruq_rag_backend node scripts/reindex-all.js
//
// Options:
//   --dry-run      report what would happen; changes nothing (pre-flight still runs)
//   --all          re-index EVERY document (also the ones already on the active model)
//   --only-failed  re-queue failed documents only (no stale-vector purge of good ones)
//
// Default mode ("stale"): purge chunks produced by any other embedding model, then
// re-queue those documents plus every failed document whose file is still in the vault.
//
// Safety: a pre-flight embedding call against the active model must succeed before
// anything is deleted. Jobs live in the shared SQLite database, so the running
// server's queue picks them up within ~2 seconds.
// ==============================================================================
require('dotenv').config();
const indexService = require('../src/services/indexService');
const { closeDb } = require('../src/db/database');

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log('Usage: node scripts/reindex-all.js [--dry-run] [--all | --only-failed]');
  process.exit(0);
}
if (args.has('--all') && args.has('--only-failed')) {
  console.error('Choose either --all or --only-failed, not both.');
  process.exit(2);
}
const mode = args.has('--all') ? 'all' : args.has('--only-failed') ? 'failed' : 'stale';
const dryRun = args.has('--dry-run');
const SYSTEM_ADMIN = { id: null, name: 'system (scripts/reindex-all.js)', role: 'admin' };

function printStatus(s) {
  console.log(`Active embedding model : ${s.activeModel}`);
  console.log(`Chunks by model        : ${s.byModel.length ? s.byModel.map((m) => `${m.model}=${m.chunks}${m.active ? ' (active)' : ''}`).join(', ') : 'none'}`);
  console.log(`Documents              : total ${s.documents.total}, searchable ${s.documents.searchable}, stale ${s.documents.stale}, failed ${s.documents.failed}, in progress ${s.documents.inProgress}`);
}

(async () => {
  let code = 0;
  try {
    printStatus(indexService.status());
    console.log(`\nMode: ${mode}${dryRun ? ' (dry run - nothing will be changed)' : ''}`);
    const r = await indexService.rebuild({ mode, dryRun, actor: SYSTEM_ADMIN });
    const p = r.preflight;
    console.log(`Pre-flight embedding   : ${p.ok ? `OK (${p.dimensions} dimensions, ${p.ms} ms)` : `FAILED ${p.code}: ${p.message}`}`);
    console.log(`Candidate documents    : ${r.documents}`);
    console.log(`Skipped                : ${r.skipped}${r.skipped ? ` (first ${r.skippedDetails.length}: ${r.skippedDetails.map((d) => `${d.title || d.id}=${d.code}`).join('; ')})` : ''}`);
    if (dryRun) {
      console.log(`Would purge chunks     : ${r.chunksToPurge}`);
      console.log(`Would re-queue         : ${r.documents - r.skipped}`);
      if (!p.ok) {
        console.log('\nThe real run would ABORT because the pre-flight failed. Fix the embedding route in System Settings first.');
        code = 1;
      }
    } else {
      console.log(`Chunks purged          : ${r.chunksPurged}`);
      console.log(`Documents re-queued    : ${r.queued}`);
      console.log('\nFollow progress with: docker logs -f masruq_rag_backend | grep Pipeline');
    }
  } catch (e) {
    console.error(`\nRebuild aborted${e.code ? ` (${e.code})` : ''}: ${e.message}`);
    code = 1;
  } finally {
    closeDb();
  }
  process.exit(code);
})();
