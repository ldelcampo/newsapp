import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Account } from './settings-sync'
import { deriveKeys } from './sync-crypto'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** How secrets are protected at rest: Electron's safeStorage (macOS Keychain) in the app. */
export interface Protector {
  encrypt(s: string): Buffer
  decrypt(b: Buffer): string
}

/**
 * The signed-in sync account. The session token and encryption key are stored encrypted by
 * the OS; the passphrase itself is never stored.
 */
export class AccountVault {
  private readonly file: string

  constructor(
    dir: string,
    private readonly protector: Protector,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i)
  ) {
    this.file = join(dir, 'sync-account.bin')
  }

  load(): Account | null {
    if (!existsSync(this.file)) return null
    try {
      const a = JSON.parse(this.protector.decrypt(readFileSync(this.file))) as { server: string; email: string; token: string; encKey: string }
      return { ...a, encKey: Buffer.from(a.encKey, 'base64') }
    } catch {
      return null
    }
  }

  private save(a: Account): void {
    writeFileSync(this.file, this.protector.encrypt(JSON.stringify({ ...a, encKey: a.encKey.toString('base64') })))
  }

  /** Creates the account, or signs in to an existing one, and remembers it on this computer. */
  async signIn(serverRaw: string, email: string, passphrase: string, create: boolean): Promise<Account> {
    const server = serverRaw.trim().replace(/\/+$/, '')
    if (!/^https:\/\//.test(server) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(server)) throw new Error('The server address must start with https://.')
    if (passphrase.length < 10) throw new Error('Use a passphrase of at least 10 characters.')
    const keys = deriveKeys(email, passphrase)
    let res: Response
    try {
      res = await this.fetchFn(`${server}/api/account/${create ? 'signup' : 'signin'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, authKey: keys.authKey }),
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      throw new Error('Could not reach the server. Check the address and your connection.')
    }
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
    if (!res.ok || !body.token) throw new Error(body.error ?? `The server answered ${res.status}.`)
    const account = { server, email: email.trim().toLowerCase(), token: body.token, encKey: keys.encKey }
    this.save(account)
    return account
  }

  async signOut(): Promise<void> {
    const a = this.load()
    rmSync(this.file, { force: true })
    if (a)
      await this.fetchFn(`${a.server}/api/account/signout`, { method: 'POST', headers: { authorization: `Bearer ${a.token}` } }).catch(() => undefined)
  }

  forget(): void {
    rmSync(this.file, { force: true })
  }
}
