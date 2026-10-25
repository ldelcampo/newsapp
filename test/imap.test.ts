import { describe, expect, it } from 'vitest'
import { guessImapSettings, normalizeAccount, normalizeImapInput } from '../src/shared/accounts'
import { parseIcal } from '../src/shared/ical'
import { previewPart, specialFolder, toSnippet } from '../src/main/accounts/imap'

const cal = (...events: string[]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e.trim().split('\n').map((l) => l.trim()), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n')

const week = { from: new Date('2026-10-26T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') }

describe('parseIcal', () => {
  it('reads a UTC event with folded text and a meeting link', () => {
    const text = cal(`
      UID:a1
      SUMMARY:Budget\\, Q4 review
      DTSTART:20261027T160000Z
      DTEND:20261027T170000Z
      LOCATION:Online
      DESCRIPTION:Join at https://teams.microsoft.com/l/meetup-join/abc
    `).replace('Join at ', 'Join at\r\n ')
    const [e] = parseIcal(text, week.from, week.to)
    expect(e.title).toBe('Budget, Q4 review')
    expect(e.start.toISOString()).toBe('2026-10-27T16:00:00.000Z')
    expect(e.end.toISOString()).toBe('2026-10-27T17:00:00.000Z')
    expect(e.joinUrl).toBe('https://teams.microsoft.com/l/meetup-join/abc')
  })

  it('converts times in a named time zone', () => {
    const [e] = parseIcal(cal('UID:a2\nSUMMARY:Standup\nDTSTART;TZID=America/Mexico_City:20261028T090000\nDURATION:PT15M'), week.from, week.to)
    // Mexico City is UTC-6 all year.
    expect(e.start.toISOString()).toBe('2026-10-28T15:00:00.000Z')
    expect(e.end.toISOString()).toBe('2026-10-28T15:15:00.000Z')
  })

  it('understands Windows zone names and daylight saving', () => {
    const [e] = parseIcal(cal('UID:a3\nSUMMARY:NY call\nDTSTART;TZID="Eastern Standard Time":20261030T100000\nDTEND;TZID="Eastern Standard Time":20261030T110000'), week.from, week.to)
    expect(e.start.toISOString()).toBe('2026-10-30T14:00:00.000Z') // EDT, before 1 November
  })

  it('marks all-day events', () => {
    const [e] = parseIcal(cal('UID:a4\nSUMMARY:Holiday\nDTSTART;VALUE=DATE:20261102\nDTEND;VALUE=DATE:20261103'), week.from, new Date('2026-11-05T00:00:00Z'))
    expect(e.allDay).toBe(true)
    expect(e.end.getTime() - e.start.getTime()).toBe(86400000)
  })

  it('expands weekly events, skipping excluded and moved occurrences', () => {
    const text = cal(
      `UID:r1
       SUMMARY:Team sync
       DTSTART:20261005T150000Z
       DTEND:20261005T153000Z
       RRULE:FREQ=WEEKLY;BYDAY=MO,WE
       EXDATE:20261028T150000Z`,
      `UID:r1
       RECURRENCE-ID:20261026T150000Z
       SUMMARY:Team sync (moved)
       DTSTART:20261027T180000Z
       DTEND:20261027T183000Z`
    )
    const events = parseIcal(text, week.from, week.to)
    expect(events.map((e) => [e.title, e.start.toISOString()])).toEqual([
      ['Team sync (moved)', '2026-10-27T18:00:00.000Z']
    ])
  })

  it('stops at COUNT and drops cancelled events', () => {
    const text = cal(
      'UID:d1\nSUMMARY:Daily\nDTSTART:20261029T120000Z\nDTEND:20261029T121500Z\nRRULE:FREQ=DAILY;COUNT=2',
      'UID:c1\nSUMMARY:Gone\nSTATUS:CANCELLED\nDTSTART:20261027T120000Z\nDTEND:20261027T130000Z'
    )
    expect(parseIcal(text, week.from, week.to).map((e) => e.start.toISOString())).toEqual(['2026-10-29T12:00:00.000Z', '2026-10-30T12:00:00.000Z'])
  })

  it('ignores alarms inside events', () => {
    const text = cal('UID:x\nSUMMARY:With alarm\nDTSTART:20261027T120000Z\nDTEND:20261027T130000Z\nBEGIN:VALARM\nDESCRIPTION:Reminder\nTRIGGER:-PT15M\nEND:VALARM')
    expect(parseIcal(text, week.from, week.to)).toHaveLength(1)
  })
})

describe('IMAP accounts', () => {
  it('guesses servers for an unknown domain', () => {
    expect(guessImapSettings('luis@example.mx')).toMatchObject({ imapHost: 'imap.example.mx', smtpHost: 'smtp.example.mx', imapPort: 993 })
  })

  it('validates the Add account form', () => {
    const imap = { user: 'luis@example.mx', imapHost: 'imap.ionos.mx', imapPort: '993', smtpHost: 'smtp.ionos.mx', smtpPort: 465, caldavUrl: '' }
    expect(normalizeImapInput({ email: 'nope', password: 'x', imap })).toBe('Enter a valid email address.')
    expect(normalizeImapInput({ email: 'luis@example.mx', password: '', imap })).toMatch(/password/)
    expect(normalizeImapInput({ email: 'luis@example.mx', password: 'x', imap: { ...imap, caldavUrl: 'http://x' } })).toMatch(/https/)
    expect(normalizeImapInput({ email: 'luis@example.mx', password: 'x', imap })).toMatchObject({ name: 'luis@example.mx', calendar: true, imap: { imapPort: 993 } })
  })

  it('keeps IMAP servers on stored accounts and drops them from others', () => {
    const imap = { user: 'a@b.mx', imapHost: 'imap.ionos.mx', imapPort: 993, smtpHost: 'smtp.ionos.mx', smtpPort: 465, caldavUrl: '' }
    expect(normalizeAccount({ id: '1', provider: 'imap', email: 'a@b.mx', imap })?.imap).toEqual(imap)
    expect(normalizeAccount({ id: '2', provider: 'microsoft', email: 'a@b.mx', imap })?.imap).toBeUndefined()
  })
})

describe('mail previews', () => {
  it('prefers the plain-text part and skips attachments', () => {
    const structure = {
      type: 'multipart/mixed',
      childNodes: [
        { type: 'multipart/alternative', childNodes: [{ part: '1.1', type: 'text/html' }, { part: '1.2', type: 'text/plain' }] },
        { part: '2', type: 'text/plain', disposition: 'attachment' }
      ]
    }
    expect(previewPart(structure)).toEqual({ part: '1.2', html: false })
    expect(previewPart({ type: 'text/html' })).toEqual({ part: '1', html: true })
  })

  it('strips HTML and quoted replies', () => {
    expect(toSnippet('<style>p{}</style><p>Hola&nbsp;Luis,</p><p>Ya quedó.</p>', true)).toBe('Hola Luis, Ya quedó.')
    expect(toSnippet('Sounds good.\n\n> On Monday you wrote:\n> old text', false)).toBe('Sounds good.')
  })
})

describe('specialFolder', () => {
  const client = (boxes: { path: string; name: string; specialUse?: string }[]) => {
    const created: string[] = []
    return { created, list: async () => boxes, mailboxCreate: async (p: string) => void created.push(p) } as never as Parameters<typeof specialFolder>[0] & { created: string[] }
  }
  it('prefers the special-use flag, then usual names, then creates Archive', async () => {
    expect(await specialFolder(client([{ path: 'INBOX.Basura', name: 'Basura', specialUse: '\\Trash' }]), 'trash')).toBe('INBOX.Basura')
    expect(await specialFolder(client([{ path: 'Papelera', name: 'Papelera' }]), 'trash')).toBe('Papelera')
    const c = client([{ path: 'INBOX', name: 'INBOX' }])
    expect(await specialFolder(c, 'archive')).toBe('Archive')
    expect(c.created).toEqual(['Archive'])
    await expect(specialFolder(client([]), 'trash')).rejects.toThrow(/no Trash/)
  })
})
