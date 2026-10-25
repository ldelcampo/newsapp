import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addressedIn, isBulk, normalizeDraft, replySubject, type Account, type MailBody, type MailMessage } from '../src/shared/accounts'
import { applySnooze, applyVerdict, describeRule, EMPTY_PREFS, learnedRules, normalizeRules, parseProposedRules, parseReplies, rulesPrompt, senderStats, parseSummary, snoozeUntil, unsubscribeMethod, jevMailState, normalizePrefs, parseJevMail, rankMail, senderLean } from '../src/shared/mail'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import { GoogleConnector, parseGmailBody, parseGmailMessage } from '../src/main/accounts/google'
import { SCOPES } from '../src/main/accounts/google-oauth'
import { rawMessage } from '../src/main/accounts/compose'
import { AccountStore } from '../src/main/accounts/store'
import { bodyParts, parseHeaderLines } from '../src/main/accounts/imap'
import { JEV_URL } from '../src/main/jev'
import { MailService, taskDescription } from '../src/main/mail-service'
import { SecretStore } from '../src/main/secrets'
import type { AccountService } from '../src/main/accounts/service'

const NOW = new Date('2026-10-25T12:00:00Z')
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const msg = (id: string, o: Partial<MailMessage> = {}): MailMessage => ({
  id,
  accountId: 'a',
  from: { name: 'Ana', email: 'ana@client.com' },
  subject: id,
  snippet: '',
  receivedAt: hoursAgo(2),
  unread: true,
  addressed: 'to',
  ...o
})
const account: Account = { id: 'google:42', provider: 'google', email: 'luis@gmail.com', name: 'Luis', mail: true, calendar: true, addedAt: '2026-10-24T00:00:00.000Z' }
const tempDir = (): string => mkdtempSync(join(tmpdir(), 'hub-mail-'))
const plain = { encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() }

describe('mail signals', () => {
  it('finds the address in To or Cc', () => {
    expect(addressedIn('Luis <LUIS@gmail.com>, ana@x.com', '', 'luis@gmail.com')).toBe('to')
    expect(addressedIn('team@x.com', '"Luis" <luis@gmail.com>', 'luis@gmail.com')).toBe('cc')
    expect(addressedIn('team@x.com', '', 'luis@gmail.com')).toBe('none')
    expect(addressedIn('notluis@gmail.com', '', 'luis@gmail.com')).toBe('none')
  })

  it('spots list and bulk mail', () => {
    expect(isBulk({ listUnsubscribe: '<mailto:u@x.com>' })).toBe(true)
    expect(isBulk({ precedence: 'bulk' })).toBe(true)
    expect(isBulk({})).toBe(false)
  })

  it('reads Gmail labels and headers into signals', () => {
    const m = parseGmailMessage(
      {
        id: 'm1',
        threadId: 't1',
        labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS', 'STARRED', 'IMPORTANT'],
        internalDate: '1761300000000',
        payload: { headers: [{ name: 'From', value: 'Shop <deals@shop.com>' }, { name: 'To', value: 'luis@gmail.com' }, { name: 'List-Unsubscribe', value: '<https://shop.com/u>' }] }
      },
      account
    )!
    expect(m).toMatchObject({ addressed: 'to', bulk: true, category: 'promotions', starred: true, providerImportant: true, unsubscribe: '<https://shop.com/u>', threadId: 't1' })
  })

  it('reads a full Gmail message', () => {
    const b64 = (s: string): string => Buffer.from(s).toString('base64url')
    const body = parseGmailBody(
      {
        id: 'm1',
        internalDate: '1761300000000',
        payload: {
          mimeType: 'multipart/mixed',
          headers: [{ name: 'From', value: 'Ana <ana@x.com>' }, { name: 'To', value: 'luis@gmail.com' }, { name: 'Subject', value: 'Budget' }],
          parts: [
            { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('Hola ñ') } }, { mimeType: 'text/html', body: { data: b64('<p>Hola ñ</p>') } }] },
            { mimeType: 'application/pdf', filename: 'q4.pdf', body: { attachmentId: 'x' } }
          ]
        }
      },
      account
    )!
    expect(body).toMatchObject({ id: 'google:42/m1', subject: 'Budget', to: 'luis@gmail.com', text: 'Hola ñ', html: '<p>Hola ñ</p>', attachments: ['q4.pdf'] })
  })

  it('finds the parts of an IMAP message and its list headers', () => {
    const parts = bodyParts({
      type: 'multipart/mixed',
      childNodes: [
        { type: 'multipart/alternative', childNodes: [{ type: 'text/plain', part: '1.1' }, { type: 'text/html', part: '1.2' }] },
        { type: 'application/pdf', part: '2', disposition: 'attachment', dispositionParameters: { filename: 'a.pdf' } }
      ]
    } as never)
    expect(parts).toEqual({ text: '1.1', html: '1.2', attachments: ['a.pdf'] })
    expect(parseHeaderLines('List-Id: Team\r\n <team.x.com>\r\nPrecedence: bulk\r\n')).toEqual({ 'list-id': 'Team <team.x.com>', precedence: 'bulk' })
  })
})

describe('rankMail', () => {
  it('puts a person writing to you above newsletters and old read mail', () => {
    const ranked = rankMail(
      [
        msg('newsletter', { from: { name: 'News', email: 'news@paper.com' }, bulk: true, addressed: 'none' }),
        msg('old', { unread: false, receivedAt: hoursAgo(24 * 9) }),
        msg('question', { subject: 'Can you approve the budget today?' })
      ],
      EMPTY_PREFS,
      NOW
    )
    expect(ranked.map((m) => m.id)).toEqual(['question', 'old', 'newsletter'])
    expect(ranked[0]).toMatchObject({ urgency: 'now' })
    expect(ranked[0].reasons).toContain('Asks you something')
    expect(ranked[2]).toMatchObject({ urgency: 'later' })
  })

  it('treats a no-reply sender as automated', () => {
    const [m] = rankMail([msg('n', { from: { name: '', email: 'no-reply@bank.com' } })], EMPTY_PREFS, NOW)
    expect(m.reasons).toContain('Automated sender')
    expect(m.urgency).not.toBe('now')
  })

  it('learns from verdicts, per message and per sender', () => {
    let prefs = applyVerdict(EMPTY_PREFS, msg('m1', { from: { name: '', email: 'Boss@Work.com' } }), 'important', NOW)
    expect(senderLean(prefs, 'boss@work.com')).toBe(1)
    const ranked = rankMail([msg('m2', { from: { name: '', email: 'boss@work.com' }, addressed: 'cc' })], prefs, NOW)
    expect(ranked[0].reasons).toContain('You mark this sender important')
    // Changing one's mind moves the count rather than adding to it.
    prefs = applyVerdict(prefs, msg('m1', { from: { name: '', email: 'boss@work.com' } }), 'not', NOW)
    expect(prefs.senders['boss@work.com']).toEqual({ important: 0, not: 1 })
    const [m1] = rankMail([msg('m1', { from: { name: '', email: 'boss@work.com' } })], prefs, NOW)
    expect(m1).toMatchObject({ urgency: 'later', verdict: 'not' })
    prefs = applyVerdict(prefs, msg('m1', { from: { name: '', email: 'boss@work.com' } }), null, NOW)
    expect(prefs).toEqual(EMPTY_PREFS)
  })

  it('keeps a message the user marked important in "needs you today"', () => {
    const prefs = applyVerdict(EMPTY_PREFS, msg('m', { bulk: true }), 'important', NOW)
    expect(rankMail([msg('m', { bulk: true, unread: false })], prefs, NOW)[0]).toMatchObject({ urgency: 'now', verdict: 'important' })
  })

  it('drops malformed saved preferences', () => {
    expect(normalizePrefs({ senders: { 'x@y.com': { important: 2 }, nope: { important: 1 } }, messages: { a: { verdict: 'maybe', at: 'x' } } })).toEqual({
      senders: { 'x@y.com': { important: 2, not: 0 } },
      messages: {},
      snoozed: {}
    })
  })

  it('adds Jev’s judgement', () => {
    const plainRank = rankMail([msg('m', { addressed: 'cc' })], EMPTY_PREFS, NOW)[0]
    const withJev = rankMail([msg('m', { addressed: 'cc' })], EMPTY_PREFS, NOW, { m: { urgency: 4, action: 0.9, automated: 0, confidence: 0.8 } })[0]
    expect(withJev.score).toBeGreaterThan(plainRank.score)
    expect(withJev.reasons).toContain('Jev: today (80%)')
  })
})

describe('Jev for mail', () => {
  it('describes a message without its body and reads the answer', () => {
    const prefs = applyVerdict(EMPTY_PREFS, msg('old'), 'important', NOW)
    const state = jevMailState(msg('m', { subject: 'Contract', snippet: 'Please sign' }), prefs, NOW)
    expect(state).toContain('From: Ana <ana@client.com>')
    expect(state).toContain('in To')
    expect(state).toContain('marked mail from this sender as important')
    expect(state).toContain('Preview: Please sign')
    expect(parseJevMail({ answers: { urgency: { score: 3.4, confidence: 0.7 }, action: { noul: 0.8 }, automated: { noul: 0.1 } } })).toEqual({ urgency: 3.4, action: 0.8, automated: 0.1, confidence: 0.7 })
    expect(() => parseJevMail({})).toThrow()
  })
})

describe('MailService', () => {
  const fakeAccounts = (items: MailMessage[], acted: [string, string[], string][] = []): AccountService =>
    ({
      recentMail: async () => ({ items, problems: [] }),
      readOnly: () => ['ro'],
      act: async (a: string, ids: string[], action: string) => void acted.push([a, ids, action])
    }) as unknown as AccountService

  it('ranks with Jev once per message and falls back without a key', async () => {
    const dir = tempDir()
    const secrets = new SecretStore(dir, plain)
    let calls = 0
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
      expect(url).toBe(JEV_URL)
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('jev-latest')
      expect(Object.keys(body.questions)).toEqual(['urgency', 'action', 'automated', 'category'])
      calls++
      return new Response(JSON.stringify({ answers: { urgency: { score: 4, confidence: 0.9 }, action: { noul: 0.9 }, automated: { noul: 0 } } }))
    }
    const items = [msg('a'), msg('b', { bulk: true, unread: false, receivedAt: hoursAgo(200) })]
    const service = new MailService(dir, fakeAccounts(items), secrets, fetchFn, () => NOW)
    const settings = { ...DEFAULT_SETTINGS, mailRanking: 'jev' as const }

    const noKey = await service.load(settings)
    expect(noKey.ranking).toBe('local')
    expect(noKey.problems[0]).toMatch(/no TypeSafe AI key/)

    secrets.set('jev', 'key-1234567890')
    const first = await service.load(settings)
    expect(first.ranking).toBe('jev')
    // Old, read newsletters aren't worth asking about.
    expect(calls).toBe(1)
    await service.load(settings)
    expect(calls).toBe(1)
    // The cache survives a restart.
    await new MailService(dir, fakeAccounts(items), secrets, fetchFn, () => NOW).load(settings)
    expect(calls).toBe(1)
  })

  it('reports Jev failures and keeps the built-in ranking', async () => {
    const dir = tempDir()
    const secrets = new SecretStore(dir, plain)
    secrets.set('jev', 'key-1234567890')
    const service = new MailService(dir, fakeAccounts([msg('a')]), secrets, async () => new Response('', { status: 401 }), () => NOW)
    const r = await service.load({ ...DEFAULT_SETTINGS, mailRanking: 'jev' })
    expect(r.ranking).toBe('local')
    expect(r.problems).toEqual(['Jev ranking: TypeSafe AI refused the API key. Using the built-in ranking for the rest.'])
  })

  it('remembers feedback across restarts', async () => {
    const dir = tempDir()
    const secrets = new SecretStore(dir, plain)
    const items = [msg('a', { from: { name: '', email: 'boss@work.com' } })]
    const service = new MailService(dir, fakeAccounts(items), secrets, fetch, () => NOW)
    await service.load(DEFAULT_SETTINGS)
    service.feedback('a', 'important')
    expect(service.learned()).toBe(1)
    const again = new MailService(dir, fakeAccounts(items), secrets, fetch, () => NOW)
    const r = await again.load(DEFAULT_SETTINGS)
    expect(r.items[0]).toMatchObject({ verdict: 'important', urgency: 'now' })
    again.resetFeedback()
    expect(again.learned()).toBe(0)
    expect(() => again.feedback('missing', 'not')).toThrow(/no longer loaded/)
  })
})

describe('snooze', () => {
  // Wednesday 2026-10-28, 10:00 local time.
  const wed = new Date(2026, 9, 28, 10, 0)
  it('picks sensible times', () => {
    expect(snoozeUntil('later', wed).getTime() - wed.getTime()).toBe(3 * 3_600_000)
    expect(snoozeUntil('evening', wed)).toEqual(new Date(2026, 9, 28, 18, 0))
    expect(snoozeUntil('evening', new Date(2026, 9, 28, 19, 0))).toEqual(new Date(2026, 9, 29, 18, 0))
    expect(snoozeUntil('tomorrow', wed)).toEqual(new Date(2026, 9, 29, 8, 0))
    expect(snoozeUntil('weekend', wed)).toEqual(new Date(2026, 9, 31, 9, 0))
    expect(snoozeUntil('weekend', new Date(2026, 9, 31, 12, 0))).toEqual(new Date(2026, 10, 7, 9, 0))
    expect(snoozeUntil('nextweek', wed)).toEqual(new Date(2026, 10, 2, 8, 0))
    expect(snoozeUntil('nextweek', new Date(2026, 10, 2, 7, 0))).toEqual(new Date(2026, 10, 9, 8, 0))
  })

  it('brings mail back on top when the snooze ends', () => {
    const prefs = applySnooze(EMPTY_PREFS, 'm', new Date(NOW.getTime() - 60_000))
    const [m] = rankMail([msg('m', { bulk: true, unread: false })], prefs, NOW)
    expect(m).toMatchObject({ urgency: 'now' })
    expect(m.reasons[0]).toBe('Back from snooze')
  })
})

describe('MailService actions', () => {
  const fakeAccounts = (items: MailMessage[], acted: [string, string[], string][]): AccountService =>
    ({
      recentMail: async () => ({ items, problems: [] }),
      readOnly: () => [],
      act: async (a: string, ids: string[], action: string) => void acted.push([a, ids, action])
    }) as unknown as AccountService

  it('sends actions to each message’s account and hides snoozed mail', async () => {
    const dir = tempDir()
    const acted: [string, string[], string][] = []
    const items = [msg('a1'), msg('a2'), msg('b1', { accountId: 'b' })]
    const service = new MailService(dir, fakeAccounts(items, acted), new SecretStore(dir, plain), fetch, () => NOW)
    await service.load(DEFAULT_SETTINGS)
    await service.act(['a1', 'b1', 'a2'], 'archive')
    expect(acted).toEqual([
      ['a', ['a1', 'a2'], 'archive'],
      ['b', ['b1'], 'archive']
    ])
    await service.load(DEFAULT_SETTINGS)
    const at = service.snooze('a1', 'tomorrow')
    expect(at! > NOW.toISOString()).toBe(true)
    const r = await service.load(DEFAULT_SETTINGS)
    expect(r.items.map((m) => m.id)).not.toContain('a1')
    expect(r.snoozed.map((m) => m.id)).toEqual(['a1'])
    service.snooze('a1', null)
    expect((await service.load(DEFAULT_SETTINGS)).snoozed).toEqual([])
    await expect(service.act(['gone'], 'read')).rejects.toThrow(/no longer loaded/)
  })
})

describe('writing mail', () => {
  it('checks drafts', () => {
    expect(normalizeDraft({ accountId: 'a', to: 'ana@x.com, "Bob" <bob@y.org>', cc: '', subject: 'Hi\nthere', text: 'Hola' })).toEqual({ accountId: 'a', to: 'ana@x.com, "Bob" <bob@y.org>', cc: '', subject: 'Hi there', text: 'Hola' })
    expect(normalizeDraft({ accountId: 'a', to: 'nope', text: 'x' })).toMatch(/valid address/)
    expect(normalizeDraft({ accountId: 'a', to: 'a@b.co', text: ' ' })).toMatch(/Write something/)
    expect(replySubject('Budget')).toBe('Re: Budget')
    expect(replySubject('RE: Budget')).toBe('RE: Budget')
  })

  it('builds a reply with threading headers', async () => {
    const raw = (await rawMessage(account, { to: 'ana@x.com', cc: '', subject: 'Re: Budget', text: 'Sí', inReplyTo: '<m2@x.com>', references: '<m1@x.com>' })).toString()
    expect(raw).toMatch(/^In-Reply-To: <m2@x.com>/m)
    expect(raw).toMatch(/^References: <m1@x.com> <m2@x.com>/m)
    expect(raw).toMatch(/^From: Luis <luis@gmail.com>/m)
  })

  it('sends through Gmail in the same thread', async () => {
    const dir = tempDir()
    const store = new AccountStore(dir, plain)
    store.put(account)
    store.setSecret(account.id, JSON.stringify({ accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000, scope: `${SCOPES.mail} ${SCOPES.send}` }))
    const sent: { url: string; body: any }[] = []
    const google = new GoogleConnector({
      store,
      client: () => ({ clientId: 'c', clientSecret: 's' }),
      openBrowser: () => {},
      fetchFn: async (url, init) => (sent.push({ url, body: JSON.parse(String(init?.body)) }), new Response('{"id":"x"}'))
    })
    await google.send(account, { to: 'ana@x.com', cc: '', subject: 'Re: B', text: 'ok', threadId: 't1' })
    expect(sent[0].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    expect(sent[0].body.threadId).toBe('t1')
    expect(Buffer.from(sent[0].body.raw, 'base64url').toString()).toMatch(/Subject: Re: B/)
  })
})

describe('AI help and unsubscribe', () => {
  it('reads replies and summaries', () => {
    expect(parseReplies({ replies: [{ label: 'Yes', text: 'Sí, aprobado.' }, { text: '' }, { text: 'Later' }] })).toEqual([
      { label: 'Yes', text: 'Sí, aprobado.' },
      { label: 'Reply', text: 'Later' }
    ])
    expect(parseSummary({ summary: 'Ana needs approval.', asks: ['Approve'], dates: ['5 pm'] })).toEqual({ summary: 'Ana needs approval.', asks: ['Approve'], dates: ['5 pm'] })
    expect(() => parseSummary({})).toThrow()
  })

  it('picks the best way to unsubscribe', () => {
    expect(unsubscribeMethod('<https://x.com/u?a=1>, <mailto:u@x.com>', 'List-Unsubscribe=One-Click')).toEqual({ kind: 'one-click', url: 'https://x.com/u?a=1' })
    expect(unsubscribeMethod('<https://x.com/u>, <mailto:u@x.com?subject=stop>')).toEqual({ kind: 'mail', to: 'u@x.com', subject: 'stop', body: 'unsubscribe' })
    expect(unsubscribeMethod('<https://x.com/u>')).toEqual({ kind: 'link', url: 'https://x.com/u' })
    expect(unsubscribeMethod('<http://x.com/u>')).toBeNull()
  })

  const body = (o: Partial<MailBody> = {}): MailBody => ({
    id: 'a:1',
    accountId: 'a',
    from: { name: 'Ana', email: 'ana@x.com' },
    to: 'luis@x.com',
    cc: '',
    subject: 'Budget',
    receivedAt: NOW.toISOString(),
    html: '<p>Please <b>approve</b></p><p>Thanks</p>',
    text: '',
    attachments: [],
    ...o
  })

  it('asks the user’s AI for replies with the message as text', async () => {
    const dir = tempDir()
    let prompt = ''
    const ai = { ask: async (o: { prompt: string }) => ((prompt = o.prompt), { text: '```json\n{"replies":[{"label":"OK","text":"Approved."}]}\n```', searched: [] }) }
    const accounts = { message: async () => body({ replyTo: 'ana-team@x.com' }) } as unknown as AccountService
    const service = new MailService(dir, accounts, new SecretStore(dir, plain), fetch, () => NOW, () => ai)
    const r = await service.replyIdeas('a', 'a:1', 'Luis')
    expect(r.ideas).toEqual([{ label: 'OK', text: 'Approved.' }])
    expect(r.draft).toEqual({ accountId: 'a', to: 'ana-team@x.com', cc: '', subject: 'Re: Budget', replyTo: 'a:1' })
    expect(prompt).toContain('Please approve')
    expect(prompt).not.toContain('<b>')
    await expect(new MailService(dir, accounts, new SecretStore(dir, plain)).summary('a', 'a:1')).rejects.toThrow(/Fact checking/)
  })

  it('unsubscribes in one click, by email, or hands back the page', async () => {
    const dir = tempDir()
    const sent: unknown[] = []
    let header = { unsubscribe: '<https://x.com/u>', unsubscribePost: 'List-Unsubscribe=One-Click' }
    const accounts = { message: async () => body(header), send: async (d: unknown) => void sent.push(d) } as unknown as AccountService
    const posts: string[] = []
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => (posts.push(`${init?.method} ${url} ${init?.body}`), new Response('ok'))
    const service = new MailService(dir, accounts, new SecretStore(dir, plain), fetchFn, () => NOW)
    expect(await service.unsubscribe('a', 'a:1')).toMatchObject({ done: true })
    expect(posts).toEqual(['POST https://x.com/u List-Unsubscribe=One-Click'])
    header = { unsubscribe: '<mailto:leave@x.com>', unsubscribePost: '' }
    expect(await service.unsubscribe('a', 'a:1')).toMatchObject({ done: true })
    expect(sent).toEqual([{ accountId: 'a', to: 'leave@x.com', cc: '', subject: 'unsubscribe', text: 'unsubscribe' }])
    header = { unsubscribe: '<https://x.com/page>', unsubscribePost: '' }
    expect(await service.unsubscribe('a', 'a:1')).toEqual({ open: 'https://x.com/page' })
  })

  it('describes a task with the email and a link back', () => {
    const d = taskDescription(body(), 'https://mail.google.com/x')
    expect(d).toContain('From Ana <ana@x.com>')
    expect(d).toContain('Please approve')
    expect(d).toContain('Open the email: https://mail.google.com/x')
  })
})

describe('categories and rules', () => {
  it('guesses categories from the message', () => {
    const kinds = rankMail(
      [
        msg('ask', { subject: 'Can you review the contract?' }),
        msg('fyi', { subject: 'Notes from today' }),
        msg('news', { bulk: true, from: { name: 'Medium', email: 'digest@medium.com' } }),
        msg('promo', { category: 'promotions', subject: '50% off this weekend' }),
        msg('receipt', { from: { name: '', email: 'no-reply@airbnb.com' }, subject: 'Your booking receipt' }),
        msg('alert', { from: { name: '', email: 'notifications@github.com' }, subject: 'New sign-in' })
      ],
      EMPTY_PREFS,
      NOW
    )
    expect(Object.fromEntries(kinds.map((m) => [m.id, m.kind]))).toEqual({ ask: 'reply', fyi: 'fyi', news: 'newsletter', promo: 'promotion', receipt: 'receipt', alert: 'notification' })
  })

  it('takes Jev’s category when it is sure', () => {
    const [m] = rankMail([msg('m')], EMPTY_PREFS, NOW, { m: { urgency: 1, action: 0, automated: 1, confidence: 0.9, category: 'receipt', categoryConfidence: 0.8 } })
    expect(m.kind).toBe('receipt')
    expect(parseJevMail({ answers: { urgency: { score: 1 }, category: { choice: 'promotion', confidence: 0.7 } } })).toMatchObject({ category: 'promotion', categoryConfidence: 0.7 })
  })

  it('applies the first matching rule: domains, subjects, hide and important', () => {
    const rules = normalizeRules([
      { id: '1', from: '@Activision.com', importance: 'hide', category: 'promotion', source: 'ai' },
      { id: '2', subject: 'factura', category: 'receipt', source: 'you' },
      { id: '3', from: 'boss@work.com', importance: 'important', source: 'you' },
      { id: 'bad', from: 'not an address', importance: 'hide' }
    ])
    expect(rules).toHaveLength(3)
    const ranked = rankMail(
      [
        msg('cod', { from: { name: '', email: 'callofduty@comms.activision.com' }, bulk: true }),
        msg('inv', { subject: 'Tu Factura de octubre', unread: false, receivedAt: hoursAgo(100) }),
        msg('boss', { from: { name: '', email: 'boss@work.com' }, unread: false, receivedAt: hoursAgo(100) })
      ],
      EMPTY_PREFS,
      NOW,
      {},
      rules
    )
    const by = Object.fromEntries(ranked.map((m) => [m.id, m]))
    expect(by.cod).toMatchObject({ kind: 'promotion', hidden: true, urgency: 'later' })
    expect(by.inv.kind).toBe('receipt')
    expect(by.boss.urgency).not.toBe('later')
    expect(by.boss.reasons[0]).toBe('Your rule: important')
    expect(describeRule(rules[0])).toBe('From @activision.com → Promotions, hidden')
  })

  it('offers rules the user’s marks support', () => {
    let prefs = EMPTY_PREFS
    for (const id of ['a', 'b']) prefs = applyVerdict(prefs, msg(id, { from: { name: '', email: 'promo@shop.com' } }), 'not', NOW)
    prefs = applyVerdict(prefs, msg('c', { from: { name: '', email: 'ana@x.com' } }), 'important', NOW)
    expect(learnedRules(prefs, [])).toMatchObject([{ from: 'promo@shop.com', importance: 'hide', source: 'learned' }])
    expect(learnedRules(prefs, [{ id: 'x', from: 'promo@shop.com', importance: 'normal', source: 'you' }])).toEqual([])
  })

  it('sends the AI only senders and subjects, and keeps new proposals', () => {
    const ranked = rankMail([msg('a', { snippet: 'secret body text' }), msg('b', { from: { name: 'Shop', email: 'deals@shop.com' }, bulk: true })], EMPTY_PREFS, NOW)
    const prompt = rulesPrompt(senderStats(ranked, EMPTY_PREFS), [])
    expect(prompt).toContain('deals@shop.com | Shop | 1')
    expect(prompt).not.toContain('secret body text')
    const existing = normalizeRules([{ id: 'x', from: '@shop.com', importance: 'hide', source: 'you' }])
    expect(parseProposedRules({ rules: [{ from: '@shop.com', importance: 'hide' }, { from: 'ana@client.com', importance: 'important', note: 'Client' }, { from: 'x' }] }, existing, 'ai:')).toEqual([
      { id: 'ai:1', from: 'ana@client.com', importance: 'important', note: 'Client', source: 'ai' }
    ])
  })

  it('proposes rules through the user’s AI', async () => {
    const dir = tempDir()
    const accounts = { recentMail: async () => ({ items: [msg('a')], problems: [] }), readOnly: () => [] } as unknown as AccountService
    const ai = { ask: async () => ({ text: '{"rules":[{"from":"ana@client.com","importance":"important"}]}', searched: [] }) }
    const service = new MailService(dir, accounts, new SecretStore(dir, plain), fetch, () => NOW, () => ai)
    expect(await service.proposeRules(DEFAULT_SETTINGS)).toMatchObject([{ from: 'ana@client.com', importance: 'important', source: 'ai' }])
    const r = await service.load({ ...DEFAULT_SETTINGS, mailRules: normalizeRules([{ id: '1', from: 'ana@client.com', category: 'fyi', source: 'you' }]) })
    expect(r.items[0].kind).toBe('fyi')
  })
})
