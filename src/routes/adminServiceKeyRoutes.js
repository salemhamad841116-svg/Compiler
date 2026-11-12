const express = require('express');
const { requireRole, asyncHandler } = require('../auth/middleware');
const serviceKeyService = require('../services/serviceKeyService');

const router = express.Router();

router.use(requireRole('admin'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const keys = serviceKeyService.listKeys();
    res.json({ keys });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, appSlug, scope, allowedCategoryIds, forbiddenCategoryIds } = req.body;
    const created = serviceKeyService.createServiceKey({
      name,
      appSlug,
      scope,
      allowedCategoryIds,
      forbiddenCategoryIds,
      createdBy: req.user ? req.user.id : null,
      actor: req.user ? { id: req.user.id, email: req.user.email, name: req.user.name } : null,
    });
    res.status(201).json(created);
  })
);

router.post(
  '/:id/revoke',
  asyncHandler(async (req, res) => {
    const result = serviceKeyService.revokeKey(req.params.id, req.user);
    res.json(result);
  })
);

module.exports = router;
