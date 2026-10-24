/** A small iCalendar (RFC 5545) reader: enough of VEVENT for an agenda, with simple recurrences. */

export interface IcalEvent {
  uid: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  location?: string
  joinUrl?: string
  webUrl?: string
}

type Prop = { name: string; params: Record<string, string>; value: string }

function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function parseLine(line: string): Prop | null {
  // The value starts at the first colon that is not inside a quoted parameter.
  let quoted = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const [name, ...rest] = line.slice(0, colon).split(';')
  const params: Record<string, string> = {}
  for (const p of rest) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) }
}

const unescapeText = (v: string): string => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim()

/** Minutes east of UTC that a time zone has at an instant. */
function zoneOffset(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }).formatToParts(new Date(ms))
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value)
  return (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - ms) / 60000
}

/** Some servers (Exchange) send Windows zone names; these are the common ones. */
const WINDOWS_ZONES: Record<string, string> = {
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'Romance Standard Time': 'Europe/Paris',
  'W. Europe Standard Time': 'Europe/Berlin',
  'GMT Standard Time': 'Europe/London',
  UTC: 'UTC'
}

function validZone(zone: string | undefined): string | undefined {
  if (!zone) return undefined
  const name = WINDOWS_ZONES[zone] ?? zone.replace(/^\/[^/]+\/[^/]+\//, '')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return name
  } catch {
    return undefined
  }
}

/** Wall-clock time in a zone (fields read as UTC) to the real instant. No zone means this computer's time. */
function wallToInstant(wall: Date, zone: string | undefined): Date {
  if (zone === 'UTC') return wall
  if (!zone) {
    return new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds())
  }
  let ms = wall.getTime() - zoneOffset(wall.getTime(), zone) * 60000
  // A second pass settles times next to a daylight-saving change.
  ms = wall.getTime() - zoneOffset(ms, zone) * 60000
  return new Date(ms)
}

interface DateValue {
  /** Wall-clock fields stored as UTC. */
  wall: Date
  zone: string | undefined
  allDay: boolean
}

function parseDate(p: Prop): DateValue | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(p.value.trim())
  if (!m) return null
  const wall = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)))
  const allDay = p.params.VALUE === 'DATE' || m[4] === undefined
  // All-day events stay on their calendar day wherever the user is.
  const zone = allDay ? undefined : m[7] === 'Z' ? 'UTC' : validZone(p.params.TZID)
  return { wall, zone, allDay }
}

function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return 0
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000
  return m[1] === '-' ? -ms : ms
}

const MEETING_LINK = /https:\/\/(?:[\w-]+\.)*(?:zoom\.us|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|webex\.com|whereby\.com|meet\.jit\.si)\/[^\s"<>)\]]+/i

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Wall-clock starts of a recurring event that fall before `until`, at most `limit` of them. */
function expandRule(rule: string, first: Date, until: Date, limit = 500): Date[] {
  const r: Record<string, string> = {}
  for (const part of rule.split(';')) {
    const [k, v] = part.split('=')
    if (k && v) r[k.toUpperCase()] = v
  }
  const freq = r.FREQ
  const interval = Math.max(1, Number(r.INTERVAL) || 1)
  const count = r.COUNT ? Number(r.COUNT) : Infinity
  const ruleEnd = r.UNTIL ? parseDate({ name: 'UNTIL', params: {}, value: r.UNTIL })?.wall : undefined
  const end = ruleEnd && ruleEnd < until ? ruleEnd : until
  const byDay = r.BYDAY ? r.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))).filter((d) => d >= 0) : []
  const out: Date[] = []
  const push = (d: Date): boolean => {
    if (d > end || out.length >= count || out.length >= limit) return false
    if (d >= first) out.push(d)
    return true
  }
  const day = 86400000
  if (freq === 'DAILY') {
    for (let d = first; push(d); d = new Date(d.getTime() + interval * day));
  } else if (freq === 'WEEKLY') {
    const days = byDay.length ? byDay : [first.getUTCDay()]
    const weekStart = new Date(first.getTime() - first.getUTCDay() * day)
    for (let w = 0; ; w += interval) {
      const base = weekStart.getTime() + w * 7 * day
      const week = days.map((d) => new Date(base + d * day)).sort((a, b) => a.getTime() - b.getTime())
      if (week[0] > end || out.length >= count || out.length >= limit) break
      for (const d of week) if (d >= first && !push(d)) break
    }
  } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
    const step = freq === 'MONTHLY' ? interval : interval * 12
    for (let i = 0; i < 1200; i += step) {
      const d = new Date(first)
      d.setUTCMonth(first.getUTCMonth() + i)
      if (d.getUTCDate() !== first.getUTCDate()) continue // Skip months without that day, such as 31 February.
      if (!push(d)) break
    }
  } else {
    out.push(first)
  }
  return out
}

/**
 * Events in an iCalendar text that overlap [from, to). Recurring events are expanded,
 * and moved or cancelled occurrences are taken into account.
 */
export function parseIcal(text: string, from: Date, to: Date): IcalEvent[] {
  type Raw = { props: Prop[] }
  const blocks: Raw[] = []
  let current: Raw | null = null
  let depth = 0
  for (const line of unfold(text)) {
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      current = { props: [] }
      depth = 0
    } else if (current && upper.startsWith('BEGIN:')) depth++
    else if (current && upper.startsWith('END:') && depth > 0) depth--
    else if (current && upper === 'END:VEVENT') {
      blocks.push(current)
      current = null
    } else if (current && depth === 0) {
      const p = parseLine(line)
      if (p) current.props.push(p)
    }
  }

  // Occurrences that were moved or cancelled, keyed by uid and original start.
  const overrides = new Set<string>()
  for (const b of blocks) {
    const uid = b.props.find((p) => p.name === 'UID')?.value ?? ''
    const rid = b.props.find((p) => p.name === 'RECURRENCE-ID')
    const d = rid && parseDate(rid)
    if (d) overrides.add(`${uid}|${wallToInstant(d.wall, d.zone).getTime()}`)
  }

  const events: IcalEvent[] = []
  for (const b of blocks) {
    const get = (name: string): Prop | undefined => b.props.find((p) => p.name === name)
    if (get('STATUS')?.value.toUpperCase() === 'CANCELLED') continue
    const dtstart = get('DTSTART')
    const start = dtstart && parseDate(dtstart)
    if (!start) continue
    const dtend = get('DTEND')
    const endValue = dtend && parseDate(dtend)
    const duration = endValue
      ? endValue.wall.getTime() - start.wall.getTime()
      : get('DURATION')
        ? parseDuration(get('DURATION')!.value)
        : start.allDay
          ? 86400000
          : 0
    // DTEND may be in another zone than DTSTART; measure it on the real clock.
    const realDuration = endValue
      ? wallToInstant(endValue.wall, endValue.zone).getTime() - wallToInstant(start.wall, start.zone).getTime()
      : duration

    const uid = get('UID')?.value ?? ''
    const location = get('LOCATION') ? unescapeText(get('LOCATION')!.value) : undefined
    const description = get('DESCRIPTION') ? unescapeText(get('DESCRIPTION')!.value) : ''
    const url = get('URL')?.value.trim()
    const joinUrl = (location?.match(MEETING_LINK) ?? description.match(MEETING_LINK) ?? (url ? url.match(MEETING_LINK) : null))?.[0]
    const exdates = new Set(
      b.props
        .filter((p) => p.name === 'EXDATE')
        .flatMap((p) => p.value.split(',').map((v) => parseDate({ ...p, value: v })))
        .filter((d): d is DateValue => d !== null)
        .map((d) => wallToInstant(d.wall, d.zone ?? start.zone).getTime())
    )

    const rrule = get('RRULE')?.value
    const isOverride = get('RECURRENCE-ID') !== undefined
    // Expand far enough in wall time to cover `to` in any zone.
    const starts = rrule && !isOverride ? expandRule(rrule, start.wall, new Date(to.getTime() + 2 * 86400000)) : [start.wall]
    for (const wall of starts) {
      const s = wallToInstant(wall, start.zone)
      if (rrule && !isOverride && (exdates.has(s.getTime()) || overrides.has(`${uid}|${s.getTime()}`))) continue
      const e = new Date(s.getTime() + (start.allDay ? duration : realDuration))
      if (e <= from || s >= to) continue
      events.push({
        uid: rrule && !isOverride ? `${uid}|${s.toISOString()}` : isOverride ? `${uid}|${get('RECURRENCE-ID')!.value}` : uid,
        title: get('SUMMARY') ? unescapeText(get('SUMMARY')!.value) : '(No title)',
        start: s,
        end: e,
        allDay: start.allDay,
        ...(location ? { location } : {}),
        ...(joinUrl ? { joinUrl } : {}),
        ...(url && /^https:\/\//.test(url) ? { webUrl: url } : {})
      })
    }
  }
  return events.sort((a, b) => a.start.getTime() - b.start.getTime())
}
