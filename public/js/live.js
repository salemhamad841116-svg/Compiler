// ==============================================================================
// Real-time updates (Phase 4). Subscribes to GET /api/events (Server-Sent Events,
// same-origin cookie auth) and lets dashboards refresh affected panels the moment
// a document is uploaded, processed, failed or deleted. Polling stays as fallback.
// No user-facing text lives here.
// ==============================================================================
(function (window) {
  'use strict';

  const TYPES = ['document.uploaded', 'document.queued', 'document.processing', 'document.completed', 'document.failed', 'document.deleted', 'settings.changed'];
  const handlers = new Map(); // type | '*' -> Set<fn>
  let es = null;
  let connected = false;
  let statusListeners = [];

  function emit(type, evt) {
    [type, '*'].forEach((k) => (handlers.get(k) || new Set()).forEach((fn) => {
      try { fn(evt); } catch (e) { console.error('[live] handler error', e); }
    }));
  }

  function setConnected(v) {
    if (connected === v) return;
    connected = v;
    statusListeners.forEach((fn) => { try { fn(v); } catch (_) { /* ignore */ } });
  }

  function start() {
    if (es || typeof window.EventSource !== 'function') return;
    es = new EventSource('/api/events', { withCredentials: true });
    es.addEventListener('hello', () => setConnected(true));
    es.onopen = () => setConnected(true);
    // The browser reconnects automatically (server sends retry: 5000).
    es.onerror = () => setConnected(false);
    TYPES.forEach((type) => es.addEventListener(type, (m) => {
      let evt = null;
      try { evt = JSON.parse(m.data); } catch (_) { return; }
      emit(type, evt);
    }));
  }

  function stop() {
    if (es) es.close();
    es = null;
    setConnected(false);
  }

  /** Subscribe to one event type ('*' for all). Returns an unsubscribe function. */
  function on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type).delete(fn);
  }

  /** Coalesces bursts (e.g. a 50-file batch) into one refresh per `ms`. */
  function debounce(fn, ms = 800) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function reset() {
    stop();
    handlers.clear();
    statusListeners = [];
  }

  window.Live = {
    start,
    stop,
    reset,
    on,
    debounce,
    isConnected: () => connected,
    onStatus: (fn) => statusListeners.push(fn),
    TYPES,
  };
})(window);
