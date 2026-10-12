// ==============================================================================
// Shared dashboard widgets: statistics, documents table, activity log.
// Each widget owns its loading / empty / error / retry states and never renders a failed
// request as zero. All text comes from i18n keys.
// ==============================================================================
(function (window) {
  'use strict';

  const { h, t, icon, clear, toast, toastError, fmtDateTime, fmtNumber, fmtBytes, createPanel, chip, pager, debounce, statCard, field, modal, confirmDialog, emptyBox, downloadBlob, describeError } = window.ui;
  const api = window.api;

  // ------------------------------------------------------------------ statistics
  function section(titleKey, cards) {
    return h('section', { class: 'stats-section' }, h('h3', {}, t(titleKey)), h('div', { class: 'stats-grid' }, cards));
  }

  function renderStats(data) {
    const c = data.current;
    const l = data.lifetime;
    const n = fmtNumber;
    return h('div', {},
      h('div', { class: 'stats-meta' }, t('stats.generated_at', { time: fmtDateTime(data.generatedAt) })),
      section('stats.sec_stored', [
        statCard({ iconName: 'database', label: t('stats.files_stored'), value: n(c.filesStored.total), hint: t('stats.files_breakdown', { images: n(c.filesStored.images), docs: n(c.filesStored.documents), text: n(c.filesStored.rawText), media: n(c.filesStored.media), urls: n(c.filesStored.urls) }) }),
        statCard({ iconName: 'image', label: t('stats.images_stored'), value: n(c.filesStored.images), hint: t('stats.images_note', { indexed: n(c.indexed.images) }) }),
        statCard({ iconName: 'book', label: t('stats.books_indexed'), value: n(c.indexed.documents), hint: t('stats.books_note', { text: n(c.indexed.rawText), other: n(c.indexed.mediaAndUrls) }) }),
        statCard({ iconName: 'hard-drive', label: t('stats.storage_size'), value: fmtBytes(c.filesStored.bytes) }),
      ]),
      section('stats.sec_pipeline', [
        statCard({ iconName: 'hourglass-start', label: t('status.queued'), value: n(c.pipeline.queued), tone: 'tone-info' }),
        statCard({ iconName: 'gears', label: t('status.processing'), value: n(c.pipeline.processing), tone: 'tone-info' }),
        statCard({ iconName: 'circle-check', label: t('status.completed'), value: n(c.pipeline.completed), tone: 'tone-ok' }),
        statCard({ iconName: 'circle-xmark', label: t('status.failed'), value: n(c.pipeline.failed), tone: c.pipeline.failed ? 'tone-bad' : '' }),
        statCard({ iconName: 'file-lines', label: t('stats.pdf_pages'), value: `${n(c.pages.pdfProcessed)} / ${n(c.pages.pdfTotal)}`, hint: t('stats.pdf_pages_note', { failed: n(c.pages.pdfFailed) }) }),
        statCard({ iconName: 'puzzle-piece', label: t('stats.chunks'), value: n(c.chunks) }),
      ]),
      section('stats.sec_lifetime', [
        statCard({ label: t('stats.life_uploads'), value: n(l.uploadsStored), hint: t('stats.life_uploads_note') }),
        statCard({ label: t('stats.life_failed'), value: n(l.uploadsFailed), tone: l.uploadsFailed ? 'tone-bad' : '' }),
        statCard({ label: t('stats.life_duplicates'), value: n(l.duplicatesRejected) }),
        statCard({ label: t('stats.life_processed'), value: n(l.processingCompleted), hint: t('stats.life_processed_note') }),
        statCard({ label: t('stats.life_pages'), value: n(l.pagesProcessed) }),
        statCard({ label: t('stats.life_deleted'), value: n(l.documentsDeleted) }),
      ]));
  }

  /**
   * Stats widget with refresh button and auto-refresh (paused while the tab is hidden).
   * @param {HTMLElement} root
   * @param {() => Promise<{data:Object}>} fetcher
   * @param {Function} [extra] (data) => Node appended under the cards
   */
  function mountStats(root, fetcher, extra) {
    const head = h('div', { class: 'toolbar' },
      h('h2', {}, t('stats.title')),
      h('div', { class: 'toolbar-actions' },
        h('span', { class: 'auto-note' }, t('stats.auto_refresh', { s: 15 })),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => panel.reload() }, icon('rotate-right'), ' ', t('common.refresh'))));
    const holder = h('div', {});
    root.append(head, holder);
    const panel = createPanel(holder, async () => (await fetcher()).data, (data) => h('div', {}, renderStats(data), extra ? extra(data) : null));
    panel.reload();
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !root.hidden && root.offsetParent !== null) panel.reload({ silent: true }); }, 15000);
    return { reload: (o) => panel.reload(o), stop: () => clearInterval(timer) };
  }

  // ------------------------------------------------------------------ documents
  function pagesCell(d) {
    const p = d.pages;
    if (p.kind === 'pdf') {
      if (p.total === null || p.total === undefined) return t('docs.pages_pending');
      return h('span', {}, `${fmtNumber(p.processed)} / ${fmtNumber(p.total)}`, p.failed ? h('small', { class: 'bad-text' }, ` (${t('docs.pages_failed', { n: fmtNumber(p.failed) })})`) : null);
    }
    if (p.kind === 'image') return t('docs.pages_image');
    if (p.estimated) return h('span', {}, `~${fmtNumber(p.estimated)}`, h('small', {}, ` ${t('docs.pages_estimated')}`));
    return t('docs.pages_na');
  }

  function statusCell(d) {
    const s = d.statuses;
    const parts = [h('span', { class: 'mini' }, t('docs.stage_upload'), ': ', chip(s.upload, `docstatus.${s.upload}`))];
    if (s.ocr && s.ocr !== 'not_applicable') parts.push(h('span', { class: 'mini' }, t('docs.stage_ocr'), ': ', chip(s.ocr, `docstatus.${s.ocr}`)));
    parts.push(h('span', { class: 'mini' }, t('docs.stage_index'), ': ', chip(s.index, `docstatus.${s.index}`)));
    return h('div', { class: 'stage-cell' }, parts);
  }

  function ownerLabel(d) {
    if (!d.owner) return t('docs.owner_unknown');
    if (d.owner.unverified) return h('span', {}, d.owner.email, h('small', { class: 'bad-text' }, ` (${t('docs.owner_unverified')})`));
    return h('span', {}, d.owner.name, d.onBehalf && d.actor ? h('small', {}, ` (${t('docs.by_admin', { name: d.actor.name })})`) : null);
  }

  function detailRows(pairs) {
    return h('dl', { class: 'details' }, pairs.filter((p) => p[1] !== null && p[1] !== undefined && p[1] !== '').map(([k, v]) => [h('dt', {}, k), h('dd', { dir: 'auto' }, v)]));
  }

  /**
   * @param {HTMLElement} root
   * @param {Object} o
   * @param {boolean} o.admin
   * @param {() => Array} o.getCategories
   * @param {() => Array} [o.getSupervisors]
   * @param {Function} [o.onChanged]
   */
  function mountDocuments(root, o) {
    const state = { page: 1, pageSize: 25, q: '', categoryId: '', status: '', kind: '', ownerId: '' };
    const base = o.admin ? '/api/admin/documents' : '/api/documents';

    const search = h('input', { class: 'input', type: 'search', placeholder: t('docs.search_ph'), oninput: debounce(() => { state.q = search.value.trim(); state.page = 1; panel.reload({ silent: true }); }) });
    const mkSelect = (key, options, label) => {
      const sel = h('select', { class: 'input', 'aria-label': label, onchange: () => { state[key] = sel.value; state.page = 1; panel.reload({ silent: true }); } }, options);
      return sel;
    };
    const catSel = mkSelect('categoryId', [], t('up.category'));
    const fillCats = () => {
      const prev = catSel.value;
      clear(catSel);
      catSel.appendChild(h('option', { value: '' }, t('docs.all_categories')));
      o.getCategories().forEach((c) => catSel.appendChild(h('option', { value: c.id }, c.name)));
      catSel.value = prev;
    };
    fillCats();
    const statusSel = mkSelect('status', [h('option', { value: '' }, t('docs.all_statuses')), ...['queued', 'processing', 'completed', 'failed'].map((s) => h('option', { value: s }, t(`status.${s}`)))], t('docs.status'));
    const kindSel = mkSelect('kind', [h('option', { value: '' }, t('docs.all_kinds')), ...['document', 'image', 'raw_text', 'media', 'url'].map((k) => h('option', { value: k }, t(`kind.${k}`)))], t('docs.kind'));
    let ownerSel = null;
    const fillOwners = () => {
      if (!ownerSel) return;
      const prev = ownerSel.value;
      clear(ownerSel);
      ownerSel.appendChild(h('option', { value: '' }, t('docs.all_supervisors')));
      o.getSupervisors().forEach((s) => ownerSel.appendChild(h('option', { value: s.id }, s.name)));
      ownerSel.value = prev;
    };
    if (o.admin) {
      ownerSel = mkSelect('ownerId', [], t('docs.owner'));
      fillOwners();
    }

    const holder = h('div', {});
    const toolbar = h('div', { class: 'toolbar filters' }, h('h2', {}, t(o.admin ? 'docs.title_admin' : 'docs.title_mine')),
      h('div', { class: 'toolbar-actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => panel.reload() }, icon('rotate-right'), ' ', t('common.refresh'))));
    root.append(toolbar, h('div', { class: 'filter-row' }, search, catSel, statusSel, kindSel, ownerSel), holder);

    const panel = createPanel(holder, () => api.get(`${base}${api.qs({ ...state })}`).then((r) => r.data), (data) => {
      if (!data.items.length) return emptyBox(state.q || state.status || state.categoryId || state.kind || state.ownerId ? 'docs.empty_filtered' : 'docs.empty');
      const head = h('tr', {}, [t('docs.col_title'), o.admin ? t('docs.col_owner') : null, t('docs.col_category'), t('docs.col_type'), t('docs.col_size'), t('docs.col_status'), t('docs.col_pages'), t('docs.col_chunks'), t('docs.col_uploaded'), t('docs.col_actions')].filter(Boolean).map((x) => h('th', {}, x)));
      const rows = data.items.map((d) => h('tr', {},
        h('td', { class: 'cell-title' }, h('div', { class: 'title-main', dir: 'auto' }, d.title), h('small', { class: 'muted', dir: 'auto' }, d.originalFilename)),
        o.admin ? h('td', {}, ownerLabel(d)) : null,
        h('td', {}, d.category ? d.category.name : '-'),
        h('td', {}, t(`kind.${d.kind}`), h('small', { class: 'muted' }, ` .${d.fileType}`)),
        h('td', {}, fmtBytes(d.sizeBytes)),
        h('td', {}, statusCell(d), d.failureReason ? h('div', { class: 'fail-reason', dir: 'auto' }, d.failureReason) : null),
        h('td', {}, pagesCell(d)),
        h('td', {}, fmtNumber(d.chunkCount)),
        h('td', {}, fmtDateTime(d.uploadedAt) || h('span', { class: 'muted' }, t('docs.time_unknown'))),
        h('td', { class: 'actions' }, actions(d))));
      return h('div', {}, h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, head), h('tbody', {}, rows))), pager(data, (p) => { state.page = p; panel.reload({ silent: true }); }));
    });

    function btn(iconName, titleKey, onclick, cls = '') {
      return h('button', { type: 'button', class: `icon-btn ${cls}`, title: t(titleKey), 'aria-label': t(titleKey), onclick }, icon(iconName));
    }

    function actions(d) {
      const list = [btn('circle-info', 'docs.act_details', () => showDetails(d))];
      if (d.fileAvailable) list.push(btn('download', 'docs.act_download', () => download(d)));
      if (d.pipelineStatus === 'failed') list.push(btn('rotate-right', 'docs.act_retry', () => retry(d, false)));
      if (o.admin && d.pipelineStatus === 'completed') list.push(btn('arrows-rotate', 'docs.act_reindex', () => retry(d, true)));
      list.push(btn('pen', 'docs.act_edit', () => edit(d)));
      list.push(btn('trash-can', 'docs.act_delete', () => remove(d), 'danger'));
      return list;
    }

    async function download(d) {
      try {
        const res = await api.request('GET', d.fileUrl, { raw: true });
        downloadBlob(d.originalFilename && d.kind !== 'url' ? d.originalFilename : `${d.title}.txt`, await res.blob());
      } catch (err) { toastError(err); }
    }

    async function retry(d, force) {
      try {
        await (o.admin ? api.post(`/api/admin/documents/${d.id}/retry`, { force }) : api.post(`/api/documents/${d.id}/retry`, {}));
        toast(t('docs.retry_queued'), 'success');
        panel.reload({ silent: true });
        if (o.onChanged) o.onChanged();
      } catch (err) { toastError(err); }
    }

    async function remove(d) {
      if (!(await confirmDialog({ title: t('docs.delete_title'), message: t('docs.delete_msg', { title: d.title }), confirmLabel: t('docs.act_delete') }))) return;
      try {
        await api.del(`/api/documents/${d.id}`);
        toast(t('docs.deleted_ok'), 'success');
        panel.reload({ silent: true });
        if (o.onChanged) o.onChanged();
      } catch (err) { toastError(err); }
    }

    function edit(d) {
      const title = h('input', { class: 'input', value: d.title, required: true });
      const cat = h('select', { class: 'input' }, o.getCategories().map((c) => h('option', { value: c.id }, c.name)));
      if (d.category) cat.value = d.category.id;
      const langKey = { Arabic: 'arabic', English: 'english', Mixed: 'mixed' };
      const lang = h('select', { class: 'input' }, Object.keys(langKey).map((l) => h('option', { value: l }, t(`common.lang_${langKey[l]}`))));
      lang.value = d.language || 'Arabic';
      let owner = null;
      const fields = [field(t('docs.col_title'), title), field(t('up.category'), cat), field(t('up.language'), lang)];
      if (o.admin) {
        owner = h('select', { class: 'input' }, [h('option', { value: '' }, t('docs.keep_owner')), ...o.getSupervisors().map((s) => h('option', { value: s.id }, `${s.name} (${s.email})`))]);
        fields.push(field(t('docs.col_owner'), owner, t('docs.owner_hint')));
      }
      modal({
        title: t('docs.edit_title'), body: h('div', { class: 'form-col' }, fields),
        actions: [{ label: t('common.cancel') }, {
          label: t('common.save'), kind: 'primary',
          onClick: async () => {
            await api.patch(`/api/documents/${d.id}`, { title: title.value, categoryId: cat.value, language: lang.value, ownerId: owner && owner.value ? owner.value : undefined });
            toast(t('common.saved'), 'success');
            panel.reload({ silent: true });
            if (o.onChanged) o.onChanged();
          },
        }],
      });
    }

    function showDetails(d) {
      const body = detailRows([
        [t('docs.d_id'), d.id], [t('docs.d_batch'), d.batchId], [t('docs.col_title'), d.title], [t('docs.d_filename'), d.originalFilename],
        [t('docs.col_owner'), d.owner ? (d.owner.name || d.owner.email) : null], [t('docs.d_actor'), d.onBehalf && d.actor ? d.actor.name : null],
        [t('docs.d_attribution'), t(`attribution.${d.attribution}`)], [t('docs.d_source'), t(`source.${d.source}`)], [t('docs.col_category'), d.category ? d.category.name : null],
        [t('docs.col_size'), fmtBytes(d.sizeBytes)], [t('docs.col_uploaded'), fmtDateTime(d.uploadedAt)], [t('docs.d_started'), fmtDateTime(d.processingStartedAt)],
        [t('docs.d_completed'), fmtDateTime(d.completedAt)], [t('docs.stage_upload'), t(`docstatus.${d.statuses.upload}`)], [t('docs.stage_ocr'), t(`docstatus.${d.statuses.ocr}`)],
        [t('docs.stage_index'), t(`docstatus.${d.statuses.index}`)], [t('docs.col_pages'), d.pages.total !== null && d.pages.total !== undefined ? `${d.pages.processed}/${d.pages.total} (${t('docs.pages_failed', { n: d.pages.failed || 0 })})` : null],
        [t('docs.col_chunks'), d.chunkCount], [t('docs.d_attempts'), d.attempts], [t('docs.d_failure'), d.failureReason ? `${d.failureReason}${d.failureCode ? ` [${d.failureCode}]` : ''}` : null],
        [t('docs.d_url'), d.sourceUrl],
      ]);
      modal({ title: t('docs.details_title'), body, wide: true, actions: [{ label: t('common.close') }] });
    }

    return {
      reload: (opts) => panel.reload(opts), refreshFilters: () => { fillCats(); fillOwners(); },
    };
  }

  // ------------------------------------------------------------------ activity
  const ACTIONS = [
    'document.uploaded', 'document.upload_failed', 'document.processing_completed', 'document.processing_failed', 'document.retry_requested',
    'document.updated', 'document.category_reassigned', 'document.owner_reassigned', 'document.deleted', 'document.downloaded', 'document.reconciled',
    'batch.created', 'category.created', 'category.renamed', 'category.updated', 'category.deleted',
    'account.created', 'account.activated', 'account.disabled', 'account.enabled', 'account.updated', 'account.invitation_issued',
    'account.reset_link_issued', 'account.sessions_revoked', 'account.password_changed', 'account.password_reset',
    'auth.login', 'auth.logout', 'auth.login_failed', 'system.legacy_import', 'system.reconciliation_applied',
  ];

  // Interpret date-time inputs as Asia/Dubai wall-clock time (UTC+4), independent of the browser zone.
  const dubaiToIso = (v) => (v ? new Date(`${v}:00+04:00`).toISOString() : '');

  function mountActivity(root, o) {
    const state = { page: 1, pageSize: 25, q: '', supervisorId: '', categoryId: '', action: '', status: '', from: '', to: '' };
    const base = o.admin ? '/api/admin/activity' : '/api/me/activity';
    const query = () => ({ ...state, from: dubaiToIso(state.from), to: dubaiToIso(state.to) });
    const reload = () => { state.page = 1; panel.reload({ silent: true }); };

    const search = h('input', { class: 'input', type: 'search', placeholder: t('act.search_ph'), oninput: debounce(() => { state.q = search.value.trim(); reload(); }) });
    const sel = (key, opts, label) => h('select', { class: 'input', 'aria-label': label, onchange: (e) => { state[key] = e.target.value; reload(); } }, opts);
    const actionSel = sel('action', [h('option', { value: '' }, t('act.all_actions')), ...ACTIONS.map((a) => h('option', { value: a }, t(`act.${a}`)))], t('act.col_action'));
    const statusSel = sel('status', [h('option', { value: '' }, t('act.all_status')), ...['success', 'failed', 'completed', 'stored'].map((s) => h('option', { value: s }, t(`act.status_${s}`)))], t('act.col_status'));
    const catSel = sel('categoryId', [], t('up.category'));
    const supSel = o.admin ? sel('supervisorId', [], t('docs.owner')) : null;
    const fillSelects = () => {
      const pc = catSel.value;
      clear(catSel);
      catSel.appendChild(h('option', { value: '' }, t('docs.all_categories')));
      o.getCategories().forEach((c) => catSel.appendChild(h('option', { value: c.id }, c.name)));
      catSel.value = pc;
      if (supSel) {
        const ps = supSel.value;
        clear(supSel);
        supSel.appendChild(h('option', { value: '' }, t('docs.all_supervisors')));
        o.getSupervisors().forEach((s) => supSel.appendChild(h('option', { value: s.id }, s.name)));
        supSel.value = ps;
      }
    };
    fillSelects();
    const from = h('input', { class: 'input', type: 'datetime-local', 'aria-label': t('act.from'), onchange: (e) => { state.from = e.target.value; reload(); } });
    const to = h('input', { class: 'input', type: 'datetime-local', 'aria-label': t('act.to'), onchange: (e) => { state.to = e.target.value; reload(); } });
    const sizeSel = h('select', { class: 'input', onchange: (e) => { state.pageSize = Number(e.target.value); reload(); } }, [25, 50, 100, 200].map((n) => h('option', { value: n }, t('act.per_page', { n }))));

    const exportBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
      exportBtn.disabled = true;
      try {
        const res = await api.request('GET', `${base.replace(/activity$/, 'activity.csv')}${api.qs(query())}`, { raw: true });
        downloadBlob('activity-log.csv', await res.blob());
      } catch (err) { toastError(err); } finally { exportBtn.disabled = false; }
    } }, icon('file-csv'), ' ', t('act.export_csv'));

    const holder = h('div', {});
    root.append(
      h('div', { class: 'toolbar' }, h('h2', {}, t(o.admin ? 'act.title_admin' : 'act.title_mine')), h('div', { class: 'toolbar-actions' }, exportBtn, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => panel.reload() }, icon('rotate-right'), ' ', t('common.refresh')))),
      h('div', { class: 'filter-row' }, search, supSel, catSel, actionSel, statusSel),
      h('div', { class: 'filter-row' }, h('label', { class: 'inline-field' }, t('act.from'), from), h('label', { class: 'inline-field' }, t('act.to'), to), sizeSel, h('small', { class: 'muted' }, t('act.tz_note'))),
      holder);

    const panel = createPanel(holder, () => api.get(`${base}${api.qs(query())}`).then((r) => r.data), (data) => {
      if (!data.items.length) return emptyBox('act.empty');
      const head = h('tr', {}, [t('act.col_time'), t('act.col_action'), t('act.col_supervisor'), t('act.col_file'), t('act.col_category'), t('act.col_pages'), t('act.col_status'), t('act.col_result'), ''].map((x) => h('th', {}, x)));
      const rows = data.items.map((e) => h('tr', { class: e.outcome === 'failed' ? 'row-failed' : '' },
        h('td', { class: 'nowrap' }, fmtDateTime(e.at)),
        h('td', {}, t(`act.${e.action}`)),
        h('td', {}, e.supervisor && e.supervisor.name ? e.supervisor.name : '-', e.actor && e.supervisor && e.actor.id !== e.supervisor.id ? h('small', { class: 'muted' }, ` (${t('act.by_actor', { name: e.actor.name })})`) : null),
        h('td', { class: 'cell-title' }, h('div', { class: 'title-main', dir: 'auto' }, e.title || '-'), h('small', { class: 'muted', dir: 'auto' }, [e.filename && e.filename !== e.title ? e.filename : null, e.sizeBytes ? fmtBytes(e.sizeBytes) : null, e.fileType ? `.${e.fileType}` : null].filter(Boolean).join(' · '))),
        h('td', {}, e.category ? e.category.name : '-'),
        h('td', {}, e.pages.total !== null && e.pages.total !== undefined ? `${fmtNumber(e.pages.processed || 0)}/${fmtNumber(e.pages.total)}${e.pages.failed ? ` (${fmtNumber(e.pages.failed)}!)` : ''}` : '-'),
        h('td', {}, [e.statuses.upload ? h('div', { class: 'mini' }, `${t('docs.stage_upload')}: ${t(`docstatus.${e.statuses.upload}`)}`) : null, e.statuses.ocr && e.statuses.ocr !== 'not_applicable' ? h('div', { class: 'mini' }, `${t('docs.stage_ocr')}: ${t(`docstatus.${e.statuses.ocr}`)}`) : null, e.statuses.index ? h('div', { class: 'mini' }, `${t('docs.stage_index')}: ${t(`docstatus.${e.statuses.index}`)}`) : null]),
        h('td', {}, e.failureReason ? h('span', { class: 'bad-text', dir: 'auto' }, e.failureReason) : e.completedAt ? `${t('act.completed_at')}: ${fmtDateTime(e.completedAt)}` : chip(e.outcome === 'failed' ? 'failed' : 'completed', e.outcome === 'failed' ? 'status.failed' : 'act.ok')),
        h('td', { class: 'actions' }, h('button', { type: 'button', class: 'icon-btn', title: t('docs.act_details'), onclick: () => showEvent(e) }, icon('circle-info')))));
      return h('div', {}, h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, head), h('tbody', {}, rows))), pager(data, (p) => { state.page = p; panel.reload({ silent: true }); }));
    });

    async function download(url, name) {
      try { downloadBlob(name, await (await api.request('GET', url, { raw: true })).blob()); } catch (err) { toastError(err); }
    }

    function showEvent(e) {
      const extra = [];
      if (e.current && e.documentId) extra.push(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => download(e.current.fileUrl, e.filename || 'file') }, icon('download'), ' ', t('docs.act_download')));
      if (e.documentDeleted) extra.push(h('span', { class: 'chip chip-failed' }, t('act.document_deleted')));
      modal({
        title: t('act.details_title'), wide: true,
        body: h('div', {}, detailRows([
          [t('act.d_event'), e.id], [t('act.col_time'), fmtDateTime(e.at)], [t('act.col_action'), t(`act.${e.action}`)], [t('act.d_actor'), `${e.actor.name || '-'} (${e.actor.role || '-'})`],
          [t('act.col_supervisor'), e.supervisor ? `${e.supervisor.name || '-'}${e.supervisor.id ? ` [${e.supervisor.id}]` : ''}` : null], [t('docs.d_id'), e.documentId], [t('docs.d_batch'), e.batchId],
          [t('docs.col_title'), e.title], [t('docs.d_filename'), e.filename], [t('docs.col_size'), e.sizeBytes ? fmtBytes(e.sizeBytes) : null], [t('docs.col_category'), e.category ? e.category.name : null],
          [t('docs.stage_upload'), e.statuses.upload ? t(`docstatus.${e.statuses.upload}`) : null], [t('docs.stage_ocr'), e.statuses.ocr ? t(`docstatus.${e.statuses.ocr}`) : null], [t('docs.stage_index'), e.statuses.index ? t(`docstatus.${e.statuses.index}`) : null],
          [t('docs.d_completed'), fmtDateTime(e.completedAt)], [t('docs.d_failure'), e.failureReason], [t('act.d_detail'), e.detail ? JSON.stringify(e.detail) : null],
        ]), h('div', { class: 'modal-extra' }, extra)),
        actions: [{ label: t('common.close') }],
      });
    }

    return { reload: () => panel.reload({ silent: true }), refreshFilters: fillSelects };
  }

  window.Widgets = { mountStats, renderStats, mountDocuments, mountActivity };
})(window);
