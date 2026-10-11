// Super Admin Master Dashboard Logic (logs.msruq.com)
let allSupervisors = [];

// DOM Elements
const kpiTotalDocs = document.getElementById('kpiTotalDocs');
const kpiTotalBooks = document.getElementById('kpiTotalBooks');
const kpiTotalRawTexts = document.getElementById('kpiTotalRawTexts');
const kpiTotalChunks = document.getElementById('kpiTotalChunks');
const supervisorsGrid = document.getElementById('supervisorsGrid');
const supervisorSearchInput = document.getElementById('supervisorSearchInput');
const refreshAllBtn = document.getElementById('refreshAllBtn');

// Modal Elements
const supervisorModal = document.getElementById('supervisorModal');
const closeSupervisorModal = document.getElementById('closeSupervisorModal');
const modalSupervisorName = document.getElementById('modalSupervisorName');
const modalSupervisorEmail = document.getElementById('modalSupervisorEmail');
const modalBooksCount = document.getElementById('modalBooksCount');
const modalRawCount = document.getElementById('modalRawCount');
const modalChunksCount = document.getElementById('modalChunksCount');
const modalDocsTableBody = document.getElementById('modalDocsTableBody');

// Fetch Overview KPIs
async function fetchOverviewStats() {
  try {
    const res = await fetch('/api/admin/overview');
    if (res.ok) {
      const result = await res.json();
      const stats = result.data;
      kpiTotalDocs.textContent = stats.totalDocuments || 0;
      kpiTotalBooks.textContent = stats.totalBooks || 0;
      kpiTotalRawTexts.textContent = stats.totalRawTexts || 0;
      kpiTotalChunks.textContent = (stats.totalVectorChunks || 0).toLocaleString();
    }
  } catch (err) {
    console.error('Failed to load system stats:', err);
  }
}

// Fetch Supervisors Analytics
async function fetchSupervisors() {
  try {
    const res = await fetch('/api/admin/supervisors');
    if (res.ok) {
      const result = await res.json();
      allSupervisors = result.data || [];
      renderSupervisorsGrid(allSupervisors);
    }
  } catch (err) {
    supervisorsGrid.innerHTML = `<div class="empty-state">Failed to load supervisors data</div>`;
  }
}

// Render Supervisors Grid
function renderSupervisorsGrid(supervisors) {
  if (!supervisors || supervisors.length === 0) {
    supervisorsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-user-slash" style="font-size: 32px; margin-bottom: 8px;"></i>
        <p>No supervisors have indexed documents yet.</p>
      </div>
    `;
    return;
  }

  supervisorsGrid.innerHTML = supervisors
    .map((sup, index) => {
      const displayName = sup.supervisorId.split('@')[0].replace(/_/g, ' ').toUpperCase();
      return `
      <div class="supervisor-card" onclick="openSupervisorDetail('${escapeHtml(sup.supervisorId)}')">
        <div class="sup-card-top">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="sup-avatar"><i class="fa-solid fa-user-tie"></i></div>
            <div>
              <div class="sup-id">${escapeHtml(displayName)}</div>
              <div style="font-size: 11.5px; color: var(--text-dim);">${escapeHtml(sup.supervisorId)}</div>
            </div>
          </div>
          <i class="fa-solid fa-chevron-right" style="color: var(--text-dim); font-size: 12px;"></i>
        </div>

        <div class="sup-card-stats">
          <div>
            <div class="sup-stat-num" style="color: #34d399;">${sup.totalBooksUploaded}</div>
            <div class="sup-stat-label">Books</div>
          </div>
          <div>
            <div class="sup-stat-num" style="color: #60a5fa;">${sup.totalRawTextsPasted}</div>
            <div class="sup-stat-label">Raw Texts</div>
          </div>
          <div>
            <div class="sup-stat-num" style="color: #fbbf24;">${sup.totalChunksIndexed}</div>
            <div class="sup-stat-label">Chunks</div>
          </div>
        </div>

        <div class="sup-card-footer">
          <span>Total Documents: ${sup.totalDocuments}</span>
          <span>Inspect Breakdown &rarr;</span>
        </div>
      </div>
    `;
    })
    .join('');
}

// Category Management Elements
const categoriesTableBody = document.getElementById('categoriesTableBody');
const openAddCategoryModalBtn = document.getElementById('openAddCategoryModalBtn');
const categoryModal = document.getElementById('categoryModal');
const closeCategoryModalBtn = document.getElementById('closeCategoryModalBtn');
const cancelCategoryModalBtn = document.getElementById('cancelCategoryModalBtn');
const categoryForm = document.getElementById('categoryForm');
const categoryModalTitle = document.getElementById('categoryModalTitle');
const editCategoryId = document.getElementById('editCategoryId');
const categoryNameInput = document.getElementById('categoryNameInput');
const categoryDescInput = document.getElementById('categoryDescInput');
const saveCategoryBtn = document.getElementById('saveCategoryBtn');

let allCategories = [];

// Fetch Categories List
async function fetchCategories() {
  try {
    const res = await fetch('/api/categories');
    if (res.ok) {
      const result = await res.json();
      allCategories = result.data || [];
      renderCategoriesTable(allCategories);
    } else {
      categoriesTableBody.innerHTML = `<tr><td colspan="4" class="empty-state">Failed to load categories</td></tr>`;
    }
  } catch (err) {
    console.error('Error loading categories:', err);
    categoriesTableBody.innerHTML = `<tr><td colspan="4" class="empty-state">Error connecting to server</td></tr>`;
  }
}

// Render Categories Table
function renderCategoriesTable(categories) {
  if (!categories || categories.length === 0) {
    categoriesTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">No categories defined yet. Click "Add New Category" above to create one.</td>
      </tr>
    `;
    return;
  }

  categoriesTableBody.innerHTML = categories
    .map((cat) => {
      const dateStr = cat.createdAt ? new Date(cat.createdAt).toLocaleDateString() : 'Initial Seed';
      return `
      <tr>
        <td>
          <span style="display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: #fff;">
            <i class="fa-solid fa-folder" style="color: #6366f1;"></i>
            ${escapeHtml(cat.name)}
          </span>
        </td>
        <td style="color: var(--text-muted); font-size: 12.5px;">${escapeHtml(cat.description || '-')}</td>
        <td style="color: var(--text-dim); font-size: 12px;">${dateStr}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="glass-btn btn-sm" onclick="openEditCategoryModal('${escapeHtml(cat.id)}')" style="padding: 5px 10px; font-size: 11.5px; margin-right: 6px;" title="Edit Category">
            <i class="fa-solid fa-pen-to-square"></i> Edit
          </button>
          <button class="glass-btn btn-sm" onclick="handleDeleteCategory('${escapeHtml(cat.id)}', '${escapeHtml(cat.name)}')" style="padding: 5px 10px; font-size: 11.5px; color: #ef4444; border-color: rgba(239, 68, 68, 0.25);" title="Delete Category">
            <i class="fa-solid fa-trash-can"></i> Delete
          </button>
        </td>
      </tr>
    `;
    })
    .join('');
}

// Modal Handlers for Categories
function openCreateCategoryModal() {
  editCategoryId.value = '';
  categoryModalTitle.textContent = 'Add New Category';
  categoryNameInput.value = '';
  categoryDescInput.value = '';
  categoryModal.classList.add('active');
  categoryNameInput.focus();
}

function openEditCategoryModal(id) {
  const cat = allCategories.find((c) => c.id === id);
  if (!cat) return;

  editCategoryId.value = cat.id;
  categoryModalTitle.textContent = `Edit Category: "${cat.name}"`;
  categoryNameInput.value = cat.name;
  categoryDescInput.value = cat.description || '';
  categoryModal.classList.add('active');
  categoryNameInput.focus();
}

function closeCategoryModal() {
  categoryModal.classList.remove('active');
}

openAddCategoryModalBtn.addEventListener('click', openCreateCategoryModal);
closeCategoryModalBtn.addEventListener('click', closeCategoryModal);
cancelCategoryModalBtn.addEventListener('click', closeCategoryModal);
categoryModal.addEventListener('click', (e) => {
  if (e.target === categoryModal) closeCategoryModal();
});

// Category Form Submission (Create or Edit)
categoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = editCategoryId.value.trim();
  const name = categoryNameInput.value.trim();
  const description = categoryDescInput.value.trim();

  if (!name) {
    alert('Please enter a category name.');
    return;
  }

  saveCategoryBtn.disabled = true;

  try {
    const isEdit = Boolean(id);
    const url = isEdit ? `/api/categories/${encodeURIComponent(id)}` : '/api/categories';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });

    const result = await res.json();
    if (res.ok && result.success) {
      alert(`Category "${result.data.name}" ${isEdit ? 'updated' : 'created'} successfully!`);
      closeCategoryModal();
      fetchCategories();
    } else {
      alert(`Error: ${result.error || 'Server error'}`);
    }
  } catch (err) {
    alert(`Failed to save category: ${err.message}`);
  } finally {
    saveCategoryBtn.disabled = false;
  }
});

// Delete Category Handler
async function handleDeleteCategory(id, name) {
  if (!confirm(`Are you sure you want to delete the category "${name}"?\n\nThis category will be removed from future supervisor selections.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

    const result = await res.json();
    if (res.ok && result.success) {
      alert(`Category "${name}" deleted successfully.`);
      fetchCategories();
    } else {
      alert(`Failed to delete category: ${result.error || 'Server error'}`);
    }
  } catch (err) {
    alert(`Error deleting category: ${err.message}`);
  }
}

// Open Supervisor Drill-down Modal
function openSupervisorDetail(supervisorId) {
  const sup = allSupervisors.find((s) => s.supervisorId === supervisorId);
  if (!sup) return;

  const displayName = sup.supervisorId.split('@')[0].replace(/_/g, ' ').toUpperCase();
  modalSupervisorName.textContent = displayName;
  modalSupervisorEmail.textContent = sup.supervisorId;
  modalBooksCount.textContent = sup.totalBooksUploaded;
  modalRawCount.textContent = sup.totalRawTextsPasted;
  modalChunksCount.textContent = sup.totalChunksIndexed.toLocaleString();

  if (!sup.documents || sup.documents.length === 0) {
    modalDocsTableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No documents found.</td></tr>`;
  } else {
    modalDocsTableBody.innerHTML = sup.documents
      .map((doc) => {
        const isRaw = doc.uploadType === 'raw-text';
        const methodBadge = isRaw
          ? `<span style="color: #60a5fa; font-weight:600;"><i class="fa-solid fa-paste"></i> Raw Text</span>`
          : `<span style="color: #34d399; font-weight:600;"><i class="fa-solid fa-file-pdf"></i> Book</span>`;

        const categoryBadge = `<span style="background: rgba(96, 165, 250, 0.15); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3); padding: 2px 7px; border-radius: 8px; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-folder-tree"></i> ${escapeHtml(doc.category || 'General')}</span>`;
        const languageBadge = `<span style="background: rgba(167, 139, 250, 0.15); color: #c084fc; border: 1px solid rgba(167, 139, 250, 0.3); padding: 2px 7px; border-radius: 8px; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-language"></i> ${escapeHtml(doc.language || 'Arabic')}</span>`;

        const dateStr = doc.uploadedAt
          ? new Date(doc.uploadedAt).toLocaleString()
          : 'N/A';

        const vaultLink = doc.rawFileUrl
          ? `<a href="${doc.rawFileUrl}" target="_blank" class="vault-link" title="Open original file from Data Vault"><i class="fa-solid fa-arrow-down-to-bracket"></i> Download (${doc.storageReference ? doc.storageReference.split('/').pop() : 'raw'})</a>`
          : `<span style="color: var(--text-dim);">No vault link</span>`;

        return `
        <tr>
          <td><strong>${escapeHtml(doc.title)}</strong></td>
          <td>${categoryBadge}</td>
          <td>${languageBadge}</td>
          <td>${methodBadge}</td>
          <td>${doc.totalChunks} chunks</td>
          <td>${vaultLink}</td>
          <td style="font-size: 12px; color: var(--text-dim);">${dateStr}</td>
        </tr>
      `;
      })
      .join('');
  }

  supervisorModal.classList.add('active');
}

closeSupervisorModal.addEventListener('click', () => {
  supervisorModal.classList.remove('active');
});

supervisorModal.addEventListener('click', (e) => {
  if (e.target === supervisorModal) supervisorModal.classList.remove('active');
});

// Search / Filter Supervisors
supervisorSearchInput.addEventListener('input', function () {
  const term = this.value.toLowerCase().trim();
  const filtered = allSupervisors.filter((s) =>
    s.supervisorId.toLowerCase().includes(term)
  );
  renderSupervisorsGrid(filtered);
});

refreshAllBtn.addEventListener('click', () => {
  fetchOverviewStats();
  fetchSupervisors();
  fetchCategories();
});

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  fetchOverviewStats();
  fetchSupervisors();
  fetchCategories();
  setInterval(() => {
    fetchOverviewStats();
    fetchSupervisors();
    fetchCategories();
  }, 15000);
});
