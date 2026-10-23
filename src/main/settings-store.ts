import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeSettings, type Settings } from '../shared/settings'

/** Settings kept as JSON in the app's data folder, written atomically. */
export class SettingsStore {
  private readonly file: string

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'settings.json')
  }

  load(): Settings {
    try {
      return normalizeSettings(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      return normalizeSettings({})
    }
  }

  save(next: unknown): Settings {
    const clean = normalizeSettings(next)
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(clean, null, 2))
    renameSync(tmp, this.file)
    return clean
  }
}
