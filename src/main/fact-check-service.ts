import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripHtml } from '../shared/feed-parser'
import {
  claimsPrompt,
  factCheckUrl,
  gdeltUrl,
  parseClaims,
  parseFactChecks,
  parseGdelt,
  parseVerdicts,
  PROVIDERS,
  relatedArticles,
  summarizeCoverage,
  SYSTEM_PROMPT,
  verdictPrompt,
  type Coverage,
  type Evidence,
  type FactCheckSettings,
  type FactCheckStep,
  type FactReport,
  type PublishedCheck
} from '../shared/factcheck'
import type { Article } from '../shared/news'
import { USER_AGENT } from '../shared/polite-fetch'
import type { FactCheckProvider } from './ai-providers'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** Readable paragraphs from an article page, without menus, scripts or captions. */
export function articleText(html: string): string {
  const body = html.replace(/<(script|style|noscript|nav|header|footer|aside|figure|form)[\s\S]*?<\/\1>/gi, ' ')
  const paras = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter((p) => p.length > 60)
  return paras.join('\n\n').slice(0, 15000)
}

/** GDELT asks for no more than one request every five seconds. */
const GDELT_GAP_MS = 5_500
/** Saved reports kept on disk, newest first. */
const MAX_REPORTS = 200

export interface RunInput {
  article: Article
  /** Everything currently loaded, to find other outlets covering the story. */
  pool: Article[]
  settings: FactCheckSettings
  provider: FactCheckProvider | null
  googleKey: string | null
  onStep?: (step: FactCheckStep) => void
}

/**
 * Verifies one story: counts the outlets that cover it (the user's sources plus GDELT), then,
 * when an AI provider is set up, has it pick out the checkable claims, looks each one up in
 * Google's Fact Check Tools, and asks for a verdict per claim citing only the evidence given.
 * Reports are saved, so reopening one is instant and costs nothing.
 */
export class FactCheckService {
  private readonly file: string
  private reports: FactReport[]
  private gdeltNext = 0
  private readonly gdeltCache = new Map<string, { at: number; value: NonNullable<Coverage['gdelt']> }>()

  constructor(
    dataDir: string,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
    private readonly now: () => number = Date.now
  ) {
    this.file = join(dataDir, 'fact-reports.json')
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'))
      this.reports = Array.isArray(saved) ? saved : []
    } catch {
      this.reports = []
    }
  }

  saved(articleId: string): FactReport | null {
    return this.reports.find((r) => r.articleId === articleId) ?? null
  }

  private save(report: FactReport): void {
    this.reports = [report, ...this.reports.filter((r) => r.articleId !== report.articleId)].slice(0, MAX_REPORTS)
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.reports))
      renameSync(tmp, this.file)
    } catch {
      // Not saving only means the next open checks again.
    }
  }

  private async getJson(url: string, timeoutMs = 15_000): Promise<unknown> {
    const res = await this.fetchFn(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.text()
    try {
      return JSON.parse(body)
    } catch {
      // GDELT answers plain text when it dislikes a query.
      throw new Error(body.slice(0, 120) || 'not JSON')
    }
  }

  private async gdelt(article: Article): Promise<NonNullable<Coverage['gdelt']>> {
    const url = gdeltUrl(article)
    if (!url) throw new Error('the headline is too short to search for')
    const hit = this.gdeltCache.get(url)
    if (hit && this.now() - hit.at < 30 * 60_000) return hit.value
    const wait = this.gdeltNext - this.now()
    this.gdeltNext = Math.max(this.now(), this.gdeltNext) + GDELT_GAP_MS
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    const value = parseGdelt(await this.getJson(url, 20_000))
    this.gdeltCache.set(url, { at: this.now(), value })
    return value
  }

  private async pageText(url: string): Promise<string> {
    try {
      const res = await this.fetchFn(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.timeout(12_000), redirect: 'follow' })
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return ''
      return articleText(await res.text())
    } catch {
      return ''
    }
  }

  private async publishedChecks(query: string, language: string, key: string): Promise<PublishedCheck[]> {
    return parseFactChecks(await this.getJson(factCheckUrl(query, language, key)))
  }

  async run(input: RunInput): Promise<FactReport> {
    const { article, pool, settings, provider, googleKey, onStep } = input
    const problems: string[] = []

    onStep?.('coverage')
    const related = relatedArticles(article, pool)
    const coverage = summarizeCoverage(article, related)
    try {
      coverage.gdelt = await this.gdelt(article)
    } catch (e) {
      problems.push(`Worldwide coverage from GDELT is missing (${(e as Error).message}).`)
    }

    const report: FactReport = {
      articleId: article.id,
      title: article.title,
      url: article.url,
      createdAt: new Date(this.now()).toISOString(),
      coverage,
      summary: '',
      claims: [],
      problems
    }

    if (!provider) {
      const info = PROVIDERS.find((p) => p.id === settings.provider)
      problems.push(`Add a ${info?.label ?? 'provider'} key in Settings to have the story's claims checked. Coverage needs no key.`)
      return report
    }
    report.provider = settings.provider
    report.model = settings.models[settings.provider]

    onStep?.('reading')
    const ownText = (await this.pageText(article.url)) || article.summary
    const relatedText = await Promise.all(related.slice(0, 6).map(async (a) => ({ a, text: (await this.pageText(a.url)) || a.summary })))

    onStep?.('claims')
    const claims = parseClaims((await provider.ask({ system: SYSTEM_PROMPT, prompt: claimsPrompt(article.title, `${article.summary}\n\n${ownText}`, article.language) })).text)
    if (claims.length === 0) {
      problems.push('The AI found no checkable claims in this story.')
      this.save(report)
      return report
    }

    onStep?.('fact-checks')
    let factChecks: PublishedCheck[][] = claims.map(() => [])
    if (googleKey) {
      try {
        factChecks = await Promise.all(claims.map((c) => this.publishedChecks(c.query, article.language, googleKey)))
      } catch (e) {
        problems.push(`Google Fact Check could not be searched (${(e as Error).message}).`)
      }
    } else {
      problems.push('Add a Google Fact Check key in Settings to also look for published fact-checks.')
    }

    onStep?.('verdicts')
    const evidence: Evidence = {
      items: relatedText.map(({ a, text }) => ({ title: `${a.sourceName}: ${a.title}`, url: a.url, text }))
    }
    const webSearch = settings.webSearch && (PROVIDERS.find((p) => p.id === settings.provider)?.webSearch ?? false)
    const answer = await provider.ask({
      system: SYSTEM_PROMPT,
      prompt: verdictPrompt(article.title, claims.map((c) => c.claim), evidence, factChecks, webSearch),
      webSearch
    })
    const verdicts = parseVerdicts(answer.text, claims.map((c) => c.claim), evidence, factChecks, answer.searched)
    report.summary = verdicts.summary
    report.claims = verdicts.claims
    if (related.length === 0 && !webSearch) problems.push('No other outlet in your sources covers this story yet, so most claims cannot be confirmed.')
    this.save(report)
    return report
  }
}
