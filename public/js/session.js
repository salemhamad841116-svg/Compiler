// ==============================================================================
// Session manager: sign-in / invitation activation UI, heartbeat presence, expiry handling.
// Used by the supervisor and administrator dashboards. All text comes from i18n keys.
// ==============================================================================
(function (window) {
  'use strict';

  const { h, t, icon, clear, toast, describeError } = window.ui;
  const api = window.api;

  const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  const IDLE_AFTER_MS = 120000;

  const Session = {
    user: null,
    policy: { heartbeatIntervalSeconds: 30, offlineAfterSeconds: 120, awayAfterSeconds: 300, displayTimeZone: 'Asia/Dubai' },
    _opts: null,
    _timer: null,
    _lastActivity: Date.now(),
    _failures: 0,
    _connectionBanner: null,

    /**
     * @param {Object} opts
     * @param {string[]} opts.roles roles allowed into this dashboard
     * @param {HTMLElement} opts.authRoot container for auth screens
     * @param {HTMLElement} opts.appRoot container of the authenticated app (hidden until signed in)
     * @param {string} opts.titleKey i18n key of the dashboard title
     * @param {Function} opts.onAuthenticated (user, policy) => void
     * @param {Function} [opts.onSignedOut]
     */
    async start(opts) {
      this._opts = opts;
      api.onUnauthorized((err) => {
        if (this.user) this._handleUnauthorized(err);
      });
      ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, () => { this._lastActivity = Date.now(); }, { passive: true }));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.user) this._beat();
      });
      window.addEventListener('online', () => this.user && this._beat());

      const invite = new URLSearchParams(location.search).get('invite');
      if (invite) return this._renderInvitation(invite);

      try {
        const me = await api.get('/api/auth/me', { silentAuth: true });
        return this._enter(me);
      } catch (err) {
        if (err.status === 401) return this._renderLogin();
        return this._renderStartupError(err);
      }
    },

    _show(which) {
      this._opts.authRoot.hidden = which !== 'auth';
      this._opts.appRoot.hidden = which !== 'app';
    },

    _enter(payload) {
      if (!this._opts.roles.includes(payload.user.role)) return this._renderRoleDenied(payload.user);
      this.user = payload.user;
      this.policy = payload.policy || this.policy;
      this._failures = 0;
      this._show('app');
      this._startHeartbeat();
      this._opts.onAuthenticated(this.user, this.policy);
    },

    // ----------------------------------------------------------------- heartbeat
    _startHeartbeat() {
      clearInterval(this._timer);
      this._timer = setInterval(() => this._beat(), Math.max(5, this.policy.heartbeatIntervalSeconds) * 1000);
    },

    async _beat() {
      if (!this.user) return;
      const idle = document.visibilityState === 'hidden' || Date.now() - this._lastActivity > IDLE_AFTER_MS;
      try {
        await api.post('/api/auth/heartbeat', { idle });
        if (this._failures > 0) {
          this._failures = 0;
          this._setConnectionBanner(false);
          toast(t('auth.connection_restored'), 'success', 2500);
        }
      } catch (err) {
        if (err.code === 'NETWORK_ERROR' || err.status >= 500 || err.status === 0) {
          this._failures++;
          if (this._failures >= 2) this._setConnectionBanner(true);
        }
      }
    },

    _setConnectionBanner(on) {
      if (on && !this._connectionBanner) {
        this._connectionBanner = h('div', { class: 'connection-banner', role: 'alert' }, icon('wifi'), ' ', t('auth.connection_lost'));
        document.body.prepend(this._connectionBanner);
      } else if (!on && this._connectionBanner) {
        this._connectionBanner.remove();
        this._connectionBanner = null;
      }
    },

    _handleUnauthorized(err) {
      clearInterval(this._timer);
      this.user = null;
      this._setConnectionBanner(false);
      if (this._opts.onSignedOut) this._opts.onSignedOut();
      const key = err.code === 'SESSION_EXPIRED' ? 'auth.session_expired' : err.code === 'SESSION_REVOKED' ? 'auth.session_revoked' : 'auth.sign_in_required';
      this._renderLogin({ notice: t(key), noticeType: 'warn' });
    },

    async logout() {
      clearInterval(this._timer);
      try {
        await api.post('/api/auth/logout', {}, { silentAuth: true });
      } catch (_) {
        /* the session is cleared client-side regardless; server records connection loss if it could not be reached */
      }
      this.user = null;
      this._setConnectionBanner(false);
      if (this._opts.onSignedOut) this._opts.onSignedOut();
      this._renderLogin({ notice: t('auth.signed_out'), noticeType: 'ok' });
    },

    // ----------------------------------------------------------------- screens
    _card(children) {
      const root = clear(this._opts.authRoot);
      root.appendChild(
        h('div', { class: 'auth-wrap' },
          h('div', { class: 'auth-card' },
            h('div', { class: 'auth-brand' }, h('div', { class: 'logo-badge' }, icon('shield-halved')), h('h1', {}, t(this._opts.titleKey))),
            children))
      );
      this._show('auth');
    },

    _renderLogin({ notice, noticeType } = {}) {
      const email = h('input', { type: 'email', id: 'loginEmail', class: 'input', autocomplete: 'username', required: true, dir: 'ltr' });
      const password = h('input', { type: 'password', id: 'loginPassword', class: 'input', autocomplete: 'current-password', required: true, dir: 'ltr' });
      const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
      const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, t('auth.sign_in'));
      const form = h('form', {
        class: 'auth-form',
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          error.hidden = true;
          if (!email.value.trim() || !password.value) {
            error.textContent = t('auth.fields_required');
            error.hidden = false;
            return;
          }
          submit.disabled = true;
          submit.textContent = t('auth.signing_in');
          try {
            const res = await api.post('/api/auth/login', { email: email.value.trim(), password: password.value }, { silentAuth: true });
            this._enter(res);
          } catch (err) {
            error.textContent = describeError(err) + (err.requestId && err.status >= 500 ? ` (${t('common.error_id')}: ${err.requestId})` : '');
            error.hidden = false;
          } finally {
            submit.disabled = false;
            submit.textContent = t('auth.sign_in');
          }
        },
      },
      notice ? h('div', { class: `notice notice-${noticeType || 'ok'}` }, notice) : null,
      window.ui.field(t('auth.email'), email), window.ui.field(t('auth.password'), password), error, submit,
      h('p', { class: 'auth-help' }, t('auth.help_invite')));
      this._card(form);
      email.focus();
    },

    async _renderInvitation(token) {
      this._card(window.ui.loadingBox());
      let info;
      try {
        info = await api.get(`/api/auth/invitations/${encodeURIComponent(token)}`, { silentAuth: true });
      } catch (err) {
        return this._card(h('div', {}, window.ui.errorBox(err), h('button', { type: 'button', class: 'btn btn-block', onclick: () => { history.replaceState({}, '', location.pathname); this._renderLogin(); } }, t('auth.back_to_login'))));
      }
      const pw = h('input', { type: 'password', class: 'input', autocomplete: 'new-password', required: true, dir: 'ltr' });
      const pw2 = h('input', { type: 'password', class: 'input', autocomplete: 'new-password', required: true, dir: 'ltr' });
      const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
      const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, t(info.invitation.purpose === 'reset' ? 'auth.reset_password' : 'auth.activate'));
      const form = h('form', {
        class: 'auth-form',
        onsubmit: async (e) => {
          e.preventDefault();
          error.hidden = true;
          if (pw.value !== pw2.value) {
            error.textContent = t('auth.passwords_mismatch');
            error.hidden = false;
            return;
          }
          submit.disabled = true;
          try {
            await api.post(`/api/auth/invitations/${encodeURIComponent(token)}/accept`, { password: pw.value }, { silentAuth: true });
            history.replaceState({}, '', location.pathname);
            this._renderLogin({ notice: t('auth.activated'), noticeType: 'ok' });
          } catch (err) {
            error.textContent = describeError(err);
            error.hidden = false;
            submit.disabled = false;
          }
        },
      },
      h('p', { class: 'auth-intro' }, t(info.invitation.purpose === 'reset' ? 'auth.reset_intro' : 'auth.invite_intro', { name: info.invitation.name })),
      h('div', { class: 'auth-identity', dir: 'ltr' }, info.invitation.email),
      window.ui.field(t('auth.new_password'), pw, t('auth.password_hint')), window.ui.field(t('auth.confirm_password'), pw2), error, submit);
      this._card(form);
    },

    _renderRoleDenied(user) {
      this.user = null;
      this._card(h('div', { class: 'auth-form' },
        h('div', { class: 'notice notice-warn' }, t('auth.role_denied', { role: t(`roles.${user.role}`) })),
        h('button', { type: 'button', class: 'btn btn-block', onclick: () => this.logout() }, t('auth.sign_out'))));
    },

    _renderStartupError(err) {
      this._card(window.ui.errorBox(err, () => location.reload()));
    },
  };

  window.Session = Session;
})(window);
