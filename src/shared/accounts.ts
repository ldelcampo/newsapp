/**
 * Mail and calendar accounts. Metadata lives in accounts.json; tokens and passwords never leave this computer.
 * All times are UTC ISO strings from Date.toISOString(), so they sort as text.
 */

export type Provider = 'google' | 'microsoft' | 'imap'

export const PROVIDERS: { provider: Provider; label: string }[] = [
  { provider: 'microsoft', label: 'Microsoft' },
  { provider: 'google', label: 'Google' },
  { provider: 'imap', label: 'Other mail (IMAP)' }
]

export interface Account {
  id: string
  provider: Provider
  email: string
  name: string
  /** Show this account's mail. */
  mail: boolean
  /** Show this account's calendar; off means "mail only". */
  calendar: boolean
  addedAt: string
  /** 'reauth' when the provider rejected the saved sign-in and the user must reconnect. */
  status?: 'ok' | 'reauth'
  /** Servers for an IMAP account; its password is a secret in the store. */
  imap?: ImapSettings
}

export interface MailMessage {
  id: string
  accountId: string
  from: { name: string; email: string }
  subject: string
  snippet: string
  receivedAt: string
  unread: boolean
  webUrl?: string
  /** Provider's conversation id, for opening the whole thread. */
  threadId?: string
  /** How the account's address appears: in To, only in Cc, or not at all (lists, Bcc). */
  addressed?: 'to' | 'cc' | 'none'
  /** Sent through a mailing list or as bulk mail (List-Id, List-Unsubscribe, Precedence: bulk). */
  bulk?: boolean
  /** Gmail's inbox tab; other providers leave it out. */
  category?: 'primary' | 'promotions' | 'social' | 'updates' | 'forums'
  /** Starred in Gmail, flagged over IMAP. */
  starred?: boolean
  /** Gmail's own importance marker. */
  providerImportant?: boolean
  /** The List-Unsubscribe header as sent. */
  unsubscribe?: string
}

/** What can be done to messages from the app. */
export type MailAction = 'read' | 'unread' | 'archive' | 'trash' | 'star' | 'unstar'
export const MAIL_ACTIONS: MailAction[] = ['read', 'unread', 'archive', 'trash', 'star', 'unstar']

/** One message in full, for reading inside the app. */
export interface MailBody {
  id: string
  accountId: string
  from: { name: string; email: string }
  to: string
  cc: string
  subject: string
  receivedAt: string
  /** The HTML part when there is one; shown sandboxed with remote images off. */
  html: string
  /** The plain-text part, or text made from the HTML. */
  text: string
  /** File names of attachments. */
  attachments: string[]
  /** For replies: the Message-ID, References and Reply-To headers, and the provider's thread. */
  messageId?: string
  references?: string
  replyTo?: string
  threadId?: string
  /** List-Unsubscribe and List-Unsubscribe-Post, for unsubscribing. */
  unsubscribe?: string
  unsubscribePost?: string
}

/** Mail the user writes in the app: new, or a reply to `replyTo` (a message id from the inbox). */
export interface MailDraft {
  accountId: string
  to: string
  cc: string
  subject: string
  text: string
  replyTo?: string
}

/** What a connector sends: a draft with the reply headers filled in. */
export interface OutgoingMail {
  to: string
  cc: string
  subject: string
  text: string
  inReplyTo?: string
  references?: string
  threadId?: string
}

const EMAIL_LIST = /^\s*([^,;\s]+@[^,;\s]+\.[^,;\s]+|[^<>,]*<[^<>\s@]+@[^<>\s]+\.[^<>\s]+>)(\s*[,;]\s*([^,;\s]+@[^,;\s]+\.[^,;\s]+|[^<>,]*<[^<>\s@]+@[^<>\s]+\.[^<>\s]+>))*\s*$/

/** Checks a draft from the window; returns a message for the first problem, or the clean draft. */
export function normalizeDraft(raw: unknown): MailDraft | string {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
  const to = s(r.to, 2000).trim()
  const cc = s(r.cc, 2000).trim()
  if (!s(r.accountId, 200)) return 'Choose the account to send from.'
  if (!EMAIL_LIST.test(to)) return 'Enter at least one valid address in To.'
  if (cc && !EMAIL_LIST.test(cc)) return 'Check the addresses in Cc.'
  const text = s(r.text, 200_000)
  if (!text.trim()) return 'Write something first.'
  const replyTo = s(r.replyTo, 500)
  return { accountId: s(r.accountId, 200), to, cc, subject: s(r.subject, 500).replace(/[\r\n]+/g, ' ').trim(), text, ...(replyTo ? { replyTo } : {}) }
}

/** "Re: subject" once, whatever language prefix was there. */
export const replySubject = (subject: string): string => (/^\s*(re|aw|rv|sv)\s*:/i.test(subject) ? subject : `Re: ${subject}`)

export interface CalendarEvent {
  id: string
  accountId: string
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  /** Online meeting link (Teams, Meet, Zoom). */
  joinUrl?: string
  webUrl?: string
}

/** Where `email` appears among the To and Cc addresses. */
export function addressedIn(to: string, cc: string, email: string): 'to' | 'cc' | 'none' {
  const me = email.trim().toLowerCase()
  if (!me) return 'none'
  const has = (list: string): boolean => list.toLowerCase().split(/[,;<>\s"]+/).includes(me)
  return has(to) ? 'to' : has(cc) ? 'cc' : 'none'
}

/** True when headers say the message came through a list or as bulk mail. */
export function isBulk(h: { listId?: string; listUnsubscribe?: string; precedence?: string }): boolean {
  return !!h.listId?.trim() || !!h.listUnsubscribe?.trim() || /^(bulk|list|junk)$/i.test(h.precedence?.trim() ?? '')
}

export const providerLabel = (p: Provider): string => PROVIDERS.find((x) => x.provider === p)?.label ?? p

/** Drops malformed accounts, so an old or hand-edited accounts.json still loads. */
export function normalizeAccount(raw: unknown): Account | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const provider = PROVIDERS.find((p) => p.provider === r.provider)?.provider
  if (!provider || !str(r.id)) return null
  return {
    id: str(r.id),
    provider,
    email: str(r.email),
    name: str(r.name),
    mail: r.mail !== false,
    calendar: r.calendar !== false,
    addedAt: str(r.addedAt) || new Date(0).toISOString(),
    ...(r.status === 'reauth' ? { status: 'reauth' as const } : {}),
    ...imapField(provider, r.imap)
  }
}

function imapField(provider: Provider, raw: unknown): { imap?: ImapSettings } {
  if (provider !== 'imap') return {}
  const imap = normalizeImapSettings(raw)
  return typeof imap === 'string' ? {} : { imap }
}

/** Newest first; unread mail is not reordered, so the list reads like an inbox. */
export function mergeMail(lists: MailMessage[][], limit: number): MailMessage[] {
  return lists
    .flat()
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, limit)
}

/** Earliest first, skipping events that already ended. */
export function mergeEvents(lists: CalendarEvent[][], now: Date): CalendarEvent[] {
  const t = now.toISOString()
  return lists
    .flat()
    .filter((e) => e.end > t)
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}

// IMAP accounts (IONOS and any other provider with IMAP/SMTP, plus CalDAV when offered).

/** Servers for an IMAP account. Not secret, so kept with the account. */
export interface ImapSettings {
  /** Login name; usually the email address. */
  user: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  /** CalDAV address for the calendar; empty when the provider has none. */
  caldavUrl: string
}

/** What the Add account form sends for an IMAP account. */
export interface ImapAccountInput {
  email: string
  name: string
  password: string
  calendar: boolean
  imap: ImapSettings
  /** Set when entering a new password for an account that already exists. */
  accountId?: string
}

export type ConnectionTest =
  | { ok: true; calendar: 'found' | 'none' | 'off'; note?: string }
  | { ok: false; error: string }

export interface ImapPreset {
  id: string
  label: string
  /** Mail domains that use this provider, for picking the preset from an address. */
  domains: string[]
  settings: Omit<ImapSettings, 'user'>
}

export const IMAP_PRESETS: ImapPreset[] = [
  {
    id: 'ionos-mx',
    label: 'IONOS (Mexico)',
    domains: [],
    settings: { imapHost: 'imap.ionos.mx', imapPort: 993, smtpHost: 'smtp.ionos.mx', smtpPort: 465, caldavUrl: '' }
  },
  {
    id: 'ionos-com',
    label: 'IONOS (US)',
    domains: [],
    settings: { imapHost: 'imap.ionos.com', imapPort: 993, smtpHost: 'smtp.ionos.com', smtpPort: 465, caldavUrl: '' }
  },
  {
    id: 'ionos-de',
    label: 'IONOS (Europe)',
    domains: [],
    settings: { imapHost: 'imap.ionos.de', imapPort: 993, smtpHost: 'smtp.ionos.de', smtpPort: 465, caldavUrl: '' }
  },
  {
    id: 'icloud',
    label: 'iCloud',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    settings: { imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587, caldavUrl: 'https://caldav.icloud.com' }
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    domains: ['fastmail.com', 'fastmail.fm'],
    settings: { imapHost: 'imap.fastmail.com', imapPort: 993, smtpHost: 'smtp.fastmail.com', smtpPort: 465, caldavUrl: 'https://caldav.fastmail.com' }
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    domains: ['yahoo.com', 'yahoo.com.mx', 'ymail.com'],
    settings: { imapHost: 'imap.mail.yahoo.com', imapPort: 993, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465, caldavUrl: 'https://caldav.calendar.yahoo.com' }
  },
  {
    id: 'other',
    label: 'Other (enter servers)',
    domains: [],
    settings: { imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 465, caldavUrl: '' }
  }
]

/** Best guess of servers for an address: a known provider, else the usual mail.domain names. */
export function guessImapSettings(email: string): ImapSettings {
  const domain = email.split('@')[1]?.trim().toLowerCase() ?? ''
  const preset = IMAP_PRESETS.find((p) => p.domains.includes(domain))
  if (preset) return { user: email.trim(), ...preset.settings }
  return { user: email.trim(), imapHost: domain ? `imap.${domain}` : '', imapPort: 993, smtpHost: domain ? `smtp.${domain}` : '', smtpPort: 465, caldavUrl: '' }
}

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function port(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Validates server settings; returns a message for the first problem, or the clean settings. */
export function normalizeImapSettings(raw: unknown): ImapSettings | string {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const imapHost = str(r.imapHost).toLowerCase()
  const smtpHost = str(r.smtpHost).toLowerCase()
  const caldavUrl = str(r.caldavUrl)
  if (!str(r.user)) return 'Enter the login name, usually your email address.'
  if (!HOST.test(imapHost)) return 'Enter the incoming (IMAP) server, such as imap.ionos.mx.'
  if (!HOST.test(smtpHost)) return 'Enter the outgoing (SMTP) server, such as smtp.ionos.mx.'
  if (caldavUrl && !/^https:\/\/[^\s]+$/.test(caldavUrl)) return 'The calendar address must start with https://.'
  return {
    user: str(r.user),
    imapHost,
    imapPort: port(r.imapPort, 993),
    smtpHost,
    smtpPort: port(r.smtpPort, 465),
    caldavUrl
  }
}

export function normalizeImapInput(raw: unknown): ImapAccountInput | string {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const email = str(r.email)
  if (!EMAIL.test(email)) return 'Enter a valid email address.'
  if (typeof r.password !== 'string' || r.password === '') return 'Enter the password for this mailbox.'
  const imap = normalizeImapSettings(r.imap)
  if (typeof imap === 'string') return imap
  const accountId = str(r.accountId)
  return { email, name: str(r.name) || email, password: r.password, calendar: r.calendar !== false, imap, ...(accountId ? { accountId } : {}) }
}

export type MeetingPhase = 'later' | 'soon' | 'imminent' | 'now'

/**
 * Where a meeting stands, for the countdown: 'soon' within an hour, 'imminent' within 10 minutes,
 * 'now' while it runs. `progress` runs 0→1 across the hour before the start (or across the
 * meeting while it runs), which drives the countdown ring.
 */
export function meetingPhase(e: CalendarEvent, now: Date): { phase: MeetingPhase; minutes: number; progress: number } {
  const t = now.getTime()
  const start = Date.parse(e.start)
  const end = Date.parse(e.end)
  if (t >= start) return { phase: 'now', minutes: Math.max(0, Math.ceil((end - t) / 60_000)), progress: Math.min(1, (t - start) / Math.max(1, end - start)) }
  const minutes = Math.ceil((start - t) / 60_000)
  const phase = minutes <= 10 ? 'imminent' : minutes <= 60 ? 'soon' : 'later'
  return { phase, minutes, progress: Math.max(0, 1 - (start - t) / 3_600_000) }
}
