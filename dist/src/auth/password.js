const crypto = require('crypto');

const KEYLEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored || '').split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const dk = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return crypto.timingSafeEqual(dk, expected);
  } catch (_) {
    return false;
  }
}

/** Burns comparable CPU time for unknown accounts to avoid user enumeration by timing. */
const DUMMY_HASH = hashPassword('dummy-password-for-timing');
function verifyDummy() {
  verifyPassword('x', DUMMY_HASH);
}

function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Password must be at least 10 characters long.';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, verifyDummy, validatePasswordStrength };
