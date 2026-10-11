// State Management
let isProcessing = false;
let indexedBooks = [];

// DOM Elements
const messagesContainer = document.getElementById('messagesContainer');
const suggestionsContainer = document.getElementById('suggestionsContainer');
const chatForm = document.getElementById('chatForm');
const queryInput = document.getElementById('queryInput');
const sendBtn = document.getElementById('sendBtn');
const connectionStatus = document.getElementById('connectionStatus');
const bookCountBadge = document.getElementById('bookCountBadge');
const clearChatBtn = document.getElementById('clearChatBtn');
const openBooksBtn = document.getElementById('openBooksBtn');
const attachFileBtn = document.getElementById('attachFileBtn');
const booksModal = document.getElementById('booksModal');
const closeBooksModal = document.getElementById('closeBooksModal');

// Tabs
const tabUploadFileBtn = document.getElementById('tabUploadFileBtn');
const tabRawTextBtn = document.getElementById('tabRawTextBtn');
const uploadFilePane = document.getElementById('uploadFilePane');
const rawTextPane = document.getElementById('rawTextPane');

// Ingestion Form Elements
const uploadForm = document.getElementById('uploadForm');
const dropzone = document.getElementById('dropzone');
const dropzoneText = document.getElementById('dropzoneText');
const bookFileInput = document.getElementById('bookFileInput');
const bookTitleInput = document.getElementById('bookTitleInput');

const rawTextForm = document.getElementById('rawTextForm');
const rawTextTitleInput = document.getElementById('rawTextTitleInput');
const rawTextInput = document.getElementById('rawTextInput');
const charCounter = document.getElementById('charCounter');

const uploadProgressBox = document.getElementById('uploadProgressBox');
const progressTitle = document.getElementById('progressTitle');
const progressDesc = document.getElementById('progressDesc');
const booksListGrid = document.getElementById('booksListGrid');
const refreshBooksBtn = document.getElementById('refreshBooksBtn');

// Initial Welcome Greeting
function initWelcomeMessage() {
  messagesContainer.innerHTML = '';
  renderMessage({
    sender: 'assistant',
    text: `Hello! I am your **Private Book AI Assistant**.\n\nAsk me any question about the documents and raw notes in your personal knowledge base. My answers are strictly retrieved from your indexed materials without outside assumptions.`,
    sources: [],
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  suggestionsContainer.style.display = 'flex';
}

// Check Backend Health
async function checkBackendHealth() {
  try {
    const res = await fetch('/health');
    if (res.ok) {
      connectionStatus.querySelector('.status-dot').classList.add('connected');
      connectionStatus.querySelector('.status-text').textContent = 'Backend Connected';
      return true;
    }
  } catch (err) {
    connectionStatus.querySelector('.status-dot').classList.remove('connected');
    connectionStatus.querySelector('.status-text').textContent = 'Backend Disconnected';
  }
  return false;
}

// Fetch Indexed Books
async function fetchIndexedBooks() {
  try {
    const res = await fetch('/api/ingestion/books');
    if (res.ok) {
      const data = await res.json();
      indexedBooks = data.data || [];
      bookCountBadge.textContent = indexedBooks.length;
      renderBooksList();
    }
  } catch (err) {
    console.error('Failed to load indexed books:', err);
  }
}

// Render Books in Modal
function renderBooksList() {
  if (!booksListGrid) return;
  if (indexedBooks.length === 0) {
    booksListGrid.innerHTML = '<div class="empty-books">No documents indexed yet. Upload a file or paste raw text above.</div>';
    return;
  }

  booksListGrid.innerHTML = indexedBooks.map(book => `
    <div class="book-card">
      <div class="book-card-left">
        <div class="book-icon"><i class="fa-solid fa-file-lines"></i></div>
        <div class="book-details">
          <h4>${escapeHtml(book.bookTitle)}</h4>
          <span>${book.totalChunks} chunks indexed • text-embedding-004</span>
        </div>
      </div>
      <i class="fa-solid fa-circle-check" style="color: var(--accent-emerald);"></i>
    </div>
  `).join('');
}

// Render Chat Message
function renderMessage({ sender, text, sources = [], time, isLoading = false, msgId = null }) {
  const row = document.createElement('div');
  row.className = `message-row ${sender}`;
  if (msgId) row.id = msgId;

  const senderName = sender === 'user' ? 'You' : 'Private Assistant';
  const icon = sender === 'user' ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-wand-magic-sparkles"></i>';

  let sourcesHtml = '';
  if (sources && sources.length > 0) {
    sourcesHtml = `
      <div class="sources-section">
        <div class="sources-header">
          <i class="fa-solid fa-bookmark"></i>
          <span>Sources from your Knowledge Base (${sources.length}):</span>
        </div>
        ${sources.map((src, i) => `
          <div class="citation-card" onclick="this.classList.toggle('open')">
            <div class="citation-toggle">
              <div class="citation-title-box">
                <i class="fa-solid fa-file-lines"></i>
                <span>#${i + 1}: ${escapeHtml(src.bookTitle)}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="citation-badge">${(src.similarity * 100).toFixed(1)}% Match</span>
                <i class="fa-solid fa-chevron-down citation-chevron"></i>
              </div>
            </div>
            <div class="citation-excerpt">
              "${escapeHtml(src.excerpt)}"
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  let bodyContent = '';
  if (isLoading) {
    bodyContent = `
      <div class="typing-indicator">
        <div class="spinner-mini"></div>
        <span>Searching knowledge base and formulating answer...</span>
      </div>
    `;
  } else {
    const rawHtml = marked.parse(text);
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    bodyContent = `<div class="markdown-body">${cleanHtml}</div>${sourcesHtml}`;
  }

  row.innerHTML = `
    <div class="message-meta">
      ${sender === 'assistant' ? icon : ''}
      <span>${senderName}</span>
      ${sender === 'user' ? icon : ''}
      <span>• ${time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
    <div class="message-bubble">
      ${bodyContent}
    </div>
  `;

  messagesContainer.appendChild(row);
  scrollToBottom();
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Send Chat Query
async function handleChatSubmit(e) {
  if (e) e.preventDefault();
  const query = queryInput.value.trim();
  if (!query || isProcessing) return;

  isProcessing = true;
  sendBtn.disabled = true;
  suggestionsContainer.style.display = 'none';

  // 1. Render User Message
  renderMessage({
    sender: 'user',
    text: query,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  queryInput.value = '';
  queryInput.style.height = 'auto';

  // 2. Render Loading Placeholder
  const loadingId = 'loading-' + Date.now();
  renderMessage({
    sender: 'assistant',
    text: '',
    isLoading: true,
    msgId: loadingId
  });

  try {
    const res = await fetch('/api/chat/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: query })
    });

    const data = await res.json();
    const loadingElem = document.getElementById(loadingId);
    if (loadingElem) loadingElem.remove();

    if (res.ok && data.success) {
      renderMessage({
        sender: 'assistant',
        text: data.answer,
        sources: data.sources || [],
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    } else {
      renderMessage({
        sender: 'assistant',
        text: `⚠️ **Error:** ${data.error || 'Failed to retrieve answer from knowledge base.'}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  } catch (err) {
    const loadingElem = document.getElementById(loadingId);
    if (loadingElem) loadingElem.remove();
    renderMessage({
      sender: 'assistant',
      text: `⚠️ **Network Error:** Could not connect to the assistant server.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    queryInput.focus();
  }
}

// Auto-expand textarea on type
queryInput.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = (this.scrollHeight) + 'px';
});

// Submit on Enter (without Shift)
queryInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

chatForm.addEventListener('submit', handleChatSubmit);

// Suggestion Chips Click
document.querySelectorAll('.suggestion-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    queryInput.value = chip.dataset.prompt;
    handleChatSubmit();
  });
});

// Clear Chat
clearChatBtn.addEventListener('click', () => {
  if (confirm('Clear the current conversation?')) {
    initWelcomeMessage();
  }
});

// Tab Switching
tabUploadFileBtn.addEventListener('click', () => {
  tabUploadFileBtn.classList.add('active');
  tabRawTextBtn.classList.remove('active');
  uploadFilePane.classList.add('active');
  rawTextPane.classList.remove('active');
});

tabRawTextBtn.addEventListener('click', () => {
  tabRawTextBtn.classList.add('active');
  tabUploadFileBtn.classList.remove('active');
  rawTextPane.classList.add('active');
  uploadFilePane.classList.remove('active');
});

// Character Counter for Raw Text
rawTextInput.addEventListener('input', function() {
  charCounter.textContent = `${this.value.length} characters`;
});

// Modal Controls
openBooksBtn.addEventListener('click', () => {
  booksModal.classList.add('active');
  fetchIndexedBooks();
});
attachFileBtn.addEventListener('click', () => {
  booksModal.classList.add('active');
  fetchIndexedBooks();
});
closeBooksModal.addEventListener('click', () => {
  booksModal.classList.remove('active');
});
booksModal.addEventListener('click', (e) => {
  if (e.target === booksModal) booksModal.classList.remove('active');
});
refreshBooksBtn.addEventListener('click', fetchIndexedBooks);

// Dropzone File Handling
dropzone.addEventListener('click', () => bookFileInput.click());
bookFileInput.addEventListener('change', () => {
  if (bookFileInput.files.length > 0) {
    dropzoneText.textContent = `Selected: ${bookFileInput.files[0].name}`;
  }
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    bookFileInput.files = e.dataTransfer.files;
    dropzoneText.textContent = `Selected: ${bookFileInput.files[0].name}`;
  }
});

// File Upload Form Submission
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!bookFileInput.files || bookFileInput.files.length === 0) {
    alert('Please select a .PDF, .TXT, or .MD file to upload.');
    return;
  }

  const formData = new FormData();
  formData.append('bookFile', bookFileInput.files[0]);
  if (bookTitleInput.value.trim()) {
    formData.append('title', bookTitleInput.value.trim());
  }

  uploadProgressBox.style.display = 'flex';
  progressTitle.textContent = 'Processing & Indexing Document...';
  progressDesc.textContent = 'Extracting text and generating Gemini vector embeddings';
  const startUploadBtn = document.getElementById('startUploadBtn');
  startUploadBtn.disabled = true;

  try {
    const res = await fetch('/api/ingestion/upload-book', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(`Success! "${data.data.bookTitle}" has been indexed (${data.data.totalChunks} chunks generated).`);
      uploadForm.reset();
      dropzoneText.textContent = 'Click or Drag & Drop a file (.PDF, .TXT, .MD) here';
      fetchIndexedBooks();
    } else {
      alert(`Upload Failed: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    alert(`Error uploading file: ${err.message}`);
  } finally {
    uploadProgressBox.style.display = 'none';
    startUploadBtn.disabled = false;
  }
});

// Raw Text Form Submission
rawTextForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = rawTextTitleInput.value.trim();
  const textContent = rawTextInput.value.trim();

  if (!textContent) {
    alert('Please paste or write some text before indexing.');
    return;
  }

  uploadProgressBox.style.display = 'flex';
  progressTitle.textContent = 'Indexing Raw Text...';
  progressDesc.textContent = 'Chunking text and generating Gemini vector embeddings';
  const startRawTextBtn = document.getElementById('startRawTextBtn');
  startRawTextBtn.disabled = true;

  try {
    const res = await fetch('/api/ingestion/raw-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || 'Pasted Note',
        textContent: textContent
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(`Success! "${data.data.bookTitle}" has been indexed (${data.data.totalChunks} chunks generated).`);
      rawTextForm.reset();
      charCounter.textContent = '0 characters';
      fetchIndexedBooks();
    } else {
      alert(`Indexing Failed: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    alert(`Error indexing text: ${err.message}`);
  } finally {
    uploadProgressBox.style.display = 'none';
    startRawTextBtn.disabled = false;
  }
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  initWelcomeMessage();
  checkBackendHealth();
  fetchIndexedBooks();
  setInterval(checkBackendHealth, 10000);
});
