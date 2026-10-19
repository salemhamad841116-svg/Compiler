// ==============================================================================
// Local engine model downloads (Phase 5). Ollama serves the OpenAI-compatible API
// under /v1 but downloads models through its native /api/pull endpoint. Pulls run
// in the background; progress is kept in memory and shown in System Settings.
// ==============================================================================
const pulls = new Map(); // model -> { model, status, completed, total, startedAt, finishedAt, error }

function nativeBase(localBaseUrl) {
  return String(localBaseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
}

function list() {
  return [...pulls.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 10);
}

/**
 * Starts a background pull. Returns immediately with the tracking record.
 * @param {string} model
 * @param {{baseUrl: string, key?: string|null}} ep
 */
function startPull(model, ep) {
  const current = pulls.get(model);
  if (current && current.status === 'running') return current;
  const rec = { model, status: 'running', completed: 0, total: 0, detail: 'starting', startedAt: new Date().toISOString(), finishedAt: null, error: null };
  pulls.set(model, rec);
  (async () => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (ep.key) headers.Authorization = `Bearer ${ep.key}`;
      const res = await fetch(`${nativeBase(ep.baseUrl)}/api/pull`, { method: 'POST', headers, body: JSON.stringify({ model, stream: true }), signal: AbortSignal.timeout(2 * 60 * 60 * 1000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch (_) { continue; }
          if (msg.error) throw new Error(msg.error);
          rec.detail = String(msg.status || '').slice(0, 80);
          if (msg.total) { rec.total = msg.total; rec.completed = msg.completed || 0; }
        }
      }
      rec.status = 'done';
      console.log(`[LocalAI] model "${model}" downloaded to the local engine`);
    } catch (e) {
      rec.status = 'failed';
      rec.error = String(e.message || e).slice(0, 300);
      console.error(`[LocalAI] pull of "${model}" failed: ${rec.error}`);
    } finally {
      rec.finishedAt = new Date().toISOString();
    }
  })();
  return rec;
}

module.exports = { startPull, list, nativeBase };
