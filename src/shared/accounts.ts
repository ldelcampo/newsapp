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
}

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
    ...(r.status === 'reauth' ? { status: 'reauth' as const } : {})
  }
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
