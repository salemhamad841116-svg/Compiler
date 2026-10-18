// ==============================================================================
// PWA client (Phase 4): registers the app's service worker, shows an "Install app"
// button when the browser allows it (beforeinstallprompt), an "Add to Home Screen"
// hint on iOS (which has no install prompt), and a "new version" banner when an
// updated service worker is waiting. All text comes from i18n keys (pwa.*).
// ==============================================================================
(function (window, document) {
  'use strict';

  const DISMISS_KEY = 'masruq_pwa_install_dismissed_at';
  const DISMISS_DAYS = 14;
  let deferredPrompt = null;
  let bar = null;
  let mode = null; // 'install' | 'ios' | 'update'
  let waitingWorker = null;

  const tr = (key, vars) => (window.i18n ? window.i18n.t(key, vars) : key);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const recentlyDismissed = () => {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at && Date.now() - at < DISMISS_DAYS * 86400000;
  };

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    children.flat().forEach((c) => { if (c != null) node.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return node;
  }

  function hide() {
    if (bar) bar.remove();
    bar = null;
    mode = null;
  }

  function render() {
    if (!mode) return;
    if (bar) bar.remove();
    const close = el('button', { type: 'button', class: 'pwa-close', 'aria-label': tr('pwa.dismiss'), onclick: () => {
      if (mode !== 'update') localStorage.setItem(DISMISS_KEY, String(Date.now()));
      hide();
    } }, '\u00d7');
    let body;
    if (mode === 'install') {
      body = [
        el('span', { class: 'pwa-text' }, tr('pwa.install_hint')),
        el('button', { type: 'button', class: 'pwa-btn', onclick: install }, tr('pwa.install')),
      ];
    } else if (mode === 'ios') {
      body = [el('span', { class: 'pwa-text' }, tr('pwa.ios_hint'))];
    } else {
      body = [
        el('span', { class: 'pwa-text' }, tr('pwa.update_ready')),
        el('button', { type: 'button', class: 'pwa-btn', onclick: applyUpdate }, tr('pwa.reload')),
      ];
    }
    bar = el('div', { class: `pwa-bar pwa-${mode}`, role: 'status', 'aria-live': 'polite' }, body, close);
    document.body.appendChild(bar);
  }

  function show(m) {
    mode = m;
    render();
  }

  async function install() {
    if (!deferredPrompt) return hide();
    deferredPrompt.prompt();
    try {
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'dismissed') localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (_) { /* ignore */ }
    deferredPrompt = null;
    hide();
  }

  function applyUpdate() {
    if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    hide();
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone() && !recentlyDismissed() && mode !== 'update') show('install');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (mode === 'install') hide();
  });

  function trackWaiting(reg) {
    const announce = (w) => {
      waitingWorker = w;
      show('update');
    };
    // Only offer an update when a previous worker already controls the page (not on first install).
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) announce(nw);
      });
    });
  }

  function register() {
    if (!('serviceWorker' in navigator)) return;
    const secure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure) return;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !waitingWorker) return;
      reloading = true;
      window.location.reload();
    });
    // Relative URL: the worker's scope is the app's own folder (site root on its subdomain).
    navigator.serviceWorker.register('service-worker.js').then((reg) => {
      trackWaiting(reg);
      // Check for a new deploy when the app returns to the foreground and every 30 minutes.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch((e) => console.warn('[pwa] service worker registration failed:', e && e.message));
  }

  function init() {
    register();
    if (isIos() && !isStandalone() && !recentlyDismissed()) setTimeout(() => { if (!mode) show('ios'); }, 2500);
    // Re-render the bar text if the language changes.
    if (window.i18n && Array.isArray(window.i18n.callbacks)) window.i18n.callbacks.push(() => render());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Pwa = { isStandalone, install, applyUpdate };
})(window, document);
