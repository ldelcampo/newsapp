import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JEV_URL, JiraService, jiraSecret, JEV_SECRET } from '../src/main/jira-service'
import { SecretStore } from '../src/main/secrets'
import { cleanSiteUrl, parseIssues, parseJev, plainText, rankTickets, siteKind, type JiraSite, type Ticket } from '../src/shared/jira'
import { normalizeSettings } from '../src/shared/settings'

const site: JiraSite = { id: 's1', url: 'https://acme.atlassian.net', kind: 'cloud', email: 'luis@acme.com', name: 'Luis' }
const now = new Date(2026, 9, 24, 9, 0)

const issue = (key: string, f: Record<string, unknown> = {}): unknown => ({
  key,
  fields: {
    summary: `Do ${key}`,
    status: { name: 'To Do', statusCategory: { key: 'new' } },
    priority: { name: 'Medium', id: '3' },
    duedate: null,
    updated: '2026-10-01T10:00:00.000+0000',
    project: { key: key.split('-')[0], name: `Project ${key.split('-')[0]}` },
    issuetype: { name: 'Task' },
    issuelinks: [],
    ...f
  }
})

const ticket = (key: string, f: Record<string, unknown> = {}, assigned = true): Ticket => parseIssues({ issues: [issue(key, f)] }, site, assigned)[0]

describe('jira sites', () => {
  it('accepts short names and requires https', () => {
    expect(cleanSiteUrl('acme')).toBe('https://acme.atlassian.net')
    expect(cleanSiteUrl('acme.atlassian.net/')).toBe('https://acme.atlassian.net')
    expect(cleanSiteUrl('https://jira.example.com/jira')).toBe('https://jira.example.com/jira')
    expect(cleanSiteUrl('http://jira.example.com')).toBe('')
    expect(siteKind('https://acme.atlassian.net')).toBe('cloud')
    expect(siteKind('https://jira.example.com')).toBe('server')
  })

  it('keeps sites and project weights in settings, but never a token', () => {
    const s = normalizeSettings({ jiraSites: [{ ...site, token: 'secret' }, { id: 'x', url: 'ftp://no' }], projectWeights: { ABC: 'high', bad: 'high', XYZ: 'weird', N: 'normal' } })
    expect(s.jiraSites).toEqual([site])
    expect(s.projectWeights).toEqual({ ABC: 'high' })
    expect(s.ticketRanking).toBe('local')
  })
})

describe('reading jira issues', () => {
  it('reads fields, links and document-format descriptions', () => {
    const t = ticket('ABC-1', {
      priority: { name: 'Highest', id: '1' },
      status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
      duedate: '2026-10-25',
      description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Client is ' }, { type: 'text', text: 'waiting' }] }] },
      issuelinks: [
        { type: { outward: 'blocks' }, outwardIssue: { fields: { status: { statusCategory: { key: 'new' } } } } },
        { type: { outward: 'blocks' }, outwardIssue: { fields: { status: { statusCategory: { key: 'done' } } } } },
        { type: { outward: 'blocks' }, inwardIssue: {} }
      ]
    })
    expect(t).toMatchObject({ key: 'ABC-1', url: 'https://acme.atlassian.net/browse/ABC-1', priorityLevel: 1, statusCategory: 'indeterminate', due: '2026-10-25', blocks: 1, description: 'Client is waiting' })
    expect(ticket('X-1', { priority: { name: 'P1', id: '2' } }).priorityLevel).toBe(2)
    expect(plainText('a'.repeat(20), 10)).toBe('aaaaaaaaaa…')
    expect(() => parseIssues({}, site, true)).toThrow()
  })
})

describe('ranking tickets', () => {
  it('puts overdue and due-today work first, and explains why', () => {
    const r = rankTickets(
      [
        ticket('A-1'),
        ticket('A-2', { duedate: '2026-10-22' }),
        ticket('A-3', { duedate: '2026-10-24', priority: { name: 'High' } }),
        ticket('A-4', { priority: { name: 'Lowest' } })
      ],
      {},
      now
    )
    expect(r.map((t) => t.key)).toEqual(['A-3', 'A-2', 'A-1', 'A-4'])
    expect(r[1].reasons[0]).toBe('Overdue by 2 days')
    expect(r[0].reasons).toContain('Due today')
    expect(r[0].urgency).toBe('now')
    expect(r[3].urgency).toBe('later')
    // Due today is always today, even at low priority.
    expect(rankTickets([ticket('A-5', { duedate: '2026-10-24', priority: { name: 'Lowest' } })], {}, now)[0].urgency).toBe('now')
  })

  it('counts in-progress work, blockers and the user’s project choices', () => {
    const base = [ticket('LOW-1', { priority: { name: 'High' } }), ticket('TOP-1'), ticket('GONE-1', { duedate: '2026-10-20' })]
    const r = rankTickets(base, { TOP: 'high', LOW: 'low', GONE: 'hidden' }, now)
    expect(r.map((t) => t.key)).toEqual(['TOP-1', 'LOW-1'])
    expect(r[0].reasons).toContain('Important project')
    const busy = rankTickets([ticket('A-1', { status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }), ticket('A-2')], {}, now)
    expect(busy[0].key).toBe('A-1')
    expect(busy[0].reasons).toContain('Already started')
  })

  it('ranks watched tickets below the user’s own', () => {
    const r = rankTickets([ticket('W-1', { priority: { name: 'High' } }, false), ticket('M-1')], {}, now)
    expect(r.map((t) => t.key)).toEqual(['M-1', 'W-1'])
    expect(r[1].reasons).toContain('You’re watching')
  })

  it('blends in Jev’s judgement when it is on', () => {
    const [a, b] = [ticket('A-1'), ticket('A-2')]
    const r = rankTickets([a, b], {}, now, { [b.id]: { urgency: 4, waiting: 0.9, confidence: 0.8 } })
    expect(r[0].key).toBe('A-2')
    expect(r[0].reasons).toEqual(expect.arrayContaining(['Jev: today (80%)', 'Someone is waiting on you']))
  })

  it('reads Jev answers', () => {
    const signal = parseJev({ answers: { urgency: { type: 'score', score: 3.2, confidence: 0.9 }, waiting: { type: 'noul', noul: 0.7 } } })
    expect(signal).toEqual({ urgency: 3.2, waiting: 0.7, confidence: 0.9 })
    expect(() => parseJev({ error: 'x' })).toThrow()
  })
})

describe('jira service', () => {
  const plain = { encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() }
  const setup = (respond: (url: string, init: RequestInit) => unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-jira-'))
    const secrets = new SecretStore(dir, plain)
    secrets.set(jiraSecret('s1'), 'tok-123456789')
    const calls: { url: string; init: RequestInit }[] = []
    const fetchFn = async (url: string, init: RequestInit = {}): Promise<Response> => {
      calls.push({ url, init })
      const body = respond(url, init)
      return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200 })
    }
    return { svc: new JiraService(dir, secrets, fetchFn, () => now), secrets, calls }
  }
  const settings = normalizeSettings({ jiraSites: [site] })

  it('fetches assigned and watched tickets from Jira Cloud, pages, and caches for five minutes', async () => {
    const { svc, calls } = setup((_url, init) => {
      const body = JSON.parse(String(init.body))
      if (body.jql.startsWith('watcher')) return { issues: [issue('B-9'), issue('A-1')], isLast: true }
      return body.nextPageToken ? { issues: [issue('A-2')], isLast: true } : { issues: [issue('A-1')], nextPageToken: 'p2', isLast: false }
    })
    const r = await svc.load(settings)
    expect(r.tickets.map((t) => t.key).sort()).toEqual(['A-1', 'A-2', 'B-9'])
    expect(r.tickets.find((t) => t.key === 'B-9')?.assigned).toBe(false)
    expect(r.projects.map((p) => p.key)).toEqual(['A', 'B'])
    expect(calls[0].url).toBe('https://acme.atlassian.net/rest/api/3/search/jql')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe(`Basic ${Buffer.from('luis@acme.com:tok-123456789').toString('base64')}`)
    await svc.load(settings)
    expect(calls).toHaveLength(3)
    await svc.load(settings, true)
    expect(calls).toHaveLength(6)
  })

  it('uses a bearer token and startAt paging on Data Center', async () => {
    const dc = { ...site, url: 'https://jira.example.com', kind: 'server' as const }
    const { svc, calls } = setup((url) => {
      const start = Number(new URL(url).searchParams.get('startAt'))
      return url.includes('watcher') ? { issues: [], total: 0 } : { issues: [issue(`D-${start + 1}`)], total: 2 }
    })
    const r = await svc.load(normalizeSettings({ jiraSites: [dc] }))
    expect(r.tickets).toHaveLength(2)
    expect(calls[0].url).toMatch(/^https:\/\/jira\.example\.com\/rest\/api\/2\/search\?/)
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer tok-123456789')
  })

  it('reports a refused token without failing', async () => {
    const { svc } = setup(() => new Response('{}', { status: 401 }))
    const r = await svc.load(settings)
    expect(r.tickets).toEqual([])
    expect(r.problems[0]).toMatch(/refused the token/)
  })

  it('asks Jev only when it is on, once per ticket version, and falls back when it fails', async () => {
    let jevCalls = 0
    let jevDown = false
    const { svc, secrets } = setup((url, init) => {
      if (url === JEV_URL) {
        jevCalls++
        if (jevDown) return new Response('{}', { status: 503 })
        expect(JSON.parse(String(init.body)).state).toContain('Do A-1')
        return { answers: { urgency: { score: 4, confidence: 1 }, waiting: { noul: 1 } } }
      }
      return JSON.parse(String(init.body)).jql.startsWith('watcher') ? { issues: [], isLast: true } : { issues: [issue('A-1')], isLast: true }
    })
    await svc.load(settings)
    expect(jevCalls).toBe(0)
    const withJev = { ...settings, ticketRanking: 'jev' as const }
    expect((await svc.load(withJev)).problems[0]).toMatch(/no TypeSafe AI key/)
    secrets.set(JEV_SECRET, 'key-1234567890')
    const r = await svc.load(withJev)
    expect(r.ranking).toBe('jev')
    expect(r.tickets[0].reasons[0]).toBe('Jev: today (100%)')
    await svc.load(withJev, true)
    expect(jevCalls).toBe(1)
    jevDown = true
    const fresh = new JiraService(mkdtempSync(join(tmpdir(), 'hub-jira-')), secrets, async (u) => (u === JEV_URL ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ issues: [issue('A-1')], isLast: true }))), () => now)
    const down = await fresh.load(withJev)
    expect(down.ranking).toBe('local')
    expect(down.problems[0]).toMatch(/Jev ranking: TypeSafe AI answered 503/)
    expect(down.tickets).toHaveLength(1)
  })
})
