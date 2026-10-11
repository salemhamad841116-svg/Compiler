const {
  getSupervisorAnalytics,
  getSupervisorAuditLogs,
  getSystemOverviewStats,
  getStoredBooksSummary,
  deleteDocumentByTitle,
  updateDocumentMetadata,
  getDocumentChunks,
  searchVectorDatabase,
} = require('../models/vectorDbModel');
const { generateVectorEmbedding } = require('../services/embeddingService');

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

/**
 * Retrieves all stored documents with full administrative metadata.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getAllDocuments(req, res) {
  try {
    const docs = await getStoredBooksSummary();
    return res.status(200).json({
      success: true,
      count: docs.length,
      data: docs,
    });
  } catch (error) {
    console.error('[Admin] Error fetching all documents:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve documents catalog.',
    });
  }
}

/**
 * Permanently deletes a document and all its vector chunks.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function deleteDocument(req, res) {
  try {
    const rawTitle = req.params.title || req.params.encodedTitle;
    if (!rawTitle) {
      return res.status(400).json({
        success: false,
        error: 'Document title parameter is required.',
      });
    }

    const decodedTitle = decodeURIComponent(rawTitle);
    const result = await deleteDocumentByTitle(decodedTitle);

    return res.status(200).json({
      success: true,
      message: `Document "${decodedTitle}" and ${result.deletedChunks} vector chunks were permanently deleted.`,
      data: result,
    });
  } catch (error) {
    console.error('[Admin] Error deleting document:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete document.',
    });
  }
}

/**
 * Updates metadata (title, category, language) across all chunks of a document.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function updateDocument(req, res) {
  try {
    const rawTitle = req.params.title || req.params.encodedTitle;
    if (!rawTitle) {
      return res.status(400).json({
        success: false,
        error: 'Document title parameter is required.',
      });
    }

    const decodedTitle = decodeURIComponent(rawTitle);
    const { newTitle, category, language } = req.body;

    const result = await updateDocumentMetadata(decodedTitle, {
      newTitle,
      category,
      language,
    });

    return res.status(200).json({
      success: true,
      message: `Document metadata updated successfully across ${result.updatedChunks} chunks.`,
      data: result,
    });
  } catch (error) {
    console.error('[Admin] Error updating document metadata:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to update document metadata.',
    });
  }
}

/**
 * Retrieves individual vector chunks for a specific document.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getDocumentChunksList(req, res) {
  try {
    const rawTitle = req.params.title || req.params.encodedTitle;
    if (!rawTitle) {
      return res.status(400).json({
        success: false,
        error: 'Document title parameter is required.',
      });
    }

    const decodedTitle = decodeURIComponent(rawTitle);
    const chunks = await getDocumentChunks(decodedTitle);

    return res.status(200).json({
      success: true,
      title: decodedTitle,
      count: chunks.length,
      data: chunks,
    });
  } catch (error) {
    console.error('[Admin] Error fetching document chunks:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve document chunks.',
    });
  }
}

/**
 * Runs a live vector similarity search test query for Super Admin diagnostic.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function searchVaultTest(req, res) {
  try {
    const { query, category, language, topK = 5, minSimilarity = 0.3 } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required.',
      });
    }

    const queryEmbedding = await generateVectorEmbedding(query.trim());
    const filterOptions = {};
    if (category && category !== 'All') filterOptions.category = category;
    if (language && language !== 'All') filterOptions.language = language;

    const results = await searchVectorDatabase(
      queryEmbedding,
      parseInt(topK, 10) || 5,
      parseFloat(minSimilarity) || 0.3,
      filterOptions
    );

    return res.status(200).json({
      success: true,
      query: query.trim(),
      matchesFound: results.length,
      data: results,
    });
  } catch (error) {
    console.error('[Admin] Error executing vector search test:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute vector search test.',
    });
  }
}

module.exports = {
  getSupervisorsList,
  getSupervisorDetails,
  getAuditLogs,
  getSystemOverview,
  getAllDocuments,
  deleteDocument,
  updateDocument,
  getDocumentChunksList,
  searchVaultTest,
};
