import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Account } from '../src/shared/accounts'
import { AuthExpiredError } from '../src/main/accounts/connector'
import { GoogleConnector, parseAddress, parseGmailMessage, parseGoogleEvent, scopesFor } from '../src/main/accounts/google'
import { authUrl, pkcePair, SCOPES } from '../src/main/accounts/google-oauth'
import { AccountService } from '../src/main/accounts/service'
import { AccountStore } from '../src/main/accounts/store'

const account: Account = { id: 'google:42', provider: 'google', email: 'luis@gmail.com', name: 'Luis', mail: true, calendar: true, addedAt: '2026-10-24T00:00:00.000Z' }
// Reversible stand-in for safeStorage.
const cipher = { encrypt: (s: string) => Buffer.from(s).reverse(), decrypt: (b: Buffer) => Buffer.from(b).reverse().toString() }
const newStore = (): AccountStore => new AccountStore(mkdtempSync(join(tmpdir(), 'hub-')), cipher)
const client = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'shh' }
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ALL = `openid ${SCOPES.mail} ${SCOPES.calendar}`

/** Plays the browser: follows the consent URL straight back to the loopback redirect with a code. */
const fakeBrowser = (code = 'the-code') => (url: string): void => {
  const u = new URL(url)
  const back = new URL(u.searchParams.get('redirect_uri')!)
  back.searchParams.set('code', code)
  back.searchParams.set('state', u.searchParams.get('state')!)
  void fetch(back)
}

/** A tiny fake of Google's token, userinfo, Gmail and Calendar endpoints. */
function fakeGoogle(o: { scope?: string; sub?: string; expireFirstToken?: boolean } = {}) {
  const calls: string[] = []
  let tokenN = 0
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(url.replace(/\?.*/, ''))
    const auth = new Headers(init?.headers).get('authorization')
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const body = new URLSearchParams(String(init?.body))
      tokenN++
      if (body.get('grant_type') === 'authorization_code') {
        expect(body.get('code_verifier')).toBeTruthy()
        expect(body.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
        return json({ access_token: `at${tokenN}`, refresh_token: 'rt', expires_in: 3600, scope: o.scope ?? ALL })
      }
      return json({ access_token: `fresh${tokenN}`, expires_in: 3600 })
    }
    if (url.includes('/userinfo')) return json({ sub: o.sub ?? '42', email: 'luis@gmail.com', name: 'Luis' })
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return json({})
    if (o.expireFirstToken && auth === 'Bearer at1') return json({}, 401)
    if (url.includes('/messages?')) return json({ messages: [{ id: 'm1' }, { id: 'm2' }] })
    if (url.includes('/messages/m1')) return json({ id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Hi', internalDate: '1761300000000', payload: { headers: [{ name: 'From', value: 'Ana <ana@x.com>' }, { name: 'Subject', value: 'Budget' }] } })
    if (url.includes('/messages/m2')) return json({ id: 'm2', threadId: 't2', labelIds: ['INBOX'], snippet: 'Old', internalDate: '1761200000000', payload: { headers: [{ name: 'From', value: 'bob@y.com' }] } })
    if (url.includes('/calendarList')) return json({ items: [{ id: 'other', selected: false }, { id: 'luis@gmail.com', primary: true }] })
    if (url.includes('/events?')) return json({ items: [{ id: 'e1', summary: 'Standup', start: { dateTime: '2026-10-24T15:00:00Z' }, end: { dateTime: '2026-10-24T15:15:00Z' }, hangoutLink: 'https://meet.google.com/abc' }] })
    return json({}, 404)
  }
  return { fetchFn, calls }
}

describe('Google sign-in', () => {
  it('builds a PKCE consent URL for offline access', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier).toMatch(/^[\w-]{43}$/)
    const u = new URL(authUrl({ client, redirectUri: 'http://127.0.0.1:5000', scopes: scopesFor({ mail: true, calendar: false }), challenge, state: 's', loginHint: 'a@b.c' }))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', login_hint: 'a@b.c', scope: `openid email profile ${SCOPES.mail} ${SCOPES.send}` })
  })

  it('adds an account through the loopback redirect and keeps tokens encrypted', async () => {
    const store = newStore()
    const g = fakeGoogle()
    const google = new GoogleConnector({ store, client: () => client, openBrowser: fakeBrowser(), fetchFn: g.fetchFn })
    const a = await google.add()
    expect(a).toMatchObject({ id: 'google:42', email: 'luis@gmail.com', mail: true, calendar: true })
    expect(JSON.parse(store.getSecret(a.id)!)).toMatchObject({ refreshToken: 'rt', accessToken: 'at1' })
  })

  it('follows the boxes the user left ticked on the consent page', async () => {
    const g = fakeGoogle({ scope: `openid ${SCOPES.mail}` })
    const google = new GoogleConnector({ store: newStore(), client: () => client, openBrowser: fakeBrowser(), fetchFn: g.fetchFn })
    expect(await google.add()).toMatchObject({ mail: true, calendar: false })
  })

  it('says so when the build has no OAuth client', async () => {
    const google = new GoogleConnector({ store: newStore(), client: () => null, openBrowser: () => undefined })
    await expect(google.add()).rejects.toThrow(/isn’t set up/)
  })

  it('refuses a reconnect as a different Google account', async () => {
    const store = newStore()
    store.put({ ...account, status: 'reauth' })
    const google = new GoogleConnector({ store, client: () => client, openBrowser: fakeBrowser(), fetchFn: fakeGoogle({ sub: '99' }).fetchFn })
    await expect(google.reconsent({ ...account, status: 'reauth' })).rejects.toThrow(/Choose luis@gmail.com/)
  })
})

describe('Gmail and Calendar', () => {
  it('reads inbox mail and shown calendars, refreshing an expired token once', async () => {
    const store = newStore()
    store.put(account)
    store.setSecret(account.id, JSON.stringify({ accessToken: 'at1', refreshToken: 'rt', expiresAt: Date.now() + 3600_000, scope: ALL }))
    const g = fakeGoogle({ expireFirstToken: true })
    const service = new AccountService(store, { google: new GoogleConnector({ store, client: () => client, openBrowser: () => undefined, fetchFn: g.fetchFn }) })

    const mail = await service.recentMail()
    expect(mail.problems).toEqual([])
    expect(mail.items.map((m) => [m.subject, m.from.email, m.unread])).toEqual([['Budget', 'ana@x.com', true], ['(no subject)', 'bob@y.com', false]])
    // The refreshed token is saved, and the refresh token kept.
    expect(JSON.parse(store.getSecret(account.id)!)).toMatchObject({ accessToken: 'fresh1', refreshToken: 'rt', scope: ALL })

    const events = await new AccountService(store, { google: new GoogleConnector({ store, client: () => client, openBrowser: () => undefined, fetchFn: g.fetchFn, now: () => Date.parse('2026-10-24T14:00:00Z') }) }, () => Date.parse('2026-10-24T14:00:00Z')).upcomingEvents()
    expect(events.items).toMatchObject([{ title: 'Standup', joinUrl: 'https://meet.google.com/abc' }])
    // Only the primary calendar is shown; the unselected one is never fetched.
    expect(g.calls.filter((c) => c.includes('/events')).length).toBe(1)
  })

  it('marks the account for reconnect when Google revoked the sign-in', async () => {
    const store = newStore()
    store.put(account)
    store.setSecret(account.id, JSON.stringify({ accessToken: 'old', refreshToken: 'rt', expiresAt: 0, scope: ALL }))
    const fetchFn = async (): Promise<Response> => json({ error: 'invalid_grant' }, 400)
    const service = new AccountService(store, { google: new GoogleConnector({ store, client: () => client, openBrowser: () => undefined, fetchFn }) })
    const mail = await service.recentMail()
    expect(mail.problems[0]).toMatch(/luis@gmail.com: Google signed this account out/)
    expect(store.get(account.id)?.status).toBe('reauth')
  })

  it('parses Gmail metadata and Calendar events', () => {
    expect(parseAddress('"Pérez, Ana" <ana@x.com>')).toEqual({ name: 'Pérez, Ana', email: 'ana@x.com' })
    const m = parseGmailMessage({ id: 'm', threadId: 't', labelIds: [], snippet: 'Tom &amp; Jerry&#39;s', internalDate: '0', payload: { headers: [{ name: 'Date', value: 'Fri, 24 Oct 2026 10:00:00 +0000' }] } }, account)
    expect(m).toMatchObject({ snippet: "Tom & Jerry's", receivedAt: '2026-10-24T10:00:00.000Z', webUrl: 'https://mail.google.com/mail/?authuser=luis%40gmail.com#all/t' })
    expect(parseGoogleEvent({ id: 'x', status: 'cancelled', start: { dateTime: '2026-10-24T10:00:00Z' } }, account)).toBeNull()
    expect(parseGoogleEvent({ id: 'x', start: { dateTime: '2026-10-24T10:00:00Z' }, attendees: [{ self: true, responseStatus: 'declined' }] }, account)).toBeNull()
    const allDay = parseGoogleEvent({ id: 'h', start: { date: '2026-11-02' }, end: { date: '2026-11-03' } }, account)!
    expect(allDay.allDay).toBe(true)
    expect(new Date(allDay.start).getDate()).toBe(2)
    expect(parseGoogleEvent({ id: 'v', start: { dateTime: '2026-10-24T10:00:00Z' }, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://zoom.us/j/1' }] } }, account)?.joinUrl).toBe('https://zoom.us/j/1')
  })

  it('throws AuthExpiredError for a missing sign-in', async () => {
    const google = new GoogleConnector({ store: newStore(), client: () => client, openBrowser: () => undefined })
    await expect(google.recentMail(account, 5)).rejects.toBeInstanceOf(AuthExpiredError)
  })
})

describe('Gmail actions', () => {
  const setup = (scope: string) => {
    const store = newStore()
    store.put(account)
    store.setSecret(account.id, JSON.stringify({ accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000, scope }))
    const sent: { url: string; method?: string; body?: unknown }[] = []
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
      sent.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(null, { status: 204 })
    }
    return { google: new GoogleConnector({ store, client: () => client, openBrowser: () => {}, fetchFn }), sent }
  }

  it('archives, stars and trashes with the modify scope', async () => {
    const { google, sent } = setup(`openid ${SCOPES.mail}`)
    expect(google.canChange(account)).toBe(true)
    await google.act(account, ['google:42/m1', 'google:42/m2'], 'archive')
    await google.act(account, ['google:42/m1'], 'star')
    await google.act(account, ['google:42/m1'], 'trash')
    expect(sent).toEqual([
      { url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', method: 'POST', body: { ids: ['m1', 'm2'], removeLabelIds: ['INBOX'] } },
      { url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', method: 'POST', body: { ids: ['m1'], addLabelIds: ['STARRED'] } },
      { url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/trash', method: 'POST', body: undefined }
    ])
  })

  it('refuses changes on a read-only sign-in, and the service lists it', async () => {
    const { google, sent } = setup(`openid ${SCOPES.mailReadOnly}`)
    expect(google.canChange(account)).toBe(false)
    await expect(google.act(account, ['google:42/m1'], 'read')).rejects.toThrow(/Reconnect it to allow changes/)
    expect(sent).toEqual([])
  })

  it('updates the cached inbox after an action', async () => {
    const { google } = setup(`openid ${SCOPES.mail}`)
    const store = (google as unknown as { deps: { store: AccountStore } }).deps.store
    const items = [
      { id: 'google:42/m1', accountId: account.id, from: { name: '', email: 'a@b.c' }, subject: 's', snippet: '', receivedAt: '2026-10-24T00:00:00.000Z', unread: true },
      { id: 'google:42/m2', accountId: account.id, from: { name: '', email: 'a@b.c' }, subject: 's', snippet: '', receivedAt: '2026-10-23T00:00:00.000Z', unread: true }
    ]
    const fake = Object.assign(Object.create(google), { recentMail: async () => items })
    const service = new AccountService(store, { google: fake })
    await service.recentMail()
    await service.act(account.id, ['google:42/m1'], 'read')
    await service.act(account.id, ['google:42/m2'], 'archive')
    expect((await service.recentMail()).items).toMatchObject([{ id: 'google:42/m1', unread: false }])
    expect(service.readOnly()).toEqual([])
  })
})
