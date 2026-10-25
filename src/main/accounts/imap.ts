import { randomUUID } from 'node:crypto'
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from 'imapflow'
import { createTransport } from 'nodemailer'
import { createDAVClient, type DAVCalendar } from 'tsdav'
import {
  addressedIn,
  isBulk,
  normalizeImapInput,
  type Account,
  type CalendarEvent,
  type ConnectionTest,
  type ImapSettings,
  type MailBody,
  type MailMessage
} from '../../shared/accounts'
import { parseIcal } from '../../shared/ical'
import { AuthExpiredError, type Connector } from './connector'
import type { AccountStore } from './store'

const TIMEOUT = 20_000

function imapClient(s: ImapSettings, password: string): ImapFlow {
  return new ImapFlow({
    host: s.imapHost,
    port: s.imapPort,
    // 993 is TLS from the start; other ports upgrade with STARTTLS, which ImapFlow requires when offered.
    secure: s.imapPort === 993,
    auth: { user: s.user, pass: password },
    logger: false,
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
    socketTimeout: 60_000,
    clientInfo: { name: 'Information Hub' }
  })
}

const isAuthError = (e: unknown): boolean =>
  !!e && typeof e === 'object' && ((e as { authenticationFailed?: boolean }).authenticationFailed === true || (e as { responseCode?: number }).responseCode === 535)

/** A message for people, from a connection error. */
function explain(e: unknown, server: string): string {
  if (isAuthError(e)) return `${server} didn’t accept the login name or password.`
  const code = (e as { code?: string })?.code
  if (code === 'ENOTFOUND') return `Couldn’t find ${server}. Check the server name.`
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'CONNECT_TIMEOUT')
    return `Couldn’t connect to ${server}. Check the server and port, or your network.`
  return `${server}: ${(e as Error)?.message || 'connection failed'}`
}

/** The part to preview: the first plain-text part, else the first HTML part, skipping attachments. */
export function previewPart(node: MessageStructureObject | undefined): { part: string; html: boolean } | null {
  if (!node) return null
  let html: { part: string; html: boolean } | null = null
  const walk = (n: MessageStructureObject): { part: string; html: boolean } | null => {
    if (n.childNodes?.length) {
      for (const c of n.childNodes) {
        const found = walk(c)
        if (found) return found
      }
      return null
    }
    if (n.disposition === 'attachment') return null
    // A single-part message has no part number; IMAP calls its body part 1.
    const part = n.part || '1'
    if (n.type === 'text/plain') return { part, html: false }
    if (n.type === 'text/html' && !html) html = { part, html: true }
    return null
  }
  return walk(node) ?? html
}

/** Every displayable part of a message: the first HTML and plain-text parts, and attachment names. */
export function bodyParts(node: MessageStructureObject | undefined): { html?: string; text?: string; attachments: string[] } {
  const out: { html?: string; text?: string; attachments: string[] } = { attachments: [] }
  const walk = (n: MessageStructureObject): void => {
    if (n.childNodes?.length) return n.childNodes.forEach(walk)
    const name = n.dispositionParameters?.filename ?? n.parameters?.name
    if (n.disposition === 'attachment' || (name && !n.type.startsWith('text/'))) {
      if (name) out.attachments.push(name)
      return
    }
    const part = n.part || '1'
    if (n.type === 'text/html' && !out.html) out.html = part
    else if (n.type === 'text/plain' && !out.text) out.text = part
  }
  if (node) walk(node)
  return out
}

/** Header lines from a FETCH of named headers, as lower-case name → unfolded value. */
export function parseHeaderLines(raw: Buffer | string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const text = (raw ?? '').toString().replace(/\r?\n[ \t]+/g, ' ')
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return out
}

/** Collapses a message body to a one-line preview. */
export function toSnippet(body: string, html: boolean, max = 200): string {
  let text = body
  if (html) {
    text = text
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
  }
  // Drop quoted replies so the preview shows what is new.
  text = text
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string))
  return Buffer.concat(chunks).toString('utf8')
}

/** Finds the calendar server: the address given, else the usual places for the mail domain. */
async function findCalendars(s: ImapSettings, email: string, password: string): Promise<{ url: string; calendars: DAVCalendar[] } | null> {
  const domain = email.split('@')[1]
  const candidates = s.caldavUrl ? [s.caldavUrl] : [`https://${domain}`, `https://caldav.${domain}`, `https://mail.${domain}`]
  for (const url of candidates) {
    try {
      const client = await createDAVClient({
        serverUrl: url,
        credentials: { username: s.user, password },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
        fetchOptions: { signal: AbortSignal.timeout(TIMEOUT) }
      })
      const calendars = (await client.fetchCalendars()).filter((c) => !c.components || c.components.includes('VEVENT'))
      if (calendars.length) return { url, calendars }
    } catch (e) {
      // A given address must work; guessed ones may simply not exist.
      if (s.caldavUrl) throw e
    }
  }
  return null
}

/** Checks the incoming and outgoing servers and looks for a calendar. Nothing is saved. */
export async function testImap(raw: unknown): Promise<ConnectionTest & { caldavUrl?: string }> {
  const input = normalizeImapInput(raw)
  if (typeof input === 'string') return { ok: false, error: input }
  const s = input.imap

  const imap = imapClient(s, input.password)
  imap.on('error', () => {})
  try {
    await imap.connect()
    await imap.logout()
  } catch (e) {
    imap.close()
    return { ok: false, error: explain(e, s.imapHost) }
  }

  const smtp = createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpPort === 465,
    requireTLS: s.smtpPort !== 465,
    auth: { user: s.user, pass: input.password },
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT
  })
  try {
    await smtp.verify()
  } catch (e) {
    return { ok: false, error: explain(e, s.smtpHost) }
  } finally {
    smtp.close()
  }

  if (!input.calendar) return { ok: true, calendar: 'off' }
  try {
    const found = await findCalendars(s, input.email, input.password)
    if (found) return { ok: true, calendar: 'found', caldavUrl: found.url }
    return { ok: true, calendar: 'none', note: 'Mail works. This provider offers no calendar we can read, so the account is set to mail only.' }
  } catch (e) {
    return { ok: false, error: `The calendar address didn’t work: ${(e as Error).message}` }
  }
}

const addresses = (list?: { name?: string; address?: string }[]): string => (list ?? []).map((a) => a.address ?? '').join(', ')

function toMessage(acc: Account, m: FetchMessageObject, snippet: string): MailMessage {
  const from = m.envelope?.from?.[0]
  const date = m.envelope?.date ?? m.internalDate
  const h = parseHeaderLines(m.headers)
  const login = acc.imap?.user.includes('@') ? acc.imap.user : acc.email
  const addressed = addressedIn(addresses(m.envelope?.to), addresses(m.envelope?.cc), acc.email)
  return {
    id: `${acc.id}:${m.uid}`,
    accountId: acc.id,
    from: { name: from?.name || from?.address || '', email: from?.address || '' },
    subject: m.envelope?.subject || '(No subject)',
    snippet,
    receivedAt: (date ? new Date(date) : new Date()).toISOString(),
    unread: !m.flags?.has('\\Seen'),
    addressed: addressed === 'none' && login !== acc.email ? addressedIn(addresses(m.envelope?.to), addresses(m.envelope?.cc), login) : addressed,
    bulk: isBulk({ listId: h['list-id'], listUnsubscribe: h['list-unsubscribe'], precedence: h.precedence }),
    starred: !!m.flags?.has('\\Flagged'),
    ...(h['list-unsubscribe'] ? { unsubscribe: h['list-unsubscribe'] } : {})
  }
}

/** Company and other mail over IMAP/SMTP, with the calendar over CalDAV when the provider has one. */
export class ImapConnector implements Connector {
  readonly provider = 'imap' as const

  constructor(private readonly store: AccountStore) {}

  private password(acc: Account): string {
    const p = this.store.getSecret(acc.id)
    if (!p) throw new AuthExpiredError('The password for this account is missing. Enter it again.')
    return p
  }

  async add(raw?: unknown): Promise<Account> {
    const input = normalizeImapInput(raw)
    if (typeof input === 'string') throw new Error(input)
    const test = await testImap(input)
    if (!test.ok) throw new Error(test.error)
    // A new password for an existing account keeps its id, so the store replaces it.
    const existing = input.accountId ? this.store.get(input.accountId) : undefined
    const account: Account = {
      id: existing?.id ?? `imap-${randomUUID()}`,
      provider: 'imap',
      email: input.email,
      name: input.name,
      mail: existing?.mail ?? true,
      calendar: test.calendar === 'found',
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      imap: { ...input.imap, caldavUrl: test.caldavUrl ?? input.imap.caldavUrl }
    }
    this.store.setSecret(account.id, input.password)
    return account
  }

  /** Looks for a calendar when the user turns the calendar switch on. */
  async reconsent(acc: Account): Promise<Account> {
    if (!acc.imap || !acc.calendar || acc.imap.caldavUrl) return acc
    const found = await findCalendars(acc.imap, acc.email, this.password(acc))
    if (!found) throw new Error('This provider offers no calendar we can read. Add its CalDAV address to use one.')
    return { ...acc, imap: { ...acc.imap, caldavUrl: found.url } }
  }

  private async connect(acc: Account & { imap: ImapSettings }): Promise<ImapFlow> {
    const client = imapClient(acc.imap, this.password(acc))
    client.on('error', () => {})
    try {
      await client.connect()
    } catch (e) {
      client.close()
      if (isAuthError(e)) throw new AuthExpiredError(explain(e, acc.imap.imapHost))
      throw new Error(explain(e, acc.imap.imapHost))
    }
    return client
  }

  /** `id` is the app's message id, `<account id>:<uid>`. Reading never marks the message as read. */
  async message(acc: Account, id: string): Promise<MailBody> {
    if (!acc.imap) throw new Error('This account has no mail server.')
    const uid = id.slice(id.lastIndexOf(':') + 1)
    if (!/^\d+$/.test(uid)) throw new Error('Unknown message')
    const client = await this.connect(acc as Account & { imap: ImapSettings })
    try {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      try {
        const m = await client.fetchOne(uid, { uid: true, envelope: true, internalDate: true, bodyStructure: true }, { uid: true })
        if (!m) throw new Error('That message is no longer in the inbox.')
        const parts = bodyParts(m.bodyStructure)
        const read = async (part?: string): Promise<string> => {
          if (!part) return ''
          const dl = await client.download(uid, part, { uid: true, maxBytes: 2_000_000 })
          return dl.content ? readStream(dl.content) : ''
        }
        const html = await read(parts.html)
        const text = await read(parts.text)
        const from = m.envelope?.from?.[0]
        const date = m.envelope?.date ?? m.internalDate
        return {
          id,
          accountId: acc.id,
          from: { name: from?.name || from?.address || '', email: from?.address || '' },
          to: addresses(m.envelope?.to),
          cc: addresses(m.envelope?.cc),
          subject: m.envelope?.subject || '(No subject)',
          receivedAt: (date ? new Date(date) : new Date()).toISOString(),
          html,
          text: text || (html ? toSnippet(html, true, 100_000) : ''),
          attachments: parts.attachments
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => client.close())
    }
  }

  async recentMail(acc: Account, limit: number): Promise<MailMessage[]> {
    if (!acc.imap) return []
    const client = await this.connect(acc as Account & { imap: ImapSettings })
    const messages: MailMessage[] = []
    try {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      try {
        const total = typeof client.mailbox === 'object' ? client.mailbox.exists : 0
        if (total > 0) {
          const fetched = await client.fetchAll(`${Math.max(1, total - limit + 1)}:*`, {
            uid: true,
            flags: true,
            envelope: true,
            internalDate: true,
            bodyStructure: true,
            headers: ['list-id', 'list-unsubscribe', 'precedence']
          })
          for (const m of fetched) {
            let snippet = ''
            const part = previewPart(m.bodyStructure)
            if (part) {
              try {
                const dl = await client.download(String(m.uid), part.part, { uid: true, maxBytes: 4096 })
                if (dl.content) snippet = toSnippet(await readStream(dl.content), part.html)
              } catch {
                // A preview is a nicety; the message still shows without one.
              }
            }
            messages.push(toMessage(acc, m, snippet))
          }
        }
      } finally {
        lock.release()
      }
      await client.logout()
    } catch (e) {
      client.close()
      throw new Error(explain(e, acc.imap.imapHost))
    }
    return messages
  }

  async events(acc: Account, fromISO: string, toISO: string): Promise<CalendarEvent[]> {
    if (!acc.imap?.caldavUrl) return []
    const pass = this.password(acc)
    let found: Awaited<ReturnType<typeof findCalendars>>
    try {
      found = await findCalendars(acc.imap, acc.email, pass)
    } catch (e) {
      if (/401|unauthori[sz]ed/i.test((e as Error)?.message ?? '')) throw new AuthExpiredError('The calendar server didn’t accept the password.')
      throw e
    }
    if (!found) return []
    const client = await createDAVClient({
      serverUrl: found.url,
      credentials: { username: acc.imap.user, password: pass },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
      fetchOptions: { signal: AbortSignal.timeout(TIMEOUT) }
    })
    const from = new Date(fromISO)
    const to = new Date(toISO)
    const events: CalendarEvent[] = []
    for (const calendar of found.calendars) {
      // Ask the server to expand recurring events; parseIcal expands them itself when it doesn't.
      const objects = await client.fetchCalendarObjects({ calendar, timeRange: { start: fromISO, end: toISO }, expand: true })
      for (const o of objects) {
        if (typeof o.data !== 'string') continue
        for (const e of parseIcal(o.data, from, to)) {
          events.push({
            id: `${acc.id}:${e.uid}`,
            accountId: acc.id,
            title: e.title,
            start: e.start.toISOString(),
            end: e.end.toISOString(),
            allDay: e.allDay,
            ...(e.location ? { location: e.location } : {}),
            ...(e.joinUrl ? { joinUrl: e.joinUrl } : {}),
            ...(e.webUrl ? { webUrl: e.webUrl } : {})
          })
        }
      }
    }
    // The same event can come back from two calendars, or both expanded and as a master.
    return [...new Map(events.map((e) => [`${e.id}|${e.start}`, e])).values()]
  }
}
