// ==============================================================================
// Supervisor dashboard. Fully localized through i18n keys (Arabic dictionary served at runtime).
// ==============================================================================
(function () {
  'use strict';

  const { h, t, clear, errorBox, toast } = window.ui;
  const api = window.api;

  const authRoot = document.getElementById('authRoot');
  const appRoot = document.getElementById('appRoot');

  const state = { categories: [], catError: null, catLoaded: false, shell: null, uploader: null, docs: null, activity: null, stats: null, timers: [] };

  // -------------------------------------------------------------- categories (single shared source)
  async function loadCategories() {
    try {
      const r = await api.get('/api/categories');
      state.categories = r.data || [];
      state.catError = null;
      state.catLoaded = true;
    } catch (err) {
      state.catError = err;
    }
    renderCategoryBanner();
    if (!state.catError) {
      if (state.uploader) state.uploader.refreshCategorySelects();
      if (state.docs) state.docs.refreshFilters();
      if (state.activity) state.activity.refreshFilters();
    }
    return state.categories;
  }

  let bannerHost = null;
  function renderCategoryBanner() {
    if (!bannerHost) return;
    clear(bannerHost);
    if (state.catError) {
      bannerHost.appendChild(errorBox(state.catError, () => loadCategories()));
    } else if (state.catLoaded && !state.categories.length) {
      bannerHost.appendChild(h('div', { class: 'notice notice-warn' }, t('sup.no_categories')));
    }
  }


  // -------------------------------------------------------------- app
  function teardown() {
    state.timers.forEach(clearInterval);
    state.timers = [];
    if (state.stats && state.stats.stop) state.stats.stop();
    if (window.Live) window.Live.reset();
    Object.assign(state, { shell: null, uploader: null, docs: null, activity: null, stats: null, categories: [], catError: null, catLoaded: false });
    clear(appRoot);
    bannerHost = null;
  }

  /** Real-time updates: the supervisor sees processing results the moment the backend finishes. */
  function startLive() {
    if (!window.Live) return;
    const refresh = window.Live.debounce(() => {
      if (state.docs) state.docs.reload({ silent: true });
      if (state.stats) state.stats.reload({ silent: true });
    }, 700);
    ['document.uploaded', 'document.queued', 'document.processing', 'document.deleted'].forEach((type) => window.Live.on(type, refresh));
    // Batches finish many files at once: one summary toast per burst instead of one per file.
    const done = { completed: [], failed: [] };
    const announce = window.Live.debounce(() => {
      const c = done.completed.splice(0);
      const f = done.failed.splice(0);
      if (c.length === 1) toast(t('live.doc_completed', { title: c[0] }), 'success');
      else if (c.length > 1) toast(t('live.docs_completed_n', { n: c.length }), 'success');
      if (f.length === 1) toast(t('live.doc_failed', { title: f[0] }), 'error', 8000);
      else if (f.length > 1) toast(t('live.docs_failed_n', { n: f.length }), 'error', 8000);
    }, 1500);
    window.Live.on('document.completed', (e) => { refresh(); done.completed.push(e.title || ''); announce(); });
    window.Live.on('document.failed', (e) => { refresh(); done.failed.push(e.title || ''); announce(); });
    window.Live.start();
  }

  function startApp(user, policy) {
    teardown();
    document.title = t('sup.title');
    const sections = [
      { id: 'upload', labelKey: 'sup.nav_upload', icon: 'cloud-arrow-up' },
      { id: 'documents', labelKey: 'sup.nav_documents', icon: 'folder-open' },
      { id: 'stats', labelKey: 'sup.nav_stats', icon: 'chart-column' },
      { id: 'activity', labelKey: 'sup.nav_activity', icon: 'clock-rotate-left' },
      { id: 'account', labelKey: 'sup.nav_account', icon: 'user-gear' },
    ];
    const shell = window.Shell.create(appRoot, {
      titleKey: 'sup.title', subtitleKey: 'sup.subtitle', storageKey: 'sup_section', sections, user,
      onLogout: () => window.Session.logout(),
      onShow: (id) => {
        // Re-read categories whenever the supervisor opens a view that depends on them: a category created
        // by an administrator appears without logging out.
        if (id === 'upload' || id === 'documents' || id === 'activity') loadCategories();
        if (id === 'documents' && state.docs) state.docs.reload({ silent: true });
        if (id === 'activity' && state.activity) state.activity.reload();
        if (id === 'stats' && state.stats) state.stats.reload({ silent: true });
      },
    });
    state.shell = shell;
    const S = shell.sections;

    // upload
    bannerHost = h('div', {});
    S.upload.append(bannerHost, h('div', { id: 'uploaderRoot' }));
    state.uploader = new window.Uploader(S.upload.querySelector('#uploaderRoot'), {
      getCategories: () => state.categories,
      refreshCategories: loadCategories,
      onChanged: () => {
        if (state.stats) state.stats.reload({ silent: true });
        if (state.docs) state.docs.reload({ silent: true });
        if (state.activity) state.activity.reload();
      },
    });

    // documents, stats, activity
    state.docs = window.Widgets.mountDocuments(S.documents, {
      admin: false,
      getCategories: () => state.categories,
      onChanged: () => state.stats && state.stats.reload({ silent: true }),
    });
    state.stats = window.Widgets.mountStats(S.stats, () => api.get('/api/me/stats'));
    state.activity = window.Widgets.mountActivity(S.activity, { admin: false, getCategories: () => state.categories });
    window.Shell.buildAccount(S.account, user, policy);

    loadCategories();
    state.timers.push(setInterval(() => { if (document.visibilityState === 'visible') loadCategories(); }, 30000));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.shell) loadCategories();
    });
    startLive();
    shell.showInitial();
  }

  async function boot() {
    await window.i18n.init({ defaultLang: 'ar', allowedLangs: ['ar'] });
    document.title = t('sup.title');
    window.Session.start({
      roles: ['supervisor', 'admin'],
      authRoot, appRoot, titleKey: 'sup.title',
      onAuthenticated: startApp,
      onSignedOut: teardown,
    });
  }

  boot();
})();
