import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { meetingPhase, mergeEvents, mergeMail, normalizeAccount, type Account, type CalendarEvent, type MailMessage } from '../src/shared/accounts'
import { AuthExpiredError, type Connector } from '../src/main/accounts/connector'
import { MicrosoftConnector, type MicrosoftTokens } from '../src/main/accounts/microsoft'
import { AccountService } from '../src/main/accounts/service'
import { AccountStore, type Cipher } from '../src/main/accounts/store'
import { parseEvents, parseMessages } from '../src/shared/microsoft-graph'

// Reversible stand-in for safeStorage.
const cipher: Cipher = {
  encrypt: (s) => Buffer.from(s, 'utf8').reverse(),
  decrypt: (b) => Buffer.from(b).reverse().toString('utf8')
}
const newStore = (): AccountStore => new AccountStore(mkdtempSync(join(tmpdir(), 'hub-acct-')), cipher)

const account = (id: string, patch: Partial<Account> = {}): Account => ({
  id, provider: 'microsoft', email: `${id}@example.com`, name: id, mail: true, calendar: true, addedAt: '2026-10-24T00:00:00.000Z', ...patch
})
const mail = (id: string, receivedAt: string): MailMessage => ({ id, accountId: 'a', from: { name: '', email: '' }, subject: id, snippet: '', receivedAt, unread: false })
const event = (id: string, start: string, end: string): CalendarEvent => ({ id, accountId: 'a', title: id, start, end, allDay: false })

describe('AccountStore', () => {
  it('keeps accounts and encrypted secrets, and removes both', () => {
    const s = newStore()
    s.put(account('one'))
    s.setSecret('one', 'token')
    expect(s.list().map((a) => a.id)).toEqual(['one'])
    expect(s.getSecret('one')).toBe('token')
    s.put(account('one', { calendar: false }))
    expect(s.list()).toHaveLength(1)
    expect(s.get('one')?.calendar).toBe(false)
    s.remove('one')
    expect(s.list()).toEqual([])
    expect(s.getSecret('one')).toBeNull()
  })

  it('drops malformed accounts', () => {
    expect(normalizeAccount({ id: 'x', provider: 'aol' })).toBeNull()
    expect(normalizeAccount({ id: 'x', provider: 'imap' })).toMatchObject({ mail: true, calendar: true })
  })
})

describe('merging', () => {
  it('sorts mail newest first and events by start, dropping finished ones', () => {
    expect(mergeMail([[mail('old', '2026-10-01T00:00:00.000Z')], [mail('new', '2026-10-02T00:00:00.000Z')]], 5).map((m) => m.id)).toEqual(['new', 'old'])
    const now = new Date('2026-10-24T12:00:00.000Z')
    const list = mergeEvents([[event('later', '2026-10-24T15:00:00.000Z', '2026-10-24T16:00:00.000Z'), event('done', '2026-10-24T09:00:00.000Z', '2026-10-24T10:00:00.000Z')], [event('running', '2026-10-24T11:30:00.000Z', '2026-10-24T12:30:00.000Z')]], now)
    expect(list.map((e) => e.id)).toEqual(['running', 'later'])
  })
})

describe('meetingPhase', () => {
  const e = event('m', '2026-10-24T12:00:00.000Z', '2026-10-24T13:00:00.000Z')
  const at = (iso: string): ReturnType<typeof meetingPhase> => meetingPhase(e, new Date(iso))
  it('counts down and fills over the last hour', () => {
    expect(at('2026-10-24T09:00:00.000Z')).toMatchObject({ phase: 'later', minutes: 180, progress: 0 })
    expect(at('2026-10-24T11:30:00.000Z')).toMatchObject({ phase: 'soon', minutes: 30, progress: 0.5 })
    expect(at('2026-10-24T11:55:00.000Z').phase).toBe('imminent')
    expect(at('2026-10-24T12:15:00.000Z')).toMatchObject({ phase: 'now', minutes: 45, progress: 0.25 })
  })
})

describe('Microsoft Graph parsing', () => {
  it('reads inbox messages', () => {
    const [m] = parseMessages(
      { value: [{ id: '1', subject: 'Budget', bodyPreview: 'Hi  Luis,\r\n see', receivedDateTime: '2026-10-24T10:00:00Z', isRead: false, webLink: 'https://outlook.office365.com/x', from: { emailAddress: { name: 'Ana', address: 'ana@corp.com' } } }] },
      'acc'
    )
    expect(m).toEqual({ id: '1', accountId: 'acc', from: { name: 'Ana', email: 'ana@corp.com' }, subject: 'Budget', snippet: 'Hi Luis, see', receivedAt: '2026-10-24T10:00:00.000Z', unread: true, webUrl: 'https://outlook.office365.com/x' })
  })

  it('reads events in UTC, skips cancelled ones and keeps all-day dates', () => {
    const events = parseEvents(
      {
        value: [
          { id: 'a', subject: 'Standup', start: { dateTime: '2026-10-24T15:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-24T15:15:00.0000000', timeZone: 'UTC' }, onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/x' }, location: { displayName: 'Teams' } },
          { id: 'b', subject: 'Gone', isCancelled: true, start: { dateTime: '2026-10-24T16:00:00' }, end: { dateTime: '2026-10-24T17:00:00' } },
          { id: 'c', subject: 'Holiday', isAllDay: true, start: { dateTime: '2026-10-25T00:00:00.0000000' }, end: { dateTime: '2026-10-26T00:00:00.0000000' } }
        ]
      },
      'acc'
    )
    expect(events.map((e) => e.id)).toEqual(['a', 'c'])
    expect(events[0]).toMatchObject({ start: '2026-10-24T15:00:00.000Z', end: '2026-10-24T15:15:00.000Z', joinUrl: 'https://teams.microsoft.com/l/x', location: 'Teams' })
    expect(new Date(events[1].start).getDate()).toBe(25)
    expect(events[1].allDay).toBe(true)
  })

  it('rejects unexpected answers', () => {
    expect(() => parseMessages({ error: {} }, 'a')).toThrow()
  })
})

class FakeTokens implements MicrosoftTokens {
  granted = new Set<string>()
  signIns: string[][] = []
  async signIn(scopes: string[]) {
    this.signIns.push(scopes)
    scopes.forEach((s) => this.granted.add(s))
    return { homeAccountId: 'home.1', username: 'luis@corp.com', name: 'Luis' }
  }
  async token(_id: string, scopes: string[]) {
    if (!scopes.every((s) => this.granted.has(s))) throw new AuthExpiredError()
    return 'tok'
  }
  async forget() {}
}

describe('MicrosoftConnector', () => {
  it('asks only for mail when connecting mail only, and for calendar once it is switched on', async () => {
    const tokens = new FakeTokens()
    const c = new MicrosoftConnector(tokens, async () => new Response('{"value":[]}'))
    const a = await c.add({ calendar: false })
    expect(a).toMatchObject({ id: 'microsoft:home.1', email: 'luis@corp.com', calendar: false })
    expect(tokens.signIns).toEqual([['Mail.Read']])
    await c.reconsent({ ...a, calendar: true })
    expect(tokens.signIns[1]).toEqual(['Mail.Read', 'Calendars.Read'])
    // Switching off and on again needs no new sign-in.
    await c.reconsent({ ...a, calendar: true })
    expect(tokens.signIns).toHaveLength(2)
  })

  it('sends the token and treats 401 as an expired sign-in', async () => {
    const tokens = new FakeTokens()
    const seen: RequestInit[] = []
    let status = 200
    const c = new MicrosoftConnector(tokens, async (_url, init) => (seen.push(init!), new Response('{"value":[]}', { status })))
    const a = await c.add()
    expect(await c.recentMail(a, 10)).toEqual([])
    expect((seen[0].headers as Record<string, string>).authorization).toBe('Bearer tok')
    status = 401
    await expect(c.events(a, '2026-10-24T00:00:00Z', '2026-10-31T00:00:00Z')).rejects.toBeInstanceOf(AuthExpiredError)
  })
})

describe('AccountService', () => {
  const fake = (over: Partial<Connector> = {}): Connector => ({
    provider: 'microsoft',
    add: async () => account('m1'),
    recentMail: async (a) => [{ ...mail('x', '2026-10-24T10:00:00.000Z'), accountId: a.id }],
    events: async () => [],
    ...over
  })

  it('skips accounts with mail switched off and caches answers', async () => {
    let calls = 0
    const svc = new AccountService(newStore(), { microsoft: fake({ recentMail: async () => (calls++, []) }) })
    await svc.add('microsoft')
    await svc.recentMail()
    await svc.recentMail()
    expect(calls).toBe(1)
    await svc.update('m1', { mail: false })
    await svc.recentMail()
    expect(calls).toBe(1)
  })

  it('marks an account for reconnecting when its sign-in expires', async () => {
    const store = newStore()
    const svc = new AccountService(store, { microsoft: fake({ recentMail: async () => { throw new AuthExpiredError() } }) })
    await svc.add('microsoft')
    const feed = await svc.recentMail()
    expect(feed.problems).toHaveLength(1)
    expect(store.get('m1')?.status).toBe('reauth')
  })
})
