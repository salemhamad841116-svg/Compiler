const categoryModel = require('../models/categoryModel');

/**
 * Controller handling Dynamic Category Management (CRUD).
 */
async function listCategories(req, res) {
  try {
    const categories = categoryModel.getAllCategories();
    return res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (err) {
    console.error('[Categories] Error listing categories:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve categories list.',
    });
  }
}

async function getCategory(req, res) {
  try {
    const { id } = req.params;
    const category = categoryModel.getCategoryById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        error: `Category with ID "${id}" not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      data: category,
    });
  } catch (err) {
    console.error('[Categories] Error fetching category:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch category.',
    });
  }
}

async function createCategory(req, res) {
  try {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'A valid "name" string is required for the category.',
      });
    }

    const created = categoryModel.createCategory({ name, description });
    return res.status(201).json({
      success: true,
      message: `Category "${created.name}" created successfully.`,
      data: created,
    });
  } catch (err) {
    console.error('[Categories] Error creating category:', err);
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to create category.',
    });
  }
}

async function updateCategory(req, res) {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const updated = categoryModel.updateCategory(id, { name, description });
    return res.status(200).json({
      success: true,
      message: `Category "${updated.name}" updated successfully.`,
      data: updated,
    });
  } catch (err) {
    console.error('[Categories] Error updating category:', err);
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to update category.',
    });
  }
}

async function deleteCategory(req, res) {
  try {
    const { id } = req.params;
    categoryModel.deleteCategory(id);
    return res.status(200).json({
      success: true,
      message: 'Category deleted successfully.',
    });
  } catch (err) {
    console.error('[Categories] Error deleting category:', err);
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to delete category.',
    });
  }
}

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
};
