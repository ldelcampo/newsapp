/** Mail triage: how messages are ranked, what the user taught the ranking, and what Jev is asked. */
import type { MailMessage } from './accounts'

export type MailRanking = 'local' | 'jev'
export type MailUrgency = 'now' | 'soon' | 'later'
/** What the user said about a message or its sender. */
export type Verdict = 'important' | 'not'

export interface RankedMail extends MailMessage {
  score: number
  urgency: MailUrgency
  /** Short reasons, most important first, e.g. "Sent to you". */
  reasons: string[]
  /** What the user said about this message, if anything. */
  verdict?: Verdict
  /** When a snooze ends (or ended, for mail back from one). */
  snoozedUntil?: string
}

export interface MailResult {
  fetchedAt: string
  items: RankedMail[]
  problems: string[]
  ranking: MailRanking
  /** Mail hidden until a later time. */
  snoozed: RankedMail[]
  /** Accounts that can only read mail until they are reconnected. */
  readOnly: string[]
}

/**
 * What the user taught the ranking, kept on this computer only. Each "important" or "not
 * important" on a message also counts for its sender, so later mail from them moves too.
 */
export interface MailPrefs {
  senders: Record<string, { important: number; not: number }>
  messages: Record<string, { verdict: Verdict; at: string }>
  /** Message id → when it comes back. Snoozing is the app's own, so it works for every provider. */
  snoozed: Record<string, string>
}

export const EMPTY_PREFS: MailPrefs = { senders: {}, messages: {}, snoozed: {} }

export function normalizePrefs(raw: unknown): MailPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const senders: MailPrefs['senders'] = {}
  for (const [k, v] of Object.entries((r.senders && typeof r.senders === 'object' ? r.senders : {}) as Record<string, any>)) {
    const important = Math.max(0, Math.floor(Number(v?.important) || 0))
    const not = Math.max(0, Math.floor(Number(v?.not) || 0))
    if (k.includes('@') && (important || not)) senders[k.toLowerCase()] = { important, not }
  }
  const messages: MailPrefs['messages'] = {}
  for (const [k, v] of Object.entries((r.messages && typeof r.messages === 'object' ? r.messages : {}) as Record<string, any>)) {
    if ((v?.verdict === 'important' || v?.verdict === 'not') && typeof v.at === 'string') messages[k] = { verdict: v.verdict, at: v.at }
  }
  const snoozed: MailPrefs['snoozed'] = {}
  for (const [k, v] of Object.entries((r.snoozed && typeof r.snoozed === 'object' ? r.snoozed : {}) as Record<string, unknown>)) {
    if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) snoozed[k] = v
  }
  return { senders, messages, snoozed }
}

export type SnoozeOption = 'later' | 'evening' | 'tomorrow' | 'weekend' | 'nextweek'
export const SNOOZE_OPTIONS: { value: SnoozeOption; label: string }[] = [
  { value: 'later', label: 'In 3 hours' },
  { value: 'evening', label: 'This evening' },
  { value: 'tomorrow', label: 'Tomorrow morning' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'nextweek', label: 'Next week' }
]

/** When a snooze ends, in local time: mornings are 8:00, evenings 18:00. */
export function snoozeUntil(option: SnoozeOption, now = new Date()): Date {
  const at = (days: number, hour: number): Date => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  switch (option) {
    case 'later':
      return new Date(now.getTime() + 3 * 3_600_000)
    case 'evening':
      // After 17:00 "this evening" means tomorrow's.
      return at(now.getHours() >= 17 ? 1 : 0, 18)
    case 'tomorrow':
      return at(1, 8)
    case 'weekend': {
      // Saturday 9:00; once that has passed, the next one.
      const days = (6 - now.getDay() + 7) % 7
      return at(days === 0 && now.getHours() >= 9 ? 7 : days, 9)
    }
    case 'nextweek':
      return at((1 - now.getDay() + 7) % 7 || 7, 8)
  }
}

/** Snoozes a message until `until`, or ends its snooze when null. */
export function applySnooze(prefs: MailPrefs, id: string, until: Date | null): MailPrefs {
  const snoozed = { ...prefs.snoozed }
  if (until) snoozed[id] = until.toISOString()
  else delete snoozed[id]
  return { ...prefs, snoozed }
}

/**
 * Records a verdict on a message (null takes it back). Changing a verdict moves the sender's
 * count from one side to the other, so a misclick doesn't teach the ranking twice.
 */
export function applyVerdict(prefs: MailPrefs, m: Pick<MailMessage, 'id' | 'from'>, verdict: Verdict | null, now = new Date()): MailPrefs {
  const email = m.from.email.toLowerCase()
  const senders = { ...prefs.senders }
  const messages = { ...prefs.messages }
  const old = messages[m.id]?.verdict
  if (old === verdict) return prefs
  const s = { ...(senders[email] ?? { important: 0, not: 0 }) }
  if (old) s[old] = Math.max(0, s[old] - 1)
  if (verdict) s[verdict]++
  if (email.includes('@')) {
    if (s.important || s.not) senders[email] = s
    else delete senders[email]
  }
  if (verdict) messages[m.id] = { verdict, at: now.toISOString() }
  else delete messages[m.id]
  return { ...prefs, senders, messages }
}

/** Forgets message verdicts older than `days`; sender counts stay. */
export function prunePrefs(prefs: MailPrefs, now: Date, days = 60): MailPrefs {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
  // Mail back from a snooze stays on top for three days.
  const woke = new Date(now.getTime() - 3 * 86_400_000).toISOString()
  return {
    senders: prefs.senders,
    messages: Object.fromEntries(Object.entries(prefs.messages).filter(([, v]) => v.at >= cutoff)),
    snoozed: Object.fromEntries(Object.entries(prefs.snoozed).filter(([, until]) => until >= woke))
  }
}

/** Sender lean from -3 (always unimportant) to +3 (always important). */
export function senderLean(prefs: MailPrefs, email: string): number {
  const s = prefs.senders[email.toLowerCase()]
  return s ? Math.max(-3, Math.min(3, s.important - s.not)) : 0
}

/** Extra signal from Jev, per message. */
export interface MailSignal {
  /** 0 (can wait) to 4 (today). */
  urgency: number
  /** Probability that the message asks the user to reply, decide or do something. */
  action: number
  /** Probability that it's automated, marketing or a newsletter. */
  automated: number
  confidence: number
}

const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|news(letter)?|marketing|info|updates?|bounce)[@+.-]/i
const ASKS = /\?|\b(urgent|asap|today|deadline|please|can you|could you|would you|need(ed)? (you|your)|approve|approval|sign|confirm|review|urgente|hoy|favor|puedes|podrías|podrias|necesito|necesitamos|apruebe|aprobar|confirmar|revisar|firma)\b/i
const URGENCY_WORDS = ['can wait', 'this month', 'this week', 'tomorrow', 'today']
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * Scores each message from what the mail itself says: whether it's addressed to the user, sent
 * by a person or a machine, whether it asks something, how new it is, what Gmail thinks of it,
 * and what the user taught the ranking. Jev's answers, when there are any, add to that.
 */
export function rankMail(messages: MailMessage[], prefs: MailPrefs, now = new Date(), ai: Record<string, MailSignal> = {}): RankedMail[] {
  const ranked = messages.map((m): RankedMail => {
    const reasons: [number, string][] = []
    const add = (pts: number, why: string): void => {
      score += pts
      if (why) reasons.push([Math.abs(pts), why])
    }
    let score = 10
    const hours = (now.getTime() - Date.parse(m.receivedAt)) / 3_600_000
    const automated = m.bulk || AUTOMATED_SENDER.test(m.from.email)

    if (m.unread) add(10, 'Unread')
    if (m.addressed === 'to') add(12, automated ? '' : 'Sent to you')
    else if (m.addressed === 'cc') add(3, 'You’re in Cc')
    if (m.bulk) add(-25, 'Newsletter or list')
    else if (AUTOMATED_SENDER.test(m.from.email)) add(-15, 'Automated sender')
    if (m.category === 'promotions' || m.category === 'social') add(-20, m.category === 'promotions' ? 'Promotion' : 'Social')
    else if (m.category === 'updates' || m.category === 'forums') add(-10, '')
    if (m.providerImportant && !automated) add(8, 'Gmail marked it important')
    if (m.starred) add(15, 'Starred')
    if (!automated && ASKS.test(`${m.subject} ${m.snippet}`)) add(8, 'Asks you something')
    if (hours < 24) add(8, '')
    else if (hours > 24 * 7) add(-10, '')
    else if (hours > 72) add(-4, '')

    const lean = senderLean(prefs, m.from.email)
    if (lean > 0) add(lean * 12, 'You mark this sender important')
    if (lean < 0) add(lean * 12, 'You mark this sender unimportant')

    const signal = ai[m.id]
    if (signal) {
      const level = Math.max(0, Math.min(4, Math.round(signal.urgency)))
      score += (signal.urgency * 8 + signal.action * 12 - signal.automated * 15) * signal.confidence
      reasons.push([signal.urgency * 8, `Jev: ${URGENCY_WORDS[level]} (${Math.round(signal.confidence * 100)}%)`])
      if (signal.action >= 0.6 && !reasons.some(([, r]) => r === 'Asks you something')) reasons.push([10, 'Asks you something'])
    }

    score = Math.round(score)
    const verdict = prefs.messages[m.id]?.verdict
    // Read mail older than two days has been dealt with, whatever it scored.
    const stale = !m.unread && hours > 48
    let urgency: MailUrgency = score >= 40 && !stale ? 'now' : score >= 22 ? 'soon' : 'later'
    if (verdict === 'important') {
      urgency = 'now'
      reasons.unshift([99, 'You marked it important'])
    }
    if (verdict === 'not') {
      urgency = 'later'
      score = Math.min(score, 0)
      reasons.unshift([99, 'You marked it not important'])
    }
    const snoozedUntil = prefs.snoozed[m.id]
    if (snoozedUntil && snoozedUntil <= now.toISOString() && verdict !== 'not') {
      urgency = 'now'
      score = Math.max(score, 40)
      reasons.unshift([98, 'Back from snooze'])
    }
    if (hours >= 0 && hours < 1 && reasons.length === 0) reasons.push([0, 'Just arrived'])
    return {
      ...m,
      score,
      urgency,
      reasons: reasons.sort((a, b) => b[0] - a[0]).map(([, r]) => r),
      ...(verdict ? { verdict } : {}),
      ...(snoozedUntil ? { snoozedUntil } : {})
    }
  })
  return ranked.sort((a, b) => b.score - a.score || b.receivedAt.localeCompare(a.receivedAt))
}

/** Newest first, the inbox order. */
export const byDate = (a: MailMessage, b: MailMessage): number => b.receivedAt.localeCompare(a.receivedAt)

// ---------- Jev (TypeSafe AI) ----------

export const JEV_MAIL_QUESTIONS = {
  urgency: {
    type: 'score',
    instructions: 'How soon does the recipient of this email need to read it and act on it or reply?',
    criteria: ['Can wait or be ignored', 'This month', 'This week', 'Tomorrow', 'Today']
  },
  action: { type: 'noul', instructions: 'Does this email ask the recipient personally to reply, decide, approve, attend or do something?' },
  automated: { type: 'noul', instructions: 'Is this an automated notification, marketing message or newsletter rather than an email a person wrote to the recipient?' }
} as const

/** What Jev reads about a message: headers, the preview and what the user taught about the sender. */
export function jevMailState(m: MailMessage, prefs: MailPrefs, now = new Date()): string {
  const lean = senderLean(prefs, m.from.email)
  const hours = Math.max(0, Math.round((now.getTime() - Date.parse(m.receivedAt)) / 3_600_000))
  return [
    `From: ${m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email}`,
    `The recipient is ${m.addressed === 'to' ? 'in To' : m.addressed === 'cc' ? 'only in Cc' : 'not named (list or Bcc)'}${m.bulk ? '; sent through a mailing list' : ''}.`,
    `Received ${hours < 1 ? 'less than an hour' : hours < 48 ? plural(hours, 'hour') : plural(Math.round(hours / 24), 'day')} ago.`,
    lean > 0 ? 'The recipient has marked mail from this sender as important before.' : lean < 0 ? 'The recipient has marked mail from this sender as not important before.' : '',
    `Subject: ${m.subject}`,
    m.snippet ? `Preview: ${m.snippet.slice(0, 600)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function parseJevMail(json: unknown): MailSignal {
  const a = (json as { answers?: Record<string, any> })?.answers
  const score = Number(a?.urgency?.score)
  if (!Number.isFinite(score)) throw new Error('Unexpected answer from Jev.')
  const p = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : 0)
  const confidence = Number(a?.urgency?.confidence)
  return {
    urgency: Math.max(0, Math.min(4, score)),
    action: p(a?.action?.noul),
    automated: p(a?.automated?.noul),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5
  }
}
