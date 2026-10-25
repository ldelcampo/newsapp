import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addressedIn, isBulk, type Account, type MailMessage } from '../src/shared/accounts'
import { applySnooze, applyVerdict, EMPTY_PREFS, snoozeUntil, jevMailState, normalizePrefs, parseJevMail, rankMail, senderLean } from '../src/shared/mail'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import { parseGmailBody, parseGmailMessage } from '../src/main/accounts/google'
import { bodyParts, parseHeaderLines } from '../src/main/accounts/imap'
import { JEV_URL } from '../src/main/jev'
import { MailService } from '../src/main/mail-service'
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
      expect(Object.keys(body.questions)).toEqual(['urgency', 'action', 'automated'])
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
