import { existsSync, mkdirSync, readFileSync, renameSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { SyncStatus } from '../shared/api'
import type { Settings } from '../shared/settings'
import { mergeDoc, stampChanges, toDoc, type Stamps, type SyncDoc } from '../shared/sync'
import type { SettingsStore } from './settings-store'
import { open, seal } from './sync-crypto'

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Where the shared copy lives: a folder, or the user's account on the news server. */
export interface Remote {
  read(): Promise<{ doc: unknown; version: number } | null>
  /** 'conflict' when another computer wrote first; the caller merges and tries again. */
  write(doc: SyncDoc, version: number): Promise<'ok' | 'conflict'>
  /** How often to look for other computers' changes. */
  pollMs: number
  close(): void
}

export class FolderRemote implements Remote {
  readonly pollMs = 5000
  private readonly file: string

  constructor(
    private readonly folder: string,
    onChange: () => void
  ) {
    this.file = join(folder, 'Information Hub', 'settings-sync.json')
    // Polling copes with iCloud and network folders, where change events are unreliable.
    watchFile(this.file, { interval: this.pollMs }, onChange)
  }

  async read(): Promise<{ doc: unknown; version: number } | null> {
    if (!existsSync(this.folder)) throw new Error('The sync folder is missing. Is iCloud Drive or Dropbox signed in?')
    const doc = readJson(this.file)
    return doc ? { doc, version: 0 } : null
  }

  async write(doc: SyncDoc): Promise<'ok'> {
    mkdirSync(join(this.folder, 'Information Hub'), { recursive: true })
    writeFileSync(`${this.file}.tmp`, JSON.stringify(doc, null, 2))
    renameSync(`${this.file}.tmp`, this.file)
    return 'ok'
  }

  close(): void {
    unwatchFile(this.file)
  }
}

export interface Account {
  server: string
  email: string
  token: string
  encKey: Buffer
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** The account's settings are encrypted here before upload; the server only stores ciphertext. */
export class ServerRemote implements Remote {
  readonly pollMs = 30_000

  constructor(
    private readonly account: Account,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
    private readonly onSignedOut: () => void = () => undefined
  ) {}

  private async call(method: string, body?: unknown): Promise<Response> {
    const res = await this.fetchFn(`${this.account.server}/api/sync`, {
      method,
      headers: { authorization: `Bearer ${this.account.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    })
    if (res.status === 401) {
      this.onSignedOut()
      throw new Error('Your session ended. Sign in again to keep syncing.')
    }
    return res
  }

  async read(): Promise<{ doc: unknown; version: number } | null> {
    const res = await this.call('GET')
    if (!res.ok) throw new Error(`The sync server answered ${res.status}.`)
    const { blob } = (await res.json()) as { blob: { version: number; data: string } | null }
    if (!blob) return null
    try {
      return { doc: JSON.parse(open(this.account.encKey, blob.data)), version: blob.version }
    } catch {
      throw new Error('Your synced data could not be decrypted. Was the passphrase changed on another computer?')
    }
  }

  async write(doc: SyncDoc, version: number): Promise<'ok' | 'conflict'> {
    const res = await this.call('PUT', { version, data: seal(this.account.encKey, JSON.stringify(doc)) })
    if (res.status === 409) return 'conflict'
    if (!res.ok) throw new Error(`The sync server answered ${res.status}.`)
    return 'ok'
  }

  close(): void {}
}

/** The parts of the shared copy that matter; when they match, nothing needs writing. */
const essence = (d: unknown): string => {
  const { values, stamps } = (d ?? {}) as Partial<SyncDoc>
  return JSON.stringify({ values, stamps })
}

/**
 * Keeps settings in step with a shared copy, in a folder or on the server. Each setting
 * carries the time it last changed and the newest change wins, so edits on two computers
 * merge instead of overwriting each other.
 */
export class SettingsSync {
  private readonly stampFile: string
  private stamps: Stamps
  private remote: Remote | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<void> = Promise.resolve()
  private status: SyncStatus = { mode: 'off', folder: '' }

  constructor(
    private readonly store: SettingsStore,
    dir: string,
    private readonly onRemoteChange: (s: Settings) => void,
    private readonly device = hostname().replace(/\.local$/, ''),
    private readonly now = (): string => new Date().toISOString()
  ) {
    this.stampFile = join(dir, 'settings-stamps.json')
    this.stamps = (readJson(this.stampFile) as Stamps) ?? {}
  }

  private saveStamps(): void {
    writeFileSync(this.stampFile, JSON.stringify(this.stamps))
  }

  getStatus(): SyncStatus {
    return this.status
  }

  /** Saves locally, then shares the result. */
  save(next: unknown): Settings {
    const prev = this.store.load()
    const saved = this.store.save(next)
    this.stamps = stampChanges(prev, saved, this.stamps, this.now())
    this.saveStamps()
    void this.sync()
    return saved
  }

  /** Switches where the shared copy lives; `null` stops syncing. */
  use(remote: Remote | null, status: Omit<SyncStatus, 'syncedAt' | 'lastDevice' | 'error'>): Promise<void> {
    this.remote?.close()
    if (this.timer) clearInterval(this.timer)
    this.remote = remote
    this.status = status
    this.timer = remote ? setInterval(() => void this.sync(), remote.pollMs) : null
    return this.sync()
  }

  /** Pulls other computers' changes, then publishes this one's. Runs one at a time. */
  sync(): Promise<void> {
    this.running = this.running.then(() => this.syncOnce()).catch(() => undefined)
    return this.running
  }

  private async syncOnce(): Promise<void> {
    const remote = this.remote
    if (!remote) return
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const got = await remote.read()
        const merged = mergeDoc(this.store.load(), this.stamps, got?.doc ?? null)
        if (merged.changed) {
          this.store.save(merged.settings)
          this.onRemoteChange(this.store.load())
        }
        this.stamps = merged.stamps
        this.saveStamps()
        const doc = toDoc(this.store.load(), this.stamps, this.device, this.now())
        // Rewrite only when something differs, so two computers don't keep waking each other up.
        if (got && essence(got.doc) === essence(doc)) {
          this.status = { ...this.status, syncedAt: this.now(), lastDevice: (got.doc as SyncDoc).device, error: undefined }
          return
        }
        if ((await remote.write(doc, got?.version ?? 0)) === 'ok') {
          this.status = { ...this.status, syncedAt: this.now(), lastDevice: this.device, error: undefined }
          return
        }
      }
      throw new Error('Another computer kept changing settings at the same time. Will try again shortly.')
    } catch (e) {
      this.status = { ...this.status, error: (e as Error).message }
    }
  }

  stop(): void {
    void this.use(null, { mode: 'off', folder: '' })
  }
}
