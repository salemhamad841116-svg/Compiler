const express = require('express');
const { requireAuth, requireRole, asyncHandler } = require('../auth/middleware');
const categories = require('../services/categoryService');

const router = express.Router();

/**
 * Public, read-only list used by the chat interface filter (id + name only, no counts).
 */
router.get(
  '/public',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: categories.listCategories().map((c) => ({ id: c.id, name: c.name })) });
  })
);

const authed = [requireAuth(), requireRole('supervisor', 'admin')];
const adminOnly = [requireAuth(), requireRole('admin')];

// Supervisors and admins read from the same single source of truth
router.get(
  '/',
  authed,
  asyncHandler(async (req, res) => {
    const data = categories.listCategories();
    res.json({ success: true, count: data.length, data });
  })
);

router.post(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    const created = categories.createCategory(req.body || {}, req.user);
    res.status(201).json({ success: true, message: `Category "${created.name}" created.`, data: created });
  })
);

router.put(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const updated = categories.updateCategory(req.params.id, req.body || {}, req.user);
    res.json({ success: true, data: updated });
  })
);

router.delete(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const reassignTo = req.query.reassignTo || (req.body && req.body.reassignTo) || null;
    const result = categories.deleteCategory(req.params.id, reassignTo, req.user);
    res.json({ success: true, data: result });
  })
);

module.exports = router;
