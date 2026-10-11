const express = require('express');
const {
  getSupervisorsList,
  getSupervisorDetails,
  getSystemOverview,
} = require('../controllers/adminController');

const router = express.Router();

// GET all supervisors with aggregated stats
router.get('/supervisors', getSupervisorsList);

// GET specific supervisor details and indexed document list
router.get('/supervisors/:supervisorId', getSupervisorDetails);

// GET global system overview metrics
router.get('/overview', getSystemOverview);

module.exports = router;
