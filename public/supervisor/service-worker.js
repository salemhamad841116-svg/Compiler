/* eslint-env serviceworker */
// Waraqa (supervisor portal) service worker. Shared logic lives in /js/sw-core.js.
// Bump `version` on every release so clients drop old caches.
self.SW_CONFIG = {
  app: 'waraqa',
  version: '4.0.0',
  offlineShell: false, // signed-in portal: show the offline screen instead of a shell that cannot authenticate
  shell: [
    './',
    'index.html',
    'app.js',
    'style.css',
    'offline.html',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/favicon-32.png',
    '/css/base.css',
    '/css/pwa.css',
    '/js/i18n.js',
    '/js/api.js',
    '/js/ui.js',
    '/js/session.js',
    '/js/shell.js',
    '/js/uploader.js',
    '/js/widgets.js',
    '/js/live.js',
    '/js/pwa.js',
    '/locales/ar.json',
    '/locales/en.json',
  ],
};
importScripts('/js/sw-core.js');
