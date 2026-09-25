import crypto from 'node:crypto';

const LEGACY_PASSWORD_SALT = 'qingyu_salt_2026';
const SCRYPT_VERSION = '1';
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 5;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_MAX_MEMORY_BYTES = 64 * 1024 * 1024;

function deriveScryptKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_BYTES, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELISM,
      maxmem: SCRYPT_MAX_MEMORY_BYTES,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}

function parseScryptHash(encodedHash) {
  if (typeof encodedHash !== 'string') return null;
  const parts = encodedHash.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== SCRYPT_VERSION
    || parts[2] !== String(SCRYPT_COST) || parts[3] !== String(SCRYPT_BLOCK_SIZE)
    || parts[4] !== String(SCRYPT_PARALLELISM)) return null;
  const salt = Buffer.from(parts[5], 'base64url');
  const expectedKey = Buffer.from(parts[6], 'base64url');
  if (salt.length !== SCRYPT_SALT_BYTES || expectedKey.length !== SCRYPT_KEY_BYTES
    || salt.toString('base64url') !== parts[5] || expectedKey.toString('base64url') !== parts[6]) return null;
  return { salt, expectedKey };
}

export function isAdminPasswordHash(encodedHash) {
  return typeof encodedHash === 'string'
    && (/^[a-f0-9]{64}$/i.test(encodedHash) || parseScryptHash(encodedHash) !== null);
}

export async function createAdminPasswordHash(password) {
  if (typeof password !== 'string') throw new TypeError('管理员密码必须是字符串');
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const key = await deriveScryptKey(password, salt);
  return ['scrypt', SCRYPT_VERSION, SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELISM,
    salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyAdminPassword(password, encodedHash) {
  if (typeof password !== 'string' || typeof encodedHash !== 'string') return false;

  if (/^[a-f0-9]{64}$/i.test(encodedHash)) {
    const expected = Buffer.from(encodedHash, 'hex');
    const actual = crypto.createHash('sha256').update(password + LEGACY_PASSWORD_SALT).digest();
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  }

  const parsed = parseScryptHash(encodedHash);
  if (!parsed) return false;
  const actual = await deriveScryptKey(password, parsed.salt);
  return crypto.timingSafeEqual(actual, parsed.expectedKey);
}

export function needsAdminPasswordRehash(encodedHash) {
  return typeof encodedHash === 'string' && /^[a-f0-9]{64}$/i.test(encodedHash);
}
