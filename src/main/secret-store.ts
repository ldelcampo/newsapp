import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SECRET_NAMES, type SecretName } from '../shared/factcheck'

/** The parts of Electron's safeStorage we use, so tests can pass a stand-in. */
export interface Cipher {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * API keys encrypted with the OS keychain (Keychain, DPAPI or libsecret) in secrets.json.
 * Keys never go to the renderer; it only learns which ones are set.
 */
export class SecretStore {
  private readonly file: string

  constructor(dir: string, private readonly cipher: Cipher) {
    this.file = join(dir, 'secrets.json')
  }

  private read(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      return {}
    }
  }

  get(name: SecretName): string | null {
    const enc = this.read()[name]
    if (!enc || !this.cipher.isEncryptionAvailable()) return null
    try {
      return this.cipher.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  /** Saves a key, or removes it when `value` is empty. */
  set(name: SecretName, value: string): void {
    if (!SECRET_NAMES.includes(name)) throw new Error('Unknown key.')
    const all = this.read()
    const v = value.trim()
    if (v) {
      if (!this.cipher.isEncryptionAvailable()) throw new Error('This computer has no keychain the app can use, so the key was not saved.')
      all[name] = this.cipher.encryptString(v).toString('base64')
    } else {
      delete all[name]
    }
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  which(): Record<SecretName, boolean> {
    const all = this.read()
    return Object.fromEntries(SECRET_NAMES.map((n) => [n, Boolean(all[n])])) as Record<SecretName, boolean>
  }
}
