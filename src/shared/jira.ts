/** Jira tickets: how sites are described, how search results are read, and how tickets are ranked. */

export interface JiraSite {
  id: string
  /** e.g. https://acme.atlassian.net, or a self-hosted Jira Data Center address. */
  url: string
  /** Cloud signs in with email + API token; Data Center with a personal access token. */
  kind: 'cloud' | 'server'
  /** Cloud only. */
  email: string
  /** Who the token belongs to, from /myself. */
  name: string
  /** Where REST calls go when it isn't `url`: scoped Cloud tokens only work through Atlassian's API gateway. */
  apiUrl?: string
}

/** The gateway address for a Cloud site, which scoped API tokens require. */
export const gatewayUrl = (cloudId: string): string => `https://api.atlassian.com/ex/jira/${cloudId}`
const GATEWAY = /^https:\/\/api\.atlassian\.com\/ex\/jira\/[0-9a-f-]{36}$/

/** How much a project counts when ranking; hidden projects are left out. */
export type ProjectWeight = 'high' | 'normal' | 'low' | 'hidden'
export const PROJECT_WEIGHTS: { value: ProjectWeight; label: string; factor: number }[] = [
  { value: 'high', label: 'Important', factor: 1.5 },
  { value: 'normal', label: 'Normal', factor: 1 },
  { value: 'low', label: 'Less important', factor: 0.6 },
  { value: 'hidden', label: 'Hidden', factor: 0 }
]

export type TicketRanking = 'local' | 'jev'

export interface Ticket {
  /** Site id + key, unique across sites. */
  id: string
  key: string
  siteId: string
  url: string
  summary: string
  /** Plain text, shortened; only used when an AI provider is on. */
  description: string
  type: string
  project: { key: string; name: string }
  status: string
  statusCategory: 'new' | 'indeterminate' | 'done'
  priority: string
  /** 1 (Highest) to 5 (Lowest); 3 when unknown. */
  priorityLevel: number
  /** YYYY-MM-DD */
  due: string | null
  updated: string
  /** Open issues this one blocks. */
  blocks: number
  /** true: assigned to the user; false: only watched. */
  assigned: boolean
  labels: string[]
}

export type Urgency = 'now' | 'soon' | 'later'

export interface RankedTicket extends Ticket {
  score: number
  urgency: Urgency
  /** Short reasons, most important first, e.g. "Overdue by 2 days". */
  reasons: string[]
}

export interface TicketResult {
  fetchedAt: string
  tickets: RankedTicket[]
  projects: { key: string; name: string; count: number }[]
  /** Labels on the user's tickets, most used first. */
  labels: { name: string; count: number }[]
  problems: string[]
  ranking: TicketRanking
}

export const siteKind = (url: string): JiraSite['kind'] => (/^https:\/\/[^/]+\.atlassian\.net$/i.test(url) ? 'cloud' : 'server')

/** https only, except a Jira on this computer. Returns the address without a trailing slash, or ''. */
export function cleanSiteUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '')
  if (/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s?#]*)?$/.test(url)) return url
  // "acme.atlassian.net" or "acme" alone mean Jira Cloud.
  if (/^[a-z0-9-]+\.atlassian\.net$/i.test(url)) return `https://${url.toLowerCase()}`
  if (/^[a-z0-9-]+$/i.test(url)) return `https://${url.toLowerCase()}.atlassian.net`
  return ''
}

export function normalizeSite(raw: unknown): JiraSite | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const url = cleanSiteUrl(str(r.url))
  if (!str(r.id) || !url) return null
  const apiUrl = GATEWAY.test(str(r.apiUrl)) ? str(r.apiUrl) : undefined
  return { id: str(r.id), url, kind: siteKind(url), email: str(r.email), name: str(r.name), ...(apiUrl ? { apiUrl } : {}) }
}

export const FIELDS = ['summary', 'status', 'priority', 'duedate', 'updated', 'project', 'issuetype', 'issuelinks', 'description', 'labels']

export const ASSIGNED_JQL = 'assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC'
export const WATCHING_JQL =
  'watcher = currentUser() AND (assignee != currentUser() OR assignee is EMPTY) AND statusCategory != Done AND updated >= -3d ORDER BY updated DESC'

const PRIORITY_NAMES: Record<string, number> = { highest: 1, blocker: 1, critical: 1, high: 2, major: 2, medium: 3, low: 4, minor: 4, lowest: 5, trivial: 5 }

/** Text out of Atlassian Document Format (Cloud) or a plain string (Data Center). */
export function plainText(v: unknown, max = 1500): string {
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n === 'string') out.push(n)
    else if (Array.isArray(n)) n.forEach(walk)
    else if (n && typeof n === 'object') {
      const o = n as { type?: string; text?: unknown; content?: unknown }
      if (typeof o.text === 'string') out.push(o.text)
      walk(o.content)
      if (o.type === 'paragraph' || o.type === 'heading' || o.type === 'listItem') out.push('\n')
    }
  }
  walk(v)
  const text = out.join('').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** The `issues` array of a Jira search response. */
export function parseIssues(json: unknown, site: JiraSite, assigned: boolean): Ticket[] {
  const issues = (json as { issues?: unknown })?.issues
  if (!Array.isArray(issues)) throw new Error('Unexpected answer from Jira.')
  return issues.flatMap((raw): Ticket[] => {
    const i = raw as { key?: unknown; fields?: Record<string, any> }
    if (typeof i?.key !== 'string' || !i.fields) return []
    const f = i.fields
    const cat = f.status?.statusCategory?.key
    const pName = typeof f.priority?.name === 'string' ? f.priority.name : ''
    const pId = Number(f.priority?.id)
    const blocks = Array.isArray(f.issuelinks)
      ? f.issuelinks.filter((l: any) => l?.type?.outward === 'blocks' && l.outwardIssue && l.outwardIssue.fields?.status?.statusCategory?.key !== 'done').length
      : 0
    return [
      {
        id: `${site.id}:${i.key}`,
        key: i.key,
        siteId: site.id,
        url: `${site.url}/browse/${i.key}`,
        summary: typeof f.summary === 'string' ? f.summary : i.key,
        description: plainText(f.description),
        type: typeof f.issuetype?.name === 'string' ? f.issuetype.name : '',
        project: { key: String(f.project?.key ?? i.key.split('-')[0]), name: String(f.project?.name ?? f.project?.key ?? '') },
        status: typeof f.status?.name === 'string' ? f.status.name : '',
        statusCategory: cat === 'indeterminate' || cat === 'done' ? cat : 'new',
        priority: pName,
        priorityLevel: PRIORITY_NAMES[pName.toLowerCase()] ?? (pId >= 1 && pId <= 5 ? pId : 3),
        due: typeof f.duedate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.duedate) ? f.duedate : null,
        updated: typeof f.updated === 'string' ? f.updated : '',
        blocks,
        assigned,
        labels: Array.isArray(f.labels) ? f.labels.filter((l: unknown): l is string => typeof l === 'string') : []
      }
    ]
  })
}

const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`

/** Extra signal from an AI provider, per ticket. */
export interface AiSignal {
  /** 0 (can wait) to 4 (today). */
  urgency: number
  /** Probability that someone is waiting on the user. */
  waiting: number
  confidence: number
}

const URGENCY_WORDS = ['can wait', 'this month', 'this week', 'tomorrow', 'today']

/**
 * Scores each ticket from what Jira already knows: due date, priority, status, what it blocks
 * and recent activity, scaled by how much its project matters to the user.
 */
export function rankTickets(
  tickets: Ticket[],
  weights: Record<string, ProjectWeight>,
  now = new Date(),
  ai: Record<string, AiSignal> = {}
): RankedTicket[] {
  const today = localDay(now)
  const ranked = tickets.flatMap((t): RankedTicket[] => {
    const weight = PROJECT_WEIGHTS.find((w) => w.value === weights[t.project.key]) ?? PROJECT_WEIGHTS[1]
    if (weight.factor === 0) return []
    const reasons: [number, string][] = []
    let score = [30, 22, 14, 7, 2][t.priorityLevel - 1] ?? 14
    if (t.priorityLevel <= 2) reasons.push([score, `${t.priority || 'High'} priority`])
    if (t.due) {
      const left = daysBetween(today, t.due)
      const [pts, why] =
        left < 0 ? [35, `Overdue by ${plural(-left, 'day')}`]
        : left === 0 ? [30, 'Due today']
        : left === 1 ? [22, 'Due tomorrow']
        : left <= 3 ? [14, `Due in ${left} days`]
        : left <= 7 ? [6, `Due in ${left} days`]
        : [0, '']
      score += pts
      if (why) reasons.push([pts, why])
    }
    if (t.statusCategory === 'indeterminate') {
      score += 10
      reasons.push([10, 'Already started'])
    }
    if (t.blocks > 0) {
      const pts = Math.min(16, t.blocks * 8)
      score += pts
      reasons.push([pts, `Blocks ${plural(t.blocks, 'issue')}`])
    }
    if (t.updated && now.getTime() - Date.parse(t.updated) < 86_400_000) {
      score += 6
      reasons.push([6, 'Updated today'])
    }
    const signal = ai[t.id]
    if (signal) {
      const level = Math.max(0, Math.min(4, Math.round(signal.urgency)))
      score += (signal.urgency * 8 + signal.waiting * 10) * signal.confidence
      reasons.push([signal.urgency * 8, `Jev: ${URGENCY_WORDS[level]} (${Math.round(signal.confidence * 100)}%)`])
      if (signal.waiting >= 0.6) reasons.push([10, 'Someone is waiting on you'])
    }
    if (!t.assigned) {
      score *= 0.5
      reasons.push([0, 'You’re watching'])
    }
    score = Math.round(score * weight.factor)
    if (weight.value === 'high') reasons.push([0, 'Important project'])
    // Anything due today or overdue needs the user today, whatever its score.
    const dueNow = !!t.due && t.due <= today && t.assigned
    const urgency: Urgency = score >= 45 || dueNow ? 'now' : score >= 25 ? 'soon' : 'later'
    return [{ ...t, score, urgency, reasons: reasons.sort((a, b) => b[0] - a[0]).map(([, r]) => r) }]
  })
  return ranked.sort((a, b) => b.score - a.score || (a.due ?? '9').localeCompare(b.due ?? '9') || a.key.localeCompare(b.key))
}

export function projectsOf(tickets: Ticket[]): TicketResult['projects'] {
  const map = new Map<string, { key: string; name: string; count: number }>()
  for (const t of tickets) {
    const p = map.get(t.project.key) ?? { ...t.project, count: 0 }
    p.count++
    map.set(t.project.key, p)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

// ---------- Jev (TypeSafe AI), the optional ranking provider ----------

/** What the app asks Jev about each ticket. */
export const JEV_QUESTIONS = {
  urgency: {
    type: 'score',
    instructions: 'How soon does the person assigned or watching this ticket need to act on it?',
    criteria: ['Can wait weeks', 'This month', 'This week', 'Tomorrow', 'Today']
  },
  waiting: { type: 'noul', instructions: 'Is someone blocked or waiting for a reply from the person this ticket is assigned to?' }
} as const

export function jevState(t: Ticket): string {
  return [
    `${t.key} (${t.type || 'Issue'}) in project ${t.project.name || t.project.key}`,
    `Summary: ${t.summary}`,
    `Status: ${t.status}. Priority: ${t.priority || 'none'}. Due: ${t.due ?? 'none'}. Blocks ${t.blocks} open issues.`,
    t.description ? `Description:\n${t.description}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function parseJev(json: unknown): AiSignal {
  const a = (json as { answers?: Record<string, any> })?.answers
  const score = Number(a?.urgency?.score)
  if (!Number.isFinite(score)) throw new Error('Unexpected answer from Jev.')
  const waiting = Number(a?.waiting?.noul)
  const confidence = Number(a?.urgency?.confidence)
  return {
    urgency: Math.max(0, Math.min(4, score)),
    waiting: Number.isFinite(waiting) ? Math.max(0, Math.min(1, waiting)) : 0,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5
  }
}

export function labelsOf(tickets: Ticket[]): TicketResult['labels'] {
  const map = new Map<string, number>()
  for (const t of tickets) for (const l of t.labels ?? []) map.set(l, (map.get(l) ?? 0) + 1)
  return [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Tickets one dashboard widget shows: all of them, or one project's, or those with one label. */
export function ticketsFor<T extends Ticket>(tickets: T[], f: { project: string; label: string }): T[] {
  return tickets.filter((t) => (!f.project || t.project.key === f.project) && (!f.label || (t.labels ?? []).includes(f.label)))
}
