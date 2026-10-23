import type { Settings } from './settings'

/** What the preload script exposes to the renderer as `window.hub`. */
export interface HubApi {
  getSettings(): Promise<Settings>
  saveSettings(next: Settings): Promise<Settings>
  appInfo(): Promise<{ version: string; platform: string; dataDir: string }>
}
