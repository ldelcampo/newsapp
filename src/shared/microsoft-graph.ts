import type { CalendarEvent, MailMessage } from './accounts'

/** Microsoft Graph responses turned into the app's mail and calendar items. */

export const GRAPH = 'https://graph.microsoft.com/v1.0'

export const MAIL_SCOPES = ['Mail.Read']
export const CALENDAR_SCOPES = ['Calendars.Read']

export function mailUrl(limit: number): string {
  const select = 'id,subject,from,receivedDateTime,isRead,bodyPreview,webLink'
  return `${GRAPH}/me/mailFolders/inbox/messages?$top=${limit}&$select=${select}&$orderby=receivedDateTime%20desc`
}

export function eventsUrl(fromISO: string, toISO: string): string {
  const select = 'id,subject,start,end,isAllDay,isCancelled,location,onlineMeeting,webLink'
  return (
    `${GRAPH}/me/calendarView?startDateTime=${encodeURIComponent(fromISO)}&endDateTime=${encodeURIComponent(toISO)}` +
    `&$select=${select}&$orderby=start/dateTime&$top=100`
  )
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Graph sends "2026-10-24T15:00:00.0000000" plus a separate time zone; we ask for UTC. */
function utc(t: unknown): string {
  const d = new Date(`${str((t as { dateTime?: unknown })?.dateTime).replace(/Z$/, '')}Z`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** All-day events are dates, not instants: keep the calendar date at local midnight. */
function localDay(t: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str((t as { dateTime?: unknown })?.dateTime))
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString() : ''
}

export function parseMessages(json: unknown, accountId: string): MailMessage[] {
  const value = (json as { value?: unknown[] })?.value
  if (!Array.isArray(value)) throw new Error('Unexpected answer from Microsoft mail')
  return value.flatMap((raw) => {
    const m = raw as Record<string, unknown>
    const from = (m.from as { emailAddress?: { name?: unknown; address?: unknown } })?.emailAddress
    const received = new Date(str(m.receivedDateTime))
    if (!str(m.id) || Number.isNaN(received.getTime())) return []
    return [
      {
        id: str(m.id),
        accountId,
        from: { name: str(from?.name) || str(from?.address), email: str(from?.address) },
        subject: str(m.subject) || '(no subject)',
        snippet: str(m.bodyPreview).replace(/\s+/g, ' ').trim().slice(0, 200),
        receivedAt: received.toISOString(),
        unread: m.isRead === false,
        ...(str(m.webLink).startsWith('https://') ? { webUrl: str(m.webLink) } : {})
      }
    ]
  })
}

export function parseEvents(json: unknown, accountId: string): CalendarEvent[] {
  const value = (json as { value?: unknown[] })?.value
  if (!Array.isArray(value)) throw new Error('Unexpected answer from Microsoft calendar')
  return value.flatMap((raw) => {
    const e = raw as Record<string, unknown>
    if (e.isCancelled === true || !str(e.id)) return []
    const allDay = e.isAllDay === true
    const start = allDay ? localDay(e.start) : utc(e.start)
    const end = allDay ? localDay(e.end) : utc(e.end)
    if (!start || !end) return []
    const join = str((e.onlineMeeting as { joinUrl?: unknown })?.joinUrl)
    const location = str((e.location as { displayName?: unknown })?.displayName).trim()
    return [
      {
        id: str(e.id),
        accountId,
        title: str(e.subject) || '(no title)',
        start,
        end,
        allDay,
        ...(location ? { location } : {}),
        ...(join.startsWith('https://') ? { joinUrl: join } : {}),
        ...(str(e.webLink).startsWith('https://') ? { webUrl: str(e.webLink) } : {})
      }
    ]
  })
}
