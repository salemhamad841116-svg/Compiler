// ==============================================================================
// Managed Batch Upload Queue (High-Performance Bulk Ingestion 100-500 Files)
// Concurrency-controlled, resilient error handling, zero-Arabic code compliance
// ==============================================================================

(function (window) {
  'use strict';

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getFileIconClass(ext) {
    switch (ext) {
      case '.jpg':
      case '.jpeg':
      case '.png':
      case '.webp':
        return 'fa-file-image';
      case '.pdf':
        return 'fa-file-pdf';
      case '.txt':
      case '.md':
      default:
        return 'fa-file-lines';
    }
  }

  function getTranslation(key, fallback) {
    if (window.i18n && typeof window.i18n.t === 'function') {
      return window.i18n.t(key, fallback);
    }
    return fallback;
  }

  class BatchQueueManager {
    /**
     * @param {Object} options
     * @param {HTMLInputElement} options.fileInput
     * @param {HTMLElement} options.dropzone
     * @param {HTMLElement} options.dropzoneText
     * @param {HTMLElement} options.container
     * @param {HTMLElement} options.filesList
     * @param {HTMLElement} options.progressBarFill
     * @param {HTMLElement} options.progressWrapper
     * @param {HTMLElement} options.statTotal
     * @param {HTMLElement} options.statSuccess
     * @param {HTMLElement} options.statFailed
     * @param {HTMLElement} options.statRemaining
     * @param {HTMLElement} options.totalBadge
     * @param {HTMLButtonElement} options.uploadAllBtn
     * @param {HTMLButtonElement} options.retryFailedBtn
     * @param {HTMLButtonElement} options.clearBtn
     * @param {HTMLButtonElement} [options.singleSubmitBtn]
     * @param {Function} options.getMetadata - Returns { uploadedBy, category, language }
     * @param {Function} [options.onComplete]
     * @param {number} [options.concurrency=3]
     */
    constructor(options) {
      this.fileInput = options.fileInput;
      this.dropzone = options.dropzone;
      this.dropzoneText = options.dropzoneText;
      this.container = options.container;
      this.filesList = options.filesList;
      this.progressBarFill = options.progressBarFill;
      this.progressWrapper = options.progressWrapper;
      this.statTotal = options.statTotal;
      this.statSuccess = options.statSuccess;
      this.statFailed = options.statFailed;
      this.statRemaining = options.statRemaining;
      this.totalBadge = options.totalBadge;
      this.uploadAllBtn = options.uploadAllBtn;
      this.retryFailedBtn = options.retryFailedBtn;
      this.clearBtn = options.clearBtn;
      this.singleSubmitBtn = options.singleSubmitBtn;
      this.getMetadata = options.getMetadata;
      this.onComplete = options.onComplete;
      this.concurrency = options.concurrency || 3;

      this.queue = [];
      this.isProcessing = false;
      this.allowedExts = ['.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png', '.webp'];
      this.maxFileSize = 50 * 1024 * 1024; // 50MB

      this.initEventListeners();
    }

    initEventListeners() {
      if (this.dropzone && this.fileInput) {
        this.dropzone.addEventListener('click', () => this.fileInput.click());

        this.fileInput.addEventListener('change', () => {
          if (this.fileInput.files && this.fileInput.files.length > 0) {
            this.addFiles(Array.from(this.fileInput.files));
          }
        });

        this.dropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          this.dropzone.classList.add('dragover');
        });

        this.dropzone.addEventListener('dragleave', () => {
          this.dropzone.classList.remove('dragover');
        });

        this.dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          this.dropzone.classList.remove('dragover');
          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            this.addFiles(Array.from(e.dataTransfer.files));
          }
        });
      }

      if (this.clearBtn) {
        this.clearBtn.addEventListener('click', () => this.clearQueue());
      }

      if (this.uploadAllBtn) {
        this.uploadAllBtn.addEventListener('click', () => this.startBatchUpload());
      }

      if (this.retryFailedBtn) {
        this.retryFailedBtn.addEventListener('click', () => this.retryFailed());
      }
    }

    /**
     * Adds files to the queue, validating format and size.
     * Supports adding 100 to 500 files at once.
     * @param {Array<File>} files
     */
    addFiles(files) {
      if (this.isProcessing) {
        alert(getTranslation('batch.wait_upload', 'Upload in progress. Please wait until current batch finishes.'));
        return;
      }

      let addedCount = 0;
      let rejectedCount = 0;

      for (const file of files) {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!this.allowedExts.includes(ext)) {
          rejectedCount++;
          continue;
        }

        if (file.size > this.maxFileSize) {
          rejectedCount++;
          continue;
        }

        // Avoid exact duplicate entries
        const exists = this.queue.some((q) => q.name === file.name && q.size === file.size);
        if (exists) continue;

        const id = 'f_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        this.queue.push({
          id,
          file,
          name: file.name,
          size: file.size,
          ext,
          status: 'pending', // 'pending' | 'uploading' | 'ocr' | 'indexing' | 'success' | 'failed'
          error: null,
          data: null,
        });
        addedCount++;
      }

      if (rejectedCount > 0 && addedCount === 0) {
        alert(getTranslation('batch.invalid_file_type', 'Selected files were rejected. Supported formats: PDF, TXT, MD, JPG, PNG, WEBP (Max 50MB).'));
      }

      this.render();
    }

    removeFile(id) {
      if (this.isProcessing) return;
      this.queue = this.queue.filter((item) => item.id !== id);
      this.render();
    }

    clearQueue() {
      if (this.isProcessing) return;
      this.queue = [];
      if (this.fileInput) this.fileInput.value = '';
      this.render();
    }

    render() {
      const count = this.queue.length;

      if (count === 0) {
        if (this.container) this.container.style.display = 'none';
        if (this.dropzoneText) {
          this.dropzoneText.textContent = getTranslation('supervisor.upload.drag_drop', 'Click or Drag & Drop documents or images here');
        }
        if (this.singleSubmitBtn) {
          this.singleSubmitBtn.style.display = 'flex';
          this.singleSubmitBtn.disabled = false;
        }
        return;
      }

      if (this.container) this.container.style.display = 'block';

      if (this.dropzoneText) {
        this.dropzoneText.textContent = `${count} ${getTranslation('batch.queue_count', 'files selected')}`;
      }

      if (this.totalBadge) {
        this.totalBadge.textContent = count;
      }

      if (this.singleSubmitBtn) {
        // If multiple files are selected, hide single upload button in favor of batch control
        this.singleSubmitBtn.style.display = count === 1 && !this.isProcessing ? 'flex' : 'none';
      }

      this.updateStats();
      this.renderFileList();
    }

    updateStats() {
      const total = this.queue.length;
      const success = this.queue.filter((q) => q.status === 'success').length;
      const failed = this.queue.filter((q) => q.status === 'failed').length;
      const remaining = total - success - failed;

      if (this.statTotal) this.statTotal.textContent = total;
      if (this.statSuccess) this.statSuccess.textContent = success;
      if (this.statFailed) this.statFailed.textContent = failed;
      if (this.statRemaining) this.statRemaining.textContent = remaining;

      const percent = total > 0 ? Math.round(((success + failed) / total) * 100) : 0;
      if (this.progressBarFill) {
        this.progressBarFill.style.width = `${percent}%`;
      }

      if (this.retryFailedBtn) {
        this.retryFailedBtn.style.display = failed > 0 && !this.isProcessing ? 'inline-flex' : 'none';
      }
    }

    renderFileList() {
      if (!this.filesList) return;

      this.filesList.innerHTML = '';

      for (const item of this.queue) {
        const itemEl = document.createElement('div');
        itemEl.className = `batch-file-item status-${item.status}`;
        itemEl.id = `item_${item.id}`;

        const iconClass = getFileIconClass(item.ext);

        let statusText = getTranslation('batch.status_pending', 'Pending');
        let statusBadgeClass = 'badge-pending';

        if (item.status === 'uploading') {
          statusText = getTranslation('batch.status_uploading', 'Uploading...');
          statusBadgeClass = 'badge-uploading';
        } else if (item.status === 'ocr') {
          statusText = getTranslation('batch.status_ocr', 'OCR Text...');
          statusBadgeClass = 'badge-ocr';
        } else if (item.status === 'indexing') {
          statusText = getTranslation('batch.status_indexing', 'Indexing...');
          statusBadgeClass = 'badge-indexing';
        } else if (item.status === 'success') {
          statusText = getTranslation('batch.status_success', 'Success');
          statusBadgeClass = 'badge-success';
        } else if (item.status === 'failed') {
          statusText = item.error ? item.error.substring(0, 35) : getTranslation('batch.status_failed', 'Failed');
          statusBadgeClass = 'badge-failed';
        }

        itemEl.innerHTML = `
          <div class="batch-file-info">
            <i class="fa-solid ${iconClass} file-icon"></i>
            <div class="batch-file-text">
              <div class="batch-file-name" title="${item.name}">${item.name}</div>
              <div class="batch-file-size">${formatBytes(item.size)}</div>
            </div>
          </div>
          <div class="batch-file-actions">
            <span class="batch-status-badge ${statusBadgeClass}">${statusText}</span>
            ${
              !this.isProcessing && item.status !== 'success'
                ? `<button type="button" class="btn-remove-item" data-id="${item.id}" title="Remove file"><i class="fa-solid fa-xmark"></i></button>`
                : ''
            }
          </div>
        `;

        const removeBtn = itemEl.querySelector('.btn-remove-item');
        if (removeBtn) {
          removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeFile(item.id);
          });
        }

        this.filesList.appendChild(itemEl);
      }
    }

    async startBatchUpload() {
      if (this.isProcessing || this.queue.length === 0) return;

      const pendingItems = this.queue.filter((q) => q.status === 'pending' || q.status === 'failed');
      if (pendingItems.length === 0) {
        alert(getTranslation('batch.all_uploaded', 'All files are already successfully uploaded.'));
        return;
      }

      // Reset any failed items to pending
      for (const item of pendingItems) {
        item.status = 'pending';
        item.error = null;
      }

      this.isProcessing = true;
      if (this.uploadAllBtn) this.uploadAllBtn.disabled = true;
      if (this.clearBtn) this.clearBtn.disabled = true;
      if (this.progressWrapper) this.progressWrapper.style.display = 'block';

      this.render();

      try {
        await this.runWorkerPool(pendingItems);
      } finally {
        this.isProcessing = false;
        if (this.uploadAllBtn) this.uploadAllBtn.disabled = false;
        if (this.clearBtn) this.clearBtn.disabled = false;
        this.render();

        const successCount = this.queue.filter((q) => q.status === 'success').length;
        const failedCount = this.queue.filter((q) => q.status === 'failed').length;

        if (typeof this.onComplete === 'function') {
          this.onComplete({ successCount, failedCount, totalCount: this.queue.length });
        }

        if (failedCount === 0) {
          const successMsg = getTranslation('batch.complete_success', `All ${successCount} files uploaded and processed successfully!`).replace('{{count}}', successCount);
          alert(successMsg);
        } else {
          const partialMsg = getTranslation('batch.complete_partial', `Upload completed: ${successCount} succeeded, ${failedCount} failed.`)
            .replace('{{succeeded}}', successCount)
            .replace('{{failed}}', failedCount);
          alert(partialMsg);
        }
      }
    }

    async retryFailed() {
      if (this.isProcessing) return;
      const failedItems = this.queue.filter((q) => q.status === 'failed');
      if (failedItems.length === 0) return;

      for (const item of failedItems) {
        item.status = 'pending';
        item.error = null;
      }

      await this.startBatchUpload();
    }

    /**
     * Managed worker pool executing uploads with fixed concurrency.
     * @param {Array<Object>} itemsToProcess
     */
    async runWorkerPool(itemsToProcess) {
      let index = 0;
      const total = itemsToProcess.length;

      const worker = async () => {
        while (index < total) {
          const currentIndex = index++;
          const item = itemsToProcess[currentIndex];
          await this.uploadItem(item);
        }
      };

      const workerCount = Math.min(this.concurrency, total);
      const workers = [];
      for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
      }

      await Promise.all(workers);
    }

    /**
     * Uploads single item safely using fetch and robust response parsing.
     * Prevents 'Unexpected end of JSON input' by checking status and parsing text.
     * @param {Object} item
     */
    async uploadItem(item) {
      item.status = 'uploading';
      this.updateItemRow(item);

      const metadata = typeof this.getMetadata === 'function' ? this.getMetadata() : {};
      const activeSupervisor = metadata.uploadedBy || 'supervisor_default@masruq.com';
      const category = metadata.category || 'General';
      const language = metadata.language || 'Arabic';

      const formData = new FormData();
      formData.append('bookFile', item.file);
      formData.append('uploadedBy', activeSupervisor);
      formData.append('category', category);
      formData.append('language', language);
      formData.append('title', item.name.replace(/\.[^/.]+$/, ''));

      // If it's an image, transition status to OCR
      if (['.jpg', '.jpeg', '.png', '.webp'].includes(item.ext)) {
        setTimeout(() => {
          if (item.status === 'uploading') {
            item.status = 'ocr';
            this.updateItemRow(item);
          }
        }, 800);
      }

      try {
        const res = await fetch('/api/ingestion/upload-book', {
          method: 'POST',
          headers: { 'X-Supervisor-ID': activeSupervisor },
          body: formData,
        });

        const rawText = await res.text();
        let jsonResponse = null;

        try {
          jsonResponse = rawText && rawText.trim().length > 0 ? JSON.parse(rawText) : null;
        } catch (parseErr) {
          jsonResponse = null;
        }

        if (res.ok && jsonResponse && jsonResponse.success) {
          item.status = 'success';
          item.data = jsonResponse.data;
          item.error = null;
        } else {
          item.status = 'failed';
          item.error = (jsonResponse && jsonResponse.error)
            ? jsonResponse.error
            : (rawText && rawText.length < 120 ? rawText : `Server error (HTTP ${res.status})`);
        }
      } catch (networkErr) {
        item.status = 'failed';
        item.error = networkErr.message || 'Network request failed';
      }

      this.updateItemRow(item);
      this.updateStats();
    }

    updateItemRow(item) {
      const itemEl = document.getElementById(`item_${item.id}`);
      if (!itemEl) return;

      itemEl.className = `batch-file-item status-${item.status}`;
      const badge = itemEl.querySelector('.batch-status-badge');
      if (badge) {
        let statusText = getTranslation('batch.status_pending', 'Pending');
        let statusBadgeClass = 'badge-pending';

        if (item.status === 'uploading') {
          statusText = getTranslation('batch.status_uploading', 'Uploading...');
          statusBadgeClass = 'badge-uploading';
        } else if (item.status === 'ocr') {
          statusText = getTranslation('batch.status_ocr', 'OCR Text...');
          statusBadgeClass = 'badge-ocr';
        } else if (item.status === 'indexing') {
          statusText = getTranslation('batch.status_indexing', 'Indexing...');
          statusBadgeClass = 'badge-indexing';
        } else if (item.status === 'success') {
          statusText = getTranslation('batch.status_success', 'Success');
          statusBadgeClass = 'badge-success';
        } else if (item.status === 'failed') {
          statusText = item.error ? item.error.substring(0, 35) : getTranslation('batch.status_failed', 'Failed');
          statusBadgeClass = 'badge-failed';
        }

        badge.className = `batch-status-badge ${statusBadgeClass}`;
        badge.textContent = statusText;
      }
    }
  }

  window.BatchQueueManager = BatchQueueManager;
})(window);
