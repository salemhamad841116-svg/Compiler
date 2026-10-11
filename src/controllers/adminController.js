const {
  getSupervisorAnalytics,
  getSupervisorAuditLogs,
  getSystemOverviewStats,
} = require('../models/vectorDbModel');

/**
 * Retrieves summary metrics for all supervisors.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getSupervisorsList(req, res) {
  try {
    const supervisors = await getSupervisorAnalytics();
    return res.status(200).json({
      success: true,
      count: supervisors.length,
      data: supervisors,
    });
  } catch (error) {
    console.error('[Admin] Error fetching supervisors list:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve supervisors analytics.',
    });
  }
}

/**
 * Retrieves comprehensive supervisor audit logs and aggregated metrics.
 * Supports optional query filter: ?supervisorId=...
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getAuditLogs(req, res) {
  try {
    const supervisorId = req.query.supervisorId || null;
    const auditData = await getSupervisorAuditLogs(supervisorId);
    return res.status(200).json({
      success: true,
      data: auditData,
    });
  } catch (error) {
    console.error('[Admin] Error fetching supervisor audit logs:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve supervisor audit logs.',
    });
  }
}

/**
 * Retrieves granular analytics for a specific supervisor.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getSupervisorDetails(req, res) {
  try {
    const { supervisorId } = req.params;
    if (!supervisorId) {
      return res.status(400).json({
        success: false,
        error: 'supervisorId parameter is required.',
      });
    }

    const details = await getSupervisorAnalytics(decodeURIComponent(supervisorId));
    return res.status(200).json({
      success: true,
      data: details,
    });
  } catch (error) {
    console.error('[Admin] Error fetching supervisor details:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve supervisor detail record.',
    });
  }
}

/**
 * Retrieves global system ecosystem overview for Super Admin.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getSystemOverview(req, res) {
  try {
    const stats = await getSystemOverviewStats();
    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('[Admin] Error fetching system overview stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve system stats.',
    });
  }
}

module.exports = {
  getSupervisorsList,
  getSupervisorDetails,
  getAuditLogs,
  getSystemOverview,
};
