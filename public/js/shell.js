// ==============================================================================
// Dashboard shell: sidebar navigation, top bar (user + sign out), section switching.
// Shared by the supervisor and administrator dashboards. All text comes from i18n keys.
// ==============================================================================
(function (window) {
  'use strict';

  const { h, t, icon, clear } = window.ui;

  /**
   * @param {HTMLElement} root container (the app root; it is emptied)
   * @param {Object} o
   * @param {string} o.titleKey brand title key
   * @param {string} o.subtitleKey brand subtitle key
   * @param {string} o.storageKey sessionStorage key for the last open section
   * @param {Array<{id:string,labelKey:string,icon:string}>} o.sections
   * @param {Object} o.user signed-in user
   * @param {Function} o.onLogout
   * @param {Function} [o.onShow] (sectionId, isFirst) => void
   */
  function create(root, o) {
    clear(root);
    const sections = {};
    const buttons = {};
    const shown = new Set();

    const nav = h('nav', { class: 'nav', 'aria-label': t(o.titleKey) });
    o.sections.forEach((s) => {
      buttons[s.id] = h('button', { type: 'button', class: 'nav-btn', dataset: { section: s.id }, onclick: () => show(s.id) }, icon(s.icon), h('span', {}, t(s.labelKey)));
      nav.appendChild(buttons[s.id]);
    });

    const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
      h('div', { class: 'brand' }, h('div', { class: 'logo-badge' }, icon('shield-halved')), h('div', {}, h('h1', {}, t(o.titleKey)), h('small', {}, t(o.subtitleKey)))),
      nav);

    const toggle = h('button', { type: 'button', class: 'icon-btn menu-toggle', 'aria-label': t('common.menu'), onclick: () => sidebar.classList.toggle('open') }, icon('bars'));
    const sectionTitle = h('h2', {});
    const topbar = h('header', { class: 'topbar' },
      h('div', { class: 'who' }, toggle, sectionTitle),
      h('div', { class: 'who' },
        h('span', { class: 'pill' }, icon('user'), ' ', o.user.name),
        h('span', { class: 'pill info' }, t(`roles.${o.user.role}`)),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: o.onLogout }, icon('right-from-bracket'), ' ', t('auth.sign_out'))));

    const content = h('main', { class: 'content' });
    o.sections.forEach((s) => {
      sections[s.id] = h('section', { class: 'section', id: `sec-${s.id}`, 'aria-label': t(s.labelKey) });
      content.appendChild(sections[s.id]);
    });

    root.append(sidebar, h('div', { class: 'main' }, topbar, content));

    function show(id) {
      if (!sections[id]) id = o.sections[0].id;
      Object.entries(sections).forEach(([k, el]) => el.classList.toggle('active', k === id));
      Object.entries(buttons).forEach(([k, el]) => {
        el.classList.toggle('active', k === id);
        if (k === id) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
      });
      const def = o.sections.find((s) => s.id === id);
      sectionTitle.textContent = t(def.labelKey);
      sidebar.classList.remove('open');
      try { sessionStorage.setItem(o.storageKey, id); } catch (_) { /* ignore */ }
      const first = !shown.has(id);
      shown.add(id);
      window.scrollTo(0, 0);
      if (o.onShow) o.onShow(id, first);
    }

    function showInitial() {
      let initial = null;
      try { initial = sessionStorage.getItem(o.storageKey); } catch (_) { /* ignore */ }
      show(initial && sections[initial] ? initial : o.sections[0].id);
    }

    return { sections, show, showInitial };
  }

  /** Account section: profile summary and password change (shared by both dashboards). */
  function buildAccount(root, user, policy) {
    const { toast, field, fmtDateTime, describeError } = window.ui;
    const api = window.api;
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', dir: 'ltr', required: true });
    const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', dir: 'ltr', required: true });
    const conf = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', dir: 'ltr', required: true });
    const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const btn = h('button', { type: 'submit', class: 'btn btn-primary' }, t('acct.change_password'));
    const form = h('form', {
      class: 'form-col',
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        if (next.value !== conf.value) {
          error.textContent = t('auth.passwords_mismatch');
          error.hidden = false;
          return;
        }
        btn.disabled = true;
        try {
          await api.post('/api/auth/change-password', { currentPassword: cur.value, newPassword: next.value });
          cur.value = '';
          next.value = '';
          conf.value = '';
          toast(t('acct.password_changed'), 'success');
        } catch (err) {
          error.textContent = describeError(err);
          error.hidden = false;
        } finally {
          btn.disabled = false;
        }
      },
    }, field(t('acct.current_password'), cur), field(t('auth.new_password'), next, t('auth.password_hint')), field(t('auth.confirm_password'), conf), error, btn);

    root.append(
      h('div', { class: 'card' },
        h('h2', {}, t('acct.profile')),
        h('dl', { class: 'details' },
          h('dt', {}, t('auth.email')), h('dd', { dir: 'ltr' }, user.email),
          h('dt', {}, t('acct.name')), h('dd', {}, user.name),
          h('dt', {}, t('acct.role')), h('dd', {}, t(`roles.${user.role}`)),
          h('dt', {}, t('acct.last_login')), h('dd', {}, fmtDateTime(user.lastLoginAt) || '-'),
          h('dt', {}, t('acct.session_policy')), h('dd', {}, t('acct.session_policy_text', { hb: policy.heartbeatIntervalSeconds, off: policy.offlineAfterSeconds })))),
      h('div', { class: 'card' }, h('h2', {}, t('acct.change_password')), form));
  }

  window.Shell = { create, buildAccount };
})(window);
