/* eslint-env serviceworker */
// Bahth (public knowledge chat) service worker. Shared logic lives in /js/sw-core.js.
// Bump `version` on every release so clients drop old caches.
self.SW_CONFIG = {
  app: 'bahth',
  version: '4.0.0',
  offlineShell: true, // the chat UI opens offline and explains that answers need a connection
  // When served from the site root on a single host, never touch the other apps.
  excludePaths: ['/supervisor', '/admin'],
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
    '/css/pwa.css',
    '/js/i18n.js',
    '/js/pwa.js',
    '/locales/ar.json',
    '/locales/en.json',
  ],
};
importScripts('/js/sw-core.js');
