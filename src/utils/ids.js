const crypto = require('crypto');

/** Time-sortable unique ID with a readable prefix, e.g. doc_01hxyz... */
function newId(prefix) {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rand = crypto.randomBytes(8).toString('hex');
  return `${prefix}_${ts}${rand}`;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

module.exports = { newId, randomToken, sha256Hex };
