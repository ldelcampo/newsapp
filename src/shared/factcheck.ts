import type { Article, Lean } from './news'
import { normalize } from './ranking'

export type ProviderId = 'claude' | 'openai' | 'gemini' | 'ollama'

export interface ProviderInfo {
  id: ProviderId
  label: string
  defaultModel: string
  /** Ollama runs on the user's own computer and needs no key. */
  needsKey: boolean
  /** Where to create a key. */
  keyUrl?: string
  /** The provider can search the web for evidence itself. */
  webSearch: boolean
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'claude', label: 'Claude (Anthropic)', defaultModel: 'claude-opus-5-5', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys', webSearch: true },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-5', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys', webSearch: false },
  { id: 'gemini', label: 'Gemini (Google)', defaultModel: 'gemini-2.5-flash', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey', webSearch: false },
  { id: 'ollama', label: 'Ollama (on this computer)', defaultModel: 'llama3.1', needsKey: false, webSearch: false }
]

/** Secrets kept in the OS keychain, never in settings.json. */
export type SecretName = 'claude' | 'openai' | 'gemini' | 'googleFactCheck'
export const SECRET_NAMES: SecretName[] = ['claude', 'openai', 'gemini', 'googleFactCheck']

export interface FactCheckSettings {
  provider: ProviderId
  /** Model per provider, so switching back keeps the user's choice. */
  models: Record<ProviderId, string>
  ollamaUrl: string
  /** Let providers that can (Claude) search the web for more evidence. */
  webSearch: boolean
}

export const DEFAULT_FACT_CHECK: FactCheckSettings = {
  provider: 'claude',
  models: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.defaultModel])) as Record<ProviderId, string>,
  ollamaUrl: 'http://localhost:11434',
  webSearch: true
}

export function normalizeFactCheck(raw: unknown): FactCheckSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const models = (r.models && typeof r.models === 'object' ? r.models : {}) as Record<string, unknown>
  const url = typeof r.ollamaUrl === 'string' ? r.ollamaUrl.trim().replace(/\/+$/, '') : ''
  return {
    provider: PROVIDERS.some((p) => p.id === r.provider) ? (r.provider as ProviderId) : DEFAULT_FACT_CHECK.provider,
    models: Object.fromEntries(
      PROVIDERS.map((p) => {
        const m = models[p.id]
        return [p.id, typeof m === 'string' && /^[\w.:/-]{1,100}$/.test(m.trim()) ? m.trim() : p.defaultModel]
      })
    ) as Record<ProviderId, string>,
    ollamaUrl: /^https?:\/\/[^\s]+$/.test(url) ? url : DEFAULT_FACT_CHECK.ollamaUrl,
    webSearch: r.webSearch !== false
  }
}

// ---------- Report ----------

export type Verdict = 'supported' | 'disputed' | 'false' | 'unverified'

export const VERDICTS: { value: Verdict; label: string }[] = [
  { value: 'supported', label: 'Supported' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'false', label: 'False' },
  { value: 'unverified', label: 'Unverified' }
]

export interface Link {
  title: string
  url: string
}

/** A published fact-check found by Google's Fact Check Tools API. */
export interface PublishedCheck {
  publisher: string
  rating: string
  title: string
  url: string
  claim: string
}

export interface ClaimCheck {
  claim: string
  verdict: Verdict
  explanation: string
  sources: Link[]
  factChecks: PublishedCheck[]
}

export interface Outlet {
  name: string
  lean: Lean
  title: string
  url: string
  publishedAt: string
}

export interface Coverage {
  /** Distinct outlets among the user's own sources that carry the story, this article's included. */
  outlets: Outlet[]
  leans: Partial<Record<Lean, number>>
  firstSeen: string
  /** Worldwide coverage from GDELT over the last three days, when it answered. */
  gdelt?: { publishers: number; articles: number; countries: number; sample: Link[] }
}

export interface FactReport {
  articleId: string
  title: string
  url: string
  createdAt: string
  /** Missing when no AI provider was set up, so only coverage was measured. */
  provider?: ProviderId
  model?: string
  coverage: Coverage
  summary: string
  claims: ClaimCheck[]
  /** Steps that could not be done, in words for the user. */
  problems: string[]
}

export type FactCheckStep = 'coverage' | 'reading' | 'claims' | 'fact-checks' | 'verdicts'

export const STEP_LABELS: Record<FactCheckStep, string> = {
  coverage: 'Counting publishers that cover the story',
  reading: 'Reading the article',
  claims: 'Picking out the checkable claims',
  'fact-checks': 'Looking for published fact-checks',
  verdicts: 'Weighing the evidence for each claim'
}

// ---------- Related coverage ----------

const STOP = new Set(
  (
    'the a an and or but of to in on at for from by with as is are was were be been has have had it its this that these those ' +
    'after before over under into about than then new says said say will would could can may not no his her their they he she we you ' +
    'el la los las un una unos unas y o pero de del al en con por para como es son fue fueron ser ha han se su sus que lo le les mas ' +
    'tras sobre ante entre sin desde hasta dice dijo nuevo nueva'
  ).split(' ')
)

/** Words that say what a story is about: no stop words, numbers kept, short words dropped. */
export function keywords(text: string): string[] {
  return [...new Set(normalize(text).split(/[^\p{L}\p{N}]+/u).filter((w) => (w.length > 2 || /\d/.test(w)) && !STOP.has(w)))]
}

/**
 * Other articles about the same event: they share enough distinctive title words with this
 * one (or, failing that, title and summary words). One per outlet, earliest first.
 */
export function relatedArticles<T extends Article>(article: T, pool: T[]): T[] {
  const titleWords = new Set(keywords(article.title))
  const allWords = new Set(keywords(`${article.title} ${article.summary}`))
  const score = (other: T): number => {
    const t = keywords(other.title)
    const sharedTitle = t.filter((w) => titleWords.has(w)).length
    const o = new Set(keywords(`${other.title} ${other.summary}`))
    const sharedAll = [...o].filter((w) => allWords.has(w)).length
    const jaccard = sharedAll / Math.max(1, new Set([...o, ...allWords]).size)
    if (sharedTitle >= 3 || (sharedTitle >= 2 && jaccard >= 0.12) || jaccard >= 0.25) return sharedTitle + jaccard
    return 0
  }
  const best = new Map<string, { a: T; s: number }>()
  for (const other of pool) {
    if (other.id === article.id || other.sourceId === article.sourceId) continue
    const s = score(other)
    if (s <= 0) continue
    const prev = best.get(other.sourceId)
    if (!prev || s > prev.s) best.set(other.sourceId, { a: other, s })
  }
  return [...best.values()].map((x) => x.a).sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
}

export function summarizeCoverage(article: Article, related: Article[]): Coverage {
  const all = [article, ...related]
  const leans: Partial<Record<Lean, number>> = {}
  for (const a of all) leans[a.lean] = (leans[a.lean] ?? 0) + 1
  const first = all.reduce((min, a) => (Date.parse(a.publishedAt) < Date.parse(min) ? a.publishedAt : min), article.publishedAt)
  return {
    outlets: all.map((a) => ({ name: a.sourceName, lean: a.lean, title: a.title, url: a.url, publishedAt: a.publishedAt })),
    leans,
    firstSeen: first
  }
}

// ---------- GDELT ----------

const GDELT_LANG: Record<string, string> = { en: 'english', es: 'spanish', fr: 'french', de: 'german', pt: 'portuguese', it: 'italian' }

/** A GDELT DOC 2.0 query for the story: its most distinctive title words, any language. */
export function gdeltUrl(article: Pick<Article, 'title' | 'language'>): string | null {
  // Longer words are usually names and places, the most telling part of a headline.
  const words = keywords(article.title)
    .filter((w) => !/^\d+$/.test(w))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4)
  if (words.length < 2) return null
  const lang = GDELT_LANG[article.language]
  const query = `${words.join(' ')}${lang ? ` sourcelang:${lang}` : ''}`
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=250&timespan=3d&sort=datedesc`
}

export function parseGdelt(json: unknown): NonNullable<Coverage['gdelt']> {
  const list = ((json as { articles?: unknown[] } | null)?.articles ?? []) as Record<string, unknown>[]
  const domains = new Set<string>()
  const countries = new Set<string>()
  const sample: Link[] = []
  for (const a of list) {
    const domain = typeof a.domain === 'string' ? a.domain : ''
    const url = typeof a.url === 'string' ? a.url : ''
    if (!domain || !/^https?:\/\//.test(url)) continue
    if (typeof a.sourcecountry === 'string' && a.sourcecountry) countries.add(a.sourcecountry)
    if (domains.has(domain)) continue
    domains.add(domain)
    if (sample.length < 8) sample.push({ title: `${domain}: ${typeof a.title === 'string' ? a.title : url}`, url })
  }
  return { publishers: domains.size, articles: list.length, countries: countries.size, sample }
}

// ---------- Google Fact Check Tools ----------

export function factCheckUrl(query: string, language: string, key: string): string {
  const q = query.slice(0, 200)
  return `https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(q)}&languageCode=${encodeURIComponent(language)}&pageSize=5&key=${encodeURIComponent(key)}`
}

export function parseFactChecks(json: unknown): PublishedCheck[] {
  const claims = ((json as { claims?: unknown[] } | null)?.claims ?? []) as Record<string, unknown>[]
  return claims.flatMap((c) =>
    ((c.claimReview as Record<string, unknown>[] | undefined) ?? [])
      .filter((r) => typeof r.url === 'string' && /^https:\/\//.test(r.url as string))
      .map((r) => ({
        publisher: String((r.publisher as Record<string, unknown> | undefined)?.name ?? (r.publisher as Record<string, unknown> | undefined)?.site ?? 'Fact-checker'),
        rating: String(r.textualRating ?? ''),
        title: String(r.title ?? c.text ?? ''),
        url: r.url as string,
        claim: String(c.text ?? '')
      }))
  )
}

// ---------- Prompts ----------

export const SYSTEM_PROMPT =
  'You are a careful, politically neutral fact-checker for a news reader app. You only judge claims against the evidence ' +
  'you are given or find, you never invent sources, and you say "unverified" when the evidence does not settle a claim. ' +
  'You always answer with one JSON object and nothing else.'

export interface Evidence {
  /** Numbered list the model cites by index. */
  items: { title: string; url: string; text: string }[]
}

export function claimsPrompt(title: string, text: string, language: string): string {
  return [
    'Pick out the 3 to 6 most important checkable claims in this news article: numbers, dates, quotes, and who did what.',
    'Skip opinions and predictions. Write each claim as one short self-contained sentence, in the article\'s language',
    `(${language}). Also give a short search query for each claim.`,
    'Answer as JSON: {"claims":[{"claim":"...","query":"..."}]}',
    '',
    `Title: ${title}`,
    '',
    text.slice(0, 12000)
  ].join('\n')
}

export function verdictPrompt(title: string, claims: string[], evidence: Evidence, factChecks: PublishedCheck[][], webSearch: boolean): string {
  const ev = evidence.items.map((e, i) => `[${i + 1}] ${e.title}\n${e.url}\n${e.text.slice(0, 2500)}`).join('\n\n')
  const fc = claims
    .map((_, i) => (factChecks[i]?.length ? `Claim ${i + 1}: ${factChecks[i].map((f) => `${f.publisher} rated "${f.claim}" as "${f.rating}" (${f.url})`).join('; ')}` : ''))
    .filter(Boolean)
    .join('\n')
  return [
    `News story: ${title}`,
    '',
    'Claims to check:',
    ...claims.map((c, i) => `${i + 1}. ${c}`),
    '',
    'Evidence (other outlets covering the story):',
    ev || '(none)',
    '',
    fc ? `Published fact-checks:\n${fc}\n` : '',
    webSearch
      ? 'You may search the web for more evidence, preferring primary sources (official statements, data, court records) and outlets of different leanings.'
      : 'Use only the evidence above.',
    '',
    'For each claim give a verdict: "supported" (independent sources confirm it), "disputed" (sources disagree or give different figures),',
    '"false" (reliable evidence contradicts it), or "unverified" (not enough evidence). Explain in one or two sentences in the article\'s language,',
    'and list the evidence numbers or URLs you relied on. Then a one-sentence overall summary.',
    'Answer as JSON: {"summary":"...","claims":[{"index":1,"verdict":"supported","explanation":"...","evidence":[1,"https://..."]}]}'
  ].join('\n')
}

/** The first JSON object in a model's answer, tolerating code fences and stray prose. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The AI answer had no JSON in it.')
  return JSON.parse(body.slice(start, end + 1))
}

export function parseClaims(text: string): { claim: string; query: string }[] {
  const j = extractJson(text) as { claims?: unknown[] }
  return (Array.isArray(j.claims) ? j.claims : [])
    .map((c) => {
      const o = (c && typeof c === 'object' ? c : { claim: c }) as Record<string, unknown>
      const claim = typeof o.claim === 'string' ? o.claim.trim() : ''
      return { claim, query: typeof o.query === 'string' && o.query.trim() ? o.query.trim() : claim }
    })
    .filter((c) => c.claim.length > 0)
    .slice(0, 6)
}

/**
 * Verdicts matched back to the claims. Sources must be evidence we gave (by number or URL) or,
 * when web search was on, pages the provider actually visited; anything else is dropped so a
 * model cannot make up a citation.
 */
export function parseVerdicts(
  text: string,
  claims: string[],
  evidence: Evidence,
  factChecks: PublishedCheck[][],
  searched: Link[]
): { summary: string; claims: ClaimCheck[] } {
  const j = extractJson(text) as { summary?: unknown; claims?: unknown[] }
  const byUrl = new Map<string, Link>([...evidence.items, ...searched].map((e) => [e.url, { title: e.title, url: e.url }]))
  const list = (Array.isArray(j.claims) ? j.claims : []) as Record<string, unknown>[]
  return {
    summary: typeof j.summary === 'string' ? j.summary.trim() : '',
    claims: claims.map((claim, i) => {
      const v = list.find((c) => Number(c.index) === i + 1) ?? list[i] ?? {}
      const verdict = VERDICTS.some((x) => x.value === v.verdict) ? (v.verdict as Verdict) : 'unverified'
      const sources: Link[] = []
      for (const ref of Array.isArray(v.evidence) ? v.evidence : []) {
        const link = typeof ref === 'number' ? evidence.items[ref - 1] : typeof ref === 'string' ? (byUrl.get(ref) ?? (/^\d+$/.test(ref) ? evidence.items[Number(ref) - 1] : undefined)) : undefined
        if (link && !sources.some((s) => s.url === link.url)) sources.push({ title: link.title, url: link.url })
      }
      return {
        claim,
        verdict,
        explanation: typeof v.explanation === 'string' ? v.explanation.trim() : '',
        sources,
        factChecks: factChecks[i] ?? []
      }
    })
  }
}
