const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const CATEGORIES_FILE_PATH = process.env.CATEGORIES_FILE_PATH || path.join(DATA_DIR, 'categories.json');
const BACKUP_FILE_PATH = `${CATEGORIES_FILE_PATH}.bak`;

const INITIAL_SEED_CATEGORIES = [
  { id: 'cat_hadith', name: 'Hadith', description: 'Prophetic traditions and narrations', createdAt: new Date().toISOString() },
  { id: 'cat_medicine', name: 'Medicine', description: 'Medical sciences, pharmacology, and treatments', createdAt: new Date().toISOString() },
  { id: 'cat_english_lang', name: 'English Language', description: 'English linguistics, grammar, and literature', createdAt: new Date().toISOString() },
  { id: 'cat_arabic_lang', name: 'Arabic Language', description: 'Arabic linguistics, rhetoric, and morphology', createdAt: new Date().toISOString() },
  { id: 'cat_arabic_dict', name: 'Arabic Dictionary', description: 'Classical and modern Arabic lexicons and glossaries', createdAt: new Date().toISOString() },
  { id: 'cat_english_dict', name: 'English Dictionary', description: 'English lexicons, thesauri, and vocabularies', createdAt: new Date().toISOString() },
];

function ensureStorageExists() {
  const dir = path.dirname(CATEGORIES_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(CATEGORIES_FILE_PATH)) {
    fs.writeFileSync(CATEGORIES_FILE_PATH, JSON.stringify(INITIAL_SEED_CATEGORIES, null, 2), 'utf-8');
    console.log('[Categories] Seeded initial categories database with 6 default topics.');
  }
}

function loadCategories() {
  ensureStorageExists();
  try {
    const raw = fs.readFileSync(CATEGORIES_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed) || parsed.length === 0) {
      fs.writeFileSync(CATEGORIES_FILE_PATH, JSON.stringify(INITIAL_SEED_CATEGORIES, null, 2), 'utf-8');
      return INITIAL_SEED_CATEGORIES;
    }
    return parsed;
  } catch (err) {
    console.error('[Categories] Error reading categories file, checking backup:', err.message);
    if (fs.existsSync(BACKUP_FILE_PATH)) {
      try {
        const backupRaw = fs.readFileSync(BACKUP_FILE_PATH, 'utf-8');
        const backupParsed = JSON.parse(backupRaw || '[]');
        if (Array.isArray(backupParsed) && backupParsed.length > 0) return backupParsed;
      } catch (backupErr) {
        console.error('[Categories] Error reading backup file:', backupErr.message);
      }
    }
    return INITIAL_SEED_CATEGORIES;
  }
}

function saveCategories(categories) {
  ensureStorageExists();
  const tempPath = `${CATEGORIES_FILE_PATH}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(categories, null, 2), 'utf-8');
    if (fs.existsSync(CATEGORIES_FILE_PATH)) {
      fs.copyFileSync(CATEGORIES_FILE_PATH, BACKUP_FILE_PATH);
    }
    fs.renameSync(tempPath, CATEGORIES_FILE_PATH);
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    throw err;
  }
}

/**
 * Returns all active categories.
 * @returns {Array<{ id: string, name: string, description?: string, createdAt: string }>}
 */
function getAllCategories() {
  return loadCategories();
}

/**
 * Finds a category by its unique ID.
 * @param {string} id
 * @returns {Object|null}
 */
function getCategoryById(id) {
  const categories = loadCategories();
  return categories.find((c) => c.id === id) || null;
}

/**
 * Creates and saves a new category.
 * @param {{ name: string, description?: string }} data
 * @returns {Object} Created category
 */
function createCategory(data) {
  const categories = loadCategories();
  const trimmedName = (data.name || '').trim();

  if (!trimmedName) {
    throw new Error('Category name cannot be empty.');
  }

  const existing = categories.find((c) => c.name.toLowerCase() === trimmedName.toLowerCase());
  if (existing) {
    throw new Error(`Category "${trimmedName}" already exists.`);
  }

  const newCategory = {
    id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: trimmedName,
    description: (data.description || '').trim(),
    createdAt: new Date().toISOString(),
  };

  categories.push(newCategory);
  saveCategories(categories);

  console.log(`[Categories] Created category: "${newCategory.name}" (ID: ${newCategory.id})`);
  return newCategory;
}

/**
 * Updates an existing category by ID.
 * @param {string} id
 * @param {{ name?: string, description?: string }} data
 * @returns {Object} Updated category
 */
function updateCategory(id, data) {
  const categories = loadCategories();
  const index = categories.findIndex((c) => c.id === id);

  if (index === -1) {
    throw new Error(`Category with ID "${id}" was not found.`);
  }

  if (data.name !== undefined) {
    const trimmedName = data.name.trim();
    if (!trimmedName) {
      throw new Error('Category name cannot be empty.');
    }
    const duplicate = categories.find((c) => c.id !== id && c.name.toLowerCase() === trimmedName.toLowerCase());
    if (duplicate) {
      throw new Error(`Category "${trimmedName}" already exists.`);
    }
    categories[index].name = trimmedName;
  }

  if (data.description !== undefined) {
    categories[index].description = data.description.trim();
  }

  categories[index].updatedAt = new Date().toISOString();
  saveCategories(categories);

  console.log(`[Categories] Updated category: "${categories[index].name}" (ID: ${id})`);
  return categories[index];
}

/**
 * Deletes a category by ID.
 * @param {string} id
 * @returns {boolean}
 */
function deleteCategory(id) {
  const categories = loadCategories();
  const index = categories.findIndex((c) => c.id === id);

  if (index === -1) {
    throw new Error(`Category with ID "${id}" was not found.`);
  }

  const removed = categories.splice(index, 1)[0];
  saveCategories(categories);

  console.log(`[Categories] Deleted category: "${removed.name}" (ID: ${id})`);
  return true;
}

module.exports = {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  INITIAL_SEED_CATEGORIES,
};
