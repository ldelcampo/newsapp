import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchSource } from '../shared/feed-parser'
import { DEFAULT_SOURCES, type Article, type Source } from '../shared/news'
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

  constructor(dataDir: string) {
    this.cacheFile = join(dataDir, 'news-cache.json')
  }

  private readCache(): { fetchedAt: string; articles: Article[] } | null {
    try {
      return JSON.parse(readFileSync(this.cacheFile, 'utf8'))
    } catch {
      return null
    }
  }

  /** Fetches sources in parallel, collecting a readable problem for each one that fails. */
  private async fetchAll(sources: Source[], problems: string[]): Promise<Article[]> {
    const results = await Promise.allSettled(sources.map((s) => fetchSource(s)))
    return results.flatMap((r, i) => {
      if (r.status === 'fulfilled') return r.value
      problems.push(`${sources[i].name}: ${(r.reason as Error).message}`)
      return []
    })
  }

  private async fromServer(serverUrl: string, languages: string[]): Promise<Article[]> {
    const res = await fetch(`${serverUrl}/api/articles?lang=${languages.join(',')}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return ((await res.json()) as { articles: Article[] }).articles
  }

  async load(settings: Settings): Promise<NewsResult> {
    const problems: string[] = []
    const included = DEFAULT_SOURCES.filter((s) => settings.newsLanguages.includes(s.language))

    // The shared server when one is set; otherwise, or when it is down, this computer
    // fetches the included feeds itself, so news works before any server exists.
    let shared: Article[] | null = null
    let via: NewsResult['via'] = 'this computer'
    if (settings.newsServerUrl) {
      try {
        shared = await this.fromServer(settings.newsServerUrl, settings.newsLanguages)
        via = 'server'
      } catch (e) {
        problems.push(`The news server at ${settings.newsServerUrl} could not be reached (${(e as Error).message}), so this computer fetched the news itself.`)
      }
    }
    const directProblems: string[] = []
    if (!shared) shared = await this.fetchAll(included, directProblems)
    const own = await this.fetchAll(settings.customSources, problems)

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

    return { fetchedAt, offline, via, problems, articles: rankArticles(articles, settings.topics, settings.newsLanguages) }
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
