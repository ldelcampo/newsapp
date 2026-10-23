import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchSource } from '../shared/feed-parser'
import type { Article, Source } from '../shared/news'
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

  async load(settings: Settings): Promise<NewsResult> {
    const problems: string[] = []
    let fromServer: Article[] | null = null
    try {
      const url = `${settings.newsServerUrl}/api/articles?lang=${settings.newsLanguages.join(',')}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fromServer = ((await res.json()) as { articles: Article[] }).articles
    } catch (e) {
      problems.push(`The news server at ${settings.newsServerUrl} could not be reached (${(e as Error).message}).`)
    }

    const own = await Promise.allSettled(settings.customSources.map((s) => fetchSource(s)))
    const ownArticles = own.flatMap((r, i) => {
      if (r.status === 'fulfilled') return r.value
      problems.push(`${settings.customSources[i].name}: ${(r.reason as Error).message}`)
      return []
    })

    let fetchedAt = new Date().toISOString()
    let offline = false
    let all: Article[]
    if (fromServer) {
      all = [...fromServer, ...ownArticles]
      try {
        writeFileSync(this.cacheFile, JSON.stringify({ fetchedAt, articles: all }))
      } catch {
        // A failed cache write only costs offline reading.
      }
    } else {
      const cache = this.readCache()
      offline = true
      fetchedAt = cache?.fetchedAt ?? fetchedAt
      all = [...(cache?.articles ?? []), ...ownArticles]
    }

    return { fetchedAt, offline, problems, articles: rankArticles(all, settings.topics, settings.newsLanguages) }
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
