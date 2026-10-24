import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Source } from '../src/shared/news'
import { MAX_BACKOFF_MS, MIN_INTERVAL_MS, PoliteFetcher, type FetchFn } from '../src/shared/polite-fetch'

const rss = readFileSync(join(__dirname, 'fixtures', 'rss2.xml'), 'utf8')
const source: Source = { id: 'ex', name: 'Example', url: 'https://example.com/rss', language: 'es', region: 'MX', lean: 'center' }

function setup(responses: (() => Response)[]): { fetcher: PoliteFetcher; calls: RequestInit[]; clock: { t: number } } {
  const calls: RequestInit[] = []
  const clock = { t: Date.parse('2026-10-24T00:00:00Z') }
  const fetchFn: FetchFn = async (_u, init) => {
    calls.push(init)
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return next()
  }
  return { fetcher: new PoliteFetcher({}, fetchFn, () => clock.t), calls, clock }
}

const ok = (headers: Record<string, string> = {}): (() => Response) => () => new Response(rss, { status: 200, headers })

describe('PoliteFetcher', () => {
  it('asks a feed at most once per interval however often Refresh is pressed', async () => {
    const { fetcher, calls, clock } = setup([ok(), ok()])
    expect((await fetcher.get(source)).length).toBe(2)
    clock.t += 60_000
    await fetcher.get(source)
    await fetcher.get(source)
    expect(calls).toHaveLength(1)
    clock.t += MIN_INTERVAL_MS
    await fetcher.get(source)
    expect(calls).toHaveLength(2)
  })

  it('sends ETag and Last-Modified back and keeps articles on 304', async () => {
    const { fetcher, calls, clock } = setup([ok({ etag: '"v1"', 'last-modified': 'Thu, 23 Oct 2026 18:00:00 GMT' }), () => new Response(null, { status: 304 })])
    await fetcher.get(source)
    clock.t += MIN_INTERVAL_MS
    const again = await fetcher.get(source)
    expect(again.length).toBe(2)
    expect(calls[1].headers).toMatchObject({ 'if-none-match': '"v1"', 'if-modified-since': 'Thu, 23 Oct 2026 18:00:00 GMT' })
    expect(fetcher.status(source).ok).toBe(true)
  })

  it('honours Retry-After on 429 and keeps serving cached stories', async () => {
    const { fetcher, calls, clock } = setup([ok(), () => new Response('slow down', { status: 429, headers: { 'retry-after': '7200' } })])
    await fetcher.get(source)
    clock.t += MIN_INTERVAL_MS
    await expect(fetcher.get(source)).rejects.toThrow(/slow down/)
    const st = fetcher.status(source)
    expect(st.ok).toBe(false)
    expect(Date.parse(st.nextCheckAt!) - clock.t).toBe(7200_000)
    clock.t += 3600_000
    expect((await fetcher.get(source)).length).toBe(2)
    expect(calls).toHaveLength(2)
  })

  it('backs off exponentially on errors, capped', async () => {
    const fail = (): Response => new Response('x', { status: 500 })
    const { fetcher, clock } = setup(Array.from({ length: 10 }, () => fail))
    const waits: number[] = []
    for (let i = 0; i < 6; i++) {
      await expect(fetcher.get(source)).rejects.toThrow(/HTTP 500/)
      const wait = Date.parse(fetcher.status(source).nextCheckAt!) - clock.t
      waits.push(wait / 60_000)
      clock.t += wait
    }
    expect(waits).toEqual([15, 30, 60, 120, 240, 360])
    expect(waits.at(-1)! * 60_000).toBe(MAX_BACKOFF_MS)
  })

  it('respects a longer Cache-Control max-age', async () => {
    const { fetcher } = setup([ok({ 'cache-control': 'public, max-age=3600' })])
    await fetcher.get(source)
    const st = fetcher.status(source)
    expect(Date.parse(st.nextCheckAt!) - Date.parse('2026-10-24T00:00:00Z')).toBe(3600_000)
  })
})
