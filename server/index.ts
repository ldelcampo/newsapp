import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DEFAULT_SOURCES, type Article } from '../src/shared/news'
import { PoliteFetcher } from '../src/shared/polite-fetch'

const PORT = Number(process.env.PORT ?? 8787)
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES ?? 15)
/** Articles older than this are dropped. */
const KEEP_HOURS = 72

// Same per-feed limits as the app: 15 minutes minimum, conditional requests, backoff.
const fetcher = new PoliteFetcher()
let articles: Article[] = []
let lastRefresh: string | null = null

async function refresh(): Promise<void> {
  const cutoff = Date.now() - KEEP_HOURS * 3_600_000
  const results = await Promise.allSettled(DEFAULT_SOURCES.map((s) => fetcher.get(s)))
  const fresh: Article[] = []
  results.forEach((r, i) => {
    // Keep the last good articles of a source that is briefly down.
    fresh.push(...(r.status === 'fulfilled' ? r.value : articles.filter((a) => a.sourceId === DEFAULT_SOURCES[i].id)))
  })
  articles = fresh.filter((a) => Date.parse(a.publishedAt) >= cutoff).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  lastRefresh = new Date().toISOString()
  const failed = DEFAULT_SOURCES.filter((s) => !fetcher.status(s).ok).map((s) => s.id)
  console.log(`[${lastRefresh}] ${articles.length} articles from ${DEFAULT_SOURCES.length - failed.length}/${DEFAULT_SOURCES.length} sources${failed.length ? `; failed: ${failed.join(', ')}` : ''}`)
}

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method !== 'GET') return send(res, 405, { error: 'Only GET is supported.' })

  switch (url.pathname) {
    case '/health':
      return send(res, 200, { ok: true, lastRefresh, articles: articles.length })
    case '/api/sources':
      return send(res, 200, {
        sources: DEFAULT_SOURCES.map(({ apiKey: _key, ...s }) => {
          const { id: _id, name: _name, ...status } = fetcher.status(s)
          return { ...s, status: lastRefresh ? status : null }
        })
      })
    case '/api/articles': {
      const langs = url.searchParams.get('lang')?.split(',').filter(Boolean)
      const since = url.searchParams.get('since')
      const list = articles.filter((a) => (!langs || langs.includes(a.language)) && (!since || a.publishedAt > since))
      return send(res, 200, { lastRefresh, articles: list })
    }
    default:
      return send(res, 404, { error: 'Not found.' })
  }
}

if (process.env.NODE_ENV !== 'test') {
  createServer(handle).listen(PORT, () => console.log(`News server listening on :${PORT}`))
  void refresh()
  setInterval(() => void refresh(), REFRESH_MINUTES * 60_000)
}
