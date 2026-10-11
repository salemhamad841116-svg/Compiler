// Super Admin Master Dashboard Logic (logs.msruq.com)
let allSupervisors = [];
let allAuditLogs = [];
let allSupervisorSummaries = [];

// DOM Elements
const kpiTotalDocs = document.getElementById('kpiTotalDocs');
const kpiTotalBooks = document.getElementById('kpiTotalBooks');
const kpiTotalRawTexts = document.getElementById('kpiTotalRawTexts');
const kpiTotalChunks = document.getElementById('kpiTotalChunks');
const kpiTotalPages = document.getElementById('kpiTotalPages');
const supervisorsGrid = document.getElementById('supervisorsGrid');
const supervisorSearchInput = document.getElementById('supervisorSearchInput');
const refreshAllBtn = document.getElementById('refreshAllBtn');

// Audit Log Elements
const auditSupervisorCardsGrid = document.getElementById('auditSupervisorCardsGrid');
const auditLogsTableBody = document.getElementById('auditLogsTableBody');
const auditSupervisorFilter = document.getElementById('auditSupervisorFilter');
const auditSearchInput = document.getElementById('auditSearchInput');
const auditLogCountBadge = document.getElementById('auditLogCountBadge');

// Modal Elements
const supervisorModal = document.getElementById('supervisorModal');
const closeSupervisorModal = document.getElementById('closeSupervisorModal');
const modalSupervisorName = document.getElementById('modalSupervisorName');
const modalSupervisorEmail = document.getElementById('modalSupervisorEmail');
const modalBooksCount = document.getElementById('modalBooksCount');
const modalPagesCount = document.getElementById('modalPagesCount');
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
      if (kpiTotalDocs) kpiTotalDocs.textContent = (stats.totalDocuments || 0).toLocaleString();
      if (kpiTotalBooks) kpiTotalBooks.textContent = (stats.totalBooks || 0).toLocaleString();
      if (kpiTotalRawTexts) kpiTotalRawTexts.textContent = (stats.totalRawTexts || 0).toLocaleString();
      if (kpiTotalChunks) kpiTotalChunks.textContent = (stats.totalVectorChunks || 0).toLocaleString();
      if (kpiTotalPages) kpiTotalPages.textContent = (stats.totalLifetimePages || 0).toLocaleString();
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

// Supervisor Audit Logs & Productivity Logic
async function fetchAuditLogs() {
  try {
    const res = await fetch('/api/admin/audit-logs');
    if (res.ok) {
      const result = await res.json();
      allSupervisorSummaries = result.data?.supervisors || [];
      allAuditLogs = result.data?.auditLogs || [];

      // Update supervisor filter dropdown options
      updateAuditSupervisorDropdown(allSupervisorSummaries);

      // Render Lifetime Productivity Cards above table
      renderSupervisorSummaryCards(allSupervisorSummaries);

      // Render Audit Log Table with current filter
      applyAuditFilters();
    } else {
      if (auditLogsTableBody) {
        auditLogsTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load audit logs</td></tr>`;
      }
      if (auditSupervisorCardsGrid) {
        auditSupervisorCardsGrid.innerHTML = `<div class="empty-state">Failed to load supervisor summary</div>`;
      }
    }
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    if (auditLogsTableBody) {
      auditLogsTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">Server connection error</td></tr>`;
    }
    if (auditSupervisorCardsGrid) {
      auditSupervisorCardsGrid.innerHTML = `<div class="empty-state">Server connection error</div>`;
    }
  }
}

// Update Supervisor Filter Dropdown in Audit Logs Section
function updateAuditSupervisorDropdown(supervisors) {
  if (!auditSupervisorFilter) return;
  const currentSelection = auditSupervisorFilter.value;
  let optionsHtml = `<option value="ALL">All Supervisors (${supervisors.length})</option>`;
  for (const sup of supervisors) {
    optionsHtml += `<option value="${escapeHtml(sup.supervisorId)}">${escapeHtml(sup.supervisorName)} (${escapeHtml(sup.supervisorId)})</option>`;
  }
  auditSupervisorFilter.innerHTML = optionsHtml;
  if (currentSelection && (supervisors.some((s) => s.supervisorId === currentSelection) || currentSelection === 'ALL')) {
    auditSupervisorFilter.value = currentSelection;
  } else {
    auditSupervisorFilter.value = 'ALL';
  }
}

// Render Summary Cards Above Table: Lifetime Totals for Each Supervisor
function renderSupervisorSummaryCards(supervisors) {
  if (!auditSupervisorCardsGrid) return;
  if (!supervisors || supervisors.length === 0) {
    auditSupervisorCardsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 20px;">
        <i class="fa-solid fa-users-slash" style="font-size: 28px; margin-bottom: 8px;"></i>
        <p>No supervisor ingestion activities recorded yet.</p>
      </div>
    `;
    return;
  }

  auditSupervisorCardsGrid.innerHTML = supervisors
    .map((sup) => {
      const isSelected = auditSupervisorFilter && auditSupervisorFilter.value === sup.supervisorId;
      return `
      <div class="audit-summary-card ${isSelected ? 'active-filter' : ''}" style="cursor: pointer;" onclick="selectSupervisorFilter('${escapeHtml(sup.supervisorId)}')">
        <div class="audit-card-header">
          <div class="user-avatar-sm"><i class="fa-solid fa-user-tie"></i></div>
          <div>
            <div class="audit-card-name">${escapeHtml(sup.supervisorName)}</div>
            <div class="audit-card-email">${escapeHtml(sup.supervisorId)}</div>
          </div>
        </div>

        <div class="audit-metrics-row">
          <div class="audit-metric-box">
            <span class="audit-metric-label"><i class="fa-solid fa-book"></i> Total Books Uploaded</span>
            <span class="audit-metric-val books-val">${(sup.totalBooksUploaded || 0).toLocaleString()}</span>
          </div>
          <div class="audit-metric-box">
            <span class="audit-metric-label"><i class="fa-solid fa-file-invoice"></i> Total Pages Uploaded</span>
            <span class="audit-metric-val pages-val">${(sup.totalPagesUploaded || 0).toLocaleString()}</span>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 11px; color: var(--text-dim);">
          <span><i class="fa-solid fa-layer-group"></i> ${(sup.totalChunksIndexed || 0).toLocaleString()} chunks</span>
          <span style="color: #818cf8; font-weight: 600;">${isSelected ? 'Active Filter &times;' : 'Filter Logs &rarr;'}</span>
        </div>
      </div>
    `;
    })
    .join('');
}

// Select supervisor filter from clicking a summary card
function selectSupervisorFilter(supervisorId) {
  if (!auditSupervisorFilter) return;
  if (auditSupervisorFilter.value === supervisorId) {
    auditSupervisorFilter.value = 'ALL';
  } else {
    auditSupervisorFilter.value = supervisorId;
  }
  renderSupervisorSummaryCards(allSupervisorSummaries);
  applyAuditFilters();
}

// Apply Filters (Supervisor dropdown + text search)
function applyAuditFilters() {
  const selectedSup = auditSupervisorFilter ? auditSupervisorFilter.value : 'ALL';
  const searchTerm = (auditSearchInput ? auditSearchInput.value : '').toLowerCase().trim();

  let filtered = allAuditLogs;

  if (selectedSup && selectedSup !== 'ALL') {
    filtered = filtered.filter(
      (log) => log.supervisorId.toLowerCase() === selectedSup.toLowerCase()
    );
  }

  if (searchTerm) {
    filtered = filtered.filter(
      (log) =>
        (log.bookTitle && log.bookTitle.toLowerCase().includes(searchTerm)) ||
        (log.supervisorName && log.supervisorName.toLowerCase().includes(searchTerm)) ||
        (log.supervisorId && log.supervisorId.toLowerCase().includes(searchTerm)) ||
        (log.category && log.category.toLowerCase().includes(searchTerm)) ||
        (log.language && log.language.toLowerCase().includes(searchTerm)) ||
        (log.exactDateAndDay && log.exactDateAndDay.toLowerCase().includes(searchTerm)) ||
        (log.exactTime && log.exactTime.toLowerCase().includes(searchTerm))
    );
  }

  renderAuditLogsTable(filtered);
}

// Render Audit Logs Table
function renderAuditLogsTable(logs) {
  if (!auditLogsTableBody) return;

  if (auditLogCountBadge) {
    auditLogCountBadge.textContent = `${logs.length} document${logs.length === 1 ? '' : 's'} logged`;
  }

  if (!logs || logs.length === 0) {
    auditLogsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <i class="fa-solid fa-folder-open" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>
          No audit logs match your search and filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  auditLogsTableBody.innerHTML = logs
    .map((log) => {
      const isRaw = log.uploadType === 'raw-text' || log.uploadType === 'url';
      const categoryBadge = `<span style="background: rgba(96, 165, 250, 0.15); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3); padding: 2px 7px; border-radius: 8px; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-folder-tree"></i> ${escapeHtml(log.category || 'General')}</span>`;
      const languageBadge = `<span style="background: rgba(167, 139, 250, 0.15); color: #c084fc; border: 1px solid rgba(167, 139, 250, 0.3); padding: 2px 7px; border-radius: 8px; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-language"></i> ${escapeHtml(log.language || 'Arabic')}</span>`;

      const vaultLink = log.rawFileUrl
        ? `<a href="${log.rawFileUrl}" target="_blank" class="vault-link" title="Download raw source file from Data Vault"><i class="fa-solid fa-cloud-arrow-down"></i> Data Vault</a>`
        : `<span style="color: var(--text-dim); font-size: 12px;"><i class="fa-solid fa-circle-xmark"></i> N/A</span>`;

      return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 30px; height: 30px; border-radius: 8px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); display: flex; align-items: center; justify-content: center; color: #818cf8; font-size: 13px;">
              <i class="fa-solid fa-user-tie"></i>
            </div>
            <div>
              <div style="font-weight: 600; color: #fff;">${escapeHtml(log.supervisorName)}</div>
              <div style="font-size: 11.5px; color: var(--text-dim);">${escapeHtml(log.supervisorId)}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 600; color: #fff; margin-bottom: 4px;">
            <i class="${isRaw ? 'fa-solid fa-file-lines' : 'fa-solid fa-book'}" style="color: ${isRaw ? '#60a5fa' : '#34d399'}; margin-right: 6px;"></i>
            ${escapeHtml(log.bookTitle)}
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            ${categoryBadge}
            ${languageBadge}
          </div>
        </td>
        <td>
          <span class="page-badge">
            <i class="fa-solid fa-copy"></i>
            <strong>${(log.totalPages || 1).toLocaleString()}</strong> pages
          </span>
        </td>
        <td>
          <span class="date-badge">
            <i class="fa-solid fa-calendar-day"></i>
            ${escapeHtml(log.exactDateAndDay)}
          </span>
        </td>
        <td>
          <span class="time-badge">
            <i class="fa-solid fa-clock"></i>
            ${escapeHtml(log.exactTime)}
          </span>
        </td>
        <td>
          ${vaultLink}
        </td>
      </tr>
    `;
    })
    .join('');
}

// Audit filter event listeners
if (auditSupervisorFilter) {
  auditSupervisorFilter.addEventListener('change', () => {
    renderSupervisorSummaryCards(allSupervisorSummaries);
    applyAuditFilters();
  });
}

if (auditSearchInput) {
  auditSearchInput.addEventListener('input', applyAuditFilters);
}

// Open Supervisor Drill-down Modal
function openSupervisorDetail(supervisorId) {
  const sup = allSupervisors.find((s) => s.supervisorId === supervisorId);
  if (!sup) return;

  const displayName = sup.supervisorId.split('@')[0].replace(/_/g, ' ').toUpperCase();
  modalSupervisorName.textContent = displayName;
  modalSupervisorEmail.textContent = sup.supervisorId;
  modalBooksCount.textContent = (sup.totalBooksUploaded || 0).toLocaleString();
  if (modalPagesCount) modalPagesCount.textContent = (sup.totalPagesUploaded || 0).toLocaleString();
  modalRawCount.textContent = (sup.totalRawTextsPasted || 0).toLocaleString();
  modalChunksCount.textContent = (sup.totalChunksIndexed || 0).toLocaleString();

  if (!sup.documents || sup.documents.length === 0) {
    modalDocsTableBody.innerHTML = `<tr><td colspan="8" class="empty-state">No documents found.</td></tr>`;
  } else {
    modalDocsTableBody.innerHTML = sup.documents
      .map((doc) => {
        const isRaw = doc.uploadType === 'raw-text' || doc.uploadType === 'url';
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
          <td><span class="page-badge"><i class="fa-solid fa-copy"></i> ${(doc.totalPages || 1).toLocaleString()}</span></td>
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

// Search / Filter Supervisors in Grid
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
  fetchAuditLogs();
});

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  fetchOverviewStats();
  fetchSupervisors();
  fetchCategories();
  fetchAuditLogs();
  setInterval(() => {
    fetchOverviewStats();
    fetchSupervisors();
    fetchCategories();
    fetchAuditLogs();
  }, 15000);
});
