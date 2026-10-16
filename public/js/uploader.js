// ==============================================================================
// Uploader component (supervisor + administrator dashboards).
//  - single/bulk files with a server-side batch (100-500 files), bounded concurrency
//  - per-file state: waiting / uploading / stored / processing / completed / upload failed /
//    indexing failed / duplicate; upload failures and indexing failures are kept distinct
//  - raw text, media, and URL ingestion
// All text comes from i18n keys (up.*).
// ==============================================================================
(function (window) {
  'use strict';

  const { h, t, icon, clear, toast, toastError, describeError, fmtBytes, fmtNumber, field } = window.ui;
  const api = window.api;

  const DOC_EXT = ['pdf', 'txt', 'md', 'jpg', 'jpeg', 'png', 'webp'];
  const MAX_FILE = 50 * 1024 * 1024;
  const MAX_MEDIA = 100 * 1024 * 1024;
  const CONCURRENCY = 3;
  const POLL_MS = 3000;

  const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

  class Uploader {
    /**
     * @param {HTMLElement} root
     * @param {Object} opts
     * @param {() => Array} opts.getCategories current category list ({id,name})
     * @param {() => Promise} opts.refreshCategories reloads categories from the server
     * @param {() => Array} [opts.getSupervisors] administrators only: assign uploads to a supervisor
     * @param {Function} [opts.onChanged] called after uploads/processing changed server state
     */
    constructor(root, opts) {
      this.root = root;
      this.opts = opts;
      this.rows = []; // { id, file, state, progress, docId, error, code }
      this.batch = null;
      this.running = false;
      this.pollTimer = null;
      this.seq = 0;
      this.activeTab = 'files';
      this.render();
    }

    // ------------------------------------------------------------------ shared controls
    categorySelect() {
      const sel = h('select', { class: 'input', required: true });
      this._fillCategories(sel);
      (this._catSelects = this._catSelects || []).push(sel);
      return sel;
    }

    _fillCategories(sel) {
      const prev = sel.value;
      clear(sel);
      const cats = this.opts.getCategories();
      cats.forEach((c) => {
        const label = c.nameKey ? t(c.nameKey) : c.name;
        sel.appendChild(h('option', { value: c.id }, label));
      });
      if (prev && cats.some((c) => c.id === prev)) sel.value = prev;
    }

    refreshCategorySelects() {
      (this._catSelects || []).forEach((s) => this._fillCategories(s));
    }

    languageSelect() {
      return h('select', { class: 'input' },
        h('option', { value: 'Arabic' }, t('common.lang_arabic')),
        h('option', { value: 'English' }, t('common.lang_english')),
        h('option', { value: 'Mixed' }, t('common.lang_mixed')));
    }

    supervisorSelect() {
      if (!this.opts.getSupervisors) return null;
      const sel = h('select', { class: 'input' });
      sel.appendChild(h('option', { value: '' }, t('up.supervisor_self')));
      this.opts.getSupervisors().forEach((s) => sel.appendChild(h('option', { value: s.id }, `${s.name} (${s.email})`)));
      (this._supSelects = this._supSelects || []).push(sel);
      return sel;
    }

    refreshSupervisorSelects() {
      (this._supSelects || []).forEach((sel) => {
        const prev = sel.value;
        clear(sel);
        sel.appendChild(h('option', { value: '' }, t('up.supervisor_self')));
        this.opts.getSupervisors().forEach((s) => sel.appendChild(h('option', { value: s.id }, `${s.name} (${s.email})`)));
        sel.value = prev;
      });
    }

    metaFields(ctx, { withTitle = false } = {}) {
      ctx.category = this.categorySelect();
      ctx.language = this.languageSelect();
      ctx.supervisor = this.supervisorSelect();
      const row = [];
      if (withTitle) {
        ctx.title = h('input', { class: 'input', placeholder: t('up.book_title_optional'), maxlength: '200' });
        row.push(field(t('up.book_title_optional'), ctx.title));
      }
      row.push(field(t('up.category'), ctx.category), field(t('up.language'), ctx.language));
      if (ctx.supervisor) row.push(field(t('up.supervisor_owner'), ctx.supervisor));
      return h('div', { class: 'form-row' }, row);
    }

    // ------------------------------------------------------------------ render
    render() {
      clear(this.root);
      const tabs = [
        ['book_images', 'up.bulk_images_title', 'images'],
        ['text', 'up.direct_text_title', 'paste'],
        ['files', 'up.tab_files', 'file-circle-plus'],
        ['media', 'up.tab_media', 'microphone-lines'],
        ['url', 'up.tab_url', 'globe'],
      ];
      this.panes = {};
      const tabBar = h('div', { class: 'tab-bar', role: 'tablist' });
      tabs.forEach(([id, key, ic]) => {
        const btn = h('button', { type: 'button', class: `tab-btn${id === this.activeTab ? ' active' : ''}`, role: 'tab', onclick: () => this.switchTab(id) }, icon(ic), ' ', h('span', {}, t(key)));
        btn.dataset.tab = id;
        tabBar.appendChild(btn);
      });
      this.root.appendChild(tabBar);
      this.panes.book_images = this.buildBookImagesPane();
      this.panes.text = this.buildTextPane();
      this.panes.files = this.buildFilesPane();
      this.panes.media = this.buildMediaPane();
      this.panes.url = this.buildUrlPane();
      Object.entries(this.panes).forEach(([id, el]) => {
        el.hidden = id !== this.activeTab;
        this.root.appendChild(el);
      });
      this.tabBar = tabBar;
    }

    switchTab(id) {
      this.activeTab = id;
      this.tabBar.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
      Object.entries(this.panes).forEach(([k, el]) => { el.hidden = k !== id; });
    }

    // ------------------------------------------------------------------ files pane
    buildFilesPane() {
      const ctx = {};
      const input = h('input', { type: 'file', multiple: true, hidden: true, accept: '.pdf,.txt,.md,.jpg,.jpeg,.png,.webp' });
      const drop = h('div', { class: 'dropzone', tabindex: '0', role: 'button', onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); } },
        icon('cloud-arrow-up'), h('div', { class: 'dropzone-title' }, t('up.drop_title')), h('div', { class: 'dropzone-hint' }, t('up.drop_hint')));
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => this.addFiles(e.dataTransfer.files));
      input.addEventListener('change', () => { this.addFiles(input.files); input.value = ''; });

      this.summaryEl = h('div', { class: 'batch-summary', hidden: true });
      this.barFill = h('div', { class: 'progress-fill' });
      this.progressEl = h('div', { class: 'progress', hidden: true }, this.barFill);
      this.listEl = h('div', { class: 'queue-list' });
      this.startBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => this.start(ctx) }, icon('cloud-arrow-up'), ' ', t('up.start'));
      this.retryUploadBtn = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => this.retryFailedUploads(ctx) }, icon('rotate-right'), ' ', t('up.retry_failed_uploads'));
      this.retryIndexBtn = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => this.retryFailedIndexing() }, icon('rotate-right'), ' ', t('up.retry_failed_index'));
      this.clearBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => this.clearQueue() }, icon('trash-can'), ' ', t('up.clear'));
      return h('div', { class: 'card' },
        h('p', { class: 'card-desc' }, t('up.files_desc')),
        this.metaFields(ctx), drop, input,
        h('div', { class: 'queue-actions' }, this.startBtn, this.retryUploadBtn, this.retryIndexBtn, this.clearBtn),
        this.summaryEl, this.progressEl, this.listEl);
    }

    addFiles(fileList) {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      if (this.running) return toast(t('up.busy'), 'warn');
      // a new selection starts a fresh batch
      if (this.batch && this.rows.every((r) => ['completed', 'duplicate', 'index_failed', 'upload_failed', 'not_sent'].includes(r.state))) {
        this.rows = [];
        this.batch = null;
      }
      files.forEach((file) => {
        const row = { id: ++this.seq, file, state: 'waiting', progress: 0, docId: null, error: null, code: null };
        const ext = extOf(file.name);
        if (!DOC_EXT.includes(ext)) { row.state = 'not_sent'; row.error = t('up.unsupported', { ext }); row.code = 'UNSUPPORTED_FILE_TYPE'; }
        else if (file.size === 0) { row.state = 'not_sent'; row.error = t('up.empty_file'); row.code = 'EMPTY_FILE'; }
        else if (file.size > MAX_FILE) { row.state = 'not_sent'; row.error = t('up.too_large', { mb: 50 }); row.code = 'FILE_TOO_LARGE'; }
        this.rows.push(row);
      });
      this.renderQueue(true);
    }

    clearQueue() {
      if (this.running) return toast(t('up.busy'), 'warn');
      clearInterval(this.pollTimer);
      this.rows = [];
      this.batch = null;
      this.renderQueue(true);
    }

    renderQueue(full) {
      if (full) {
        clear(this.listEl);
        this.rows.forEach((r) => { r.el = this.buildRow(r); this.listEl.appendChild(r.el); });
      } else {
        this.rows.forEach((r) => this.updateRow(r));
      }
      this.updateSummary();
    }

    buildRow(r) {
      const retry = h('button', { type: 'button', class: 'btn btn-sm', hidden: true, onclick: () => this.retryOne(r) }, icon('rotate-right'));
      const state = h('span', { class: 'chip' });
      const bar = h('div', { class: 'row-progress' }, h('div', { class: 'row-progress-fill' }));
      const msg = h('div', { class: 'row-msg', hidden: true });
      const el = h('div', { class: 'queue-row' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-name', dir: 'auto', title: r.file.name }, r.file.name), h('span', { class: 'row-size' }, fmtBytes(r.file.size))),
        state, retry, bar, msg);
      r.refs = { state, retry, bar, msg };
      this.updateRow(r, el);
      return el;
    }

    updateRow(r, elOverride) {
      const el = elOverride || r.el;
      if (!el) return;
      const { state, retry, bar, msg } = r.refs;
      state.className = `chip chip-${r.state}`;
      state.textContent = t(`up.st.${r.state}`);
      retry.hidden = !(r.state === 'upload_failed' || (r.state === 'index_failed' && r.docId));
      retry.title = t('common.retry');
      bar.hidden = r.state !== 'uploading';
      bar.firstChild.style.width = `${Math.round(r.progress * 100)}%`;
      const text = r.error ? `${r.error}${r.code ? ` [${r.code}]` : ''}` : '';
      msg.hidden = !text;
      msg.textContent = text;
    }

    counts() {
      const c = { total: this.rows.length, waiting: 0, uploading: 0, stored: 0, processing: 0, completed: 0, upload_failed: 0, index_failed: 0, duplicate: 0, not_sent: 0 };
      this.rows.forEach((r) => { c[r.state]++; });
      return c;
    }

    updateSummary() {
      const c = this.counts();
      this.summaryEl.hidden = c.total === 0;
      clear(this.summaryEl);
      const pill = (key, n, cls) => h('span', { class: `pill ${cls || ''}` }, `${t(key)}: `, h('strong', {}, fmtNumber(n)));
      this.summaryEl.append(
        pill('up.sum.total', c.total), pill('up.sum.stored', c.stored + c.processing + c.completed + c.index_failed, 'ok'),
        pill('up.sum.processing', c.stored + c.processing, 'info'), pill('up.sum.completed', c.completed, 'ok'),
        pill('up.sum.upload_failed', c.upload_failed, c.upload_failed ? 'bad' : ''), pill('up.sum.index_failed', c.index_failed, c.index_failed ? 'bad' : ''),
        pill('up.sum.duplicate', c.duplicate, 'warn'), pill('up.sum.not_sent', c.not_sent, c.not_sent ? 'warn' : ''));
      const done = c.total - c.waiting - c.uploading;
      this.progressEl.hidden = !(this.running || (c.total > 0 && done > 0 && c.waiting > 0));
      this.barFill.style.width = c.total ? `${Math.round((done / c.total) * 100)}%` : '0%';
      this.retryUploadBtn.hidden = c.upload_failed === 0 || this.running;
      this.retryIndexBtn.hidden = c.index_failed === 0 || !this.batch;
      this.startBtn.disabled = this.running || c.waiting === 0;
    }

    // ------------------------------------------------------------------ upload flow
    ownerParams(ctx) {
      return ctx.supervisor && ctx.supervisor.value ? { supervisorId: ctx.supervisor.value } : {};
    }

    async start(ctx) {
      if (this.running) return;
      this._ctx = ctx;
      const pending = this.rows.filter((r) => r.state === 'waiting');
      if (!pending.length) return toast(t('up.nothing_to_upload'), 'warn');
      if (!ctx.category.value) return toast(t('up.pick_category'), 'warn');
      this.running = true;
      this.updateSummary();
      try {
        if (!this.batch) {
          const res = await api.post('/api/ingestion/batches', { declaredCount: this.rows.length, ...this.ownerParams(ctx) });
          this.batch = res.data;
        }
      } catch (err) {
        this.running = false;
        this.updateSummary();
        return toastError(err);
      }
      const queue = pending.slice();
      const worker = async () => {
        while (queue.length) {
          const r = queue.shift();
          await this.uploadRow(r, ctx);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      this.running = false;
      this.updateSummary();
      if (this.opts.onChanged) this.opts.onChanged();
      this.startPolling();
    }

    async uploadRow(r, ctx) {
      r.state = 'uploading';
      r.progress = 0;
      r.error = null;
      r.code = null;
      this.updateRow(r);
      const fd = new FormData();
      fd.append('bookFile', r.file, r.file.name);
      fd.append('categoryId', ctx.category.value);
      fd.append('language', ctx.language.value);
      fd.append('batchId', this.batch.id);
      Object.entries(this.ownerParams(ctx)).forEach(([k, v]) => fd.append(k, v));
      let lastPaint = 0;
      try {
        const res = await api.upload('/api/ingestion/upload-book', fd, {
          onProgress: (p) => {
            r.progress = p;
            if (Date.now() - lastPaint > 150) { lastPaint = Date.now(); this.updateRow(r); }
          },
        });
        r.docId = res.data.id;
        r.state = 'stored';
      } catch (err) {
        if (err.code === 'DUPLICATE_FILE') {
          r.state = 'duplicate';
          r.docId = err.data && err.data.existingDocumentId;
        } else {
          r.state = 'upload_failed';
        }
        r.error = describeError(err);
        r.code = err.code;
      }
      this.updateRow(r);
      this.updateSummary();
    }

    retryFailedUploads(ctx) {
      this.rows.filter((r) => r.state === 'upload_failed').forEach((r) => { r.state = 'waiting'; });
      this.renderQueue(false);
      this.start(ctx);
    }

    async retryOne(r) {
      if (r.state === 'upload_failed') {
        r.state = 'waiting';
        this.updateRow(r);
        return this.start(this._ctx);
      }
      if (r.state === 'index_failed' && r.docId) {
        try {
          await api.post(`/api/documents/${r.docId}/retry`, {});
          r.state = 'processing';
          r.error = null;
          this.updateRow(r);
          this.updateSummary();
          this.startPolling();
        } catch (err) {
          toastError(err);
        }
      }
    }

    async retryFailedIndexing() {
      try {
        const res = await api.post(`/api/ingestion/batches/${this.batch.id}/retry-failed`, {});
        toast(t('up.retry_queued', { n: res.data.queued }), 'success');
        this.rows.filter((r) => r.state === 'index_failed').forEach((r) => { r.state = 'processing'; r.error = null; });
        this.renderQueue(false);
        this.startPolling();
      } catch (err) {
        toastError(err);
      }
    }

    startPolling() {
      clearInterval(this.pollTimer);
      const tick = async () => {
        if (!this.batch) return;
        try {
          const res = await api.get(`/api/ingestion/batches/${this.batch.id}`, { silentAuth: false });
          const byId = new Map(res.data.files.map((f) => [f.id, f]));
          let active = 0;
          this.rows.forEach((r) => {
            if (!r.docId || r.state === 'duplicate') return;
            const f = byId.get(r.docId);
            if (!f) return;
            const prev = r.state;
            if (f.pipelineStatus === 'completed') r.state = 'completed';
            else if (f.pipelineStatus === 'failed') { r.state = 'index_failed'; r.error = f.failureReason; r.code = f.failureCode; }
            else { r.state = f.pipelineStatus === 'processing' ? 'processing' : 'stored'; active++; }
            if (prev !== r.state) this.updateRow(r);
          });
          this.updateSummary();
          if (this.opts.onChanged) this.opts.onChanged();
          if (active === 0) clearInterval(this.pollTimer);
        } catch (_) {
          /* transient: the next tick retries; the session layer reports lost connections */
        }
      };
      this.pollTimer = setInterval(tick, POLL_MS);
      tick();
    }

    // ------------------------------------------------------------------ simple ingestion panes
    submitButton(label, ic) {
      return h('button', { type: 'submit', class: 'btn btn-primary' }, icon(ic), ' ', label);
    }

    async runSimple(btn, fn, onDone) {
      btn.disabled = true;
      try {
        const res = await fn();
        toast(t('up.stored_ok'), 'success');
        if (onDone) onDone(res);
        if (this.opts.onChanged) this.opts.onChanged();
      } catch (err) {
        toastError(err);
      } finally {
        btn.disabled = false;
      }
    }

    buildBookImagesPane() {
      const ctx = {};
      const title = h('input', { class: 'input', placeholder: t('up.book_title_optional'), maxlength: '200' });
      const input = h('input', { type: 'file', multiple: true, hidden: true, accept: '.jpg,.jpeg,.png,.webp' });
      const drop = h('div', { class: 'dropzone', tabindex: '0', role: 'button', onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); } },
        icon('images'), h('div', { class: 'dropzone-title' }, t('up.select_images')), h('div', { class: 'dropzone-hint' }, t('up.bulk_images_desc')));
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));

      let selectedFiles = [];
      const countPill = h('div', { class: 'batch-summary', hidden: true });
      const pagesList = h('div', { class: 'queue-list' });
      const progress = h('div', { class: 'row-progress', hidden: true }, h('div', { class: 'row-progress-fill' }));
      const btn = this.submitButton(t('up.submit_book_images'), 'cloud-arrow-up');
      btn.disabled = true;

      const updateList = () => {
        clear(pagesList);
        countPill.hidden = !selectedFiles.length;
        btn.disabled = !selectedFiles.length;
        if (!selectedFiles.length) return;
        clear(countPill);
        countPill.appendChild(h('span', { class: 'pill ok' }, t('up.images_selected', { n: fmtNumber(selectedFiles.length), pages: fmtNumber(selectedFiles.length) })));
        selectedFiles.forEach((file, idx) => {
          const pageRow = h('div', { class: 'queue-row' },
            h('div', { class: 'row-main' },
              h('span', { class: 'chip chip-info' }, `${idx + 1}`),
              h('span', { class: 'row-name', dir: 'auto' }, file.name),
              h('span', { class: 'row-size' }, fmtBytes(file.size))
            ),
            h('button', {
              type: 'button', class: 'icon-btn danger', title: t('docs.act_delete'), 'aria-label': t('docs.act_delete'),
              onclick: () => {
                selectedFiles.splice(idx, 1);
                updateList();
              },
            }, icon('trash-can'))
          );
          pagesList.appendChild(pageRow);
        });
      };

      const handleFiles = (fl) => {
        const incoming = Array.from(fl || []).filter((f) => {
          const ext = extOf(f.name);
          return ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
        });
        if (!incoming.length) return toast(t('up.unsupported', { ext: 'all' }), 'warn');
        selectedFiles = selectedFiles.concat(incoming);
        updateList();
      };

      drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
      input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });

      const form = h('form', {
        class: 'card',
        onsubmit: async (e) => {
          e.preventDefault();
          if (!selectedFiles.length) return toast(t('up.nothing_to_upload'), 'warn');
          if (!ctx.category.value) return toast(t('up.pick_category'), 'warn');
          const fd = new FormData();
          selectedFiles.forEach((f) => fd.append('imageFiles', f, f.name));
          if (title.value.trim()) fd.append('title', title.value.trim());
          fd.append('categoryId', ctx.category.value);
          fd.append('language', ctx.language.value);
          Object.entries(this.ownerParams(ctx)).forEach(([k, v]) => fd.append(k, v));
          progress.hidden = false;
          await this.runSimple(btn, () => api.upload('/api/ingestion/book-images', fd, {
            onProgress: (p) => { progress.firstChild.style.width = `${Math.round(p * 100)}%`; },
          }), () => {
            title.value = '';
            selectedFiles = [];
            updateList();
          }).finally(() => { progress.hidden = true; });
        },
      },
      h('p', { class: 'card-desc' }, t('up.bulk_images_desc')),
      field(t('up.book_title_optional'), title),
      this.metaFields(ctx),
      drop, input, countPill, pagesList, progress, btn);

      return form;
    }

    buildTextPane() {
      const ctx = {};
      const title = h('input', { class: 'input', placeholder: t('up.book_title_optional'), maxlength: '200' });
      const text = h('textarea', { class: 'input', rows: '9', required: true });
      const counter = h('small', { class: 'field-hint' }, t('up.chars', { n: 0 }));
      text.addEventListener('input', () => { counter.textContent = t('up.chars', { n: fmtNumber(text.value.length) }); });
      const btn = this.submitButton(t('up.submit_text'), 'wand-magic-sparkles');
      const form = h('form', {
        class: 'card',
        onsubmit: (e) => {
          e.preventDefault();
          this.runSimple(btn, () => api.post('/api/ingestion/raw-text', { title: title.value, textContent: text.value, categoryId: ctx.category.value, language: ctx.language.value, ...this.ownerParams(ctx) }), () => { title.value = ''; text.value = ''; counter.textContent = t('up.chars', { n: 0 }); });
        },
      }, h('p', { class: 'card-desc' }, t('up.direct_text_desc')), field(t('up.book_title_optional'), title), this.metaFields(ctx), field(t('up.content'), text, null), counter, btn);
      return form;
    }

    buildMediaPane() {
      const ctx = {};
      const title = h('input', { class: 'input', required: true, maxlength: '200' });
      const file = h('input', { type: 'file', class: 'input', accept: '.mp4,.mp3,.wav,.m4a,.ogg,.webm,.mov,.avi', required: true });
      const progress = h('div', { class: 'row-progress', hidden: true }, h('div', { class: 'row-progress-fill' }));
      const btn = this.submitButton(t('up.submit_media'), 'closed-captioning');
      return h('form', {
        class: 'card',
        onsubmit: (e) => {
          e.preventDefault();
          const f = file.files[0];
          if (!f) return;
          if (f.size > MAX_MEDIA) return toast(t('up.too_large', { mb: 100 }), 'error');
          const fd = new FormData();
          fd.append('mediaFile', f, f.name);
          fd.append('title', title.value);
          fd.append('categoryId', ctx.category.value);
          fd.append('language', ctx.language.value);
          Object.entries(this.ownerParams(ctx)).forEach(([k, v]) => fd.append(k, v));
          progress.hidden = false;
          this.runSimple(btn, () => api.upload('/api/ingestion/media', fd, { onProgress: (p) => { progress.firstChild.style.width = `${Math.round(p * 100)}%`; } }), () => { file.value = ''; title.value = ''; progress.hidden = true; })
            .finally(() => { progress.hidden = true; });
        },
      }, h('p', { class: 'card-desc' }, t('up.media_desc')), field(t('up.title'), title), this.metaFields(ctx), field(t('up.media_file'), file, t('up.media_hint')), progress, btn);
    }

    buildUrlPane() {
      const ctx = {};
      const url = h('input', { type: 'url', class: 'input', required: true, dir: 'ltr', placeholder: 'https://' });
      const title = h('input', { class: 'input' });
      const btn = this.submitButton(t('up.submit_url'), 'globe');
      return h('form', {
        class: 'card',
        onsubmit: (e) => {
          e.preventDefault();
          this.runSimple(btn, () => api.post('/api/ingestion/scrape-url', { url: url.value, title: title.value, categoryId: ctx.category.value, language: ctx.language.value, ...this.ownerParams(ctx) }), () => { url.value = ''; title.value = ''; });
        },
      }, h('p', { class: 'card-desc' }, t('up.url_desc')), field(t('up.url'), url), field(t('up.title_optional'), title), this.metaFields(ctx), btn);
    }
  }

  window.Uploader = Uploader;
})(window);
