// ==============================================================================
// ChatHSM Client Application Architecture
// Strictly zero-Arabic source code: all localized strings retrieved via i18n
// ==============================================================================

const chatForm = document.getElementById('chatForm');
const queryInput = document.getElementById('queryInput');
const sendBtn = document.getElementById('sendBtn');
const messagesContainer = document.getElementById('messagesContainer');
const suggestionsContainer = document.getElementById('suggestionsContainer');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');
const langToggleBtn = document.getElementById('langToggleBtn');
const currentLangLabel = document.getElementById('currentLangLabel');
const clearChatBtn = document.getElementById('clearChatBtn');
const chatSidebar = document.getElementById('chatSidebar');
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const newChatBtn = document.getElementById('newChatBtn');
const chatSearchInput = document.getElementById('chatSearchInput');
const recentChatsList = document.getElementById('recentChatsList');

let isProcessing = false;

const tr = (key, vars) => (window.i18n ? window.i18n.t(key, vars) : key);

function updateLangUi(lang) {
  if (currentLangLabel) {
    currentLangLabel.textContent = (lang || 'ar').toUpperCase();
  }
}

function initWelcomeMessage() {
  messagesContainer.innerHTML = '';
  suggestionsContainer.style.display = 'flex';
}

async function checkBackendHealth() {
  try {
    const res = await fetch('/health');
    if (res.ok) {
      const dot = connectionStatus.querySelector('.status-dot');
      if (dot) dot.classList.add('connected');
      if (statusText) {
        statusText.textContent = tr('chat.connected', 'Connected to Private Knowledge Base');
      }
      return true;
    }
  } catch (_) {
    const dot = connectionStatus.querySelector('.status-dot');
    if (dot) dot.classList.remove('connected');
    if (statusText) {
      statusText.textContent = tr('chat.connecting', 'Connecting to Knowledge Base...');
    }
  }
  return false;
}

function renderMessage({ sender, text, sources = [], time, isLoading = false, msgId = null }) {
  const row = document.createElement('div');
  row.className = `message-row ${sender}`;
  if (msgId) row.id = msgId;

  const senderName = sender === 'user' ? tr('chat.you') : tr('chat.assistant');
  const icon = sender === 'user' ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-wand-magic-sparkles"></i>';

  let sourcesHtml = '';
  if (sources && sources.length > 0) {
    sourcesHtml = `
      <div class="sources-section">
        <div class="sources-header">
          <i class="fa-solid fa-bookmark"></i>
          <span>${escapeHtml(tr('chat.cited_sources', { n: sources.length }))}</span>
        </div>
        ${sources.map((src, i) => `
          <div class="citation-card" onclick="this.classList.toggle('open')">
            <div class="citation-toggle">
              <div class="citation-title-box">
                <i class="fa-solid fa-file-lines"></i>
                <span>#${i + 1}: ${escapeHtml(src.bookTitle || src.title || 'Reference')}${src.page ? ` · ${escapeHtml(tr('chat.page_n', { n: src.page }))}` : ''}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="citation-badge">${escapeHtml(tr('chat.match', { pct: ((src.similarity || 0.85) * 100).toFixed(1) }))}</span>
                <i class="fa-solid fa-chevron-down citation-chevron"></i>
              </div>
            </div>
            <div class="citation-excerpt">
              "${escapeHtml(src.excerpt || src.content || '')}"
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
        <span>${escapeHtml(tr('chat.thinking'))}</span>
      </div>
    `;
  } else {
    const rawHtml = window.marked ? window.marked.parse(text) : text;
    const cleanHtml = window.DOMPurify ? window.DOMPurify.sanitize(rawHtml) : rawHtml;
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
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

async function handleChatSubmit(e) {
  if (e) e.preventDefault();
  const query = queryInput.value.trim();
  if (!query || isProcessing) return;

  isProcessing = true;
  sendBtn.disabled = true;
  suggestionsContainer.style.display = 'none';

  renderMessage({
    sender: 'user',
    text: query,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  queryInput.value = '';
  queryInput.style.height = 'auto';

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

    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
    const loadingElem = document.getElementById(loadingId);
    if (loadingElem) loadingElem.remove();

    if (res.ok && data && data.success) {
      renderMessage({
        sender: 'assistant',
        text: data.answer,
        sources: data.sources || [],
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    } else {
      const key = data && data.code ? `errors.${data.code}` : null;
      const known = key && tr(key) !== key ? tr(key) : null;
      const reason = known || (data && data.error) || tr(res.status >= 500 ? 'chat.server_busy' : 'chat.error_server');
      const ref = data && data.requestId ? ` (ID: ${data.requestId})` : '';
      renderMessage({
        sender: 'assistant',
        text: `⚠️ **${tr('chat.error_label')}:** ${reason}${ref}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  } catch (_) {
    const loadingElem = document.getElementById(loadingId);
    if (loadingElem) loadingElem.remove();
    renderMessage({
      sender: 'assistant',
      text: `⚠️ **${tr('chat.error_label')}:** ${tr('chat.network_error')}`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    queryInput.focus();
  }
}

// Auto-expand textarea
queryInput.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 180) + 'px';
});

// Submit on Enter
queryInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

chatForm.addEventListener('submit', handleChatSubmit);

// Sidebar Collapse / Expand Toggle
if (sidebarToggleBtn && chatSidebar) {
  sidebarToggleBtn.addEventListener('click', () => {
    chatSidebar.classList.toggle('collapsed');
    const isCollapsed = chatSidebar.classList.contains('collapsed');
    sidebarToggleBtn.setAttribute('title', tr(isCollapsed ? 'chat.expand_sidebar' : 'chat.collapse_sidebar'));
  });
}

// Mobile Menu Toggle
if (mobileMenuBtn && chatSidebar) {
  mobileMenuBtn.addEventListener('click', () => {
    chatSidebar.classList.toggle('mobile-open');
  });

  // Close mobile drawer when clicking outside
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && chatSidebar.classList.contains('mobile-open')) {
      if (!chatSidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        chatSidebar.classList.remove('mobile-open');
      }
    }
  });
}

// New Chat Button
if (newChatBtn) {
  newChatBtn.addEventListener('click', () => {
    initWelcomeMessage();
    if (chatSidebar.classList.contains('mobile-open')) {
      chatSidebar.classList.remove('mobile-open');
    }
  });
}

// Recent chats search filter
if (chatSearchInput && recentChatsList) {
  chatSearchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    const items = recentChatsList.querySelectorAll('.recent-chat-item');
    items.forEach(item => {
      const title = item.textContent.toLowerCase();
      item.style.display = title.includes(term) ? 'flex' : 'none';
    });
  });
}

// Recent chat selection
if (recentChatsList) {
  recentChatsList.querySelectorAll('.recent-chat-item').forEach(item => {
    item.addEventListener('click', () => {
      recentChatsList.querySelectorAll('.recent-chat-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      initWelcomeMessage();
    });
  });
}

// Language Toggle
if (langToggleBtn) {
  langToggleBtn.addEventListener('click', async () => {
    if (window.i18n) {
      const newLang = await window.i18n.toggleLanguage();
      updateLangUi(newLang);
      initWelcomeMessage();
    }
  });
}

// Suggestion Chips
document.querySelectorAll('.suggestion-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const promptKey = chip.getAttribute('data-prompt-key');
    const promptText = (window.i18n && promptKey) ? window.i18n.t(promptKey, chip.textContent.trim()) : chip.textContent.trim();
    queryInput.value = promptText;
    handleChatSubmit();
  });
});

// Clear Chat Confirmation
if (clearChatBtn) {
  clearChatBtn.addEventListener('click', () => {
    if (confirm(tr('chat.clear_confirm'))) {
      initWelcomeMessage();
    }
  });
}

// App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  if (window.i18n) {
    await window.i18n.init({
      defaultLang: 'ar',
      allowedLangs: ['ar', 'en'],
      onChange: (lang) => {
        updateLangUi(lang);
      }
    });
  }
  initWelcomeMessage();
  checkBackendHealth();
  setInterval(checkBackendHealth, 10000);
});
