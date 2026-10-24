import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DEFAULT_SOURCES, type Article } from '../src/shared/news'
import { PoliteFetcher } from '../src/shared/polite-fetch'
import { AccountStore, MAX_BLOB_BYTES, RateLimit } from './accounts'

const PORT = Number(process.env.PORT ?? 8787)
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES ?? 15)
/** Articles older than this are dropped. */
const KEEP_HOURS = 72
const DATA_DIR = process.env.DATA_DIR ?? './data'

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

let accounts: AccountStore | null = null
const store = (): AccountStore => (accounts ??= new AccountStore(DATA_DIR))
const signInLimit = new RateLimit(10, 60_000)
const syncLimit = new RateLimit(120, 60_000)

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BLOB_BYTES + 4096) {
        reject(new Error('Too large.'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        resolve(v && typeof v === 'object' ? v : {})
      } catch {
        reject(new Error('Invalid JSON.'))
      }
    })
    req.on('error', reject)
  })
}

/** Behind nginx the client address comes in X-Real-IP; nginx sets it, clients can't. */
const clientIp = (req: IncomingMessage): string => String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? '')
const bearer = (req: IncomingMessage): string | undefined => /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1]

async function handleAccount(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (path === '/api/account/signup' || path === '/api/account/signin') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' })
    if (!signInLimit.allow(clientIp(req))) return send(res, 429, { error: 'Too many attempts. Wait a minute.' })
    const b = await readBody(req)
    const email = typeof b.email === 'string' ? b.email : ''
    const authKey = typeof b.authKey === 'string' ? b.authKey : ''
    const r = path.endsWith('signup') ? store().signUp(email, authKey) : store().signIn(email, authKey)
    return 'token' in r ? send(res, 200, r) : send(res, path.endsWith('signup') ? 400 : 401, r)
  }
  const token = bearer(req)
  const user = store().userFor(token)
  if (!user) return send(res, 401, { error: 'Please sign in again.' })
  if (!syncLimit.allow(user)) return send(res, 429, { error: 'Too many requests.' })
  if (path === '/api/account/signout' && req.method === 'POST') {
    store().signOut(token!)
    return send(res, 200, { ok: true })
  }
  if (path === '/api/sync' && req.method === 'GET') return send(res, 200, { blob: store().getBlob(user) })
  if (path === '/api/sync' && req.method === 'PUT') {
    const b = await readBody(req)
    const r = store().putBlob(user, Number(b.version ?? 0), b.data as string)
    if ('error' in r) return send(res, 413, r)
    return 'conflict' in r ? send(res, 409, { blob: r.conflict }) : send(res, 200, { blob: r.blob })
  }
  return send(res, 404, { error: 'Not found.' })
}

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api/account/') || url.pathname === '/api/sync') {
    handleAccount(req, res, url.pathname).catch((e: Error) => send(res, 400, { error: e.message }))
    return
  }
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
