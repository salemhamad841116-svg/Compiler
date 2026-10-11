// ==============================================================================
// Super Admin Central Dashboard Logic (logs.msruq.com)
// Strict Zero-Arabic Source Code Compliance - Fully Localized Dynamic i18n
// ==============================================================================

let allSupervisors = [];
let allAuditLogs = [];
let allSupervisorSummaries = [];
let allCategories = [];
let allAdminDocuments = [];
let pendingDeleteTitle = null;

// DOM Elements: Header & Controls
const kpiTotalDocs = document.getElementById('kpiTotalDocs');
const kpiTotalBooks = document.getElementById('kpiTotalBooks');
const kpiTotalRawTexts = document.getElementById('kpiTotalRawTexts');
const kpiTotalChunks = document.getElementById('kpiTotalChunks');
const kpiTotalPages = document.getElementById('kpiTotalPages');
const refreshAllBtn = document.getElementById('refreshAllBtn');
const langToggleBtn = document.getElementById('langToggleBtn');
const currentLangLabel = document.getElementById('currentLangLabel');
const jumpToIngestBtn = document.getElementById('jumpToIngestBtn');

// DOM Elements: Master Documents Catalog & Ingestion
const adminDocsSection = document.getElementById('adminDocsSection');
const adminSupervisorAssignSelect = document.getElementById('adminSupervisorAssignSelect');
const adminCustomSupInput = document.getElementById('adminCustomSupInput');

// Ingestion Tabs
const adminTabUploadDocBtn = document.getElementById('adminTabUploadDocBtn');
const adminTabRawTextBtn = document.getElementById('adminTabRawTextBtn');
const adminTabMediaBtn = document.getElementById('adminTabMediaBtn');
const adminTabUrlScraperBtn = document.getElementById('adminTabUrlScraperBtn');

const adminUploadDocPane = document.getElementById('adminUploadDocPane');
const adminRawTextPane = document.getElementById('adminRawTextPane');
const adminMediaPane = document.getElementById('adminMediaPane');
const adminUrlScraperPane = document.getElementById('adminUrlScraperPane');

// Ingestion Forms & Controls
const adminUploadDocForm = document.getElementById('adminUploadDocForm');
const adminDocTitleInput = document.getElementById('adminDocTitleInput');
const adminDocCategorySelect = document.getElementById('adminDocCategorySelect');
const adminDocLanguageSelect = document.getElementById('adminDocLanguageSelect');
const adminDocDropzone = document.getElementById('adminDocDropzone');
const adminDocFileInput = document.getElementById('adminDocFileInput');
const adminDocDropzoneText = document.getElementById('adminDocDropzoneText');
const adminStartDocUploadBtn = document.getElementById('adminStartDocUploadBtn');

const adminRawTextForm = document.getElementById('adminRawTextForm');
const adminRawTitleInput = document.getElementById('adminRawTitleInput');
const adminRawCategorySelect = document.getElementById('adminRawCategorySelect');
const adminRawLanguageSelect = document.getElementById('adminRawLanguageSelect');
const adminRawContentInput = document.getElementById('adminRawContentInput');
const adminCharCounter = document.getElementById('adminCharCounter');
const adminStartRawBtn = document.getElementById('adminStartRawBtn');

const adminMediaForm = document.getElementById('adminMediaForm');
const adminMediaTitleInput = document.getElementById('adminMediaTitleInput');
const adminMediaCategorySelect = document.getElementById('adminMediaCategorySelect');
const adminMediaLanguageSelect = document.getElementById('adminMediaLanguageSelect');
const adminMediaDropzone = document.getElementById('adminMediaDropzone');
const adminMediaFileInput = document.getElementById('adminMediaFileInput');
const adminMediaDropzoneText = document.getElementById('adminMediaDropzoneText');
const adminStartMediaBtn = document.getElementById('adminStartMediaBtn');

const adminUrlScraperForm = document.getElementById('adminUrlScraperForm');
const adminTargetUrlInput = document.getElementById('adminTargetUrlInput');
const adminUrlTitleInput = document.getElementById('adminUrlTitleInput');
const adminUrlCategorySelect = document.getElementById('adminUrlCategorySelect');
const adminUrlLanguageSelect = document.getElementById('adminUrlLanguageSelect');
const adminStartUrlScrapeBtn = document.getElementById('adminStartUrlScrapeBtn');

const adminUploadProgressBox = document.getElementById('adminUploadProgressBox');
const adminProgressTitle = document.getElementById('adminProgressTitle');
const adminProgressDesc = document.getElementById('adminProgressDesc');

// Master Documents Table Elements
const adminDocsTableBody = document.getElementById('adminDocsTableBody');
const adminDocCountBadge = document.getElementById('adminDocCountBadge');
const adminDocSearchInput = document.getElementById('adminDocSearchInput');
const adminDocFilterCategory = document.getElementById('adminDocFilterCategory');
const adminDocFilterSupervisor = document.getElementById('adminDocFilterSupervisor');
const adminDocFilterType = document.getElementById('adminDocFilterType');

// Edit Document Modal Elements
const editDocModal = document.getElementById('editDocModal');
const closeEditDocModalBtn = document.getElementById('closeEditDocModalBtn');
const cancelEditDocBtn = document.getElementById('cancelEditDocBtn');
const editDocForm = document.getElementById('editDocForm');
const editOriginalDocTitle = document.getElementById('editOriginalDocTitle');
const editNewDocTitle = document.getElementById('editNewDocTitle');
const editDocCategory = document.getElementById('editDocCategory');
const editDocLanguage = document.getElementById('editDocLanguage');
const saveEditDocBtn = document.getElementById('saveEditDocBtn');

// Delete Document Modal Elements
const deleteDocModal = document.getElementById('deleteDocModal');
const closeDeleteDocModalBtn = document.getElementById('closeDeleteDocModalBtn');
const cancelDeleteDocBtn = document.getElementById('cancelDeleteDocBtn');
const confirmDeleteDocBtn = document.getElementById('confirmDeleteDocBtn');
const deleteDocTargetTitle = document.getElementById('deleteDocTargetTitle');

// Inspect Chunks Modal Elements
const chunksModal = document.getElementById('chunksModal');
const closeChunksModalBtn = document.getElementById('closeChunksModalBtn');
const chunksModalTitle = document.getElementById('chunksModalTitle');
const chunksModalSubtitle = document.getElementById('chunksModalSubtitle');
const chunksModalList = document.getElementById('chunksModalList');

// Supervisor Audit Logs Elements
const auditSupervisorCardsGrid = document.getElementById('auditSupervisorCardsGrid');
const auditLogsTableBody = document.getElementById('auditLogsTableBody');
const auditSupervisorFilter = document.getElementById('auditSupervisorFilter');
const auditSearchInput = document.getElementById('auditSearchInput');
const auditLogCountBadge = document.getElementById('auditLogCountBadge');

// Supervisor Grid & Drilldown Elements
const supervisorsGrid = document.getElementById('supervisorsGrid');
const supervisorSearchInput = document.getElementById('supervisorSearchInput');
const supervisorModal = document.getElementById('supervisorModal');
const closeSupervisorModal = document.getElementById('closeSupervisorModal');
const modalSupervisorName = document.getElementById('modalSupervisorName');
const modalSupervisorEmail = document.getElementById('modalSupervisorEmail');
const modalBooksCount = document.getElementById('modalBooksCount');
const modalPagesCount = document.getElementById('modalPagesCount');
const modalRawCount = document.getElementById('modalRawCount');
const modalChunksCount = document.getElementById('modalChunksCount');
const modalDocsTableBody = document.getElementById('modalDocsTableBody');

// Category CRUD Elements
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

// Vector Vault Inspector Elements
const vaultInspectorForm = document.getElementById('vaultInspectorForm');
const inspectorQueryInput = document.getElementById('inspectorQueryInput');
const inspectorCategorySelect = document.getElementById('inspectorCategorySelect');
const inspectorMinSim = document.getElementById('inspectorMinSim');
const inspectorMinSimVal = document.getElementById('inspectorMinSimVal');
const inspectorTopK = document.getElementById('inspectorTopK');
const runInspectorBtn = document.getElementById('runInspectorBtn');
const inspectorResultsContainer = document.getElementById('inspectorResultsContainer');
const inspectorResultCount = document.getElementById('inspectorResultCount');
const inspectorResultsList = document.getElementById('inspectorResultsList');

// System Telemetry Elements
const sysEmbeddingModel = document.getElementById('sysEmbeddingModel');
const sysLlmModel = document.getElementById('sysLlmModel');
const sysVectorDim = document.getElementById('sysVectorDim');
const sysVaultStatus = document.getElementById('sysVaultStatus');
const sysOverallStatus = document.getElementById('sysOverallStatus');

// Helper: Escape HTML strings
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Update Language Toggle Badge
function updateLangUi(lang) {
  const activeLang = lang || 'ar';
  if (currentLangLabel) {
    currentLangLabel.textContent = activeLang.toUpperCase();
  }
  document.documentElement.dir = activeLang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = activeLang;
}

// Supervisor Attribution Picker for Ingestion
function getActiveAdminSupervisor() {
  if (!adminSupervisorAssignSelect) return 'admin@msruq.com';
  const val = adminSupervisorAssignSelect.value;
  if (val === 'custom_sup') {
    return (adminCustomSupInput && adminCustomSupInput.value.trim()) || 'supervisor_custom@masruq.com';
  }
  return val;
}

if (adminSupervisorAssignSelect) {
  adminSupervisorAssignSelect.addEventListener('change', function () {
    if (this.value === 'custom_sup') {
      adminCustomSupInput.style.display = 'inline-block';
      adminCustomSupInput.focus();
    } else {
      adminCustomSupInput.style.display = 'none';
    }
  });
}

// Smooth scroll to Ingestion section
if (jumpToIngestBtn && adminDocsSection) {
  jumpToIngestBtn.addEventListener('click', () => {
    adminDocsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// Ingestion Tabs Switching Logic
function switchAdminIngestTab(activeBtn, activePane) {
  [adminTabUploadDocBtn, adminTabRawTextBtn, adminTabMediaBtn, adminTabUrlScraperBtn].forEach((btn) => {
    if (btn) btn.classList.remove('active');
  });
  [adminUploadDocPane, adminRawTextPane, adminMediaPane, adminUrlScraperPane].forEach((pane) => {
    if (pane) {
      pane.classList.remove('active');
      pane.style.display = 'none';
    }
  });
  if (activeBtn) activeBtn.classList.add('active');
  if (activePane) {
    activePane.classList.add('active');
    activePane.style.display = 'block';
  }
}

if (adminTabUploadDocBtn) adminTabUploadDocBtn.addEventListener('click', () => switchAdminIngestTab(adminTabUploadDocBtn, adminUploadDocPane));
if (adminTabRawTextBtn) adminTabRawTextBtn.addEventListener('click', () => switchAdminIngestTab(adminTabRawTextBtn, adminRawTextPane));
if (adminTabMediaBtn) adminTabMediaBtn.addEventListener('click', () => switchAdminIngestTab(adminTabMediaBtn, adminMediaPane));
if (adminTabUrlScraperBtn) adminTabUrlScraperBtn.addEventListener('click', () => switchAdminIngestTab(adminTabUrlScraperBtn, adminUrlScraperPane));

// Dropzone 1: Document Upload
if (adminDocDropzone && adminDocFileInput) {
  adminDocDropzone.addEventListener('click', () => adminDocFileInput.click());
  adminDocFileInput.addEventListener('change', () => {
    if (adminDocFileInput.files.length > 0) {
      adminDocDropzoneText.textContent = `Selected: ${adminDocFileInput.files[0].name}`;
    }
  });
  adminDocDropzone.addEventListener('dragover', (e) => { e.preventDefault(); adminDocDropzone.classList.add('dragover'); });
  adminDocDropzone.addEventListener('dragleave', () => adminDocDropzone.classList.remove('dragover'));
  adminDocDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    adminDocDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      adminDocFileInput.files = e.dataTransfer.files;
      adminDocDropzoneText.textContent = `Selected: ${adminDocFileInput.files[0].name}`;
    }
  });
}

// Dropzone 2: Media Upload
if (adminMediaDropzone && adminMediaFileInput) {
  adminMediaDropzone.addEventListener('click', () => adminMediaFileInput.click());
  adminMediaFileInput.addEventListener('change', () => {
    if (adminMediaFileInput.files.length > 0) {
      adminMediaDropzoneText.textContent = `Selected Media: ${adminMediaFileInput.files[0].name}`;
    }
  });
  adminMediaDropzone.addEventListener('dragover', (e) => { e.preventDefault(); adminMediaDropzone.classList.add('dragover'); });
  adminMediaDropzone.addEventListener('dragleave', () => adminMediaDropzone.classList.remove('dragover'));
  adminMediaDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    adminMediaDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      adminMediaFileInput.files = e.dataTransfer.files;
      adminMediaDropzoneText.textContent = `Selected Media: ${adminMediaFileInput.files[0].name}`;
    }
  });
}

// Character counter for Raw text
if (adminRawContentInput && adminCharCounter) {
  adminRawContentInput.addEventListener('input', function () {
    adminCharCounter.textContent = `${this.value.length} characters`;
  });
}

// Fetch Overview KPIs
async function fetchOverviewStats() {
  try {
    const res = await fetch('/api/admin/overview');
    if (res.ok) {
      const result = await res.json();
      const stats = result.data || {};
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

// Fetch Categories & Populate Dropdowns
async function fetchCategories() {
  try {
    const res = await fetch('/api/categories');
    if (res.ok) {
      const result = await res.json();
      allCategories = result.data || [];
      renderCategoriesTable(allCategories);
      populateCategoryDropdowns(allCategories);
    }
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

function populateCategoryDropdowns(categories) {
  const dropdowns = [
    adminDocCategorySelect,
    adminRawCategorySelect,
    adminMediaCategorySelect,
    adminUrlCategorySelect,
    editDocCategory,
  ];

  dropdowns.forEach((sel) => {
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = categories
      .map((cat) => `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`)
      .join('');
    if (currentVal && categories.some((c) => c.name === currentVal)) {
      sel.value = currentVal;
    }
  });

  // Filter dropdown in Master Documents Table
  if (adminDocFilterCategory) {
    const curFilter = adminDocFilterCategory.value;
    const filterOpts = `<option value="ALL">All Categories (${categories.length})</option>` +
      categories.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
    adminDocFilterCategory.innerHTML = filterOpts;
    if (curFilter) adminDocFilterCategory.value = curFilter;
  }

  // Filter dropdown in Vector Inspector
  if (inspectorCategorySelect) {
    const curInsp = inspectorCategorySelect.value;
    const inspOpts = `<option value="All">All Categories</option>` +
      categories.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
    inspectorCategorySelect.innerHTML = inspOpts;
    if (curInsp) inspectorCategorySelect.value = curInsp;
  }
}

// Fetch Master Documents Catalog
async function fetchAdminDocuments() {
  try {
    const res = await fetch('/api/admin/documents');
    if (res.ok) {
      const result = await res.json();
      allAdminDocuments = result.data || [];
      updateAdminDocSupervisorFilter(allAdminDocuments);
      applyAdminDocFilters();
    } else {
      if (adminDocsTableBody) {
        adminDocsTableBody.innerHTML = '<tr><td colspan="9" class="empty-state">Failed to load documents catalog.</td></tr>';
      }
    }
  } catch (err) {
    console.error('Error fetching admin documents:', err);
    if (adminDocsTableBody) {
      adminDocsTableBody.innerHTML = '<tr><td colspan="9" class="empty-state">Server connection error.</td></tr>';
    }
  }
}

function updateAdminDocSupervisorFilter(docs) {
  if (!adminDocFilterSupervisor) return;
  const currentVal = adminDocFilterSupervisor.value;
  const uniqueSups = Array.from(new Set(docs.map((d) => d.uploadedBy).filter(Boolean)));
  let opts = `<option value="ALL">All Supervisors (${uniqueSups.length})</option>`;
  uniqueSups.forEach((sup) => {
    opts += `<option value="${escapeHtml(sup)}">${escapeHtml(sup)}</option>`;
  });
  adminDocFilterSupervisor.innerHTML = opts;
  if (currentVal && (uniqueSups.includes(currentVal) || currentVal === 'ALL')) {
    adminDocFilterSupervisor.value = currentVal;
  } else {
    adminDocFilterSupervisor.value = 'ALL';
  }
}

function applyAdminDocFilters() {
  const searchTerm = (adminDocSearchInput ? adminDocSearchInput.value : '').toLowerCase().trim();
  const selectedCat = adminDocFilterCategory ? adminDocFilterCategory.value : 'ALL';
  const selectedSup = adminDocFilterSupervisor ? adminDocFilterSupervisor.value : 'ALL';
  const selectedType = adminDocFilterType ? adminDocFilterType.value : 'ALL';

  let filtered = allAdminDocuments;

  if (selectedCat && selectedCat !== 'ALL') {
    filtered = filtered.filter((d) => (d.category || '').toLowerCase() === selectedCat.toLowerCase());
  }

  if (selectedSup && selectedSup !== 'ALL') {
    filtered = filtered.filter((d) => (d.uploadedBy || '').toLowerCase() === selectedSup.toLowerCase());
  }

  if (selectedType && selectedType !== 'ALL') {
    filtered = filtered.filter((d) => (d.uploadType || '').toLowerCase() === selectedType.toLowerCase());
  }

  if (searchTerm) {
    filtered = filtered.filter((d) =>
      (d.bookTitle && d.bookTitle.toLowerCase().includes(searchTerm)) ||
      (d.category && d.category.toLowerCase().includes(searchTerm)) ||
      (d.language && d.language.toLowerCase().includes(searchTerm)) ||
      (d.uploadedBy && d.uploadedBy.toLowerCase().includes(searchTerm))
    );
  }

  renderAdminDocsTable(filtered);
}

function renderAdminDocsTable(docs) {
  if (!adminDocsTableBody) return;

  if (adminDocCountBadge) {
    adminDocCountBadge.textContent = `${docs.length} document${docs.length === 1 ? '' : 's'}`;
  }

  if (!docs || docs.length === 0) {
    adminDocsTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">
          <i class="fa-solid fa-folder-open" style="font-size: 26px; margin-bottom: 8px; display: block;"></i>
          No documents match your filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  adminDocsTableBody.innerHTML = docs
    .map((doc) => {
      const isRaw = doc.uploadType === 'raw-text' || doc.uploadType === 'url';
      const isMedia = doc.uploadType === 'media';
      let typeIcon = 'fa-file-pdf';
      let typeColor = '#34d399';
      let typeLabel = 'Book / PDF';

      if (doc.uploadType === 'raw-text') {
        typeIcon = 'fa-file-lines';
        typeColor = '#60a5fa';
        typeLabel = 'Raw Text';
      } else if (doc.uploadType === 'media') {
        typeIcon = 'fa-file-audio';
        typeColor = '#38bdf8';
        typeLabel = 'Speech Media';
      } else if (doc.uploadType === 'url') {
        typeIcon = 'fa-globe';
        typeColor = '#fbbf24';
        typeLabel = 'Web Scraper';
      }

      const typeBadge = `<span style="color: ${typeColor}; font-weight: 600; font-size: 11px;"><i class="fa-solid ${typeIcon}"></i> ${typeLabel}</span>`;
      const categoryBadge = `<span style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-tag"></i> ${escapeHtml(doc.category || 'General')}</span>`;
      const languageBadge = `<span style="background: rgba(167, 139, 250, 0.15); color: #c084fc; border: 1px solid rgba(167, 139, 250, 0.3); padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 600;">${escapeHtml(doc.language || 'Arabic')}</span>`;

      const vaultLink = doc.rawFileUrl
        ? `<a href="${doc.rawFileUrl}" target="_blank" class="vault-link" title="Download original Data Vault file"><i class="fa-solid fa-cloud-arrow-down"></i> Vault File</a>`
        : '<span style="color: var(--text-dim); font-size: 11px;">N/A</span>';

      const dateStr = doc.createdAt
        ? new Date(doc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'N/A';

      const encodedTitle = encodeURIComponent(doc.bookTitle);

      return `
        <tr>
          <td>
            <div style="font-weight: 600; color: #fff; margin-bottom: 3px;">
              <i class="fa-solid ${typeIcon}" style="color: ${typeColor}; margin-right: 6px;"></i>
              ${escapeHtml(doc.bookTitle)}
            </div>
            <div>${typeBadge}</div>
          </td>
          <td>${categoryBadge}</td>
          <td>${languageBadge}</td>
          <td>
            <div style="font-size: 12px; font-weight: 500; color: #e2e8f0;">${escapeHtml(doc.uploadedBy || 'admin@msruq.com')}</div>
          </td>
          <td>
            <span class="page-badge"><i class="fa-solid fa-copy"></i> ${(doc.totalPages || 1).toLocaleString()}</span>
          </td>
          <td>
            <span style="font-weight: 600; color: #fbbf24;"><i class="fa-solid fa-cubes"></i> ${(doc.totalChunks || 1).toLocaleString()}</span>
          </td>
          <td>${vaultLink}</td>
          <td style="font-size: 12px; color: var(--text-dim);">${dateStr}</td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="glass-btn btn-sm" onclick="openChunksModal('${escapeHtml(doc.bookTitle)}')" title="Inspect Vector Chunks" style="padding: 5px 8px; margin-right: 4px;">
              <i class="fa-solid fa-cubes" style="color: #38bdf8;"></i>
            </button>
            <button class="glass-btn btn-sm" onclick="openEditDocModal('${escapeHtml(doc.bookTitle)}', '${escapeHtml(doc.category || 'General')}', '${escapeHtml(doc.language || 'Arabic')}')" title="Edit Metadata" style="padding: 5px 8px; margin-right: 4px;">
              <i class="fa-solid fa-pen-to-square" style="color: #fbbf24;"></i>
            </button>
            <button class="glass-btn btn-sm" onclick="openDeleteDocModal('${escapeHtml(doc.bookTitle)}')" title="Delete Document & Vectors" style="padding: 5px 8px; color: #f87171;">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

// Master Documents Filter Listeners
if (adminDocSearchInput) adminDocSearchInput.addEventListener('input', applyAdminDocFilters);
if (adminDocFilterCategory) adminDocFilterCategory.addEventListener('change', applyAdminDocFilters);
if (adminDocFilterSupervisor) adminDocFilterSupervisor.addEventListener('change', applyAdminDocFilters);
if (adminDocFilterType) adminDocFilterType.addEventListener('change', applyAdminDocFilters);

// Modal: Inspect Chunks
async function openChunksModal(title) {
  if (!chunksModal) return;
  chunksModalTitle.textContent = `Chunks: "${title}"`;
  chunksModalSubtitle.textContent = 'Loading vector chunks from index...';
  chunksModalList.innerHTML = '<div class="loading-state">Fetching vector chunks...</div>';
  chunksModal.classList.add('active');

  try {
    const res = await fetch(`/api/admin/documents/${encodeURIComponent(title)}/chunks`);
    if (res.ok) {
      const result = await res.json();
      const chunks = result.data || [];
      chunksModalSubtitle.textContent = `${chunks.length} indexed chunks in database`;

      if (chunks.length === 0) {
        chunksModalList.innerHTML = '<div class="empty-state">No chunks found for this document.</div>';
        return;
      }

      chunksModalList.innerHTML = chunks
        .map((c, i) => `
          <div style="background: rgba(0,0,0,0.35); padding: 12px 14px; border-radius: 8px; border: 1px solid var(--glass-border);">
            <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: var(--text-dim); margin-bottom: 6px;">
              <span><i class="fa-solid fa-cube"></i> Chunk #${c.chunkIndex ?? i + 1}</span>
              <span>${c.characterCount || c.chunk?.length || 0} characters</span>
            </div>
            <div style="font-family: inherit; font-size: 13px; line-height: 1.6; color: #e2e8f0; white-space: pre-wrap;">${escapeHtml(c.chunk)}</div>
          </div>
        `)
        .join('');
    } else {
      chunksModalList.innerHTML = '<div class="empty-state">Failed to load chunks.</div>';
    }
  } catch (err) {
    chunksModalList.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
  }
}

if (closeChunksModalBtn) closeChunksModalBtn.addEventListener('click', () => chunksModal.classList.remove('active'));
if (chunksModal) {
  chunksModal.addEventListener('click', (e) => {
    if (e.target === chunksModal) chunksModal.classList.remove('active');
  });
}

// Modal: Edit Metadata
function openEditDocModal(title, currentCategory, currentLanguage) {
  if (!editDocModal) return;
  editOriginalDocTitle.value = title;
  editNewDocTitle.value = title;
  if (editDocCategory) editDocCategory.value = currentCategory || 'General';
  if (editDocLanguage) editDocLanguage.value = currentLanguage || 'Arabic';
  editDocModal.classList.add('active');
  editNewDocTitle.focus();
}

function closeEditDocModal() {
  if (editDocModal) editDocModal.classList.remove('active');
}

if (closeEditDocModalBtn) closeEditDocModalBtn.addEventListener('click', closeEditDocModal);
if (cancelEditDocBtn) cancelEditDocBtn.addEventListener('click', closeEditDocModal);
if (editDocModal) {
  editDocModal.addEventListener('click', (e) => {
    if (e.target === editDocModal) closeEditDocModal();
  });
}

if (editDocForm) {
  editDocForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const originalTitle = editOriginalDocTitle.value.trim();
    const newTitle = editNewDocTitle.value.trim();
    const category = editDocCategory.value;
    const language = editDocLanguage.value;

    if (!newTitle) {
      alert('Document title cannot be empty.');
      return;
    }

    saveEditDocBtn.disabled = true;

    try {
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(originalTitle)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newTitle, category, language }),
      });

      const result = await res.json();
      if (res.ok && result.success) {
        alert(`Success: ${result.message}`);
        closeEditDocModal();
        fetchAdminDocuments();
        fetchAuditLogs();
        fetchSupervisors();
      } else {
        alert(`Update failed: ${result.error || 'Server error'}`);
      }
    } catch (err) {
      alert(`Error updating document: ${err.message}`);
    } finally {
      saveEditDocBtn.disabled = false;
    }
  });
}

// Modal: Delete Document
function openDeleteDocModal(title) {
  pendingDeleteTitle = title;
  if (deleteDocTargetTitle) deleteDocTargetTitle.textContent = `"${title}"`;
  if (deleteDocModal) deleteDocModal.classList.add('active');
}

function closeDeleteDocModal() {
  pendingDeleteTitle = null;
  if (deleteDocModal) deleteDocModal.classList.remove('active');
}

if (closeDeleteDocModalBtn) closeDeleteDocModalBtn.addEventListener('click', closeDeleteDocModal);
if (cancelDeleteDocBtn) cancelDeleteDocBtn.addEventListener('click', closeDeleteDocModal);
if (deleteDocModal) {
  deleteDocModal.addEventListener('click', (e) => {
    if (e.target === deleteDocModal) closeDeleteDocModal();
  });
}

if (confirmDeleteDocBtn) {
  confirmDeleteDocBtn.addEventListener('click', async () => {
    if (!pendingDeleteTitle) return;
    confirmDeleteDocBtn.disabled = true;

    try {
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(pendingDeleteTitle)}`, {
        method: 'DELETE',
      });

      const result = await res.json();
      if (res.ok && result.success) {
        alert(result.message);
        closeDeleteDocModal();
        fetchAdminDocuments();
        fetchOverviewStats();
        fetchAuditLogs();
        fetchSupervisors();
      } else {
        alert(`Failed to delete document: ${result.error || 'Server error'}`);
      }
    } catch (err) {
      alert(`Error deleting document: ${err.message}`);
    } finally {
      confirmDeleteDocBtn.disabled = false;
    }
  });
}

// Ingestion Tab 1 Submit: Document File (.pdf, .txt, .md)
if (adminUploadDocForm) {
  adminUploadDocForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!adminDocFileInput.files || adminDocFileInput.files.length === 0) {
      alert('Please select a document file (.PDF, .TXT, .MD) to upload.');
      return;
    }

    const assignedSupervisor = getActiveAdminSupervisor();
    const category = adminDocCategorySelect ? adminDocCategorySelect.value : 'General';
    const language = adminDocLanguageSelect ? adminDocLanguageSelect.value : 'Arabic';

    const formData = new FormData();
    formData.append('bookFile', adminDocFileInput.files[0]);
    formData.append('uploadedBy', assignedSupervisor);
    formData.append('category', category);
    formData.append('language', language);
    if (adminDocTitleInput && adminDocTitleInput.value.trim()) {
      formData.append('title', adminDocTitleInput.value.trim());
    }

    adminUploadProgressBox.style.display = 'flex';
    adminProgressTitle.textContent = 'Archiving & Indexing Document...';
    adminProgressDesc.textContent = `Saving in Data Vault [${category}/${language}] under: ${assignedSupervisor}`;
    adminStartDocUploadBtn.disabled = true;

    try {
      const res = await fetch('/api/ingestion/upload-book', {
        method: 'POST',
        headers: { 'X-Supervisor-ID': assignedSupervisor },
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Success! "${data.data.bookTitle}" has been permanently archived in Data Vault and indexed (${data.data.totalChunks} chunks).`);
        adminUploadDocForm.reset();
        adminDocDropzoneText.textContent = 'Click or Drag & Drop a document (.PDF, .TXT, .MD) here';
        fetchAdminDocuments();
        fetchOverviewStats();
        fetchAuditLogs();
        fetchSupervisors();
      } else {
        alert(`Upload Failed: ${data.error || 'Server error'}`);
      }
    } catch (err) {
      alert(`Error uploading document: ${err.message}`);
    } finally {
      adminUploadProgressBox.style.display = 'none';
      adminStartDocUploadBtn.disabled = false;
    }
  });
}

// Ingestion Tab 2 Submit: Raw Text Ingestion
if (adminRawTextForm) {
  adminRawTextForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = adminRawTitleInput.value.trim();
    const textContent = adminRawContentInput.value.trim();
    const assignedSupervisor = getActiveAdminSupervisor();
    const category = adminRawCategorySelect ? adminRawCategorySelect.value : 'General';
    const language = adminRawLanguageSelect ? adminRawLanguageSelect.value : 'Arabic';

    if (!textContent) {
      alert('Please paste some text content before indexing.');
      return;
    }

    adminUploadProgressBox.style.display = 'flex';
    adminProgressTitle.textContent = 'Processing Raw Text Notes...';
    adminProgressDesc.textContent = `Creating .txt Vault File [${category}/${language}] under: ${assignedSupervisor}`;
    adminStartRawBtn.disabled = true;

    try {
      const res = await fetch('/api/ingestion/raw-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Supervisor-ID': assignedSupervisor,
        },
        body: JSON.stringify({
          title,
          text: textContent,
          uploadedBy: assignedSupervisor,
          category,
          language,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Success! Raw notes "${data.data.bookTitle}" processed and indexed (${data.data.totalChunks} chunks).`);
        adminRawTextForm.reset();
        if (adminCharCounter) adminCharCounter.textContent = '0 characters';
        fetchAdminDocuments();
        fetchOverviewStats();
        fetchAuditLogs();
        fetchSupervisors();
      } else {
        alert(`Raw text indexing failed: ${data.error || 'Server error'}`);
      }
    } catch (err) {
      alert(`Error processing raw text: ${err.message}`);
    } finally {
      adminUploadProgressBox.style.display = 'none';
      adminStartRawBtn.disabled = false;
    }
  });
}

// Ingestion Tab 3 Submit: Media Speech-to-Text
if (adminMediaForm) {
  adminMediaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!adminMediaFileInput.files || adminMediaFileInput.files.length === 0) {
      alert('Please select a Video or Audio file to transcribe.');
      return;
    }

    const title = adminMediaTitleInput.value.trim();
    const assignedSupervisor = getActiveAdminSupervisor();
    const category = adminMediaCategorySelect ? adminMediaCategorySelect.value : 'General';
    const language = adminMediaLanguageSelect ? adminMediaLanguageSelect.value : 'Arabic';

    const formData = new FormData();
    formData.append('mediaFile', adminMediaFileInput.files[0]);
    formData.append('title', title);
    formData.append('uploadedBy', assignedSupervisor);
    formData.append('category', category);
    formData.append('language', language);

    adminUploadProgressBox.style.display = 'flex';
    adminProgressTitle.textContent = 'Transcribing Speech via Gemini AI...';
    adminProgressDesc.textContent = `Generating speech-to-text transcript & archiving in Data Vault for: ${assignedSupervisor}`;
    adminStartMediaBtn.disabled = true;

    try {
      const res = await fetch('/api/ingestion/media', {
        method: 'POST',
        headers: { 'X-Supervisor-ID': assignedSupervisor },
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Success! Media transcribed and indexed: "${data.data.bookTitle}" (${data.data.totalChunks} chunks).`);
        adminMediaForm.reset();
        adminMediaDropzoneText.textContent = 'Click or Drag & Drop a Video/Audio file (.MP4, .MP3, .WAV, .M4A) here';
        fetchAdminDocuments();
        fetchOverviewStats();
        fetchAuditLogs();
        fetchSupervisors();
      } else {
        alert(`Transcription failed: ${data.error || 'Server error'}`);
      }
    } catch (err) {
      alert(`Error processing media: ${err.message}`);
    } finally {
      adminUploadProgressBox.style.display = 'none';
      adminStartMediaBtn.disabled = false;
    }
  });
}

// Ingestion Tab 4 Submit: Web URL Scraper
if (adminUrlScraperForm) {
  adminUrlScraperForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = adminTargetUrlInput.value.trim();
    const title = adminUrlTitleInput ? adminUrlTitleInput.value.trim() : '';
    const assignedSupervisor = getActiveAdminSupervisor();
    const category = adminUrlCategorySelect ? adminUrlCategorySelect.value : 'General';
    const language = adminUrlLanguageSelect ? adminUrlLanguageSelect.value : 'Arabic';

    if (!url) {
      alert('Please enter a valid website URL.');
      return;
    }

    adminUploadProgressBox.style.display = 'flex';
    adminProgressTitle.textContent = 'Scraping Web Article & Cleaning HTML...';
    adminProgressDesc.textContent = `Extracting content from: ${url}`;
    adminStartUrlScrapeBtn.disabled = true;

    try {
      const res = await fetch('/api/ingestion/scrape-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Supervisor-ID': assignedSupervisor,
        },
        body: JSON.stringify({
          url,
          title,
          uploadedBy: assignedSupervisor,
          category,
          language,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Success! Scraped and indexed "${data.data.bookTitle}" (${data.data.totalChunks} chunks).`);
        adminUrlScraperForm.reset();
        fetchAdminDocuments();
        fetchOverviewStats();
        fetchAuditLogs();
        fetchSupervisors();
      } else {
        alert(`URL scraping failed: ${data.error || 'Server error'}`);
      }
    } catch (err) {
      alert(`Error scraping URL: ${err.message}`);
    } finally {
      adminUploadProgressBox.style.display = 'none';
      adminStartUrlScrapeBtn.disabled = false;
    }
  });
}

// Knowledge Base Vector Vault Inspector Logic
if (inspectorMinSim && inspectorMinSimVal) {
  inspectorMinSim.addEventListener('input', function () {
    inspectorMinSimVal.textContent = `${Math.round(this.value * 100)}%`;
  });
}

if (vaultInspectorForm) {
  vaultInspectorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = inspectorQueryInput.value.trim();
    const category = inspectorCategorySelect ? inspectorCategorySelect.value : 'All';
    const minSimilarity = parseFloat(inspectorMinSim ? inspectorMinSim.value : 0.3);
    const topK = parseInt(inspectorTopK ? inspectorTopK.value : 5, 10);

    if (!query) return;

    runInspectorBtn.disabled = true;
    inspectorResultsContainer.style.display = 'block';
    inspectorResultsList.innerHTML = '<div class="loading-state">Executing vector query with Gemini text-embedding-004...</div>';

    try {
      const res = await fetch('/api/admin/search-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          category,
          minSimilarity,
          topK,
        }),
      });

      const result = await res.json();
      if (res.ok && result.success) {
        const matches = result.data || [];
        inspectorResultCount.textContent = `${matches.length} matches`;

        if (matches.length === 0) {
          inspectorResultsList.innerHTML = '<div class="empty-state">No chunks matched the query with the selected similarity threshold.</div>';
          return;
        }

        inspectorResultsList.innerHTML = matches
          .map((m) => {
            const pct = Math.round(m.similarity * 100);
            return `
              <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); border-radius: 10px; padding: 14px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
                  <span style="font-weight: 700; color: #fff; font-size: 14px;">
                    <i class="fa-solid fa-book" style="color: #34d399; margin-right: 6px;"></i> ${escapeHtml(m.bookTitle)}
                  </span>
                  <div style="display: flex; gap: 8px; align-items: center;">
                    <span style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); padding: 2px 8px; border-radius: 6px; font-size: 11px;">
                      ${escapeHtml(m.category || 'General')}
                    </span>
                    <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px;">
                      ${pct}% Match
                    </span>
                  </div>
                </div>
                <div style="font-size: 13px; line-height: 1.6; color: #cbd5e1; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; white-space: pre-wrap;">${escapeHtml(m.chunk)}</div>
              </div>
            `;
          })
          .join('');
      } else {
        inspectorResultsList.innerHTML = `<div class="empty-state">${result.error || 'Search test failed.'}</div>`;
      }
    } catch (err) {
      inspectorResultsList.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
    } finally {
      runInspectorBtn.disabled = false;
    }
  });
}

// Real-Time System Telemetry & Vault Health
async function fetchSystemTelemetry() {
  try {
    const res = await fetch('/api/admin/overview');
    if (res.ok) {
      const result = await res.json();
      const stats = result.data || {};
      if (sysEmbeddingModel) sysEmbeddingModel.textContent = stats.embeddingModel || 'text-embedding-004';
      if (sysLlmModel) sysLlmModel.textContent = stats.llmModel || 'gemini-1.5-flash';
      if (sysVectorDim) sysVectorDim.textContent = `${stats.vectorDimension || 768}-dim`;
      if (sysVaultStatus) sysVaultStatus.textContent = stats.dataVaultStatus ? 'Active & Permanent' : 'Active';
      if (sysOverallStatus) sysOverallStatus.textContent = stats.systemStatus || 'Operational';
    }
  } catch (err) {
    console.error('Error fetching system telemetry:', err);
  }
}

// Supervisors Grid Analytics
async function fetchSupervisors() {
  try {
    const res = await fetch('/api/admin/supervisors');
    if (res.ok) {
      const result = await res.json();
      allSupervisors = result.data || [];
      renderSupervisorsGrid(allSupervisors);
    }
  } catch (err) {
    if (supervisorsGrid) {
      supervisorsGrid.innerHTML = '<div class="empty-state">Failed to load supervisors data</div>';
    }
  }
}

function renderSupervisorsGrid(supervisors) {
  if (!supervisorsGrid) return;
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
    .map((sup) => {
      const displayName = sup.supervisorId.split('@')[0].replace(/[._-]/g, ' ').toUpperCase();
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

// Supervisor Filter Input
if (supervisorSearchInput) {
  supervisorSearchInput.addEventListener('input', function () {
    const term = this.value.toLowerCase().trim();
    const filtered = allSupervisors.filter((s) => s.supervisorId.toLowerCase().includes(term));
    renderSupervisorsGrid(filtered);
  });
}

// Supervisor Drill-Down Modal
function openSupervisorDetail(supervisorId) {
  const sup = allSupervisors.find((s) => s.supervisorId === supervisorId);
  if (!sup) return;

  const displayName = sup.supervisorId.split('@')[0].replace(/[._-]/g, ' ').toUpperCase();
  modalSupervisorName.textContent = displayName;
  modalSupervisorEmail.textContent = sup.supervisorId;
  modalBooksCount.textContent = (sup.totalBooksUploaded || 0).toLocaleString();
  if (modalPagesCount) modalPagesCount.textContent = (sup.totalPagesUploaded || 0).toLocaleString();
  modalRawCount.textContent = (sup.totalRawTextsPasted || 0).toLocaleString();
  modalChunksCount.textContent = (sup.totalChunksIndexed || 0).toLocaleString();

  if (!sup.documents || sup.documents.length === 0) {
    modalDocsTableBody.innerHTML = '<tr><td colspan="8" class="empty-state">No documents found.</td></tr>';
  } else {
    modalDocsTableBody.innerHTML = sup.documents
      .map((doc) => {
        const isRaw = doc.uploadType === 'raw-text' || doc.uploadType === 'url';
        const methodBadge = isRaw
          ? '<span style="color: #60a5fa; font-weight:600;"><i class="fa-solid fa-paste"></i> Raw Text</span>'
          : '<span style="color: #34d399; font-weight:600;"><i class="fa-solid fa-file-pdf"></i> Book</span>';

        const categoryBadge = `<span style="background: rgba(96, 165, 250, 0.15); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3); padding: 2px 7px; border-radius: 8px; font-size: 11px; font-weight: 600;">${escapeHtml(doc.category || 'General')}</span>`;
        const languageBadge = `<span style="background: rgba(167, 139, 250, 0.15); color: #c084fc; border: 1px solid rgba(167, 139, 250, 0.3); padding: 2px 7px; border-radius: 8px; font-size: 11px; font-weight: 600;">${escapeHtml(doc.language || 'Arabic')}</span>`;
        const dateStr = doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString() : 'N/A';
        const vaultLink = doc.rawFileUrl
          ? `<a href="${doc.rawFileUrl}" target="_blank" class="vault-link"><i class="fa-solid fa-arrow-down-to-bracket"></i> Download</a>`
          : '<span style="color: var(--text-dim);">No vault link</span>';

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

if (closeSupervisorModal) {
  closeSupervisorModal.addEventListener('click', () => supervisorModal.classList.remove('active'));
}
if (supervisorModal) {
  supervisorModal.addEventListener('click', (e) => {
    if (e.target === supervisorModal) supervisorModal.classList.remove('active');
  });
}

// Category CRUD Logic
function renderCategoriesTable(categories) {
  if (!categoriesTableBody) return;
  if (!categories || categories.length === 0) {
    categoriesTableBody.innerHTML = '<tr><td colspan="4" class="empty-state">No dynamic categories found.</td></tr>';
    return;
  }

  categoriesTableBody.innerHTML = categories
    .map((cat) => `
      <tr>
        <td>
          <div style="font-weight: 600; color: #fff;"><i class="fa-solid fa-tag" style="color: #818cf8; margin-right: 6px;"></i> ${escapeHtml(cat.name)}</div>
        </td>
        <td style="color: var(--text-dim); font-size: 13px;">${escapeHtml(cat.description || 'No description')}</td>
        <td style="color: var(--text-dim); font-size: 12px;">${cat.createdAt ? new Date(cat.createdAt).toLocaleDateString() : 'N/A'}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="glass-btn btn-sm" onclick="openEditCategoryModal('${escapeHtml(cat.id)}')" title="Edit Category" style="margin-right: 4px;">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="glass-btn btn-sm" onclick="handleDeleteCategory('${escapeHtml(cat.id)}', '${escapeHtml(cat.name)}')" title="Delete Category" style="color: #f87171;">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </td>
      </tr>
    `)
    .join('');
}

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
  if (categoryModal) categoryModal.classList.remove('active');
}

if (openAddCategoryModalBtn) openAddCategoryModalBtn.addEventListener('click', openCreateCategoryModal);
if (closeCategoryModalBtn) closeCategoryModalBtn.addEventListener('click', closeCategoryModal);
if (cancelCategoryModalBtn) cancelCategoryModalBtn.addEventListener('click', closeCategoryModal);
if (categoryModal) {
  categoryModal.addEventListener('click', (e) => {
    if (e.target === categoryModal) closeCategoryModal();
  });
}

if (categoryForm) {
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
        alert(`Category "${result.data.name}" saved successfully!`);
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
}

async function handleDeleteCategory(id, name) {
  if (!confirm(`Are you sure you want to delete the category "${name}"?`)) return;

  try {
    const res = await fetch(`/api/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

// Supervisor Audit Logs Logic
async function fetchAuditLogs() {
  try {
    const res = await fetch('/api/admin/audit-logs');
    if (res.ok) {
      const result = await res.json();
      allSupervisorSummaries = result.data?.supervisors || [];
      allAuditLogs = result.data?.auditLogs || [];
      updateAuditSupervisorDropdown(allSupervisorSummaries);
      renderSupervisorSummaryCards(allSupervisorSummaries);
      applyAuditFilters();
    }
  } catch (err) {
    console.error('Error fetching audit logs:', err);
  }
}

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
            <span class="audit-metric-label"><i class="fa-solid fa-book"></i> Total Books</span>
            <span class="audit-metric-val books-val">${(sup.totalBooksUploaded || 0).toLocaleString()}</span>
          </div>
          <div class="audit-metric-box">
            <span class="audit-metric-label"><i class="fa-solid fa-file-invoice"></i> Total Pages</span>
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

function applyAuditFilters() {
  const selectedSup = auditSupervisorFilter ? auditSupervisorFilter.value : 'ALL';
  const searchTerm = (auditSearchInput ? auditSearchInput.value : '').toLowerCase().trim();

  let filtered = allAuditLogs;

  if (selectedSup && selectedSup !== 'ALL') {
    filtered = filtered.filter((log) => log.supervisorId.toLowerCase() === selectedSup.toLowerCase());
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

function renderAuditLogsTable(logs) {
  if (!auditLogsTableBody) return;

  if (auditLogCountBadge) {
    auditLogCountBadge.textContent = `${logs.length} document${logs.length === 1 ? '' : 's'} logged`;
  }

  if (!logs || logs.length === 0) {
    auditLogsTableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No audit logs match your search and filter criteria.</td></tr>';
    return;
  }

  auditLogsTableBody.innerHTML = logs
    .map((log) => {
      const isRaw = log.uploadType === 'raw-text' || log.uploadType === 'url';
      const categoryBadge = `<span style="background: rgba(96, 165, 250, 0.15); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3); padding: 2px 7px; border-radius: 8px; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-folder-tree"></i> ${escapeHtml(log.category || 'General')}</span>`;
      const languageBadge = `<span style="background: rgba(167, 139, 250, 0.15); color: #c084fc; border: 1px solid rgba(167, 139, 250, 0.3); padding: 2px 7px; border-radius: 8px; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-language"></i> ${escapeHtml(log.language || 'Arabic')}</span>`;

      const vaultLink = log.rawFileUrl
        ? `<a href="${log.rawFileUrl}" target="_blank" class="vault-link" title="Download source from Data Vault"><i class="fa-solid fa-cloud-arrow-down"></i> Data Vault</a>`
        : '<span style="color: var(--text-dim); font-size: 12px;">N/A</span>';

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
        <td>${vaultLink}</td>
      </tr>
    `;
    })
    .join('');
}

if (auditSupervisorFilter) {
  auditSupervisorFilter.addEventListener('change', () => {
    renderSupervisorSummaryCards(allSupervisorSummaries);
    applyAuditFilters();
  });
}
if (auditSearchInput) {
  auditSearchInput.addEventListener('input', applyAuditFilters);
}

// Global Refresh Button
if (refreshAllBtn) {
  refreshAllBtn.addEventListener('click', () => {
    fetchOverviewStats();
    fetchAdminDocuments();
    fetchSupervisors();
    fetchCategories();
    fetchAuditLogs();
    fetchSystemTelemetry();
  });
}

// Language Toggle Event
if (langToggleBtn) {
  langToggleBtn.addEventListener('click', async () => {
    if (window.i18n) {
      const newLang = await window.i18n.toggleLanguage();
      updateLangUi(newLang);
    }
  });
}

// Initialization on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  if (window.i18n) {
    await window.i18n.init({
      defaultLang: 'ar',
      allowedLangs: ['ar', 'en'],
      onChange: (lang) => {
        updateLangUi(lang);
      },
    });
  }
  updateLangUi('ar');

  fetchOverviewStats();
  fetchAdminDocuments();
  fetchSupervisors();
  fetchCategories();
  fetchAuditLogs();
  fetchSystemTelemetry();

  setInterval(() => {
    fetchOverviewStats();
    fetchAdminDocuments();
    fetchSupervisors();
    fetchCategories();
    fetchAuditLogs();
    fetchSystemTelemetry();
  }, 15000);
});
