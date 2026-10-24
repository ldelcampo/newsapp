import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** How secrets are protected at rest: Electron's safeStorage (macOS Keychain) in the app. */
export interface Protector {
  encrypt(s: string): Buffer
  decrypt(b: Buffer): string
}

/** Tokens and API keys, encrypted by the OS. They never go into settings.json. */
export class SecretStore {
  private readonly file: string

  constructor(
    dir: string,
    private readonly protector: Protector
  ) {
    this.file = join(dir, 'secrets.bin')
  }

  private all(): Record<string, string> {
    if (!existsSync(this.file)) return {}
    try {
      return JSON.parse(this.protector.decrypt(readFileSync(this.file))) as Record<string, string>
    } catch {
      return {}
    }
  }

  get(name: string): string | undefined {
    return this.all()[name]
  }

  has(name: string): boolean {
    return !!this.get(name)
  }

  set(name: string, value: string | null): void {
    const all = this.all()
    if (value) all[name] = value
    else delete all[name]
    writeFileSync(this.file, this.protector.encrypt(JSON.stringify(all)))
  }
}
