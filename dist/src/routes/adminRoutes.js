const express = require('express');
const {
  getSupervisorsList,
  getSupervisorDetails,
  getAuditLogs,
  getSystemOverview,
  getAllDocuments,
  deleteDocument,
  updateDocument,
  getDocumentChunksList,
  searchVaultTest,
} = require('../controllers/adminController');

const router = express.Router();

// GET all supervisors with aggregated stats
router.get('/supervisors', getSupervisorsList);

// GET comprehensive supervisor audit logs and lifetime totals
router.get('/audit-logs', getAuditLogs);

// GET specific supervisor details and indexed document list
router.get('/supervisors/:supervisorId', getSupervisorDetails);

// GET global system overview metrics
router.get('/overview', getSystemOverview);

// Document Management & Control Endpoints
router.get('/documents', getAllDocuments);
router.delete('/documents/:title', deleteDocument);
router.put('/documents/:title', updateDocument);
router.get('/documents/:title/chunks', getDocumentChunksList);

// Diagnostic Vector Search Test Endpoint
router.post('/search-test', searchVaultTest);

module.exports = router;

