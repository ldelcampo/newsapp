import { existsSync, mkdirSync, readFileSync, renameSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { SyncStatus } from '../shared/api'
import type { Settings } from '../shared/settings'
import { mergeDoc, stampChanges, toDoc, type Stamps, type SyncDoc } from '../shared/sync'
import type { SettingsStore } from './settings-store'


const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Keeps settings in step with a file in a folder the user shares between computers
 * (iCloud Drive, Dropbox, OneDrive…). Each setting carries the time it last changed, and the
 * newest change wins, so edits on two computers merge instead of overwriting each other.
 */
export class SettingsSync {
  private readonly stampFile: string
  private stamps: Stamps
  private watched = ''
  private status: SyncStatus = { folder: '' }

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

  private sharedFile(folder: string): string {
    return join(folder, 'Information Hub', 'settings-sync.json')
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
    this.start(saved.syncFolder)
    return saved
  }

  /** Watches the folder's file, merges it in and writes the merged result back. */
  start(folder: string): void {
    if (folder !== this.watched) {
      if (this.watched) unwatchFile(this.sharedFile(this.watched))
      this.watched = folder
      this.status = { folder }
      // Polling copes with iCloud and network folders, where change events are unreliable.
      if (folder) watchFile(this.sharedFile(folder), { interval: 5000 }, () => this.sync())
    }
    this.sync()
  }

  /** Pulls the other computers' changes, then publishes this one's. */
  sync(): void {
    const folder = this.watched
    if (!folder) return
    const file = this.sharedFile(folder)
    try {
      if (!existsSync(folder)) throw new Error('The sync folder is missing. Is iCloud Drive or Dropbox signed in?')
      const local = this.store.load()
      const remote = readJson(file) as SyncDoc | null
      const merged = mergeDoc(local, this.stamps, remote)
      if (merged.changed) {
        this.store.save(merged.settings)
        this.onRemoteChange(this.store.load())
      }
      this.stamps = merged.stamps
      this.saveStamps()
      const doc = toDoc(this.store.load(), this.stamps, this.device, this.now())
      // Rewrite only when something differs, so two computers don't keep waking each other up.
      const changed = !remote || JSON.stringify({ ...remote, writtenAt: '', device: '' }) !== JSON.stringify({ ...doc, writtenAt: '', device: '' })
      if (changed) {
        mkdirSync(join(folder, 'Information Hub'), { recursive: true })
        writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 2))
        renameSync(`${file}.tmp`, file)
      }
      this.status = { folder, syncedAt: this.now(), lastDevice: changed ? this.device : remote?.device }
    } catch (e) {
      this.status = { folder, error: (e as Error).message }
    }
  }

  stop(): void {
    if (this.watched) unwatchFile(this.sharedFile(this.watched))
    this.watched = ''
  }
}
