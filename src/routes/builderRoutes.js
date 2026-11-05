const express = require('express');
const { requireAuth, requireRole, asyncHandler } = require('../auth/middleware');
const { AppError } = require('../utils/errors');
const builder = require('../services/builderService');
const authService = require('../auth/authService');
const {
  orchestrateProject,
  listProjectRuns,
  getRunDetails,
} = require('../services/engineer/orchestrator');
const { getMemory } = require('../services/engineer/projectMemory');
const { retrieveCodingKnowledge } = require('../services/engineer/knowledgeRetriever');
const {
  runBenchmarkSuite,
  listBenchmarkResults,
} = require('../services/engineer/benchmarkSuite');

const clientRouter = express.Router();
clientRouter.use(requireAuth());

clientRouter.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const data = builder.listUserProjects(req.user.id);
    res.json({ success: true, data });
  })
);

clientRouter.post(
  '/projects',
  asyncHandler(async (req, res) => {
    const data = builder.createProject(req.user.id, req.body, req.user);
    res.status(201).json({ success: true, data });
  })
);

clientRouter.get(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const data = builder.getProject(req.params.id, req.user.id, req.user.role === 'admin');
    res.json({ success: true, data });
  })
);

clientRouter.put(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const data = builder.updateProject(
      req.params.id,
      req.user.id,
      req.body,
      req.user.role === 'admin',
      req.user
    );
    res.json({ success: true, data });
  })
);

clientRouter.delete(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const data = builder.deleteProject(
      req.params.id,
      req.user.id,
      req.user.role === 'admin',
      req.user
    );
    res.json({ success: true, data });
  })
);

clientRouter.get(
  '/projects/:id/requests',
  asyncHandler(async (req, res) => {
    const data = builder.listProjectRequests(
      req.params.id,
      req.user.id,
      req.user.role === 'admin'
    );
    res.json({ success: true, data });
  })
);

clientRouter.post(
  '/projects/:id/requests',
  asyncHandler(async (req, res) => {
    const data = builder.createProjectRequest(
      req.params.id,
      req.user.id,
      req.body,
      req.user
    );
    res.status(201).json({ success: true, data });
  })
);

clientRouter.get(
  '/projects/:id/files',
  asyncHandler(async (req, res) => {
    const data = builder.listProjectFiles(
      req.params.id,
      req.user.id,
      req.user.role === 'admin'
    );
    res.json({ success: true, data });
  })
);

clientRouter.post(
  '/projects/:id/files',
  asyncHandler(async (req, res) => {
    const data = builder.addProjectFile(
      req.params.id,
      req.user.id,
      req.body,
      req.user
    );
    res.status(201).json({ success: true, data });
  })
);

// -----------------------------------------------------------------------------
// Engineer Intelligence & Orchestration Endpoints
// -----------------------------------------------------------------------------
clientRouter.post(
  '/projects/:id/build',
  asyncHandler(async (req, res) => {
    builder.getProject(req.params.id, req.user.id, req.user.role === 'admin');
    const prompt = req.body.prompt;
    if (!prompt || !prompt.trim()) {
      throw new AppError(400, 'PROMPT_REQUIRED', 'Prompt is required.');
    }
    const result = await orchestrateProject({
      projectId: req.params.id,
      prompt: prompt.trim(),
      actor: req.user,
    });
    res.json({ success: true, data: result });
  })
);

clientRouter.get(
  '/projects/:id/runs',
  asyncHandler(async (req, res) => {
    builder.getProject(req.params.id, req.user.id, req.user.role === 'admin');
    const data = listProjectRuns(req.params.id);
    res.json({ success: true, data });
  })
);

clientRouter.get(
  '/projects/:id/runs/:runId',
  asyncHandler(async (req, res) => {
    builder.getProject(req.params.id, req.user.id, req.user.role === 'admin');
    const data = getRunDetails(req.params.runId);
    res.json({ success: true, data });
  })
);

clientRouter.get(
  '/projects/:id/memory',
  asyncHandler(async (req, res) => {
    builder.getProject(req.params.id, req.user.id, req.user.role === 'admin');
    const data = getMemory(req.params.id);
    res.json({ success: true, data });
  })
);

clientRouter.get(
  '/knowledge',
  asyncHandler(async (req, res) => {
    const { query = '', framework = null, limit = 10 } = req.query;
    const data = retrieveCodingKnowledge({
      prompt: query,
      framework,
      limit: parseInt(limit, 10) || 10,
    });
    res.json({ success: true, data });
  })
);

// -----------------------------------------------------------------------------
// Admin Router
// -----------------------------------------------------------------------------
const adminRouter = express.Router();
adminRouter.use(requireAuth(), requireRole('admin'));

adminRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const data = builder.adminGetStats();
    res.json({ success: true, data });
  })
);

adminRouter.get(
  '/clients',
  asyncHandler(async (req, res) => {
    const { search, status, limit, offset } = req.query;
    const data = builder.adminListClients({
      search,
      status,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ success: true, data });
  })
);

adminRouter.post(
  '/clients',
  asyncHandler(async (req, res) => {
    const { name, email } = req.body;
    const result = authService.createUser(
      { name, email, role: 'supervisor', appSource: 'sanea' },
      req.user
    );
    res.status(201).json({ success: true, data: result });
  })
);

adminRouter.patch(
  '/clients/:id/status',
  asyncHandler(async (req, res) => {
    const data = builder.adminUpdateClientStatus(req.params.id, req.body.status, req.user);
    res.json({ success: true, data });
  })
);

adminRouter.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const { status, search, limit, offset } = req.query;
    const data = builder.adminListProjects({
      status,
      search,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ success: true, data });
  })
);

adminRouter.patch(
  '/projects/:id/status',
  asyncHandler(async (req, res) => {
    const data = builder.adminUpdateProjectStatus(req.params.id, req.body.status, req.user);
    res.json({ success: true, data });
  })
);

adminRouter.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const { status, search, limit, offset } = req.query;
    const data = builder.adminListRequests({
      status,
      search,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ success: true, data });
  })
);

adminRouter.patch(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    const data = builder.adminUpdateRequest(req.params.id, req.body, req.user);
    res.json({ success: true, data });
  })
);

adminRouter.post(
  '/benchmarks/run',
  asyncHandler(async (req, res) => {
    const { taskName, modelName } = req.body;
    const data = await runBenchmarkSuite({
      taskName: taskName || null,
      modelName: modelName || 'default-model',
      actor: req.user,
    });
    res.json({ success: true, data });
  })
);

adminRouter.get(
  '/benchmarks',
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
    const data = listBenchmarkResults(limit);
    res.json({ success: true, data });
  })
);

module.exports = { clientRouter, adminRouter };
