(function () {
  'use strict';

  const { h, t, icon, clear, toast, toastError, field, fmtDateTime, fmtNumber, fmtBytes, createPanel, chip, emptyBox, modal } = window.ui;
  const api = window.api;

  const authRoot = document.getElementById('authRoot');
  const appRoot = document.getElementById('appRoot');

  const state = { shell: null, projectsPanel: null, activeProject: null, timers: [] };

  function teardown() {
    state.timers.forEach(clearInterval);
    state.timers = [];
    state.shell = null;
    state.projectsPanel = null;
    state.activeProject = null;
    clear(appRoot);
  }

  function addProjectModal(onCreated) {
    const name = h('input', { class: 'input', required: true, maxlength: 120 });
    const prompt = h('textarea', { class: 'input', rows: 4, placeholder: t('adm.builder_create_project_hint') });
    modal({
      title: t('adm.builder_create_project_title'),
      body: h('div', { class: 'form-col' },
        field(t('adm.builder_project_name'), name),
        field(t('adm.builder_prompt_title'), prompt),
        h('p', { class: 'muted' }, t('adm.builder_create_project_hint'))),
      actions: [
        { label: t('common.cancel') },
        {
          label: t('adm.builder_new_project'),
          kind: 'primary',
          onClick: async () => {
            if (!name.value.trim()) throw new api.ApiError('', { code: 'NAME_REQUIRED' });
            const r = await api.post('/api/builder/projects', {
              name: name.value.trim(),
              prompt: prompt.value.trim(),
            });
            toast(t('common.saved'), 'success');
            if (onCreated) onCreated(r.data);
          },
        },
      ],
    });
  }

  function renderWorkspace(root, project, onBack) {
    clear(root);
    const topBar = h('div', { class: 'toolbar' },
      h('div', { style: 'display: flex; align-items: center; gap: 12px;' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: onBack }, icon('arrow-right'), ' ', t('adm.builder_back_to_projects')),
        h('h2', {}, project.name),
        chip(project.status, `adm.builder_status_${project.status}`)),
      h('div', { class: 'toolbar-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => saveCode() }, icon('floppy-disk'), ' ', t('adm.builder_save_code')),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => reloadProject() }, icon('rotate-right'), ' ', t('common.refresh'))));

    const splitPane = h('div', { class: 'builder-split-pane' });

    // Left pane: requests & prompt
    const leftPane = h('div', { class: 'builder-editor-pane' });
    const leftHeader = h('div', { class: 'builder-pane-header' },
      h('span', {}, icon('message'), ' ', t('adm.builder_requests_tab')));

    const reqInput = h('textarea', { class: 'input', rows: 3, placeholder: t('adm.builder_request_placeholder') });
    const sendReqBtn = h('button', {
      type: 'button',
      class: 'btn btn-primary btn-sm',
      style: 'margin-top: 8px;',
      onclick: async () => {
        if (!reqInput.value.trim()) return;
        await api.post(`/api/builder/projects/${project.id}/requests`, { prompt: reqInput.value.trim() });
        reqInput.value = '';
        toast(t('adm.builder_request_sent'), 'success');
        reloadProject();
      },
    }, icon('paper-plane'), ' ', t('adm.builder_submit_request'));

    const reqHistoryHolder = h('div', { style: 'flex: 1; overflow-y: auto; padding: 12px;' });
    const reqForm = h('div', { style: 'padding: 12px; border-bottom: 1px solid var(--border);' }, reqInput, sendReqBtn);
    leftPane.append(leftHeader, reqForm, reqHistoryHolder);

    // Right pane: code & live preview
    const rightPane = h('div', { class: 'builder-preview-pane' });
    let activeRightTab = 'preview';
    const previewBtn = h('button', { type: 'button', class: 'tab-btn active', onclick: () => switchRightTab('preview') }, icon('eye'), ' ', t('adm.builder_preview'));
    const codeBtn = h('button', { type: 'button', class: 'tab-btn', onclick: () => switchRightTab('code') }, icon('code'), ' ', t('adm.builder_code'));
    const rightHeader = h('div', { class: 'builder-pane-header' }, h('div', { class: 'tab-bar', style: 'margin: 0;' }, previewBtn, codeBtn));

    const codeArea = h('textarea', { class: 'builder-code-textarea', spellcheck: false, value: project.html || '' });
    const previewIframe = h('iframe', { class: 'builder-preview-iframe', sandbox: 'allow-scripts allow-same-origin' });

    function updatePreview() {
      const doc = previewIframe.contentDocument || (previewIframe.contentWindow && previewIframe.contentWindow.document);
      if (doc) {
        doc.open();
        doc.write(codeArea.value || '<!DOCTYPE html><html><body><h3 style="font-family: sans-serif; color: #888; text-align: center; margin-top: 40px;">No Preview Available</h3></body></html>');
        doc.close();
      }
    }

    function switchRightTab(tab) {
      activeRightTab = tab;
      [previewBtn, codeBtn].forEach((b) => b.classList.remove('active'));
      if (tab === 'preview') {
        previewBtn.classList.add('active');
        codeArea.style.display = 'none';
        previewIframe.style.display = 'block';
        updatePreview();
      } else {
        codeBtn.classList.add('active');
        codeArea.style.display = 'block';
        previewIframe.style.display = 'none';
      }
    }

    rightPane.append(rightHeader, codeArea, previewIframe);
    switchRightTab('preview');

    splitPane.append(leftPane, rightPane);
    root.append(topBar, splitPane);

    async function saveCode() {
      await api.put(`/api/builder/projects/${project.id}`, { html: codeArea.value });
      toast(t('common.saved'), 'success');
      updatePreview();
    }

    async function reloadProject() {
      const res = await api.get(`/api/builder/projects/${project.id}`);
      const full = res.data;
      clear(reqHistoryHolder);
      const reqs = full.requests || [];
      if (!reqs.length) {
        reqHistoryHolder.appendChild(emptyBox('adm.builder_no_requests'));
      } else {
        reqs.forEach((r) => {
          const item = h('div', { class: 'builder-request-item' },
            h('div', { style: 'display: flex; justify-content: space-between; margin-bottom: 4px;' },
              chip(r.status, `adm.builder_status_${r.status}`),
              h('small', { class: 'muted' }, fmtDateTime(r.created_at))),
            h('p', { style: 'margin: 0; font-size: 0.88rem;' }, r.prompt));
          reqHistoryHolder.appendChild(item);
        });
      }
    }

    reloadProject();
  }

  function startApp(user, policy) {
    teardown();
    document.title = t('adm.nav_builder');
    const sections = [
      { id: 'projects', labelKey: 'adm.builder_my_projects', icon: 'laptop-code' },
      { id: 'account', labelKey: 'sup.nav_account', icon: 'user-gear' },
    ];

    const shell = window.Shell.create(appRoot, {
      titleKey: 'adm.nav_builder',
      subtitleKey: 'adm.builder_subtitle',
      storageKey: 'builder_section',
      sections,
      user,
      onLogout: () => window.Session.logout(),
      onShow: (id, first) => {
        if (!first && id === 'projects' && state.projectsPanel) state.projectsPanel.reload({ silent: true });
      },
    });
    state.shell = shell;
    const S = shell.sections;

    window.Shell.buildAccount(S.account, user, policy);

    // Build projects section
    function buildProjectsList() {
      clear(S.projects);
      const toolbar = h('div', { class: 'toolbar' },
        h('h2', {}, t('adm.builder_my_projects')),
        h('div', { class: 'toolbar-actions' },
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => addProjectModal((p) => { renderWorkspace(S.projects, p, buildProjectsList); }) }, icon('plus'), ' ', t('adm.builder_new_project')),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => state.projectsPanel.reload() }, icon('rotate-right'), ' ', t('common.refresh'))));

      const holder = h('div', {});
      S.projects.append(toolbar, holder);

      state.projectsPanel = createPanel(holder, () => api.get('/api/builder/projects').then((r) => r.data), (projects) => {
        if (!projects || !projects.length) return emptyBox('adm.builder_no_projects');

        const cards = projects.map((p) => {
          const card = h('div', { class: 'builder-project-card', onclick: () => renderWorkspace(S.projects, p, buildProjectsList) },
            h('div', { class: 'builder-project-card-header' },
              h('div', {},
                h('h3', { style: 'margin: 0 0 4px;' }, p.name),
                h('small', { class: 'muted', dir: 'ltr' }, p.slug)),
              chip(p.status, `adm.builder_status_${p.status}`)),
            p.description ? h('p', { class: 'muted', style: 'font-size: 0.85rem; margin: 0;' }, p.description) : null,
            h('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-top: auto; font-size: 0.8rem; color: var(--muted);' },
              h('span', {}, icon('message'), ' ', fmtNumber(p.requests_count || 0)),
              h('span', {}, fmtDateTime(p.updated_at))));
          return card;
        });

        return h('div', { class: 'builder-projects-grid' }, ...cards);
      });

      state.projectsPanel.reload();
    }

    buildProjectsList();
    shell.showInitial();
  }

  async function boot() {
    await window.i18n.init({ defaultLang: 'ar', allowedLangs: ['ar'] });
    document.title = t('adm.nav_builder');
    window.Session.start({
      roles: ['supervisor', 'admin'],
      authRoot,
      appRoot,
      titleKey: 'adm.nav_builder',
      onAuthenticated: startApp,
      onSignedOut: teardown,
    });
  }

  boot();
})();
