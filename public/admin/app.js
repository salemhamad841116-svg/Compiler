// ==============================================================================
// Administrator dashboard. Every section has loading / empty / error / retry states.
// All user-facing text comes from i18n keys (Arabic dictionary served at runtime).
// ==============================================================================
(function () {
  'use strict';

  const { h, t, icon, clear, toast, toastError, field, fmtDateTime, fmtNumber, fmtBytes, fmtRelative, createPanel, chip, emptyBox, errorBox, modal, confirmDialog, describeError } = window.ui;
  const api = window.api;

  const authRoot = document.getElementById('authRoot');
  const appRoot = document.getElementById('appRoot');

  const state = { categories: [], supervisors: [], catError: null, supError: null, shell: null, uploader: null, docs: null, activity: null, stats: null, supPanel: null, catPanel: null, presencePanel: null, timers: [], listeners: [] };

  // ------------------------------------------------------------------ shared lists
  function notifyCategoryConsumers() {
    if (state.uploader) state.uploader.refreshCategorySelects();
    if (state.docs) state.docs.refreshFilters();
    if (state.activity) state.activity.refreshFilters();
    if (state.searchCats) state.searchCats();
  }

  async function loadCategories() {
    try {
      state.categories = (await api.get('/api/categories')).data || [];
      state.catError = null;
      notifyCategoryConsumers();
    } catch (err) {
      state.catError = err;
    }
    return state.categories;
  }

  function notifySupervisorConsumers() {
    if (state.uploader) state.uploader.refreshSupervisorSelects();
    if (state.docs) state.docs.refreshFilters();
    if (state.activity) state.activity.refreshFilters();
  }

  async function loadSupervisors() {
    try {
      const r = await api.get('/api/admin/supervisors');
      state.supervisors = r.data || [];
      state.unattributed = r.unattributedDocuments || 0;
      state.supError = null;
      notifySupervisorConsumers();
    } catch (err) {
      state.supError = err;
    }
    return state.supervisors;
  }

  function supervisorLink(token) {
    const { protocol, hostname, port } = window.location;
    const m = hostname.match(/^(logs|admin)\.(.+)$/);
    if (m) return `${protocol}//waraqa.${m[2]}${port ? `:${port}` : ''}/?invite=${token}`;
    return `${window.location.origin}/supervisor/?invite=${token}`;
  }

  // ------------------------------------------------------------------ overview
  function supervisorStatsTable(data) {
    if (!data.items.length) return emptyBox('adm.no_supervisors');
    const n = fmtNumber;
    const head = h('tr', {}, ['adm.col_supervisor', 'adm.col_files', 'adm.col_images', 'adm.col_indexed', 'adm.col_failed', 'adm.col_pipeline', 'adm.col_pages', 'adm.col_life_uploads', 'adm.col_last_upload'].map((k) => h('th', {}, t(k))));
    const rows = data.items.map((i) => {
      const c = i.current;
      return h('tr', {},
        h('td', {}, h('div', { class: 'title-main' }, i.supervisor.name), h('small', { class: 'muted', dir: 'ltr' }, i.supervisor.email)),
        h('td', {}, n(c.filesStored.total)), h('td', {}, n(c.filesStored.images)),
        h('td', {}, n(c.indexed.documents + c.indexed.images + c.indexed.rawText + c.indexed.mediaAndUrls)),
        h('td', { class: c.pipeline.failed ? 'bad-text' : '' }, n(c.pipeline.failed)),
        h('td', {}, t('adm.pipeline_cell', { queued: n(c.pipeline.queued), processing: n(c.pipeline.processing) })),
        h('td', {}, `${n(c.pages.pdfProcessed)} / ${n(c.pages.pdfTotal)}`),
        h('td', {}, n(i.lifetime.uploadsStored)),
        h('td', {}, i.lastUploadAt ? fmtDateTime(i.lastUploadAt) : t('adm.never')));
    });
    return h('div', {},
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, head), h('tbody', {}, rows))),
      data.unattributedDocuments ? h('p', { class: 'muted' }, t('adm.unattributed', { n: n(data.unattributedDocuments) })) : null);
  }

  function buildOverview(root) {
    state.stats = window.Widgets.mountStats(root, () => api.get('/api/admin/overview'), (data) =>
      h('div', { class: 'stats-meta' }, t('adm.queue_line', { queued: fmtNumber(data.queue.queued), running: fmtNumber(data.queue.running), supervisors: fmtNumber(data.users.supervisors) })));
    const card = h('div', { class: 'card' }, h('h2', {}, t('adm.per_supervisor')));
    const holder = h('div', {});
    card.appendChild(holder);
    root.appendChild(card);
    const panel = createPanel(holder, () => api.get('/api/admin/stats/supervisors').then((r) => r.data), supervisorStatsTable);
    panel.reload();
    state.timers.push(setInterval(() => { if (document.visibilityState === 'visible' && root.offsetParent !== null) panel.reload({ silent: true }); }, 15000));
    state.perSupervisor = panel;
  }

  // ------------------------------------------------------------------ supervisors
  function showInvitation(inv, user) {
    const link = supervisorLink(inv.token);
    const box = h('div', { class: 'link-box', dir: 'ltr' }, link);
    const copy = h('button', { type: 'button', class: 'btn', onclick: async () => {
      try {
        await navigator.clipboard.writeText(link);
      } catch (_) {
        const range = document.createRange();
        range.selectNodeContents(box);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
      }
      toast(t('adm.link_copied'), 'success', 2000);
    } }, icon('copy'), ' ', t('adm.copy'));
    modal({
      title: t(inv.purpose === 'reset' ? 'adm.reset_link_title' : 'adm.invite_link_title'),
      body: h('div', {},
        h('p', {}, t(inv.purpose === 'reset' ? 'adm.reset_link_intro' : 'adm.invite_link_intro', { name: user.name })),
        h('div', { class: 'copy-row' }, box, copy),
        h('p', { class: 'muted' }, t('adm.link_expires', { time: fmtDateTime(inv.expiresAt) })),
        h('div', { class: 'notice notice-warn' }, t('adm.link_once'))),
      actions: [{ label: t('common.close'), kind: 'primary' }],
    });
  }

  function addSupervisor() {
    const name = h('input', { class: 'input', required: true, maxlength: 120 });
    const email = h('input', { class: 'input', type: 'email', required: true, dir: 'ltr' });
    modal({
      title: t('adm.add_supervisor'),
      body: h('div', { class: 'form-col' }, field(t('acct.name'), name), field(t('auth.email'), email), h('p', { class: 'muted' }, t('adm.add_supervisor_hint'))),
      actions: [{ label: t('common.cancel') }, {
        label: t('adm.create_and_invite'), kind: 'primary',
        onClick: async () => {
          if (!name.value.trim() || !email.value.trim()) throw new api.ApiError('', { code: 'FIELDS_REQUIRED' });
          const r = await api.post('/api/admin/supervisors', { name: name.value.trim(), email: email.value.trim() });
          toast(t('adm.supervisor_created'), 'success');
          await loadSupervisors();
          if (state.supPanel) state.supPanel.reload({ silent: true });
          showInvitation(r.invitation, r.data);
        },
      }],
    });
  }

  function editSupervisor(s) {
    const name = h('input', { class: 'input', value: s.name, required: true });
    modal({
      title: t('adm.edit_supervisor'),
      body: h('div', { class: 'form-col' }, field(t('acct.name'), name), h('div', { dir: 'ltr', class: 'muted' }, s.email)),
      actions: [{ label: t('common.cancel') }, {
        label: t('common.save'), kind: 'primary',
        onClick: async () => {
          await api.patch(`/api/admin/supervisors/${s.id}`, { name: name.value });
          toast(t('common.saved'), 'success');
          await loadSupervisors();
          state.supPanel.reload({ silent: true });
        },
      }],
    });
  }

  async function toggleSupervisor(s) {
    const disabling = s.status === 'active';
    if (disabling && !(await confirmDialog({ title: t('adm.disable_title'), message: t('adm.disable_msg', { name: s.name }), confirmLabel: t('adm.disable') }))) return;
    try {
      await api.patch(`/api/admin/supervisors/${s.id}`, { status: disabling ? 'disabled' : 'active' });
      toast(t(disabling ? 'adm.disabled_ok' : 'adm.enabled_ok'), 'success');
      await loadSupervisors();
      state.supPanel.reload({ silent: true });
      if (state.presencePanel) state.presencePanel.reload({ silent: true });
    } catch (err) { toastError(err); }
  }

  async function issueLink(s) {
    if (s.status === 'active' && !(await confirmDialog({ title: t('adm.reset_title'), message: t('adm.reset_msg', { name: s.name }), confirmLabel: t('adm.reset_confirm'), kind: 'primary' }))) return;
    try {
      const r = await api.post(`/api/admin/supervisors/${s.id}/invitation`, {});
      showInvitation(r.invitation, s);
    } catch (err) { toastError(err); }
  }

  async function revokeSessions(s) {
    if (!(await confirmDialog({ title: t('adm.revoke_title'), message: t('adm.revoke_msg', { name: s.name }), confirmLabel: t('adm.revoke') }))) return;
    try {
      const r = await api.post(`/api/admin/supervisors/${s.id}/revoke-sessions`, {});
      toast(t('adm.revoked_ok', { n: fmtNumber(r.data.revoked) }), 'success');
      state.supPanel.reload({ silent: true });
      if (state.presencePanel) state.presencePanel.reload({ silent: true });
    } catch (err) { toastError(err); }
  }

  function buildSupervisors(root) {
    const toolbar = h('div', { class: 'toolbar' }, h('h2', {}, t('adm.supervisors_title')),
      h('div', { class: 'toolbar-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: addSupervisor }, icon('user-plus'), ' ', t('adm.add_supervisor')),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => state.supPanel.reload() }, icon('rotate-right'), ' ', t('common.refresh'))));
    const holder = h('div', {});
    root.append(toolbar, holder);
    state.supPanel = createPanel(holder, async () => {
      const list = await api.get('/api/admin/supervisors');
      state.supervisors = list.data || [];
      state.supError = null;
      notifySupervisorConsumers();
      return list;
    }, (list) => {
      if (!list.data.length) return emptyBox('adm.no_supervisors');
      const head = h('tr', {}, ['adm.col_supervisor', 'adm.col_account', 'adm.col_presence', 'adm.col_files', 'adm.col_failed', 'adm.col_last_login', 'docs.col_actions'].map((k) => h('th', {}, t(k))));
      const btn = (ic, key, fn, cls = '') => h('button', { type: 'button', class: `icon-btn ${cls}`, title: t(key), 'aria-label': t(key), onclick: fn }, icon(ic));
      const rows = list.data.map((s) => {
        const p = s.presence;
        const st = s.stats;
        return h('tr', {},
          h('td', {}, h('div', { class: 'title-main' }, s.name), h('small', { class: 'muted', dir: 'ltr' }, s.email)),
          h('td', {}, chip(s.status, `accstatus.${s.status}`)),
          h('td', {}, p ? h('span', {}, h('span', { class: `presence-dot presence-${p.presence}` }), chip(p.presence, `presence.${p.presence}`)) : '-'),
          h('td', {}, st ? fmtNumber(st.current.filesStored.total) : '-'),
          h('td', { class: st && st.current.pipeline.failed ? 'bad-text' : '' }, st ? fmtNumber(st.current.pipeline.failed) : '-'),
          h('td', {}, s.lastLoginAt ? fmtDateTime(s.lastLoginAt) : t('adm.never')),
          h('td', { class: 'actions' },
            btn('pen', 'adm.act_edit', () => editSupervisor(s)),
            s.status !== 'disabled' ? btn('link', s.status === 'invited' ? 'adm.act_invite' : 'adm.act_reset', () => issueLink(s)) : null,
            s.status !== 'invited' ? btn(s.status === 'active' ? 'user-slash' : 'user-check', s.status === 'active' ? 'adm.disable' : 'adm.enable', () => toggleSupervisor(s), s.status === 'active' ? 'danger' : '') : null,
            btn('plug-circle-xmark', 'adm.revoke', () => revokeSessions(s)),
            btn('clock-rotate-left', 'adm.act_history', () => showHistory(s))));
      });
      return h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, head), h('tbody', {}, rows)));
    });
    state.supPanel.reload();
  }

  // ------------------------------------------------------------------ presence
  function departureText(p) {
    if (p.presence !== 'offline') return '-';
    const d = p.offlineDetail || {};
    switch (p.offlineReason) {
      case 'never_logged_in': return t('presence.reason_never');
      case 'logout': return t('presence.reason_logout', { time: fmtDateTime(d.endedAt) });
      case 'session_expired': return t('presence.reason_expired', { seen: fmtDateTime(d.lastSeenAt) });
      case 'session_revoked': return t('presence.reason_revoked', { time: fmtDateTime(d.endedAt) });
      case 'connection_lost': return t('presence.reason_lost', { seen: fmtDateTime(d.lastSeenAt) });
      default: return '-';
    }
  }

  function showHistory(s) {
    const body = h('div', {});
    const panel = createPanel(body, () => api.get(`/api/admin/presence/${s.id}/sessions`).then((r) => r.data), (d) => {
      const stateOf = (x) => {
        if (x.endedAt) return t(`sess.end_${x.endReason}`);
        return Date.now() - Date.parse(x.lastSeenAt) > 120000 ? t('sess.end_lost') : t('sess.active');
      };
      const sessions = d.sessions.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, ['sess.col_start', 'sess.col_last_seen', 'sess.col_end', 'sess.col_state', 'sess.col_client'].map((k) => h('th', {}, t(k))))),
          h('tbody', {}, d.sessions.map((x) => h('tr', {},
            h('td', { class: 'nowrap' }, fmtDateTime(x.startedAt)), h('td', { class: 'nowrap' }, fmtDateTime(x.lastSeenAt)),
            h('td', { class: 'nowrap' }, x.endedAt ? fmtDateTime(x.endedAt) : '-'), h('td', {}, stateOf(x)),
            h('td', { dir: 'ltr' }, `${x.client || 'web'} ${x.ip || ''}`))))))
        : emptyBox('sess.empty');
      const events = d.events.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, [h('th', {}, t('sess.col_time')), h('th', {}, t('sess.col_event'))])),
          h('tbody', {}, d.events.map((e) => h('tr', {}, h('td', { class: 'nowrap' }, fmtDateTime(e.at)), h('td', {}, t(`sevent.${e.event}`)))))))
        : emptyBox('sess.empty');
      return h('div', {}, h('h3', {}, t('sess.sessions')), sessions, h('h3', { style: { marginTop: '16px' } }, t('sess.events')), events);
    });
    modal({ title: t('sess.title', { name: s.name }), body, wide: true, actions: [{ label: t('common.close') }] });
    panel.reload();
  }

  function buildPresence(root) {
    const toolbar = h('div', { class: 'toolbar' }, h('h2', {}, t('presence.title')),
      h('div', { class: 'toolbar-actions' }, h('span', { class: 'auto-note' }, t('stats.auto_refresh', { s: 15 })),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => state.presencePanel.reload() }, icon('rotate-right'), ' ', t('common.refresh'))));
    const holder = h('div', {});
    root.append(toolbar, h('p', { class: 'muted' }, t('presence.note')), holder);
    state.presencePanel = createPanel(holder, () => api.get('/api/admin/presence'), (r) => {
      if (!r.data.length) return emptyBox('adm.no_supervisors');
      const head = h('tr', {}, ['adm.col_supervisor', 'adm.col_presence', 'presence.col_sessions', 'presence.col_session_start', 'presence.col_last_activity', 'presence.col_last_login', 'presence.col_last_logout', 'presence.col_departure', ''].map((k) => h('th', {}, t(k))));
      const rows = r.data.map((p) => h('tr', {},
        h('td', {}, h('div', { class: 'title-main' }, p.name), h('small', { class: 'muted', dir: 'ltr' }, p.email), p.accountStatus !== 'active' ? h('div', {}, chip(p.accountStatus, `accstatus.${p.accountStatus}`)) : null),
        h('td', {}, h('span', { class: `presence-dot presence-${p.presence}` }), chip(p.presence, `presence.${p.presence}`)),
        h('td', {}, fmtNumber(p.activeSessions)),
        h('td', { class: 'nowrap' }, p.currentSessionStartedAt ? fmtDateTime(p.currentSessionStartedAt) : '-'),
        h('td', {}, p.lastActivityAt ? h('span', {}, fmtDateTime(p.lastActivityAt), h('small', { class: 'muted' }, ` (${fmtRelative(p.lastActivityAt)})`)) : '-'),
        h('td', { class: 'nowrap' }, p.lastLoginAt ? fmtDateTime(p.lastLoginAt) : '-'),
        h('td', { class: 'nowrap' }, p.lastLogoutAt ? fmtDateTime(p.lastLogoutAt) : '-'),
        h('td', {}, departureText(p)),
        h('td', { class: 'actions' }, h('button', { type: 'button', class: 'icon-btn', title: t('adm.act_history'), 'aria-label': t('adm.act_history'), onclick: () => showHistory({ id: p.id, name: p.name }) }, icon('clock-rotate-left')))));
      return h('div', {},
        h('div', { class: 'stats-meta' }, t('stats.generated_at', { time: fmtDateTime(r.generatedAt) })),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, head), h('tbody', {}, rows))));
    });
    state.presencePanel.reload();
    state.timers.push(setInterval(() => { if (document.visibilityState === 'visible' && root.offsetParent !== null) state.presencePanel.reload({ silent: true }); }, 15000));
  }

  // ------------------------------------------------------------------ categories
  function categoryForm(existing) {
    const name = h('input', { class: 'input', value: existing ? existing.name : '', required: true, maxlength: 120 });
    const desc = h('textarea', { class: 'input', rows: 3 }, existing ? existing.description || '' : '');
    return { name, desc, body: h('div', { class: 'form-col' }, field(t('cat.name'), name), field(t('cat.description'), desc)) };
  }

  async function afterCategoryChange() {
    await loadCategories();
    state.catPanel.reload({ silent: true });
    if (state.docs) state.docs.reload({ silent: true });
  }

  function addCategory() {
    const f = categoryForm(null);
    modal({
      title: t('cat.add'), body: f.body,
      actions: [{ label: t('common.cancel') }, {
        label: t('common.save'), kind: 'primary',
        onClick: async () => {
          await api.post('/api/categories', { name: f.name.value, description: f.desc.value });
          toast(t('cat.created_ok'), 'success');
          await afterCategoryChange();
        },
      }],
    });
  }

  function editCategory(c) {
    const f = categoryForm(c);
    modal({
      title: t('cat.edit'), body: f.body,
      actions: [{ label: t('common.cancel') }, {
        label: t('common.save'), kind: 'primary',
        onClick: async () => {
          await api.put(`/api/categories/${c.id}`, { name: f.name.value, description: f.desc.value });
          toast(t('common.saved'), 'success');
          await afterCategoryChange();
        },
      }],
    });
  }

  async function deleteCategory(c) {
    if (c.documentCount === 0) {
      if (!(await confirmDialog({ title: t('cat.delete_title'), message: t('cat.delete_msg', { name: c.name }), confirmLabel: t('docs.act_delete') }))) return;
      try {
        await api.del(`/api/categories/${c.id}`);
        toast(t('cat.deleted_ok'), 'success');
        await afterCategoryChange();
      } catch (err) { toastError(err); }
      return;
    }
    const others = state.categories.filter((x) => x.id !== c.id);
    if (!others.length) {
      toast(t('cat.need_other'), 'warn');
      return;
    }
    const target = h('select', { class: 'input' }, others.map((o) => h('option', { value: o.id }, o.name)));
    modal({
      title: t('cat.delete_title'),
      body: h('div', { class: 'form-col' }, h('p', {}, t('cat.in_use_msg', { name: c.name, n: fmtNumber(c.documentCount) })), field(t('cat.reassign_to'), target)),
      actions: [{ label: t('common.cancel') }, {
        label: t('cat.delete_reassign'), kind: 'danger',
        onClick: async () => {
          const r = await api.del(`/api/categories/${c.id}${api.qs({ reassignTo: target.value })}`);
          toast(t('cat.deleted_reassigned', { n: fmtNumber(r.data.documentsReassigned) }), 'success');
          await afterCategoryChange();
        },
      }],
    });
  }

  function buildCategories(root) {
    root.append(h('div', { class: 'toolbar' }, h('h2', {}, t('cat.title')),
      h('div', { class: 'toolbar-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: addCategory }, icon('plus'), ' ', t('cat.add')),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => state.catPanel.reload() }, icon('rotate-right'), ' ', t('common.refresh')))),
    h('p', { class: 'muted' }, t('cat.shared_note')));
    const holder = h('div', {});
    root.appendChild(holder);
    state.catPanel = createPanel(holder, async () => {
      const r = await api.get('/api/categories');
      state.categories = r.data || [];
      state.catError = null;
      notifyCategoryConsumers();
      return r.data;
    }, (list) => {
      if (!list.length) return emptyBox('cat.empty');
      const head = h('tr', {}, ['cat.name', 'cat.description', 'cat.documents', 'cat.created', 'docs.col_actions'].map((k) => h('th', {}, t(k))));
      const rows = list.map((c) => h('tr', {},
        h('td', {}, h('div', { class: 'title-main', dir: 'auto' }, c.name)),
        h('td', { dir: 'auto' }, c.description || '-'),
        h('td', {}, fmtNumber(c.documentCount)),
        h('td', { class: 'nowrap' }, fmtDateTime(c.createdAt)),
        h('td', { class: 'actions' },
          h('button', { type: 'button', class: 'icon-btn', title: t('docs.act_edit'), 'aria-label': t('docs.act_edit'), onclick: () => editCategory(c) }, icon('pen')),
          h('button', { type: 'button', class: 'icon-btn danger', title: t('docs.act_delete'), 'aria-label': t('docs.act_delete'), onclick: () => deleteCategory(c) }, icon('trash-can')))));
      return h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, head), h('tbody', {}, rows)));
    });
    state.catPanel.reload();
  }

  // ------------------------------------------------------------------ system
  function kv(label, value) {
    return h('div', { class: 'stat-card' }, h('div', { class: 'stat-body' }, h('div', { class: 'stat-value', style: { fontSize: '1rem' } }, value), h('div', { class: 'stat-label' }, label)));
  }

  function aiChip(ai) {
    if (ai.status === 'ok') return chip('completed', 'sys.ai_ok');
    if (ai.status === 'error') return chip('failed', 'sys.ai_error');
    if (ai.status === 'not_configured') return chip('failed', 'sys.ai_not_configured');
    return chip('pending', 'sys.ai_unchecked');
  }

  function reconcileView(rep) {
    if (!rep) return h('p', { class: 'muted' }, t('sys.reconcile_never'));
    const f = rep.findings;
    const counts = Object.keys(f).map((k) => kv(t(`sys.f_${k}`), fmtNumber(f[k].length)));
    const actions = rep.applied ? h('div', { class: 'notice notice-ok' }, t('sys.reconcile_applied', { adopted: fmtNumber(rep.actions.adopted), audit: fmtNumber(rep.actions.auditBackfilled), requeued: fmtNumber(rep.actions.requeued) })) : h('div', { class: 'notice' }, t('sys.reconcile_dry'));
    const unrec = rep.unrecoverable.length
      ? h('div', {}, h('h4', {}, t('sys.unrecoverable', { n: fmtNumber(rep.unrecoverable.length) })),
        h('ul', { class: 'mini-list' }, rep.unrecoverable.slice(0, 50).map((u) => h('li', { dir: 'auto' }, `${t(`sys.u_${u.type}`)}: ${u.title || u.relPath || u.documentId || ''}`))))
      : null;
    return h('div', {}, h('div', { class: 'stats-meta' }, t('sys.reconcile_ran', { time: fmtDateTime(rep.ranAt) })),
      h('div', { class: 'kv-grid' }, kv(t('sys.vault_files'), `${fmtNumber(rep.vault.files)} (${fmtBytes(rep.vault.bytes)})`), kv(t('sys.db_documents'), fmtNumber(rep.database.documents)), counts), actions, unrec);
  }

  function buildSystem(root) {
    // health
    const healthHolder = h('div', {});
    let checking = false;
    const checkBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
      checking = true;
      checkBtn.disabled = true;
      await healthPanel.reload();
      checking = false;
      checkBtn.disabled = false;
    } }, icon('stethoscope'), ' ', t('sys.check_ai'));
    const healthPanel = createPanel(healthHolder, () => api.get(`/api/admin/system/health${checking ? '?check=1' : ''}`).then((r) => r.data), (d) => h('div', {},
      h('div', { class: 'kv-grid' },
        kv(t('sys.ai_status'), aiChip(d.ai)),
        kv(t('sys.ai_models'), h('span', { dir: 'ltr' }, `${d.ai.embeddingModel || '-'} / ${d.ai.generationModel || '-'}`)),
        kv(t('sys.storage'), chip(d.storage.writable ? 'completed' : 'failed', d.storage.writable ? 'sys.storage_ok' : 'sys.storage_bad')),
        kv(t('sys.cloud_mirror'), t(`sys.mirror_${d.storage.cloudMirror}`)),
        kv(t('sys.queue'), t('sys.queue_text', { queued: fmtNumber(d.queue.queued), running: fmtNumber(d.queue.running), failed: fmtNumber(d.queue.failed) }))),
      d.ai.error ? h('div', { class: 'notice notice-warn' }, `${t(`errors.${d.ai.error.code}`)} [${d.ai.error.code}]`) : null,
      d.storage.persistentVolumeHint ? h('p', { class: 'muted' }, t('sys.volume_hint')) : null));
    healthPanel.reload();

    // reconciliation
    const recHolder = h('div', {});
    const recPanel = createPanel(recHolder, () => api.get('/api/admin/system/reconcile').then((r) => r.data), reconcileView);
    recPanel.reload();
    const runRec = async (apply) => {
      if (apply && !(await confirmDialog({ title: t('sys.reconcile_apply'), message: t('sys.reconcile_apply_msg'), confirmLabel: t('sys.reconcile_apply'), kind: 'primary' }))) return;
      try {
        const r = await api.post('/api/admin/system/reconcile', { apply });
        clear(recHolder);
        recHolder.appendChild(reconcileView(r.data));
        if (apply) {
          toast(t('sys.reconcile_done'), 'success');
          if (state.stats) state.stats.reload({ silent: true });
          if (state.docs) state.docs.reload({ silent: true });
        }
      } catch (err) { toastError(err); }
    };

    // search test
    const q = h('input', { class: 'input', type: 'search', placeholder: t('sys.search_ph') });
    const cat = h('select', { class: 'input' });
    const fillCats = () => {
      const prev = cat.value;
      clear(cat);
      cat.appendChild(h('option', { value: '' }, t('docs.all_categories')));
      state.categories.forEach((c) => cat.appendChild(h('option', { value: c.id }, c.name)));
      cat.value = prev;
    };
    fillCats();
    state.searchCats = fillCats;
    const results = h('div', {});
    const go = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
      if (!q.value.trim()) return;
      go.disabled = true;
      clear(results);
      results.appendChild(window.ui.loadingBox());
      try {
        const r = await api.post('/api/admin/search-test', { query: q.value, category: cat.value || 'All', topK: 5, minSimilarity: 0.3 });
        clear(results);
        if (!r.data.length) results.appendChild(emptyBox('sys.search_empty'));
        r.data.forEach((m) => results.appendChild(h('div', { class: 'result-item' },
          h('div', { class: 'meta' }, h('strong', { dir: 'auto' }, m.bookTitle), h('span', { class: 'pill ok' }, t('sys.similarity', { n: Math.round(m.similarity * 100) })), m.page ? h('span', { class: 'pill' }, t('sys.page_n', { n: m.page })) : null, h('span', { class: 'pill' }, m.category)),
          h('p', { dir: 'auto' }, m.chunk))));
      } catch (err) {
        clear(results);
        results.appendChild(errorBox(err, () => go.click()));
      } finally { go.disabled = false; }
    } }, icon('magnifying-glass'), ' ', t('sys.search_run'));

    root.append(
      h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h2', {}, t('sys.health_title')), h('div', { class: 'toolbar-actions' }, checkBtn, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => healthPanel.reload() }, icon('rotate-right'), ' ', t('common.refresh')))), healthHolder),
      h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h2', {}, t('sys.reconcile_title')), h('div', { class: 'toolbar-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => runRec(false) }, icon('magnifying-glass-chart'), ' ', t('sys.reconcile_analyze')),
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => runRec(true) }, icon('screwdriver-wrench'), ' ', t('sys.reconcile_apply')))),
      h('p', { class: 'muted' }, t('sys.reconcile_hint')), recHolder),
      h('div', { class: 'card' }, h('h2', {}, t('sys.search_title')), h('p', { class: 'muted' }, t('sys.search_hint')), h('div', { class: 'filter-row' }, q, cat, go), results));
  }

  // ------------------------------------------------------------------ app
  function teardown() {
    state.timers.forEach(clearInterval);
    state.timers = [];
    if (state.stats && state.stats.stop) state.stats.stop();
    Object.assign(state, { categories: [], supervisors: [], shell: null, uploader: null, docs: null, activity: null, stats: null, supPanel: null, catPanel: null, presencePanel: null, searchCats: null, perSupervisor: null });
    clear(appRoot);
  }

  function startApp(user, policy) {
    teardown();
    document.title = t('adm.title');
    const sections = [
      { id: 'overview', labelKey: 'adm.nav_overview', icon: 'gauge-high' },
      { id: 'supervisors', labelKey: 'adm.nav_supervisors', icon: 'users-gear' },
      { id: 'presence', labelKey: 'adm.nav_presence', icon: 'signal' },
      { id: 'categories', labelKey: 'adm.nav_categories', icon: 'tags' },
      { id: 'documents', labelKey: 'adm.nav_documents', icon: 'folder-open' },
      { id: 'upload', labelKey: 'adm.nav_upload', icon: 'cloud-arrow-up' },
      { id: 'activity', labelKey: 'adm.nav_activity', icon: 'clock-rotate-left' },
      { id: 'system', labelKey: 'adm.nav_system', icon: 'server' },
      { id: 'account', labelKey: 'sup.nav_account', icon: 'user-gear' },
    ];
    const shell = window.Shell.create(appRoot, {
      titleKey: 'adm.title', subtitleKey: 'adm.subtitle', storageKey: 'adm_section', sections, user,
      onLogout: () => window.Session.logout(),
      onShow: (id, first) => {
        if (id === 'documents' || id === 'upload' || id === 'activity') { loadCategories(); loadSupervisors(); }
        if (!first) {
          if (id === 'overview' && state.stats) { state.stats.reload({ silent: true }); state.perSupervisor.reload({ silent: true }); }
          if (id === 'documents' && state.docs) state.docs.reload({ silent: true });
          if (id === 'activity' && state.activity) state.activity.reload();
          if (id === 'supervisors' && state.supPanel) state.supPanel.reload({ silent: true });
          if (id === 'presence' && state.presencePanel) state.presencePanel.reload({ silent: true });
          if (id === 'categories' && state.catPanel) state.catPanel.reload({ silent: true });
        }
      },
    });
    state.shell = shell;
    const S = shell.sections;

    // Initial shared lists (selectors fill in as soon as they load, and again on every refresh).
    loadCategories();
    loadSupervisors();

    buildOverview(S.overview);
    buildSupervisors(S.supervisors);
    buildPresence(S.presence);
    buildCategories(S.categories);

    state.docs = window.Widgets.mountDocuments(S.documents, {
      admin: true, getCategories: () => state.categories, getSupervisors: () => state.supervisors,
      onChanged: () => { if (state.stats) state.stats.reload({ silent: true }); },
    });

    const upHost = h('div', {});
    S.upload.appendChild(upHost);
    state.uploader = new window.Uploader(upHost, {
      getCategories: () => state.categories,
      refreshCategories: loadCategories,
      getSupervisors: () => state.supervisors.filter((s) => s.status === 'active'),
      onChanged: () => {
        if (state.stats) state.stats.reload({ silent: true });
        if (state.docs) state.docs.reload({ silent: true });
        if (state.activity) state.activity.reload();
        if (state.perSupervisor) state.perSupervisor.reload({ silent: true });
      },
    });

    state.activity = window.Widgets.mountActivity(S.activity, { admin: true, getCategories: () => state.categories, getSupervisors: () => state.supervisors });
    buildSystem(S.system);
    window.Shell.buildAccount(S.account, user, policy);

    state.timers.push(setInterval(() => { if (document.visibilityState === 'visible') loadCategories(); }, 30000));
    shell.showInitial();
  }

  async function boot() {
    await window.i18n.init({ defaultLang: 'ar', allowedLangs: ['ar'] });
    document.title = t('adm.title');
    window.Session.start({
      roles: ['admin'],
      authRoot, appRoot, titleKey: 'adm.title',
      onAuthenticated: startApp,
      onSignedOut: teardown,
    });
  }

  boot();
})();
