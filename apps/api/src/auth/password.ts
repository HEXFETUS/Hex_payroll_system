import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const N = 131072;
const KEY_LENGTH = 64;
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$v1$${N}$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (
    parts.length !== 7 ||
    parts.slice(0, 5).join('$') !== 'scrypt$v1$131072$8$1' ||
    !/^[a-f0-9]{32}$/.test(parts[5] ?? '') ||
    !/^[a-f0-9]{128}$/.test(parts[6] ?? '')
  )
    return false;
  const key = await derive(password, Buffer.from(parts[5]!, 'hex'));
  return timingSafeEqual(key, Buffer.from(parts[6]!, 'hex'));
}
// Valid encoding ensures unknown accounts incur the same expensive KDF work.
export const DUMMY_PASSWORD_HASH = `scrypt$v1$131072$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;
