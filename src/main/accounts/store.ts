import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeAccount, type Account } from '../../shared/accounts'

/** Encrypts secrets at rest; in the app this is Electron's safeStorage (Keychain, DPAPI or libsecret). */
export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

function writeAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

/**
 * Account metadata in accounts.json, and each account's secrets (tokens, passwords) in one
 * encrypted secrets.bin, keyed by id. Neither file is part of settings sync.
 */
export class AccountStore {
  private readonly file: string
  private readonly secretsFile: string

  constructor(
    dir: string,
    private readonly cipher: Cipher
  ) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'accounts.json')
    this.secretsFile = join(dir, 'secrets.bin')
  }

  list(): Account[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(raw) ? raw.map(normalizeAccount).filter((a): a is Account => a !== null) : []
    } catch {
      return []
    }
  }

  get(id: string): Account | undefined {
    return this.list().find((a) => a.id === id)
  }

  /** Adds the account, or replaces the one with the same id. */
  put(account: Account): Account {
    const all = this.list()
    const i = all.findIndex((a) => a.id === account.id)
    if (i >= 0) all[i] = account
    else all.push(account)
    writeAtomic(this.file, JSON.stringify(all, null, 2))
    return account
  }

  remove(id: string): void {
    writeAtomic(this.file, JSON.stringify(this.list().filter((a) => a.id !== id), null, 2))
    this.setSecret(id, null)
  }

  private secrets(): Record<string, string> {
    try {
      return JSON.parse(this.cipher.decrypt(readFileSync(this.secretsFile)))
    } catch {
      return {}
    }
  }

  getSecret(id: string): string | null {
    return this.secrets()[id] ?? null
  }

  /** null deletes the secret. */
  setSecret(id: string, value: string | null): void {
    const all = this.secrets()
    if (value === null) delete all[id]
    else all[id] = value
    writeAtomic(this.secretsFile, this.cipher.encrypt(JSON.stringify(all)))
  }
}
