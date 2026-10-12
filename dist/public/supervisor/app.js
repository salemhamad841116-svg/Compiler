// Supervisor Data Entry Portal (waraqa.msruq.com)
const supervisorEmailSelect = document.getElementById('supervisorEmailSelect');
const customSupervisorInput = document.getElementById('customSupervisorInput');

// 4 Tabs
const tabUploadDocBtn = document.getElementById('tabUploadDocBtn');
const tabRawTextBtn = document.getElementById('tabRawTextBtn');
const tabMediaBtn = document.getElementById('tabMediaBtn');
const tabUrlScraperBtn = document.getElementById('tabUrlScraperBtn');

const uploadDocPane = document.getElementById('uploadDocPane');
const rawTextPane = document.getElementById('rawTextPane');
const mediaPane = document.getElementById('mediaPane');
const urlScraperPane = document.getElementById('urlScraperPane');

// Tab 1: Document Upload
const uploadDocForm = document.getElementById('uploadDocForm');
const docDropzone = document.getElementById('docDropzone');
const docDropzoneText = document.getElementById('docDropzoneText');
const docFileInput = document.getElementById('docFileInput');
const docTitleInput = document.getElementById('docTitleInput');
const docCategorySelect = document.getElementById('docCategorySelect');
const docLanguageSelect = document.getElementById('docLanguageSelect');
const startDocUploadBtn = document.getElementById('startDocUploadBtn');

// Tab 2: Raw Text Ingestion
const rawTextForm = document.getElementById('rawTextForm');
const rawTextTitleInput = document.getElementById('rawTextTitleInput');
const rawCategorySelect = document.getElementById('rawCategorySelect');
const rawLanguageSelect = document.getElementById('rawLanguageSelect');
const rawTextInput = document.getElementById('rawTextInput');
const charCounter = document.getElementById('charCounter');
const startRawTextBtn = document.getElementById('startRawTextBtn');

// Tab 3: Media Speech-to-Text Ingestion
const mediaForm = document.getElementById('mediaForm');
const mediaDropzone = document.getElementById('mediaDropzone');
const mediaDropzoneText = document.getElementById('mediaDropzoneText');
const mediaFileInput = document.getElementById('mediaFileInput');
const mediaTitleInput = document.getElementById('mediaTitleInput');
const mediaCategorySelect = document.getElementById('mediaCategorySelect');
const mediaLanguageSelect = document.getElementById('mediaLanguageSelect');
const startMediaUploadBtn = document.getElementById('startMediaUploadBtn');

// Tab 4: Web URL Scraper
const urlScraperForm = document.getElementById('urlScraperForm');
const targetUrlInput = document.getElementById('targetUrlInput');
const urlTitleInput = document.getElementById('urlTitleInput');
const urlCategorySelect = document.getElementById('urlCategorySelect');
const urlLanguageSelect = document.getElementById('urlLanguageSelect');
const startUrlScrapeBtn = document.getElementById('startUrlScrapeBtn');

// Progress & History
const uploadProgressBox = document.getElementById('uploadProgressBox');
const progressTitle = document.getElementById('progressTitle');
const progressDesc = document.getElementById('progressDesc');
const historyTableBody = document.getElementById('historyTableBody');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');

function getActiveSupervisorEmail() {
  if (supervisorEmailSelect.value === 'supervisor_custom') {
    return customSupervisorInput.value.trim() || 'supervisor_custom@masruq.com';
  }
  return supervisorEmailSelect.value;
}

supervisorEmailSelect.addEventListener('change', () => {
  if (supervisorEmailSelect.value === 'supervisor_custom') {
    customSupervisorInput.style.display = 'block';
    customSupervisorInput.focus();
  } else {
    customSupervisorInput.style.display = 'none';
  }
  loadSupervisorHistory();
});

customSupervisorInput.addEventListener('input', () => {
  loadSupervisorHistory();
});

// Tab Switching Helper
function switchTab(activeBtn, activePane) {
  [tabUploadDocBtn, tabRawTextBtn, tabMediaBtn, tabUrlScraperBtn].forEach((btn) => btn.classList.remove('active'));
  [uploadDocPane, rawTextPane, mediaPane, urlScraperPane].forEach((pane) => pane.classList.remove('active'));

  activeBtn.classList.add('active');
  activePane.classList.add('active');
}

tabUploadDocBtn.addEventListener('click', () => switchTab(tabUploadDocBtn, uploadDocPane));
tabRawTextBtn.addEventListener('click', () => switchTab(tabRawTextBtn, rawTextPane));
tabMediaBtn.addEventListener('click', () => switchTab(tabMediaBtn, mediaPane));
tabUrlScraperBtn.addEventListener('click', () => switchTab(tabUrlScraperBtn, urlScraperPane));

rawTextInput.addEventListener('input', function () {
  charCounter.textContent = `${this.value.length} characters`;
});

// Helper for safely reading JSON responses without throwing Unexpected end of JSON input
async function safeParseResponse(res) {
  try {
    const text = await res.text();
    if (!text || text.trim().length === 0) return null;
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

// 1. Document Dropzone & Batch Queue Setup (Supports 100-500 files bulk)
let supervisorBatchManager = null;
if (window.BatchQueueManager && docDropzone && docFileInput) {
  supervisorBatchManager = new window.BatchQueueManager({
    fileInput: docFileInput,
    dropzone: docDropzone,
    dropzoneText: docDropzoneText,
    container: document.getElementById('batchQueueContainer'),
    filesList: document.getElementById('batchFilesList'),
    progressBarFill: document.getElementById('batchProgressBarFill'),
    progressWrapper: document.getElementById('batchProgressWrapper'),
    statTotal: document.getElementById('batchStatTotal'),
    statSuccess: document.getElementById('batchStatSuccess'),
    statFailed: document.getElementById('batchStatFailed'),
    statRemaining: document.getElementById('batchStatRemaining'),
    totalBadge: document.getElementById('batchTotalBadge'),
    uploadAllBtn: document.getElementById('batchUploadAllBtn'),
    retryFailedBtn: document.getElementById('batchRetryFailedBtn'),
    clearBtn: document.getElementById('batchClearBtn'),
    singleSubmitBtn: startDocUploadBtn,
    getMetadata: () => ({
      uploadedBy: getActiveSupervisorEmail(),
      category: docCategorySelect ? docCategorySelect.value : 'General',
      language: docLanguageSelect ? docLanguageSelect.value : 'Arabic',
    }),
    onComplete: () => {
      loadSupervisorHistory();
    },
    concurrency: 3,
  });
} else if (docDropzone && docFileInput) {
  docDropzone.addEventListener('click', () => docFileInput.click());
  docFileInput.addEventListener('change', () => {
    if (docFileInput.files.length > 0) {
      docDropzoneText.textContent = `Selected: ${docFileInput.files[0].name}`;
    }
  });
}

// 2. Media Dropzone Setup
mediaDropzone.addEventListener('click', () => mediaFileInput.click());
mediaFileInput.addEventListener('change', () => {
  if (mediaFileInput.files.length > 0) {
    mediaDropzoneText.textContent = `Selected Media: ${mediaFileInput.files[0].name}`;
  }
});
mediaDropzone.addEventListener('dragover', (e) => { e.preventDefault(); mediaDropzone.classList.add('dragover'); });
mediaDropzone.addEventListener('dragleave', () => mediaDropzone.classList.remove('dragover'));
mediaDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  mediaDropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    mediaFileInput.files = e.dataTransfer.files;
    mediaDropzoneText.textContent = `Selected Media: ${mediaFileInput.files[0].name}`;
  }
});

// Dynamic Category Loader from API (GET /api/categories)
async function loadDynamicCategories() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) return;
    const json = await safeParseResponse(res);
    const categories = (json && json.data) ? json.data : [];
    if (categories.length === 0) return;

    const selects = [docCategorySelect, rawCategorySelect, mediaCategorySelect, urlCategorySelect];
    selects.forEach((sel) => {
      if (!sel) return;
      const currentVal = sel.value;
      sel.innerHTML = categories
        .map((cat) => `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`)
        .join('');
      if (currentVal && categories.some((c) => c.name === currentVal)) {
        sel.value = currentVal;
      }
    });
  } catch (err) {
    console.warn('[Supervisor] Failed to load dynamic categories from API:', err);
  }
}

// Tab 1 Submit: Document & Image File (.pdf, .txt, .md, .jpg, .png, .webp)
uploadDocForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // If batch queue manager has files in queue, delegate to batch upload
  if (supervisorBatchManager && supervisorBatchManager.queue.length > 0) {
    await supervisorBatchManager.startBatchUpload();
    return;
  }

  if (!docFileInput.files || docFileInput.files.length === 0) {
    alert('Please select one or more documents or images to upload.');
    return;
  }

  const activeSupervisor = getActiveSupervisorEmail();
  const category = docCategorySelect ? docCategorySelect.value : 'General';
  const language = docLanguageSelect ? docLanguageSelect.value : 'Arabic';

  const formData = new FormData();
  formData.append('bookFile', docFileInput.files[0]);
  formData.append('uploadedBy', activeSupervisor);
  formData.append('category', category);
  formData.append('language', language);
  if (docTitleInput.value.trim()) {
    formData.append('title', docTitleInput.value.trim());
  }

  uploadProgressBox.style.display = 'flex';
  progressTitle.textContent = 'Archiving & Indexing Document...';
  progressDesc.textContent = `Saving in Data Vault [${category}/${language}] under Supervisor: ${activeSupervisor}`;
  startDocUploadBtn.disabled = true;

  try {
    const res = await fetch('/api/ingestion/upload-book', {
      method: 'POST',
      headers: { 'X-Supervisor-ID': activeSupervisor },
      body: formData,
    });

    const data = await safeParseResponse(res);
    if (res.ok && data && data.success) {
      alert(`Success! "${data.data.bookTitle}" has been permanently archived in Data Vault under category "${data.data.category}" and indexed (${data.data.totalChunks} chunks).`);
      uploadDocForm.reset();
      if (supervisorBatchManager) supervisorBatchManager.clearQueue();
      docDropzoneText.textContent = 'Click or Drag & Drop documents or images (.PDF, .TXT, .MD, .JPG, .PNG, .WEBP) here';
      loadSupervisorHistory();
    } else {
      const errMsg = (data && data.error) ? data.error : `Server returned error (${res.status})`;
      alert(`Upload Failed: ${errMsg}`);
    }
  } catch (err) {
    alert(`Error uploading document: ${err.message || 'Network error'}`);
  } finally {
    uploadProgressBox.style.display = 'none';
    startDocUploadBtn.disabled = false;
  }
});

// Tab 2 Submit: Raw Text Ingestion
rawTextForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = rawTextTitleInput.value.trim();
  const textContent = rawTextInput.value.trim();
  const activeSupervisor = getActiveSupervisorEmail();
  const category = rawCategorySelect ? rawCategorySelect.value : 'General';
  const language = rawLanguageSelect ? rawLanguageSelect.value : 'Arabic';

  if (!textContent) {
    alert('Please paste some text content before indexing.');
    return;
  }

  uploadProgressBox.style.display = 'flex';
  progressTitle.textContent = 'Creating Vault File & Indexing...';
  progressDesc.textContent = `Saving as .TXT in Data Vault [${category}/${language}] under Supervisor: ${activeSupervisor}`;
  startRawTextBtn.disabled = true;

  try {
    const res = await fetch('/api/ingestion/raw-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Supervisor-ID': activeSupervisor,
      },
      body: JSON.stringify({
        title: title || 'Pasted Note',
        textContent: textContent,
        uploadedBy: activeSupervisor,
        category,
        language,
      }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(`Success! "${data.data.bookTitle}" saved into Data Vault under category "${data.data.category}" and indexed (${data.data.totalChunks} chunks).`);
      rawTextForm.reset();
      charCounter.textContent = '0 characters';
      loadSupervisorHistory();
    } else {
      alert(`Indexing Failed: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    alert(`Error indexing raw text: ${err.message}`);
  } finally {
    uploadProgressBox.style.display = 'none';
    startRawTextBtn.disabled = false;
  }
});

// Tab 3 Submit: Video / Audio Speech-to-Text Transcription
mediaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!mediaFileInput.files || mediaFileInput.files.length === 0) {
    alert('Please select a Video or Audio file (.MP4, .MP3, .WAV, .M4A) to transcribe.');
    return;
  }

  const activeSupervisor = getActiveSupervisorEmail();
  const category = mediaCategorySelect ? mediaCategorySelect.value : 'General';
  const language = mediaLanguageSelect ? mediaLanguageSelect.value : 'Arabic';

  const formData = new FormData();
  formData.append('mediaFile', mediaFileInput.files[0]);
  formData.append('title', mediaTitleInput.value.trim() || mediaFileInput.files[0].name);
  formData.append('uploadedBy', activeSupervisor);
  formData.append('category', category);
  formData.append('language', language);

  uploadProgressBox.style.display = 'flex';
  progressTitle.textContent = 'Transcribing Speech via Gemini Multimodal Engine...';
  progressDesc.textContent = `Transcribing spoken words [${category}/${language}] and archiving into Data Vault`;
  startMediaUploadBtn.disabled = true;

  try {
    const res = await fetch('/api/ingestion/media', {
      method: 'POST',
      headers: { 'X-Supervisor-ID': activeSupervisor },
      body: formData,
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(`Transcription Complete! "${data.data.bookTitle}" transcribed, archived in Data Vault under category "${data.data.category}", and indexed (${data.data.totalChunks} chunks).`);
      mediaForm.reset();
      mediaDropzoneText.textContent = 'Click or Drag & Drop a Video/Audio file (.MP4, .MP3, .WAV, .M4A) here';
      loadSupervisorHistory();
    } else {
      alert(`Media Transcription Failed: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    alert(`Error processing media: ${err.message}`);
  } finally {
    uploadProgressBox.style.display = 'none';
    startMediaUploadBtn.disabled = false;
  }
});

// Tab 4 Submit: Web URL Scraper
urlScraperForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = targetUrlInput.value.trim();
  const title = urlTitleInput.value.trim();
  const activeSupervisor = getActiveSupervisorEmail();
  const category = urlCategorySelect ? urlCategorySelect.value : 'General';
  const language = urlLanguageSelect ? urlLanguageSelect.value : 'Arabic';

  if (!url) {
    alert('Please enter a valid web URL.');
    return;
  }

  uploadProgressBox.style.display = 'flex';
  progressTitle.textContent = 'Scraping Web Page Content...';
  progressDesc.textContent = `Extracting clean text [${category}/${language}], archiving to Data Vault & generating embeddings`;
  startUrlScrapeBtn.disabled = true;

  try {
    const res = await fetch('/api/ingestion/scrape-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Supervisor-ID': activeSupervisor,
      },
      body: JSON.stringify({
        url,
        title: title || undefined,
        uploadedBy: activeSupervisor,
        category,
        language,
      }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(`Scraping Complete! "${data.data.bookTitle}" scraped, archived in Data Vault under category "${data.data.category}", and indexed (${data.data.totalChunks} chunks).`);
      urlScraperForm.reset();
      loadSupervisorHistory();
    } else {
      const errorMsg = data.error || 'Cannot extract text from this specific URL. The site may be protected or require login. Please copy and paste the text manually using the "Paste Raw Text" tab.';
      if (confirm(`Scraping Blocked or Failed:\n\n${errorMsg}\n\nWould you like to switch to the "Paste Raw Text" tab to paste the article directly?`)) {
        switchTab(tabRawTextBtn, rawTextPane);
      }
    }
  } catch (err) {
    const errorMsg = err.message || 'Cannot extract text from this specific URL. The site may be protected or require login. Please copy and paste the text manually using the "Paste Raw Text" tab.';
    if (confirm(`Scraping Failed:\n\n${errorMsg}\n\nWould you like to switch to the "Paste Raw Text" tab to paste the article directly?`)) {
      switchTab(tabRawTextBtn, rawTextPane);
    }
  } finally {
    uploadProgressBox.style.display = 'none';
    startUrlScrapeBtn.disabled = false;
  }
});

// Load Indexed Documents for Active Supervisor
async function loadSupervisorHistory() {
  const supervisorId = getActiveSupervisorEmail();
  try {
    const res = await fetch(`/api/admin/supervisors/${encodeURIComponent(supervisorId)}`);
    if (res.ok) {
      const result = await res.json();
      const sup = result.data;
      renderHistoryTable(sup ? sup.documents : []);
    }
  } catch (err) {
    historyTableBody.innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load history</td></tr>`;
  }
}

function renderHistoryTable(documents) {
  if (!documents || documents.length === 0) {
    historyTableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No items indexed yet by this supervisor.</td></tr>`;
    return;
  }

  historyTableBody.innerHTML = documents
    .map((doc) => {
      let typeBadge = '';
      const srcType = (doc.sourceType || 'pdf').toLowerCase();

      if (doc.uploadType === 'media' || ['mp4', 'mp3', 'wav', 'm4a', 'ogg', 'webm', 'mov'].includes(srcType)) {
        typeBadge = `<span style="color: #38bdf8; font-weight:600;"><i class="fa-solid fa-microphone"></i> Audio/Video (${srcType.toUpperCase()})</span>`;
      } else if (doc.uploadType === 'url' || srcType === 'url') {
        typeBadge = `<span style="color: #fbbf24; font-weight:600;"><i class="fa-solid fa-globe"></i> Web URL</span>`;
      } else if (doc.uploadType === 'raw-text' || srcType === 'txt') {
        typeBadge = `<span style="color: #60a5fa; font-weight:600;"><i class="fa-solid fa-paste"></i> Raw Text</span>`;
      } else {
        typeBadge = `<span style="color: #34d399; font-weight:600;"><i class="fa-solid fa-file-pdf"></i> Book (${srcType.toUpperCase()})</span>`;
      }

      const categoryBadge = `<span style="background: rgba(96, 165, 250, 0.15); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3); padding: 3px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-folder-tree"></i> ${escapeHtml(doc.category || 'General')}</span>`;
      const languageBadge = `<span style="background: rgba(167, 139, 250, 0.15); color: #c084fc; border: 1px solid rgba(167, 139, 250, 0.3); padding: 3px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-language"></i> ${escapeHtml(doc.language || 'Arabic')}</span>`;

      const formattedDate = doc.uploadedAt
        ? new Date(doc.uploadedAt).toLocaleString()
        : 'Recently';

      const vaultLink = doc.rawFileUrl
        ? `<a href="${doc.rawFileUrl}" target="_blank" style="color:#38bdf8; text-decoration:none; font-weight:600;"><i class="fa-solid fa-download"></i> Vault File</a>`
        : `<span style="color: var(--text-dim);">-</span>`;

      return `
      <tr>
        <td><strong>${escapeHtml(doc.title)}</strong></td>
        <td>${categoryBadge}</td>
        <td>${languageBadge}</td>
        <td>${typeBadge}</td>
        <td>${doc.totalChunks} chunks</td>
        <td>${vaultLink}</td>
        <td>${formattedDate}</td>
      </tr>
    `;
    })
    .join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

refreshHistoryBtn.addEventListener('click', () => {
  loadDynamicCategories();
  loadSupervisorHistory();
});

document.addEventListener('DOMContentLoaded', async () => {
  if (window.i18n) {
    await window.i18n.init({
      defaultLang: 'ar',
      allowedLangs: ['ar', 'en'],
      onChange: () => {
        if (window.i18n) window.i18n.applyTranslations();
      }
    });
  }
  loadDynamicCategories();
  loadSupervisorHistory();
});
