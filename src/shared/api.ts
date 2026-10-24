import type { Source } from './news'
import type { RankedArticle } from './ranking'
import type { Settings } from './settings'

export interface NewsResult {
  /** When these articles were downloaded. */
  fetchedAt: string
  /** True when the server was unreachable and cached articles are shown. */
  offline: boolean
  /** Where the included sources came from. */
  via: 'server' | 'this computer'
  /** Human-readable problems with the server or the user's own sources. */
  problems: string[]
  articles: RankedArticle[]
}

export type SourceTest = { ok: true; count: number; sample: string[] } | { ok: false; error: string }

/** What the preload script exposes to the renderer as `window.hub`. */
export interface HubApi {
  getSettings(): Promise<Settings>
  saveSettings(next: Settings): Promise<Settings>
  appInfo(): Promise<{ version: string; platform: string; dataDir: string }>
  loadNews(): Promise<NewsResult>
  testSource(source: Source): Promise<SourceTest>
  openExternal(url: string): Promise<void>
}
