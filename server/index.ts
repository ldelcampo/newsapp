import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fetchSource } from '../src/shared/feed-parser'
import { DEFAULT_SOURCES, type Article } from '../src/shared/news'

const PORT = Number(process.env.PORT ?? 8787)
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES ?? 15)
/** Articles older than this are dropped. */
const KEEP_HOURS = 72

interface SourceStatus {
  ok: boolean
  count: number
  error?: string
  checkedAt: string
}

let articles: Article[] = []
const status = new Map<string, SourceStatus>()
let lastRefresh: string | null = null

async function refresh(): Promise<void> {
  const cutoff = Date.now() - KEEP_HOURS * 3_600_000
  const results = await Promise.allSettled(DEFAULT_SOURCES.map((s) => fetchSource(s)))
  const fresh: Article[] = []
  results.forEach((r, i) => {
    const source = DEFAULT_SOURCES[i]
    const checkedAt = new Date().toISOString()
    if (r.status === 'fulfilled') {
      fresh.push(...r.value)
      status.set(source.id, { ok: true, count: r.value.length, checkedAt })
    } else {
      status.set(source.id, { ok: false, count: 0, error: String(r.reason?.message ?? r.reason), checkedAt })
      // Keep the last good articles of a source that is briefly down.
      fresh.push(...articles.filter((a) => a.sourceId === source.id))
    }
  })
  articles = fresh.filter((a) => Date.parse(a.publishedAt) >= cutoff).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  lastRefresh = new Date().toISOString()
  const failed = [...status].filter(([, s]) => !s.ok).map(([id]) => id)
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
      return send(res, 200, { sources: DEFAULT_SOURCES.map((s) => ({ ...s, status: status.get(s.id) ?? null })) })
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
