import { feedUrl, parseFeed, toArticles } from './feed-parser'
import type { Article, Source, SourceStatus } from './news'

/** Never ask one feed more often than this; RSS publishers generally expect 15 minutes or more. */
export const MIN_INTERVAL_MS = 15 * 60_000
/** Longest wait after repeated failures. */
export const MAX_BACKOFF_MS = 6 * 60 * 60_000

export const USER_AGENT = 'InformationHub/0.1 (+https://github.com/ldelcampo/newsapp)'

/** What we remember about one feed between fetches. Serializable, so it survives restarts. */
export interface FeedState {
  etag?: string
  lastModified?: string
  articles: Article[]
  lastAttemptAt?: number
  lastSuccessAt?: number
  failures: number
  /** No request to this feed before this time. */
  nextAllowedAt: number
  lastError?: string
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null
  const secs = Number(header)
  if (Number.isFinite(secs)) return secs * 1000
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

/**
 * Fetches feeds while staying inside publishers' limits: at most once per MIN_INTERVAL_MS per
 * feed however often the user presses Refresh, conditional requests (ETag / Last-Modified) so an
 * unchanged feed costs a 304, Retry-After honoured on 429/503, and exponential backoff on errors.
 * Between allowed fetches the last good articles are served from memory.
 */
export class PoliteFetcher {
  constructor(
    private readonly state: Record<string, FeedState> = {},
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
    private readonly now: () => number = Date.now
  ) {}

  snapshot(): Record<string, FeedState> {
    return this.state
  }

  private stateFor(id: string): FeedState {
    return (this.state[id] ??= { articles: [], failures: 0, nextAllowedAt: 0 })
  }

  status(source: Source): SourceStatus {
    const s = this.stateFor(source.id)
    const ok = s.failures === 0 && s.lastSuccessAt !== undefined
    return {
      id: source.id,
      name: source.name,
      ok,
      count: s.articles.length,
      ...(s.lastError && !ok ? { error: s.lastError } : {}),
      checkedAt: new Date(s.lastAttemptAt ?? 0).toISOString(),
      nextCheckAt: new Date(s.nextAllowedAt).toISOString()
    }
  }

  /** Articles for a source: fresh if it may be asked again, otherwise the cached ones. Throws only when nothing is cached and the fetch fails. */
  async get(source: Source, timeoutMs = 15000): Promise<Article[]> {
    const s = this.stateFor(source.id)
    const now = this.now()
    if (now < s.nextAllowedAt) {
      if (s.articles.length > 0 || s.failures === 0) return s.articles
      throw new Error(s.lastError ?? 'Waiting before trying this source again.')
    }

    s.lastAttemptAt = now
    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
    }
    if (s.etag) headers['if-none-match'] = s.etag
    if (s.lastModified) headers['if-modified-since'] = s.lastModified

    const fail = (message: string, waitMs?: number): never => {
      s.failures += 1
      s.lastError = message
      const backoff = Math.min(MAX_BACKOFF_MS, MIN_INTERVAL_MS * 2 ** (s.failures - 1))
      s.nextAllowedAt = now + Math.max(waitMs ?? 0, backoff)
      throw new Error(message)
    }

    let res: Response
    try {
      res = await this.fetchFn(feedUrl(source), { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
    } catch (e) {
      return fail((e as Error).name === 'TimeoutError' ? 'The address took too long to answer.' : 'Could not connect to that address. Check it and your internet connection.')
    }

    if (res.status === 304) {
      s.failures = 0
      s.lastError = undefined
      s.lastSuccessAt = now
      s.nextAllowedAt = now + MIN_INTERVAL_MS
      return s.articles
    }
    if (res.status === 429 || res.status === 503) {
      return fail(`The source asked us to slow down (HTTP ${res.status}).`, retryAfterMs(res.headers.get('retry-after'), now) ?? undefined)
    }
    if (!res.ok) return fail(`The feed answered with HTTP ${res.status}.`)

    let articles: Article[]
    try {
      articles = toArticles(source, parseFeed(await res.text()), new Date(now))
    } catch (e) {
      return fail((e as Error).message)
    }
    s.articles = articles
    s.etag = res.headers.get('etag') ?? undefined
    s.lastModified = res.headers.get('last-modified') ?? undefined
    s.failures = 0
    s.lastError = undefined
    s.lastSuccessAt = now
    // Respect a longer max-age if the publisher sets one.
    const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')
    s.nextAllowedAt = now + Math.max(MIN_INTERVAL_MS, maxAge ? Number(maxAge[1]) * 1000 : 0)
    return articles
  }
}
