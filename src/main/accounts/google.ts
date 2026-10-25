import { addressedIn, isBulk, type Account, type CalendarEvent, type MailAction, type MailBody, type MailMessage } from '../../shared/accounts'
import { USER_AGENT } from '../../shared/polite-fetch'
import { AuthExpiredError, ReadOnlyError, type Connector } from './connector'
import {
  authUrl,
  exchangeCode,
  pkcePair,
  refreshTokens,
  revoke,
  SCOPES,
  signInInBrowser,
  type FetchFn,
  type GoogleClient,
  type GoogleTokens
} from './google-oauth'
import type { AccountStore } from './store'

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const CALENDAR = 'https://www.googleapis.com/calendar/v3'
/** Calendars fetched per account; people with dozens of shared calendars only see their own first. */
const MAX_CALENDARS = 10

// ---------- Parsing Google's answers (pure, tested) ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }
const decode = (s: string): string => s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
  if (ENTITIES[e]) return ENTITIES[e]
  const n = e.startsWith('#x') ? parseInt(e.slice(2), 16) : e.startsWith('#') ? Number(e.slice(1)) : NaN
  return Number.isFinite(n) ? String.fromCodePoint(n) : m
})

/** "Ana Pérez <ana@x.com>", "<ana@x.com>" or "ana@x.com". */
export function parseAddress(header: string): { name: string; email: string } {
  const m = header.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim(), email: m[2].trim() }
  return { name: '', email: header.trim() }
}

/** A Gmail messages.get answer in metadata format. */
export function parseGmailMessage(json: unknown, account: Account): MailMessage | null {
  const j = json as { id?: unknown; threadId?: unknown; labelIds?: unknown; snippet?: unknown; internalDate?: unknown; payload?: { headers?: { name?: unknown; value?: unknown }[] } }
  if (typeof j?.id !== 'string') return null
  const header = (name: string): string => {
    const h = j.payload?.headers?.find((x) => typeof x.name === 'string' && x.name.toLowerCase() === name)
    return typeof h?.value === 'string' ? h.value : ''
  }
  const labels = Array.isArray(j.labelIds) ? j.labelIds : []
  const ms = Number(j.internalDate)
  const thread = typeof j.threadId === 'string' ? j.threadId : j.id
  const category = (['promotions', 'social', 'updates', 'forums'] as const).find((c) => labels.includes(`CATEGORY_${c.toUpperCase()}`))
  const unsubscribe = header('list-unsubscribe')
  return {
    id: `${account.id}/${j.id}`,
    accountId: account.id,
    from: parseAddress(header('from')),
    subject: header('subject') || '(no subject)',
    snippet: decode(typeof j.snippet === 'string' ? j.snippet : ''),
    receivedAt: new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.parse(header('date')) || 0).toISOString(),
    unread: labels.includes('UNREAD'),
    webUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email)}#all/${thread}`,
    threadId: thread,
    addressed: addressedIn(header('to'), header('cc'), account.email),
    bulk: isBulk({ listId: header('list-id'), listUnsubscribe: unsubscribe, precedence: header('precedence') }),
    category: category ?? (labels.includes('CATEGORY_PERSONAL') ? 'primary' : undefined),
    starred: labels.includes('STARRED'),
    providerImportant: labels.includes('IMPORTANT'),
    ...(unsubscribe ? { unsubscribe } : {})
  }
}

type GPart = { mimeType?: string; filename?: string; headers?: { name?: string; value?: string }[]; body?: { data?: string; attachmentId?: string }; parts?: GPart[] }

/** A Gmail messages.get answer in full format: headers, the HTML and plain-text parts, attachment names. */
export function parseGmailBody(json: unknown, account: Account): MailBody | null {
  const j = json as { id?: unknown; internalDate?: unknown; payload?: GPart }
  if (typeof j?.id !== 'string' || !j.payload) return null
  const header = (name: string): string => j.payload?.headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? ''
  let html = ''
  let text = ''
  const attachments: string[] = []
  const walk = (p: GPart): void => {
    if (p.filename) attachments.push(p.filename)
    else if (p.body?.data && p.mimeType === 'text/html' && !html) html = Buffer.from(p.body.data, 'base64url').toString('utf8')
    else if (p.body?.data && p.mimeType === 'text/plain' && !text) text = Buffer.from(p.body.data, 'base64url').toString('utf8')
    p.parts?.forEach(walk)
  }
  walk(j.payload)
  const ms = Number(j.internalDate)
  return {
    id: `${account.id}/${j.id}`,
    accountId: account.id,
    from: parseAddress(header('from')),
    to: header('to'),
    cc: header('cc'),
    subject: header('subject') || '(no subject)',
    receivedAt: new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.parse(header('date')) || 0).toISOString(),
    html,
    text,
    attachments
  }
}

type GTime = { dateTime?: string; date?: string }
const localMidnight = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

/** A Calendar events.list item. Cancelled events and ones the user declined are dropped. */
export function parseGoogleEvent(json: unknown, account: Account): CalendarEvent | null {
  const j = json as {
    id?: unknown; status?: unknown; summary?: unknown; location?: unknown; htmlLink?: unknown; hangoutLink?: unknown
    start?: GTime; end?: GTime
    attendees?: { self?: boolean; responseStatus?: string }[]
    conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
  }
  if (typeof j?.id !== 'string' || j.status === 'cancelled') return null
  if (j.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null
  const allDay = !j.start?.dateTime && !!j.start?.date
  const start = j.start?.dateTime ?? (j.start?.date ? localMidnight(j.start.date) : '')
  const end = j.end?.dateTime ?? (j.end?.date ? localMidnight(j.end.date) : start)
  if (!start || Number.isNaN(Date.parse(start))) return null
  const video = j.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri
  const joinUrl = video ?? (typeof j.hangoutLink === 'string' ? j.hangoutLink : undefined)
  return {
    id: `${account.id}/${j.id}`,
    accountId: account.id,
    title: typeof j.summary === 'string' && j.summary.trim() ? j.summary : '(no title)',
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    allDay,
    ...(typeof j.location === 'string' && j.location ? { location: j.location } : {}),
    ...(joinUrl ? { joinUrl } : {}),
    ...(typeof j.htmlLink === 'string' ? { webUrl: j.htmlLink } : {})
  }
}

/** Scopes to ask for, given the account's switches. */
export function scopesFor(want: { mail: boolean; calendar: boolean }): string[] {
  return [...SCOPES.identity, ...(want.mail ? [SCOPES.mail, SCOPES.send] : []), ...(want.calendar ? [SCOPES.calendar] : [])]
}

/** Gmail label changes for each action; trash has its own call. */
export const GMAIL_LABELS: Record<Exclude<MailAction, 'trash'>, { addLabelIds?: string[]; removeLabelIds?: string[] }> = {
  read: { removeLabelIds: ['UNREAD'] },
  unread: { addLabelIds: ['UNREAD'] },
  archive: { removeLabelIds: ['INBOX'] },
  star: { addLabelIds: ['STARRED'] },
  unstar: { removeLabelIds: ['STARRED'] }
}

const gmailId = (id: string): string => {
  const gid = id.slice(id.lastIndexOf('/') + 1)
  if (!/^[\w-]+$/.test(gid)) throw new Error('Unknown message')
  return gid
}

// ---------- The connector ----------

export interface GoogleDeps {
  store: AccountStore
  /** Null when this build has no Google OAuth client configured. */
  client: () => GoogleClient | null
  openBrowser: (url: string) => void
  fetchFn?: FetchFn
  now?: () => number
}

/** Runs `fn` over items with at most `limit` in flight, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export class GoogleConnector implements Connector {
  readonly provider = 'google' as const
  private readonly fetchFn: FetchFn
  private readonly now: () => number

  constructor(private readonly deps: GoogleDeps) {
    this.fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init))
    this.now = deps.now ?? Date.now
  }

  private client(): GoogleClient {
    const c = this.deps.client()
    if (!c) throw new Error('Google sign-in isn’t set up in this build. Add a Google OAuth client ID (see the README).')
    return c
  }

  /** Opens Google's consent page and returns the tokens and who signed in. */
  private async signIn(want: { mail: boolean; calendar: boolean }, loginHint?: string): Promise<{ tokens: GoogleTokens; sub: string; email: string; name: string }> {
    const client = this.client()
    const { verifier, challenge } = pkcePair()
    const { code, redirectUri } = await signInInBrowser(this.deps.openBrowser, (redirectUri, state) =>
      authUrl({ client, redirectUri, scopes: scopesFor(want), challenge, state, loginHint })
    )
    const tokens = await exchangeCode(this.fetchFn, client, code, verifier, redirectUri, this.now())
    const res = await this.fetchFn('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.accessToken}` } })
    const me = (await res.json().catch(() => ({}))) as { sub?: string; email?: string; name?: string }
    if (!res.ok || !me.sub || !me.email) throw new Error('Google didn’t say which account signed in.')
    return { tokens, sub: me.sub, email: me.email, name: me.name ?? '' }
  }

  /** Switches follow what the user actually granted on Google's consent page. */
  private granted(tokens: GoogleTokens, want: { mail: boolean; calendar: boolean }): { mail: boolean; calendar: boolean } {
    const scopes = tokens.scope.split(' ')
    const mail = want.mail && (scopes.includes(SCOPES.mail) || scopes.includes(SCOPES.mailReadOnly))
    const calendar = want.calendar && scopes.includes(SCOPES.calendar)
    if (!mail && !calendar) throw new Error('Google didn’t give access to Gmail or Calendar. Try again and leave the boxes ticked.')
    return { mail, calendar }
  }

  async add(input?: unknown): Promise<Account> {
    const i = (input ?? {}) as { mail?: unknown; calendar?: unknown }
    const want = { mail: i.mail !== false, calendar: i.calendar !== false }
    const { tokens, sub, email, name } = await this.signIn(want)
    const id = `google:${sub}`
    const old = this.deps.store.get(id)
    const account = this.deps.store.put({
      id,
      provider: 'google',
      email,
      name,
      ...this.granted(tokens, want),
      addedAt: old?.addedAt ?? new Date(this.now()).toISOString(),
      status: 'ok'
    })
    this.deps.store.setSecret(id, JSON.stringify(tokens))
    return account
  }

  async reconsent(account: Account): Promise<Account> {
    const tokens = this.tokens(account)
    const scopes = tokens?.scope.split(' ') ?? []
    const covered = (!account.mail || scopes.includes(SCOPES.mail)) && (!account.calendar || scopes.includes(SCOPES.calendar))
    if (tokens && covered && account.status !== 'reauth') return account
    const signed = await this.signIn(account, account.email)
    if (`google:${signed.sub}` !== account.id) throw new Error(`You signed in as ${signed.email}. Choose ${account.email} to reconnect this account.`)
    this.deps.store.setSecret(account.id, JSON.stringify(signed.tokens))
    return { ...account, ...this.granted(signed.tokens, account), status: 'ok' }
  }

  canChange(account: Account): boolean {
    return !!this.tokens(account)?.scope.split(' ').includes(SCOPES.mail)
  }

  async act(account: Account, ids: string[], action: MailAction): Promise<void> {
    if (!this.canChange(account)) throw new ReadOnlyError(`${account.email} can only read mail. Reconnect it to allow changes.`)
    const gids = ids.map(gmailId)
    if (action === 'trash') {
      await mapLimit(gids, 5, (id) => this.api(account, `${GMAIL}/messages/${id}/trash`, { method: 'POST' }))
      return
    }
    await this.api(account, `${GMAIL}/messages/batchModify`, { method: 'POST', body: { ids: gids, ...GMAIL_LABELS[action] } })
  }

  async remove(account: Account): Promise<void> {
    const tokens = this.tokens(account)
    if (tokens) await revoke(this.fetchFn, tokens.refreshToken)
  }

  private tokens(account: Account): GoogleTokens | null {
    const raw = this.deps.store.getSecret(account.id)
    try {
      return raw ? (JSON.parse(raw) as GoogleTokens) : null
    } catch {
      return null
    }
  }

  private async accessToken(account: Account, force = false): Promise<string> {
    const tokens = this.tokens(account)
    if (!tokens?.refreshToken) throw new AuthExpiredError('This account has no saved sign-in. Reconnect it.')
    if (!force && tokens.expiresAt - 60_000 > this.now()) return tokens.accessToken
    const next = await refreshTokens(this.fetchFn, this.client(), tokens, this.now())
    this.deps.store.setSecret(account.id, JSON.stringify(next))
    return next.accessToken
  }

  /** Calls a Google API, refreshing the access token once if Google says it expired. */
  private async api<T>(account: Account, url: string, init: { method?: 'POST'; body?: unknown } = {}): Promise<T> {
    for (const force of [false, true]) {
      const res = await this.fetchFn(url, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${await this.accessToken(account, force)}`,
          accept: 'application/json',
          'user-agent': USER_AGENT,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(15_000)
      })
      if (res.status === 401 && !force) continue
      if (res.status === 401) throw new AuthExpiredError('Google signed this account out. Reconnect it.')
      if (res.status === 403) throw new Error('Google refused access. Reconnect the account and allow access.')
      if (res.status === 429) throw new Error('Google asked the app to slow down. It will try again shortly.')
      if (!res.ok) throw new Error(`Google answered ${res.status}.`)
      // batchModify answers 204 with no body.
      const text = await res.text()
      return (text ? JSON.parse(text) : {}) as T
    }
    throw new Error('unreachable')
  }

  async recentMail(account: Account, limit: number): Promise<MailMessage[]> {
    const list = await this.api<{ messages?: { id: string }[] }>(account, `${GMAIL}/messages?labelIds=INBOX&maxResults=${limit}`)
    const ids = (list.messages ?? []).map((m) => m.id)
    const fields = 'id,threadId,labelIds,snippet,internalDate,payload/headers'
    const headers = ['From', 'To', 'Cc', 'Subject', 'Date', 'List-Id', 'List-Unsubscribe', 'Precedence'].map((h) => `metadataHeaders=${h}`).join('&')
    const msgs = await mapLimit(ids, 5, (id) => this.api<unknown>(account, `${GMAIL}/messages/${id}?format=metadata&${headers}&fields=${encodeURIComponent(fields)}`))
    return msgs.map((m) => parseGmailMessage(m, account)).filter((m): m is MailMessage => m !== null)
  }

  /** `id` is the app's message id, `<account id>/<Gmail id>`. */
  async message(account: Account, id: string): Promise<MailBody> {
    const body = parseGmailBody(await this.api<unknown>(account, `${GMAIL}/messages/${gmailId(id)}?format=full`), account)
    if (!body) throw new Error('Gmail sent an empty message.')
    return body
  }

  async events(account: Account, fromISO: string, toISO: string): Promise<CalendarEvent[]> {
    const cals = await this.api<{ items?: { id: string; primary?: boolean; selected?: boolean }[] }>(account, `${CALENDAR}/users/me/calendarList?minAccessRole=reader`)
    // The calendars the user shows in Google Calendar; primary first.
    const shown = (cals.items ?? []).filter((c) => c.primary || c.selected).sort((a, b) => Number(!!b.primary) - Number(!!a.primary)).slice(0, MAX_CALENDARS)
    const q = new URLSearchParams({ timeMin: fromISO, timeMax: toISO, singleEvents: 'true', orderBy: 'startTime', maxResults: '100' })
    const lists = await mapLimit(shown, 4, (c) => this.api<{ items?: unknown[] }>(account, `${CALENDAR}/calendars/${encodeURIComponent(c.id)}/events?${q}`))
    const seen = new Set<string>()
    return lists
      .flatMap((l) => l.items ?? [])
      .map((e) => parseGoogleEvent(e, account))
      .filter((e): e is CalendarEvent => e !== null && !seen.has(e.id) && !!seen.add(e.id))
  }
}
