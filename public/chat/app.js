// End-User Chat Client App (Isolated Q&A Interface)
let isProcessing = false;

const messagesContainer = document.getElementById('messagesContainer');
const suggestionsContainer = document.getElementById('suggestionsContainer');
const chatForm = document.getElementById('chatForm');
const queryInput = document.getElementById('queryInput');
const sendBtn = document.getElementById('sendBtn');
const connectionStatus = document.getElementById('connectionStatus');
const langToggleBtn = document.getElementById('langToggleBtn');
const currentLangLabel = document.getElementById('currentLangLabel');

function updateLangUi(lang) {
  if (currentLangLabel) {
    currentLangLabel.textContent = (lang || 'en').toUpperCase();
  }
}

function initWelcomeMessage() {
  messagesContainer.innerHTML = '';
  const isAr = window.i18n && window.i18n.currentLang === 'ar';
  const welcomeText = isAr
    ? window.i18n.t('chat.welcome', 'Welcome to Private Assistant')
    : `Hello! I am your **Private Knowledge Assistant**.\n\nAsk me any question about the books and notes in your private repository. My answers are strictly retrieved from your verified materials without hallucinations.`;

  renderMessage({
    sender: 'assistant',
    text: welcomeText,
    sources: [],
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  suggestionsContainer.style.display = 'flex';
}

async function checkBackendHealth() {
  try {
    const res = await fetch('/health');
    if (res.ok) {
      connectionStatus.querySelector('.status-dot').classList.add('connected');
      const text = window.i18n ? window.i18n.t('chat.connected', 'Connected to Private Knowledge Base') : 'Search Index Active';
      connectionStatus.querySelector('.status-text').textContent = text;
      return true;
    }
  } catch (err) {
    connectionStatus.querySelector('.status-dot').classList.remove('connected');
    const text = window.i18n ? window.i18n.t('chat.connecting', 'Connecting to Knowledge Base...') : 'Index Offline';
    connectionStatus.querySelector('.status-text').textContent = text;
  }
  return false;
}

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
          <span>Cited Sources (${sources.length}):</span>
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
      text: `⚠️ **Network Error:** Could not connect to the search index server.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    queryInput.focus();
  }
}

queryInput.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = (this.scrollHeight) + 'px';
});

queryInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

chatForm.addEventListener('submit', handleChatSubmit);

const clearChatBtn = document.getElementById('clearChatBtn');

if (langToggleBtn) {
  langToggleBtn.addEventListener('click', async () => {
    if (window.i18n) {
      const newLang = await window.i18n.toggleLanguage();
      updateLangUi(newLang);
      initWelcomeMessage();
    }
  });
}

document.querySelectorAll('.suggestion-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const promptKey = chip.getAttribute('data-prompt-key');
    const promptText = (window.i18n && promptKey) ? window.i18n.t(promptKey, chip.textContent.trim()) : chip.textContent.trim();
    queryInput.value = promptText;
    handleChatSubmit();
  });
});

if (clearChatBtn) {
  clearChatBtn.addEventListener('click', () => {
    if (confirm('Clear current conversation history?')) {
      initWelcomeMessage();
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (window.i18n) {
    await window.i18n.init({
      defaultLang: 'en',
      allowedLangs: ['en', 'ar'],
      onChange: (lang) => {
        updateLangUi(lang);
      }
    });
  }
  initWelcomeMessage();
  checkBackendHealth();
  setInterval(checkBackendHealth, 10000);
});
