// Single time source so presence/session expiry logic can be exercised deterministically in tests.
let offsetMs = 0;

function nowMs() {
  return Date.now() + offsetMs;
}

function nowIso() {
  return new Date(nowMs()).toISOString();
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

/** Test-only helper: moves the application clock forward/backward. */
function __advance(ms) {
  offsetMs += ms;
}

function __reset() {
  offsetMs = 0;
}

module.exports = { nowMs, nowIso, toIso, __advance, __reset };
