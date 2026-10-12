// ==============================================================================
// Shared API client. Every failure becomes an ApiError with a stable `code`, so the UI can
// show a precise, recoverable message instead of an endless "Loading..." or a fake zero.
// No user-facing text lives here: messages are resolved through i18n keys (errors.<code>).
// ==============================================================================
(function (window) {
  'use strict';

  class ApiError extends Error {
    constructor(message, { status = 0, code = 'UNKNOWN', requestId = null, data = null } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.requestId = requestId;
      this.data = data;
    }
  }

  const AUTH_CODES = new Set(['NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'SESSION_REVOKED']);
  const listeners = { unauthorized: [] };

  function parse(status, text, requestIdHeader) {
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = null;
    }
    return { json, requestId: (json && json.requestId) || requestIdHeader || null };
  }

  function toError(status, text, headers) {
    const { json, requestId } = parse(status, text, headers.get('x-request-id'));
    if (json && json.error) {
      return new ApiError(json.error, { status, code: json.code || `HTTP_${status}`, requestId, data: json });
    }
    // Non-JSON error bodies (HTML error page from a proxy, empty body, ...) are reported as such.
    const code = status === 0 ? 'NETWORK_ERROR' : text && /^\s*</.test(text) ? 'NON_JSON_RESPONSE' : text ? `HTTP_${status}` : 'EMPTY_RESPONSE';
    return new ApiError(`Request failed with status ${status}`, { status, code, requestId });
  }

  function notifyIfUnauthorized(err, opts) {
    if (err.status === 401 && AUTH_CODES.has(err.code) && !(opts && opts.silentAuth)) {
      listeners.unauthorized.forEach((fn) => {
        try { fn(err); } catch (_) { /* ignore */ }
      });
    }
  }

  async function request(method, url, { body, form, headers = {}, signal, raw = false, silentAuth = false } = {}) {
    const init = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest', ...headers }, signal };
    if (form) {
      init.body = form;
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new ApiError('Network request failed', { status: 0, code: 'NETWORK_ERROR' });
    }
    if (raw && res.ok) return res;
    const text = await res.text();
    if (!res.ok) {
      const err = toError(res.status, text, res.headers);
      notifyIfUnauthorized(err, { silentAuth });
      throw err;
    }
    const { json, requestId } = parse(res.status, text, res.headers.get('x-request-id'));
    if (json === null) {
      // 2xx but not JSON: never treat as success (this was the "Unexpected end of JSON input" class of bug).
      throw new ApiError('Server returned an unreadable response', { status: res.status, code: text ? 'NON_JSON_RESPONSE' : 'EMPTY_RESPONSE', requestId });
    }
    return json;
  }

  /** Upload with progress (XHR) - same error contract as request(). */
  function upload(url, formData, { onProgress, signal } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onerror = () => reject(new ApiError('Network request failed', { status: 0, code: 'NETWORK_ERROR' }));
      xhr.ontimeout = () => reject(new ApiError('Network request timed out', { status: 0, code: 'NETWORK_ERROR' }));
      xhr.onabort = () => reject(new ApiError('Upload cancelled', { status: 0, code: 'ABORTED' }));
      xhr.onload = () => {
        const headers = { get: (n) => xhr.getResponseHeader(n) };
        const text = xhr.responseText;
        if (xhr.status >= 200 && xhr.status < 300) {
          const { json, requestId } = parse(xhr.status, text, headers.get('x-request-id'));
          if (json === null) return reject(new ApiError('Server returned an unreadable response', { status: xhr.status, code: text ? 'NON_JSON_RESPONSE' : 'EMPTY_RESPONSE', requestId }));
          return resolve(json);
        }
        const err = toError(xhr.status, text, headers);
        notifyIfUnauthorized(err);
        reject(err);
      };
      if (signal) signal.addEventListener('abort', () => xhr.abort());
      xhr.send(formData);
    });
  }

  function qs(params) {
    const p = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p.set(k, v);
    });
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  window.api = {
    ApiError,
    request,
    upload,
    qs,
    get: (url, o) => request('GET', url, o),
    post: (url, body, o) => request('POST', url, { ...o, body }),
    put: (url, body, o) => request('PUT', url, { ...o, body }),
    patch: (url, body, o) => request('PATCH', url, { ...o, body }),
    del: (url, o) => request('DELETE', url, o),
    onUnauthorized: (fn) => listeners.unauthorized.push(fn),
  };
})(window);
