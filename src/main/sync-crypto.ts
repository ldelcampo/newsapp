import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scryptSync } from 'node:crypto'

export interface SyncKeys {
  /** Sent to the server to sign in; it can't decrypt anything with it. */
  authKey: string
  /** Never leaves this computer (stored encrypted by the OS keychain). */
  encKey: Buffer
}

/**
 * Turns email + passphrase into the two keys. Slow on purpose (scrypt), so a stolen server
 * database can't be used to guess passphrases quickly.
 */
export function deriveKeys(email: string, passphrase: string): SyncKeys {
  // The salt keeps the app's old name: changing it would lock every account out of its data.
  const master = scryptSync(passphrase.normalize('NFKC'), `information-hub:${email.trim().toLowerCase()}`, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const part = (info: string): Buffer => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32))
  return { authKey: part('auth').toString('base64'), encKey: part('encrypt') }
}

/** AES-256-GCM; output is base64 of iv | tag | ciphertext. */
export function seal(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')
}

export function open(key: Buffer, sealed: string): string {
  const raw = Buffer.from(sealed, 'base64')
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}
