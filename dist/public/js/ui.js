// ==============================================================================
// Shared UI helpers: safe DOM builder, formatting, toasts, modals, loading/error/empty states.
// No user-facing text is hard-coded here; everything is resolved from i18n dictionaries.
// ==============================================================================
(function (window) {
  'use strict';

  const t = (key, vars) => (window.i18n ? window.i18n.t(key, vars) : key);

  /** Safe element builder (text is always inserted as text nodes, never as HTML). */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    append(el, children);
    return el;
  }

  function append(el, children) {
    children.flat(Infinity).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return el;
  }

  function icon(name) {
    return h('i', { class: `fa-solid fa-${name}`, 'aria-hidden': 'true' });
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  // ------------------------------------------------------------------ formatting
  const locale = () => (window.i18n && window.i18n.currentLang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB');

  /** Server timestamps are UTC ISO strings; shown in Asia/Dubai with the zone always visible. */
  function fmtDateTime(iso, { zone = true } = {}) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const s = new Intl.DateTimeFormat(locale(), {
      timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(d);
    return zone ? `${s} ${t('common.tz_label')}` : s;
  }

  function fmtNumber(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
    return new Intl.NumberFormat(locale()).format(Number(n));
  }

  function fmtBytes(n) {
    if (n === null || n === undefined) return '-';
    const units = ['common.unit_b', 'common.unit_kb', 'common.unit_mb', 'common.unit_gb'];
    let v = Number(n);
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${fmtNumber(Number(v.toFixed(i === 0 ? 0 : 1)))} ${t(units[i])}`;
  }

  function fmtRelative(iso) {
    if (!iso) return '';
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return t('common.ago_seconds', { n: s });
    if (s < 3600) return t('common.ago_minutes', { n: Math.round(s / 60) });
    if (s < 86400) return t('common.ago_hours', { n: Math.round(s / 3600) });
    return t('common.ago_days', { n: Math.round(s / 86400) });
  }

  // ------------------------------------------------------------------ errors
  /** Translates an ApiError into a human message; unknown codes fall back to the server text. */
  function describeError(err) {
    if (!err) return t('errors.UNKNOWN');
    const key = `errors.${err.code}`;
    const translated = t(key);
    const base = translated !== key ? translated : err.message || t('errors.UNKNOWN');
    return base;
  }

  // ------------------------------------------------------------------ toast
  let toastRoot;
  function toast(message, type = 'info', ms = 4500) {
    if (!toastRoot) {
      toastRoot = h('div', { class: 'toast-root', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastRoot);
    }
    const el = h('div', { class: `toast toast-${type}` }, message);
    toastRoot.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function toastError(err) {
    const msg = describeError(err);
    toast(err && err.requestId ? `${msg} (${t('common.error_id')}: ${err.requestId})` : msg, 'error', 8000);
  }

  // ------------------------------------------------------------------ modal
  function modal({ title, body, actions = [], wide = false, onClose }) {
    const overlay = h('div', { class: 'modal-overlay', role: 'dialog', 'aria-modal': 'true' });
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const footer = h('div', { class: 'modal-actions' });
    actions.forEach((a) => {
      footer.appendChild(
        h('button', {
          type: 'button', class: `btn ${a.kind ? `btn-${a.kind}` : ''}`,
          onclick: async (e) => {
            const btn = e.currentTarget;
            if (!a.onClick) return close();
            btn.disabled = true;
            try {
              const keep = await a.onClick(close);
              if (keep !== false) close();
            } catch (err) {
              toastError(err);
            } finally {
              btn.disabled = false;
            }
          },
        }, a.label)
      );
    });
    const box = h('div', { class: `modal-box${wide ? ' modal-wide' : ''}` },
      h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.close'), onclick: close }, icon('xmark'))),
      h('div', { class: 'modal-body' }, body), footer);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    const first = box.querySelector('input,select,textarea,button');
    if (first) first.focus();
    return { close, box };
  }

  function confirmDialog({ title, message, confirmLabel, kind = 'danger' }) {
    return new Promise((resolve) => {
      modal({
        title,
        body: h('p', {}, message),
        onClose: () => resolve(false), // closing via X / Esc / backdrop resolves false (resolve is idempotent)
        actions: [
          { label: t('common.cancel') },
          { label: confirmLabel || t('common.confirm'), kind, onClick: () => { resolve(true); } },
        ],
      });
    });
  }

  // ------------------------------------------------------------------ states
  function loadingBox() {
    return h('div', { class: 'state-box state-loading', role: 'status' }, h('div', { class: 'spinner' }), h('span', {}, t('common.loading')));
  }

  function emptyBox(messageKey = 'common.empty') {
    return h('div', { class: 'state-box state-empty' }, icon('inbox'), h('span', {}, t(messageKey)));
  }

  function errorBox(err, onRetry) {
    return h('div', { class: 'state-box state-error', role: 'alert' },
      icon('triangle-exclamation'),
      h('div', { class: 'state-error-text' },
        h('strong', {}, describeError(err)),
        err && err.requestId ? h('small', {}, `${t('common.error_id')}: ${err.requestId}`) : null,
        err && err.code && err.code !== 'UNKNOWN' ? h('small', {}, `${t('common.error_code')}: ${err.code}`) : null),
      onRetry ? h('button', { type: 'button', class: 'btn btn-sm', onclick: onRetry }, icon('rotate-right'), ' ', t('common.retry')) : null);
  }

  /**
   * Panel: owns a container, shows loading -> content | empty | error(+retry).
   * silent reloads keep existing content and show a "stale" banner on failure instead of wiping data
   * or pretending the numbers are zero.
   */
  function createPanel(container, loader, render) {
    let hasData = false;
    let seq = 0;
    const banner = h('div', { class: 'stale-banner', hidden: true });
    const body = h('div', { class: 'panel-body' });
    container.appendChild(banner);
    container.appendChild(body);

    async function reload({ silent = false } = {}) {
      const my = ++seq;
      if (!silent || !hasData) {
        clear(body);
        body.appendChild(loadingBox());
      }
      try {
        const data = await loader();
        if (my !== seq) return;
        banner.hidden = true;
        clear(body);
        hasData = true;
        const out = render(data);
        if (out) body.appendChild(out);
      } catch (err) {
        if (my !== seq) return;
        if (hasData) {
          clear(banner);
          banner.hidden = false;
          banner.appendChild(h('span', {}, `${t('common.stale_data')} ${describeError(err)}`));
          banner.appendChild(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => reload({ silent: true }) }, t('common.retry')));
        } else {
          clear(body);
          body.appendChild(errorBox(err, () => reload()));
        }
      }
    }
    return { reload, body };
  }

  // ------------------------------------------------------------------ misc widgets
  function chip(status, labelKey) {
    return h('span', { class: `chip chip-${String(status).replace(/[^a-z_]/gi, '')}` }, t(labelKey || `status.${status}`));
  }

  function pager(info, onPage) {
    if (!info || info.pages <= 1) {
      return h('div', { class: 'pager' }, h('span', { class: 'pager-info' }, t('common.total_n', { n: fmtNumber(info ? info.total : 0) })));
    }
    return h('div', { class: 'pager' },
      h('button', { type: 'button', class: 'btn btn-sm', disabled: info.page <= 1, onclick: () => onPage(info.page - 1) }, t('common.prev')),
      h('span', { class: 'pager-info' }, t('common.page_of', { page: fmtNumber(info.page), pages: fmtNumber(info.pages) }), ' · ', t('common.total_n', { n: fmtNumber(info.total) })),
      h('button', { type: 'button', class: 'btn btn-sm', disabled: info.page >= info.pages, onclick: () => onPage(info.page + 1) }, t('common.next')));
  }

  function debounce(fn, ms = 350) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function statCard({ label, value, hint, tone = '', iconName }) {
    return h('div', { class: `stat-card ${tone}` },
      iconName ? h('div', { class: 'stat-icon' }, icon(iconName)) : null,
      h('div', { class: 'stat-body' }, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label), hint ? h('div', { class: 'stat-hint' }, hint) : null));
  }

  function field(labelText, control, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, labelText), control, hint ? h('small', { class: 'field-hint' }, hint) : null);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.ui = {
    t, h, append, icon, clear, fmtDateTime, fmtNumber, fmtBytes, fmtRelative, describeError, toast, toastError,
    modal, confirmDialog, loadingBox, emptyBox, errorBox, createPanel, chip, pager, debounce, statCard, field, downloadBlob,
  };
})(window);
