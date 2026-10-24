import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ASSIGNED_JQL,
  FIELDS,
  JEV_QUESTIONS,
  jevState,
  parseIssues,
  parseJev,
  projectsOf,
  rankTickets,
  WATCHING_JQL,
  type AiSignal,
  type JiraSite,
  type Ticket,
  type TicketResult
} from '../shared/jira'
import type { Settings } from '../shared/settings'
import { USER_AGENT } from '../shared/polite-fetch'
import type { SecretStore } from './secrets'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const CACHE_MS = 5 * 60_000
/** At most this many tickets per site and query. */
const MAX_TICKETS = 300
/** Jev scores the top tickets only, and only ones it hasn't seen in this state. */
const JEV_TOP = 30
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const jiraSecret = (siteId: string): string => `jira:${siteId}`
export const JEV_SECRET = 'jev'

/**
 * Reads the user's open Jira tickets straight from each site, so tickets never pass through
 * any server of ours. Results are kept for five minutes; Refresh can skip that.
 */
export class JiraService {
  private readonly cache = new Map<string, { at: number; tickets: Ticket[] }>()
  private readonly jevFile: string
  private jevCache: Record<string, AiSignal & { updated: string }>

  constructor(
    dir: string,
    private readonly secrets: SecretStore,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
    private readonly now: () => Date = () => new Date()
  ) {
    this.jevFile = join(dir, 'jev-cache.json')
    try {
      this.jevCache = existsSync(this.jevFile) ? JSON.parse(readFileSync(this.jevFile, 'utf8')) : {}
    } catch {
      this.jevCache = {}
    }
  }

  private headers(site: Pick<JiraSite, 'kind' | 'email'>, token: string): Record<string, string> {
    const auth = site.kind === 'cloud' ? `Basic ${Buffer.from(`${site.email}:${token}`).toString('base64')}` : `Bearer ${token}`
    return { authorization: auth, accept: 'application/json', 'content-type': 'application/json', 'user-agent': USER_AGENT }
  }

  private async call(url: string, init: RequestInit, siteUrl: string): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(20_000) })
    } catch {
      throw new Error(`Could not reach ${siteUrl}.`)
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Jira at ${siteUrl} refused the token. Connect it again in Settings.`)
    if (res.status === 429) throw new Error(`Jira at ${siteUrl} asked us to slow down. Showing the last tickets.`)
    if (!res.ok) throw new Error(`Jira at ${siteUrl} answered ${res.status}.`)
    return res.json()
  }

  /** Checks a token and returns whose it is. */
  async whoAmI(site: Pick<JiraSite, 'url' | 'kind' | 'email'>, token: string): Promise<string> {
    const me = (await this.call(`${site.url}/rest/api/${site.kind === 'cloud' ? 3 : 2}/myself`, { headers: this.headers(site, token) }, site.url)) as {
      displayName?: string
      emailAddress?: string
      name?: string
    }
    return me.displayName ?? me.emailAddress ?? me.name ?? site.email
  }

  private async search(site: JiraSite, token: string, jql: string, max: number): Promise<unknown[]> {
    const issues: unknown[] = []
    const headers = this.headers(site, token)
    if (site.kind === 'cloud') {
      let nextPageToken: string | undefined
      do {
        const page = (await this.call(
          `${site.url}/rest/api/3/search/jql`,
          { method: 'POST', headers, body: JSON.stringify({ jql, fields: FIELDS, maxResults: 100, nextPageToken }) },
          site.url
        )) as { issues?: unknown[]; nextPageToken?: string; isLast?: boolean }
        issues.push(...(page.issues ?? []))
        nextPageToken = page.isLast === false || (page.isLast === undefined && page.nextPageToken) ? page.nextPageToken : undefined
      } while (nextPageToken && issues.length < max)
    } else {
      let total = Infinity
      while (issues.length < Math.min(total, max)) {
        const q = new URLSearchParams({ jql, fields: FIELDS.join(','), maxResults: '100', startAt: String(issues.length) })
        const page = (await this.call(`${site.url}/rest/api/2/search?${q}`, { headers }, site.url)) as { issues?: unknown[]; total?: number }
        if (!page.issues?.length) break
        issues.push(...page.issues)
        total = page.total ?? issues.length
      }
    }
    return issues.slice(0, max)
  }

  private async siteTickets(site: JiraSite, force: boolean): Promise<Ticket[]> {
    const hit = this.cache.get(site.id)
    if (hit && !force && this.now().getTime() - hit.at < CACHE_MS) return hit.tickets
    const token = this.secrets.get(jiraSecret(site.id))
    if (!token) throw new Error(`${site.url} has no token on this computer. Connect it again in Settings.`)
    try {
      const assigned = parseIssues({ issues: await this.search(site, token, ASSIGNED_JQL, MAX_TICKETS) }, site, true)
      const mine = new Set(assigned.map((t) => t.key))
      const watching = parseIssues({ issues: await this.search(site, token, WATCHING_JQL, 50) }, site, false).filter((t) => !mine.has(t.key))
      const tickets = [...assigned, ...watching]
      this.cache.set(site.id, { at: this.now().getTime(), tickets })
      return tickets
    } catch (e) {
      // The last good tickets beat an empty widget; the problem still shows.
      if (hit) throw Object.assign(e as Error, { stale: hit.tickets })
      throw e
    }
  }

  private async jev(tickets: Ticket[], liveIds: Set<string>, key: string, problems: string[]): Promise<Record<string, AiSignal>> {
    const todo = tickets.filter((t) => this.jevCache[t.id]?.updated !== t.updated)
    let failed = ''
    for (let i = 0; i < todo.length && !failed; i += 4) {
      await Promise.all(
        todo.slice(i, i + 4).map(async (t) => {
          try {
            const res = await this.fetchFn(JEV_URL, {
              method: 'POST',
              headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
              body: JSON.stringify({ model: 'jev-latest', state: jevState(t), questions: JEV_QUESTIONS }),
              signal: AbortSignal.timeout(20_000)
            })
            if (res.status === 401) throw new Error('TypeSafe AI refused the API key.')
            if (res.status === 429) throw new Error('TypeSafe AI asked us to slow down.')
            if (!res.ok) throw new Error(`TypeSafe AI answered ${res.status}.`)
            this.jevCache[t.id] = { ...parseJev(await res.json()), updated: t.updated }
          } catch (e) {
            failed ||= (e as Error).name === 'TimeoutError' ? 'TypeSafe AI did not answer in time.' : (e as Error).message
          }
        })
      )
    }
    if (failed) problems.push(`Jev ranking: ${failed} Using the built-in ranking for the rest.`)
    // Forget tickets that are gone, so the file doesn't grow forever.
    for (const id of Object.keys(this.jevCache)) if (!liveIds.has(id)) delete this.jevCache[id]
    writeFileSync(this.jevFile, JSON.stringify(this.jevCache))
    return Object.fromEntries(tickets.flatMap((t) => (this.jevCache[t.id] ? [[t.id, this.jevCache[t.id]]] : [])))
  }

  async load(settings: Settings, force = false): Promise<TicketResult> {
    const problems: string[] = []
    const results = await Promise.all(
      settings.jiraSites.map((s) =>
        this.siteTickets(s, force).catch((e: Error & { stale?: Ticket[] }) => {
          problems.push(e.message)
          return e.stale ?? []
        })
      )
    )
    const tickets = results.flat()
    let ai: Record<string, AiSignal> = {}
    const jevKey = this.secrets.get(JEV_SECRET)
    if (settings.ticketRanking === 'jev' && tickets.length) {
      if (!jevKey) problems.push('Jev ranking is on, but there is no TypeSafe AI key on this computer.')
      else ai = await this.jev(rankTickets(tickets, settings.projectWeights, this.now()).slice(0, JEV_TOP), new Set(tickets.map((t) => t.id)), jevKey, problems)
    }
    return {
      fetchedAt: this.now().toISOString(),
      tickets: rankTickets(tickets, settings.projectWeights, this.now(), ai),
      projects: projectsOf(tickets),
      problems,
      ranking: settings.ticketRanking === 'jev' && Object.keys(ai).length ? 'jev' : 'local'
    }
  }

  forget(siteId: string): void {
    this.cache.delete(siteId)
  }
}
