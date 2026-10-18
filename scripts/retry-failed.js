#!/usr/bin/env node
// ==============================================================================
// Re-queues every failed document (file still in the vault) for processing.
// Run inside the backend container while the server is running:
//   docker exec masruq_rag_backend node scripts/retry-failed.js
// The running server's queue picks the jobs up within ~2 seconds
// (jobs live in the shared SQLite database). Safe to run repeatedly.
// ==============================================================================
require('dotenv').config();
const jobQueue = require('../src/services/jobQueue');
const { closeDb } = require('../src/db/database');

const SYSTEM_ADMIN = { id: null, name: 'system (scripts/retry-failed.js)', role: 'admin' };
const r = jobQueue.retryAllFailed(SYSTEM_ADMIN);
console.log(`Failed documents: ${r.failed} | re-queued: ${r.queued} | skipped: ${r.skipped}`);
if (r.skipped) console.log('Skipped (first 50):', r.skippedDetails);
console.log('Follow progress with: docker logs -f masruq_rag_backend | grep Pipeline');
closeDb();
