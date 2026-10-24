import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchSource } from '../shared/feed-parser'
import { PoliteFetcher, type FeedState } from '../shared/polite-fetch'
import { DEFAULT_SOURCES, type Article, type Source, type SourceStatus } from '../shared/news'
import { rankArticles } from '../shared/ranking'
import type { Settings } from '../shared/settings'
import type { NewsResult, SourceTest } from '../shared/api'

/**
 * Gets articles from the shared news server plus the user's own sources, and ranks them
 * locally so the server never learns anyone's topics. The last good download is cached
 * on disk so the app still shows news offline.
 */
export class NewsService {
  private readonly cacheFile: string
  /** Statuses from the latest load, for the Settings screen. */
  lastSources: SourceStatus[] = []

  private readonly stateFile: string
  private readonly fetcher: PoliteFetcher
  /** Our own server is cheap to ask, but still no more than once a minute. */
  private serverCache: { at: number; url: string; langs: string; data: { articles: Article[]; statuses: SourceStatus[] } } | null = null

  constructor(dataDir: string) {
    this.cacheFile = join(dataDir, 'news-cache.json')
    this.stateFile = join(dataDir, 'feed-state.json')
    let saved: Record<string, FeedState> = {}
    try {
      saved = JSON.parse(readFileSync(this.stateFile, 'utf8'))
    } catch {
      // First run, or an unreadable file: start fresh.
    }
    this.fetcher = new PoliteFetcher(saved)
  }

  private saveState(): void {
    try {
      writeFileSync(this.stateFile, JSON.stringify(this.fetcher.snapshot()))
    } catch {
      // Losing this only means the next start re-fetches feeds once.
    }
  }

  private readCache(): { fetchedAt: string; articles: Article[] } | null {
    try {
      return JSON.parse(readFileSync(this.cacheFile, 'utf8'))
    } catch {
      return null
    }
  }

  /** Fetches sources in parallel, collecting a readable problem for each one that fails. */
  private async fetchAll(sources: Source[], problems: string[], statuses: SourceStatus[]): Promise<Article[]> {
    const results = await Promise.allSettled(sources.map((s) => this.fetcher.get(s)))
    this.saveState()
    return results.flatMap((r, i) => {
      statuses.push(this.fetcher.status(sources[i]))
      if (r.status === 'fulfilled') return r.value
      problems.push(`${sources[i].name}: ${(r.reason as Error).message}`)
      return []
    })
  }

  private async fromServer(serverUrl: string, languages: string[]): Promise<{ articles: Article[]; statuses: SourceStatus[] }> {
    const langs = languages.join(',')
    const c = this.serverCache
    if (c && c.url === serverUrl && c.langs === langs && Date.now() - c.at < 60_000) return c.data
    const get = async <T>(path: string): Promise<T> => {
      const res = await fetch(`${serverUrl}${path}`, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    }
    const [{ articles }, { sources }] = await Promise.all([
      get<{ articles: Article[] }>(`/api/articles?lang=${languages.join(',')}`),
      get<{ sources: (Source & { status: Omit<SourceStatus, 'id' | 'name'> | null })[] }>('/api/sources').catch(() => ({ sources: [] }))
    ])
    const statuses = (sources ?? [])
      .filter((s) => languages.includes(s.language) && s.status)
      .map((s) => ({ id: s.id, name: s.name, ...s.status! }))
    this.serverCache = { at: Date.now(), url: serverUrl, langs, data: { articles, statuses } }
    return { articles, statuses }
  }

  async load(settings: Settings): Promise<NewsResult> {
    const problems: string[] = []
    const included = DEFAULT_SOURCES.filter((s) => settings.newsLanguages.includes(s.language))

    // The shared server when one is set; otherwise, or when it is down, this computer
    // fetches the included feeds itself, so news works before any server exists.
    let shared: Article[] | null = null
    let sources: SourceStatus[] = []
    let via: NewsResult['via'] = 'this computer'
    if (settings.newsServerUrl) {
      try {
        const fromServer = await this.fromServer(settings.newsServerUrl, settings.newsLanguages)
        shared = fromServer.articles
        sources = fromServer.statuses
        via = 'server'
      } catch (e) {
        problems.push(`The news server at ${settings.newsServerUrl} could not be reached (${(e as Error).message}), so this computer fetched the news itself.`)
      }
    }
    const directProblems: string[] = []
    if (!shared) shared = await this.fetchAll(included, directProblems, sources)
    const own = await this.fetchAll(settings.customSources, problems, sources)

    // A few failing feeds are normal; only report them all when nothing came through.
    if (shared.length === 0) problems.push(...directProblems)
    else if (directProblems.length > 0) problems.push(`${directProblems.length} of ${included.length} sources did not answer: ${directProblems.map((p) => p.split(':')[0]).join(', ')}.`)

    const all = [...shared, ...own]
    let fetchedAt = new Date().toISOString()
    let offline = false
    let articles = all
    if (all.length > 0) {
      try {
        writeFileSync(this.cacheFile, JSON.stringify({ fetchedAt, articles: all }))
      } catch {
        // A failed cache write only costs offline reading.
      }
    } else {
      const cache = this.readCache()
      if (cache) {
        offline = true
        fetchedAt = cache.fetchedAt
        articles = cache.articles
      }
    }

    this.lastSources = sources
    return { fetchedAt, offline, via, problems, sources, articles: rankArticles(articles, settings.topics, settings.newsLanguages) }
  }
}

/** Checks that an address is a working feed before the user saves it. */
export async function testSource(source: Source): Promise<SourceTest> {
  try {
    const articles = await fetchSource(source)
    if (articles.length === 0) return { ok: false, error: 'The feed works but has no articles right now.' }
    return { ok: true, count: articles.length, sample: articles.slice(0, 3).map((a) => a.title) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
