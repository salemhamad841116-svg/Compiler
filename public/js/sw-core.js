/* eslint-env serviceworker */
// ==============================================================================
// Shared service-worker logic for the installable apps (Phase 4 PWA).
// Each app's service-worker.js sets self.SW_CONFIG and imports this file.
//
// Caching strategy:
//   /api/*, /health, non-GET      -> never intercepted (network only: auth + live RAG answers)
//   page navigations              -> network first, cached shell second, offline.html last
//   same-origin app assets        -> network first with cache fallback (always fresh after a deploy,
//                                    still works offline)
//   icons / manifest              -> cache first
//   CDN fonts, icons, libraries   -> stale-while-revalidate runtime cache
// Bump SW_CONFIG.version on every release to drop old caches.
// ==============================================================================
(function (self) {
  'use strict';

  const cfg = self.SW_CONFIG || {};
  const VERSION = cfg.version || 'v1';
  const APP = cfg.app || 'app';
  const SHELL_CACHE = `${APP}-shell-${VERSION}`;
  const RUNTIME_CACHE = `${APP}-runtime-${VERSION}`;
  const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
  const SCOPE = self.registration ? self.registration.scope : self.location.href.replace(/[^/]*$/, '');
  const abs = (u) => new URL(u, SCOPE).href;
  const SHELL = (cfg.shell || []).map(abs);
  const OFFLINE_URL = abs('offline.html');
  const INDEX_URL = abs('./');

  function isNeverCached(url, request) {
    if (request.method !== 'GET') return true;
    if (url.origin !== self.location.origin) return !CDN_HOSTS.includes(url.hostname);
    // Single-host deployments: a root-scoped worker must leave the other apps' paths alone.
    if ((cfg.excludePaths || []).some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return true;
    return url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname.endsWith('/service-worker.js');
  }

  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(SHELL_CACHE).then((cache) =>
        // Add individually so one missing optional asset never blocks installation.
        Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch((e) => console.warn('[sw] precache skipped', u, e && e.message))))
      )
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(`${APP}-`) && k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
      await self.clients.claim();
    })());
  });

  // The page asks the waiting worker to take over when the user accepts "new version available".
  self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  });

  async function networkFirst(request, cacheName, preload) {
    const cache = await caches.open(cacheName);
    try {
      const fresh = (preload && (await preload)) || (await fetch(request));
      if (fresh && fresh.ok && fresh.type !== 'opaque') cache.put(request, fresh.clone());
      return fresh;
    } catch (e) {
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      throw e;
    }
  }

  async function cacheFirst(request) {
    const hit = await caches.match(request, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(request);
    if (res && res.ok) (await caches.open(RUNTIME_CACHE)).put(request, res.clone());
    return res;
  }

  async function staleWhileRevalidate(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    const hit = await cache.match(request);
    const refresh = fetch(request).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await refresh) || Response.error();
  }

  async function handleNavigation(event) {
    try {
      const fresh = (event.preloadResponse && (await event.preloadResponse)) || (await fetch(event.request));
      // Store the SPA shell under its canonical URL only: query strings (one-time invite or reset
      // tokens) are never written to the cache.
      if (fresh && fresh.ok && /text\/html/.test(fresh.headers.get('Content-Type') || '')) {
        (await caches.open(SHELL_CACHE)).put(INDEX_URL, fresh.clone());
      }
      return fresh;
    } catch (_) {
      if (cfg.offlineShell) {
        const shell = await caches.match(INDEX_URL);
        if (shell) return shell;
      }
      return (await caches.match(OFFLINE_URL)) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  }

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (isNeverCached(url, request)) return;

    if (request.mode === 'navigate') {
      event.respondWith(handleNavigation(event));
      return;
    }
    if (url.origin !== self.location.origin) {
      event.respondWith(staleWhileRevalidate(request));
      return;
    }
    if (/\/icons\/|\.webmanifest$/.test(url.pathname)) {
      event.respondWith(cacheFirst(request));
      return;
    }
    event.respondWith(networkFirst(request, SHELL_CACHE).catch(() => Response.error()));
  });
})(self);
