const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

// GET all categories
router.get('/', categoryController.listCategories);

// GET single category
router.get('/:id', categoryController.getCategory);

// POST create category
router.post('/', categoryController.createCategory);

// PUT update category
router.put('/:id', categoryController.updateCategory);

// DELETE category
router.delete('/:id', categoryController.deleteCategory);

module.exports = router;
