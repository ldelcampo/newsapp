import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FactCheckProvider } from '../src/main/ai-providers'
import { articleText, FactCheckService } from '../src/main/fact-check-service'
import { SecretStore, type Cipher } from '../src/main/secret-store'
import {
  DEFAULT_FACT_CHECK,
  extractJson,
  gdeltUrl,
  normalizeFactCheck,
  parseClaims,
  parseFactChecks,
  parseGdelt,
  parseVerdicts,
  relatedArticles,
  summarizeCoverage
} from '../src/shared/factcheck'
import type { Article } from '../src/shared/news'
import { normalizeSettings } from '../src/shared/settings'

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'hub-fc-'))

const art = (id: string, sourceId: string, title: string, summary = '', extra: Partial<Article> = {}): Article => ({
  id,
  sourceId,
  sourceName: sourceId.toUpperCase(),
  language: 'en',
  lean: 'center',
  title,
  summary,
  url: `https://${sourceId}.example/${id}`,
  publishedAt: '2026-10-23T10:00:00Z',
  ...extra
})

const story = art('a1', 'bbc', 'Central bank raises interest rates to 5.25% as inflation persists', 'The Bank of England raised rates by a quarter point.')
const pool = [
  story,
  art('b1', 'guardian', 'Bank of England raises interest rates again amid stubborn inflation', '', { lean: 'center-left', publishedAt: '2026-10-23T08:00:00Z' }),
  art('b2', 'guardian', 'Interest rates: what the rise means for you', ''),
  art('c1', 'wsj', 'Central bank lifts interest rates to 5.25%', '', { lean: 'center-right' }),
  art('d1', 'npr', 'Hurricane makes landfall in Florida', ''),
  art('e1', 'bbc', 'Central bank raises interest rates, live updates', '')
]

describe('relatedArticles', () => {
  it('finds the same event at other outlets, one article per outlet, earliest first', () => {
    const r = relatedArticles(story, pool)
    expect(r.map((a) => a.id)).toEqual(['b1', 'c1'])
  })

  it('ignores unrelated stories and the same outlet', () => {
    expect(relatedArticles(pool[4], pool)).toEqual([])
  })

  it('summarizes coverage with leans and first report time', () => {
    const c = summarizeCoverage(story, relatedArticles(story, pool))
    expect(c.outlets).toHaveLength(3)
    expect(c.leans).toEqual({ center: 1, 'center-left': 1, 'center-right': 1 })
    expect(c.firstSeen).toBe('2026-10-23T08:00:00Z')
  })
})

describe('GDELT', () => {
  it('builds a query from the most telling title words', () => {
    const url = gdeltUrl(story)!
    expect(url).toContain('api.gdeltproject.org/api/v2/doc/doc')
    const q = decodeURIComponent(new URL(url).searchParams.get('query')!)
    expect(q).toContain('sourcelang:english')
    expect(q).toContain('inflation')
    expect(q).not.toMatch(/\bthe\b|\bto\b/)
  })

  it('counts distinct publishers and countries', () => {
    const g = parseGdelt({
      articles: [
        { url: 'https://a.com/1', domain: 'a.com', title: 'One', sourcecountry: 'US' },
        { url: 'https://a.com/2', domain: 'a.com', title: 'Two', sourcecountry: 'US' },
        { url: 'https://b.mx/1', domain: 'b.mx', title: 'Tres', sourcecountry: 'Mexico' },
        { url: 'javascript:alert(1)', domain: 'evil' }
      ]
    })
    expect(g).toMatchObject({ publishers: 2, articles: 4, countries: 2 })
    expect(g.sample.map((s) => s.url)).toEqual(['https://a.com/1', 'https://b.mx/1'])
    expect(parseGdelt({})).toMatchObject({ publishers: 0 })
  })
})

describe('Google Fact Check', () => {
  it('flattens claim reviews and keeps only https links', () => {
    const checks = parseFactChecks({
      claims: [
        {
          text: 'Inflation is at a 10-year high',
          claimReview: [
            { publisher: { name: 'FactCheck.org' }, url: 'https://factcheck.org/x', title: 'No', textualRating: 'False' },
            { publisher: { name: 'Bad' }, url: 'http://insecure.example', textualRating: 'True' }
          ]
        }
      ]
    })
    expect(checks).toEqual([{ publisher: 'FactCheck.org', rating: 'False', title: 'No', url: 'https://factcheck.org/x', claim: 'Inflation is at a 10-year high' }])
  })
})

describe('model answers', () => {
  it('reads JSON inside code fences or prose', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Here: {"a":{"b":2}} done')).toEqual({ a: { b: 2 } })
    expect(() => extractJson('no json')).toThrow()
  })

  it('keeps at most six non-empty claims', () => {
    const text = JSON.stringify({ claims: [{ claim: ' Rates rose 0.25 points ', query: 'rates' }, { claim: '' }, ...Array(8).fill({ claim: 'x' })] })
    const c = parseClaims(text)
    expect(c).toHaveLength(6)
    expect(c[0]).toEqual({ claim: 'Rates rose 0.25 points', query: 'rates' })
  })

  it('drops citations the model made up', () => {
    const evidence = { items: [{ title: 'Guardian: rates', url: 'https://guardian.example/b1', text: '' }] }
    const out = parseVerdicts(
      JSON.stringify({
        summary: 'Mostly confirmed.',
        claims: [
          { index: 1, verdict: 'supported', explanation: 'Two outlets agree.', evidence: [1, 'https://made-up.example', 'https://searched.example'] },
          { index: 2, verdict: 'nonsense' }
        ]
      }),
      ['Rates rose', 'Inflation at 10-year high'],
      evidence,
      [[], []],
      [{ title: 'Searched', url: 'https://searched.example' }]
    )
    expect(out.summary).toBe('Mostly confirmed.')
    expect(out.claims[0].sources.map((s) => s.url)).toEqual(['https://guardian.example/b1', 'https://searched.example'])
    expect(out.claims[1].verdict).toBe('unverified')
  })
})

describe('settings', () => {
  it('defaults and cleans fact-check settings', () => {
    expect(normalizeSettings({}).factCheck).toEqual(DEFAULT_FACT_CHECK)
    const fc = normalizeFactCheck({ provider: 'gemini', models: { gemini: ' gemini-x ', openai: 'bad model; rm' }, ollamaUrl: 'http://box:11434/', webSearch: false })
    expect(fc.provider).toBe('gemini')
    expect(fc.models.gemini).toBe('gemini-x')
    expect(fc.models.openai).toBe(DEFAULT_FACT_CHECK.models.openai)
    expect(fc.ollamaUrl).toBe('http://box:11434')
    expect(fc.webSearch).toBe(false)
    expect(normalizeFactCheck({ provider: 'skynet' }).provider).toBe('claude')
  })
})

describe('articleText', () => {
  it('keeps real paragraphs and skips scripts and short captions', () => {
    const html = `<script>var x = "<p>not this one at all, it is inside a script tag and must be skipped</p>"</script>
      <nav><p>Home · World · Business · and a lot of other navigation items here</p></nav>
      <p class="lead">The Bank of England raised interest rates by a quarter point on Thursday, to 5.25&nbsp;%.</p>
      <p>Photo: Reuters</p>
      <param name="x"><p>Governor Andrew Bailey said inflation was <b>still too high</b> and further rises were possible.</p>`
    expect(articleText(html)).toBe(
      'The Bank of England raised interest rates by a quarter point on Thursday, to 5.25 %.\n\nGovernor Andrew Bailey said inflation was still too high and further rises were possible.'
    )
  })
})

describe('SecretStore', () => {
  const cipher: Cipher = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => b.toString().replace(/^enc:/, '')
  }

  it('stores keys encrypted and only says which are set', () => {
    const dir = tempDir()
    const store = new SecretStore(dir, cipher)
    store.set('claude', ' sk-ant-123 ')
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain('sk-ant-123')
    expect(new SecretStore(dir, cipher).get('claude')).toBe('sk-ant-123')
    expect(store.which()).toEqual({ claude: true, openai: false, gemini: false, googleFactCheck: false })
    store.set('claude', '')
    expect(store.get('claude')).toBeNull()
  })

  it('refuses to save when the OS has no keychain', () => {
    const store = new SecretStore(tempDir(), { ...cipher, isEncryptionAvailable: () => false })
    expect(() => store.set('openai', 'sk-1')).toThrow(/keychain/)
  })
})

describe('FactCheckService', () => {
  const gdeltJson = { articles: [{ url: 'https://x.com/1', domain: 'x.com', title: 'X', sourcecountry: 'US' }] }
  const fakeFetch = (calls: string[]) => async (url: string): Promise<Response> => {
    calls.push(url)
    if (url.includes('gdeltproject')) return new Response(JSON.stringify(gdeltJson), { status: 200 })
    if (url.includes('factchecktools'))
      return new Response(JSON.stringify({ claims: [{ text: 'c', claimReview: [{ publisher: { name: 'PolitiFact' }, url: 'https://politifact.com/1', textualRating: 'True' }] }] }), { status: 200 })
    return new Response('<p>The Bank of England raised interest rates by a quarter point to 5.25 percent on Thursday.</p>', {
      status: 200,
      headers: { 'content-type': 'text/html' }
    })
  }

  it('measures coverage without any AI key', async () => {
    const calls: string[] = []
    const svc = new FactCheckService(tempDir(), fakeFetch(calls), () => 0)
    const r = await svc.run({ article: story, pool, settings: DEFAULT_FACT_CHECK, provider: null, googleKey: null })
    expect(r.coverage.outlets).toHaveLength(3)
    expect(r.coverage.gdelt?.publishers).toBe(1)
    expect(r.claims).toEqual([])
    expect(r.problems.join(' ')).toMatch(/key in Settings/)
    expect(calls.every((u) => u.includes('gdeltproject'))).toBe(true)
  })

  it('checks claims, adds published fact-checks and saves the report', async () => {
    const dir = tempDir()
    const prompts: string[] = []
    const provider: FactCheckProvider = {
      ask: async ({ prompt }) => {
        prompts.push(prompt)
        if (prompts.length === 1) return { text: JSON.stringify({ claims: [{ claim: 'Rates rose to 5.25%', query: 'bank of england rates 5.25' }] }), searched: [] }
        return { text: JSON.stringify({ summary: 'Confirmed.', claims: [{ index: 1, verdict: 'supported', explanation: 'Two outlets agree.', evidence: [1] }] }), searched: [] }
      }
    }
    const steps: string[] = []
    const svc = new FactCheckService(dir, fakeFetch([]), () => 0)
    const r = await svc.run({ article: story, pool, settings: { ...DEFAULT_FACT_CHECK, webSearch: false }, provider, googleKey: 'g-key', onStep: (s) => steps.push(s) })
    expect(steps).toEqual(['coverage', 'reading', 'claims', 'fact-checks', 'verdicts'])
    expect(prompts[0]).toContain('quarter point')
    expect(prompts[1]).toContain('PolitiFact rated')
    expect(r.claims[0]).toMatchObject({ verdict: 'supported', sources: [{ url: 'https://guardian.example/b1' }] })
    expect(r.claims[0].factChecks[0].publisher).toBe('PolitiFact')
    expect(r.provider).toBe('claude')
    expect(new FactCheckService(dir).saved(story.id)?.summary).toBe('Confirmed.')
  })
})
