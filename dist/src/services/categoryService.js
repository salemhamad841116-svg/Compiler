const { get, all, run, tx } = require('../db/database');
const { newId } = require('../utils/ids');
const { nowIso } = require('../utils/clock');
const { AppError } = require('../utils/errors');
const audit = require('./auditService');

const SEED_CATEGORIES = [
  ['Arabic Language', 'cat.arabic_language', 'Arabic linguistics, rhetoric, and morphology'],
  ['Religion', 'cat.religion', 'Islamic and theological studies'],
  ['Hadith', 'cat.hadith', 'Prophetic traditions and narrations'],
  ['Quran Interpretation', 'cat.quran_interpretation', 'Tafsir and Quranic sciences'],
  ['History', 'cat.history', 'Historical events, biographies, and chronicles'],
  ['English Language', 'cat.english_language', 'English linguistics, grammar, and literature'],
  ['Botany / Plants', 'cat.botany_plants', 'Botanical sciences, flora, and plant studies'],
  ['Programming & Engineering', 'cat.programming_engineering', 'Software development, computer science, and engineering'],
];

function map(r) {
  return {
    id: r.id,
    name: r.name,
    nameKey: r.name_key || null,
    description: r.description,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    documentCount: r.document_count,
  };
}

function seedIfNeeded() {
  tx(() => {
    for (const [name, nameKey, description] of SEED_CATEGORIES) {
      const existing = findByName(name);
      if (!existing) {
        run('INSERT INTO categories (id, name, name_key, description, created_at) VALUES (?,?,?,?,?)', newId('cat'), name, nameKey, description, nowIso());
      } else if (!existing.name_key) {
        run('UPDATE categories SET name_key = ? WHERE id = ?', nameKey, existing.id);
      }
    }
    run("INSERT OR REPLACE INTO system_flags (key, value) VALUES ('categories_seeded', '1')");
  });
}

function listCategories() {
  return all(
    `SELECT c.*, (SELECT COUNT(*) FROM documents d WHERE d.category_id = c.id) AS document_count
     FROM categories c ORDER BY c.name COLLATE NOCASE`
  ).map(map);
}

function getCategory(id) {
  return get('SELECT * FROM categories WHERE id = ?', id) || null;
}

function findByName(name) {
  return get('SELECT * FROM categories WHERE name = ?', String(name || '').trim()) || null;
}

/** Resolves a category reference (id preferred, name accepted for backward compatibility). */
function resolveCategory(ref) {
  if (!ref) return null;
  return getCategory(ref) || findByName(ref);
}

function ensureUncategorized() {
  const existing = findByName('Uncategorized');
  if (existing) return existing;
  const id = newId('cat');
  run('INSERT INTO categories (id, name, description, created_at) VALUES (?,?,?,?)', id, 'Uncategorized', 'Documents without a specific category', nowIso());
  return getCategory(id);
}

function createCategory({ name, nameKey, description }, actor) {
  const n = String(name || '').trim();
  if (!n) throw new AppError(400, 'CATEGORY_NAME_REQUIRED', 'Category name cannot be empty.');
  if (n.length > 120) throw new AppError(400, 'CATEGORY_NAME_TOO_LONG', 'Category name is too long.');
  if (findByName(n)) throw new AppError(409, 'CATEGORY_EXISTS', `Category "${n}" already exists.`);
  const id = newId('cat');
  run('INSERT INTO categories (id, name, name_key, description, created_at, created_by) VALUES (?,?,?,?,?,?)', id, n, nameKey || null, String(description || '').trim(), nowIso(), actor.id);
  const created = getCategory(id);
  audit.record({ action: 'category.created', actor, supervisor: null, categoryId: id, categoryName: n, detail: { categoryId: id, name: n } });
  return map({ ...created, document_count: 0 });
}

function updateCategory(id, { name, nameKey, description }, actor) {
  const cat = getCategory(id);
  if (!cat) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found.');
  const changes = {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (!n) throw new AppError(400, 'CATEGORY_NAME_REQUIRED', 'Category name cannot be empty.');
    const dup = findByName(n);
    if (dup && dup.id !== id) throw new AppError(409, 'CATEGORY_EXISTS', `Category "${n}" already exists.`);
    if (n !== cat.name) changes.name = { from: cat.name, to: n };
  }
  if (nameKey !== undefined && nameKey !== cat.name_key) {
    changes.nameKey = { from: cat.name_key, to: nameKey };
  }
  if (description !== undefined && String(description).trim() !== cat.description) {
    changes.description = { from: cat.description, to: String(description).trim() };
  }
  if (Object.keys(changes).length) {
    run('UPDATE categories SET name = ?, name_key = ?, description = ?, updated_at = ? WHERE id = ?',
      changes.name ? changes.name.to : cat.name,
      changes.nameKey !== undefined ? changes.nameKey.to : cat.name_key,
      changes.description ? changes.description.to : cat.description,
      nowIso(), id);
    audit.record({
      action: changes.name ? 'category.renamed' : 'category.updated', actor, supervisor: null,
      categoryId: id, categoryName: changes.name ? changes.name.to : cat.name,
      detail: { categoryId: id, changes },
    });
  }
  const row = get('SELECT c.*, (SELECT COUNT(*) FROM documents d WHERE d.category_id = c.id) AS document_count FROM categories c WHERE c.id = ?', id);
  require('../models/vectorDbModel').invalidateCache();
  return map(row);
}

function deleteCategory(id, reassignTo, actor) {
  const cat = getCategory(id);
  if (!cat) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found.');
  const count = get('SELECT COUNT(*) AS n FROM documents WHERE category_id = ?', id).n;
  let target = null;
  if (count > 0) {
    if (!reassignTo) {
      throw new AppError(409, 'CATEGORY_IN_USE', `Category "${cat.name}" is assigned to ${count} document(s). Choose a category to reassign them to.`, { documentCount: count });
    }
    target = getCategory(reassignTo);
    if (!target) throw new AppError(404, 'REASSIGN_TARGET_NOT_FOUND', 'The reassignment target category does not exist.');
    if (target.id === id) throw new AppError(400, 'REASSIGN_TARGET_INVALID', 'Reassignment target must be a different category.');
  }
  const docs = count > 0 ? all('SELECT * FROM documents WHERE category_id = ?', id) : [];
  tx(() => {
    if (target) run('UPDATE documents SET category_id = ? WHERE category_id = ?', target.id, id);
    run('DELETE FROM categories WHERE id = ?', id);
  });
  for (const d of docs) {
    audit.record({
      action: 'document.category_reassigned', actor, doc: { ...d, category_id: target.id },
      categoryName: target.name, detail: { from: { id, name: cat.name }, to: { id: target.id, name: target.name }, reason: 'category_deleted' },
    });
  }
  audit.record({
    action: 'category.deleted', actor, supervisor: null, categoryId: id, categoryName: cat.name,
    detail: { categoryId: id, name: cat.name, reassignedTo: target ? { id: target.id, name: target.name } : null, documentsReassigned: count },
  });
  require('../models/vectorDbModel').invalidateCache();
  return { deleted: true, documentsReassigned: count, reassignedTo: target ? target.id : null };
}

module.exports = {
  seedIfNeeded, listCategories, getCategory, findByName, resolveCategory,
  ensureUncategorized, createCategory, updateCategory, deleteCategory,
};
