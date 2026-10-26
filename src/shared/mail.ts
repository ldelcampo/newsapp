/** Mail triage: how messages are ranked, what the user taught the ranking, and what Jev is asked. */
import type { MailMessage } from './accounts'

export type MailRanking = 'local' | 'jev'
export type MailUrgency = 'now' | 'soon' | 'later'
/** What the user said about a message or its sender. */
export type Verdict = 'important' | 'not'

/** What kind of mail it is, for the tabs. */
export type MailCategory = 'reply' | 'fyi' | 'newsletter' | 'promotion' | 'receipt' | 'notification'
export const MAIL_CATEGORIES: { value: MailCategory; label: string; jev: string }[] = [
  { value: 'reply', label: 'Needs reply', jev: 'A person wrote to the recipient and expects a reply, decision or action' },
  { value: 'fyi', label: 'FYI', jev: 'Written by a person or team, but only informs; nothing is asked' },
  { value: 'newsletter', label: 'Newsletters', jev: 'A newsletter, digest or mailing-list post' },
  { value: 'promotion', label: 'Promotions', jev: 'Marketing: offers, sales, product announcements' },
  { value: 'receipt', label: 'Receipts', jev: 'A receipt, invoice, order, booking, payment or account statement' },
  { value: 'notification', label: 'Notifications', jev: 'An automated alert or notification from an app or service' }
]
export const categoryLabel = (c: MailCategory): string => MAIL_CATEGORIES.find((x) => x.value === c)?.label ?? c

/**
 * A rule the user approved: mail matching it gets a category and, optionally, an importance.
 * Rules run on this computer; they sync with the other settings.
 */
export interface MailRule {
  id: string
  /** An address (ana@x.com) or a whole domain (@x.com). */
  from?: string
  /** Words the subject contains, any case. */
  subject?: string
  category?: MailCategory
  /** 'important' always shows it under Important; 'hide' keeps it out of everything but All mail. */
  importance?: 'important' | 'normal' | 'hide'
  /** Why the rule exists, shown in the list; AI-proposed rules say what they saw. */
  note?: string
  source: 'you' | 'ai' | 'learned'
}

export interface RankedMail extends MailMessage {
  score: number
  urgency: MailUrgency
  kind: MailCategory
  /** Kept out of every view but All mail by a rule. */
  hidden?: boolean
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
  /** Rules the user's own marks support, offered for approval. */
  suggestions: MailRule[]
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

const RULE_FROM = /^(@[a-z0-9.-]+\.[a-z]{2,}|[^\s@]+@[a-z0-9.-]+\.[a-z]{2,})$/i

/** Drops malformed rules, so old or hand-edited settings still load. */
export function normalizeRules(raw: unknown): MailRule[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r): MailRule[] => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const from = typeof o.from === 'string' && RULE_FROM.test(o.from.trim()) ? o.from.trim().toLowerCase() : undefined
    const subject = typeof o.subject === 'string' && o.subject.trim() ? o.subject.trim().slice(0, 100) : undefined
    const category = MAIL_CATEGORIES.some((c) => c.value === o.category) ? (o.category as MailCategory) : undefined
    const importance = o.importance === 'important' || o.importance === 'normal' || o.importance === 'hide' ? o.importance : undefined
    if (typeof o.id !== 'string' || !o.id || (!from && !subject) || (!category && !importance)) return []
    const source = o.source === 'ai' || o.source === 'learned' ? o.source : 'you'
    const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 200) : undefined
    return [{ id: o.id, ...(from ? { from } : {}), ...(subject ? { subject } : {}), ...(category ? { category } : {}), ...(importance ? { importance } : {}), ...(note ? { note } : {}), source }]
  }).slice(0, 300)
}

export function ruleMatches(r: MailRule, m: Pick<MailMessage, 'from' | 'subject'>): boolean {
  const email = m.from.email.toLowerCase()
  if (r.from && !(r.from.startsWith('@') ? email.endsWith(r.from) || email.endsWith(`.${r.from.slice(1)}`) : email === r.from)) return false
  if (r.subject && !m.subject.toLowerCase().includes(r.subject.toLowerCase())) return false
  return true
}

/** Plain words for a rule, e.g. "From @x.com → Promotions, hidden". */
export function describeRule(r: MailRule): string {
  const when = [r.from ? `From ${r.from}` : '', r.subject ? `subject has “${r.subject}”` : ''].filter(Boolean).join(' and ')
  const then = [r.category ? categoryLabel(r.category) : '', r.importance === 'important' ? 'always important' : r.importance === 'hide' ? 'hidden' : r.importance === 'normal' ? 'not important' : '']
    .filter(Boolean)
    .join(', ')
  return `${when} → ${then}`
}

const RECEIPT = /\b(receipt|invoice|your order|order (confirmation|#)|payment|booking|reservation confirmed|statement|factura|recibo|comprobante|pedido|compra|pago|estado de cuenta|reservaci[oó]n confirmada|cfdi)\b/i
const PROMO = /\b(sale|% off|discount|deal|offer|limited time|free shipping|oferta|descuento|promoci[oó]n|venta|rebaja|gratis|cup[oó]n)\b|%/i

/** The category from what the message itself shows, before Jev or rules. */
export function guessCategory(m: MailMessage, asks: boolean): MailCategory {
  const text = `${m.subject} ${m.snippet}`
  const machine = AUTOMATED_SENDER.test(m.from.email)
  if (RECEIPT.test(text) && (machine || m.bulk || m.category === 'updates' || !asks)) return 'receipt'
  if (m.category === 'promotions' || ((m.bulk || machine) && PROMO.test(text))) return 'promotion'
  if (m.bulk || m.category === 'forums') return 'newsletter'
  if (machine || m.category === 'updates' || m.category === 'social') return 'notification'
  return asks && m.addressed !== 'none' ? 'reply' : 'fyi'
}

/**
 * Rules the user's own marks already support: a sender marked the same way at least twice.
 * They are offered, never applied, until the user accepts them.
 */
export function learnedRules(prefs: MailPrefs, existing: MailRule[]): MailRule[] {
  const covered = new Set(existing.map((r) => r.from).filter(Boolean))
  return Object.entries(prefs.senders).flatMap(([email, s]): MailRule[] => {
    if (covered.has(email)) return []
    if (s.important >= 2 && s.not === 0) return [{ id: `learned:${email}`, from: email, importance: 'important', source: 'learned', note: `You marked ${s.important} messages from this sender important.` }]
    if (s.not >= 2 && s.important === 0) return [{ id: `learned:${email}`, from: email, importance: 'hide', source: 'learned', note: `You marked ${s.not} messages from this sender not important.` }]
    return []
  })
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
  /** Jev's category and how sure it is; missing in answers cached before categories existed. */
  category?: MailCategory
  categoryConfidence?: number
}

const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|news(letter)?|marketing|info|updates?|bounce)[@+.-]/i
const ASKS = /\?|\b(urgent|asap|today|deadline|please|can you|could you|would you|need(ed)? (you|your)|approve|approval|sign|confirm|review|urgente|hoy|favor|puedes|podrías|podrias|necesito|necesitamos|apruebe|aprobar|confirmar|revisar|firma)\b/i
/** A request for the reader to answer or act, which makes mail "Needs reply" (urgency words alone don't). */
const REQUEST = /\?|\b(please|can you|could you|would you|let me know|need(ed)? (you|your)|approve|confirm|review|sign|puedes|podr[ií]as|favor|necesito|necesitamos|confirma|revisa|aprueba|me dices|quedo atento)\b/i
const URGENCY_WORDS = ['can wait', 'this month', 'this week', 'tomorrow', 'today']
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * Scores each message from what the mail itself says: whether it's addressed to the user, sent
 * by a person or a machine, whether it asks something, how new it is, what Gmail thinks of it,
 * and what the user taught the ranking. Jev's answers, when there are any, add to that.
 */
export function rankMail(messages: MailMessage[], prefs: MailPrefs, now = new Date(), ai: Record<string, MailSignal> = {}, rules: MailRule[] = []): RankedMail[] {
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
    const asks = !automated && ASKS.test(`${m.subject} ${m.snippet}`)
    if (asks) add(8, 'Asks you something')
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

    let kind = guessCategory(m, (!automated && REQUEST.test(`${m.subject} ${m.snippet}`)) || (signal?.action ?? 0) >= 0.6)
    if (signal?.category && (signal.categoryConfidence ?? 0) >= 0.5) kind = signal.category
    const rule = rules.find((r) => ruleMatches(r, m))
    if (rule?.category) kind = rule.category
    if (kind === 'promotion' || kind === 'newsletter') score -= 8

    score = Math.round(score)
    const verdict = prefs.messages[m.id]?.verdict
    // Read mail older than two days has been dealt with, whatever it scored.
    const stale = !m.unread && hours > 48
    let urgency: MailUrgency = score >= 40 && !stale ? 'now' : score >= 22 ? 'soon' : 'later'
    let hidden = false
    if (rule?.importance === 'important') {
      urgency = urgency === 'later' ? 'soon' : urgency
      score = Math.max(score, 30)
      reasons.unshift([97, 'Your rule: important'])
    } else if (rule?.importance === 'normal' || rule?.importance === 'hide') {
      urgency = 'later'
      hidden = rule.importance === 'hide'
      reasons.unshift([97, rule.importance === 'hide' ? 'Your rule: hidden' : 'Your rule: not important'])
    } else if (rule?.category) reasons.unshift([96, `Your rule: ${categoryLabel(rule.category)}`])
    if (verdict === 'important') {
      urgency = 'now'
      hidden = false
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
      kind,
      ...(hidden ? { hidden } : {}),
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
  automated: { type: 'noul', instructions: 'Is this an automated notification, marketing message or newsletter rather than an email a person wrote to the recipient?' },
  category: {
    type: 'choice',
    instructions: 'What kind of email is this?',
    criteria: Object.fromEntries(MAIL_CATEGORIES.map((c) => [c.value, c.jev]))
  }
}

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
  const category = MAIL_CATEGORIES.find((c) => c.value === a?.category?.choice)?.value
  return {
    urgency: Math.max(0, Math.min(4, score)),
    action: p(a?.action?.noul),
    automated: p(a?.automated?.noul),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    ...(category ? { category, categoryConfidence: Number.isFinite(Number(a?.category?.confidence)) ? p(a?.category?.confidence) : 0.5 } : {})
  }
}

// ---------- AI help: quick replies and summaries (the user's own AI provider, per click) ----------

export const MAIL_AI_SYSTEM =
  'You help a busy professional handle email. You write in the language of the email you are given, you never invent facts, ' +
  'dates or commitments the user did not state, and you always answer with one JSON object and nothing else.'

export interface ReplyIdea {
  /** Two to four words, e.g. "Yes, approved". */
  label: string
  text: string
}

export interface MailSummary {
  summary: string
  /** What the email asks the user to do, if anything. */
  asks: string[]
  /** Dates or deadlines mentioned, as written. */
  dates: string[]
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}\n[…cut]` : s)

export function replyPrompt(email: { from: string; subject: string; text: string }, me: string): string {
  return [
    `The user is ${me}. Suggest three short, different replies they might send to this email: for example one that agrees, one that asks for something or more time, and one that declines or redirects, whichever fit.`,
    'Each reply is two to four sentences, polite and direct, ready to send, signed with nothing (the app adds no signature).',
    'Answer as JSON: {"replies":[{"label":"Yes, approved","text":"..."}]}',
    '',
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    '',
    clip(email.text, 12_000)
  ].join('\n')
}

export function summaryPrompt(email: { from: string; subject: string; text: string }): string {
  return [
    'Summarise this email, including any earlier messages quoted in it, in at most three sentences.',
    'Then list what it asks the reader to do, and any dates or deadlines mentioned, exactly as written. Use empty lists when there are none.',
    'Answer as JSON: {"summary":"...","asks":["..."],"dates":["..."]}',
    '',
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    '',
    clip(email.text, 30_000)
  ].join('\n')
}

const strings = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()).slice(0, max)

export function parseReplies(json: unknown): ReplyIdea[] {
  const list = (json as { replies?: unknown })?.replies
  return (Array.isArray(list) ? list : [])
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
    .filter((r) => typeof r.text === 'string' && r.text.trim())
    .map((r) => ({ label: typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 40) : 'Reply', text: String(r.text).trim() }))
    .slice(0, 4)
}

export function parseSummary(json: unknown): MailSummary {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  if (typeof j.summary !== 'string' || !j.summary.trim()) throw new Error('The AI answer had no summary in it.')
  return { summary: j.summary.trim(), asks: strings(j.asks, 6), dates: strings(j.dates, 6) }
}

// ---------- Unsubscribe ----------

export type UnsubscribeMethod =
  /** RFC 8058: a POST to the link unsubscribes with no page to visit. */
  | { kind: 'one-click'; url: string }
  | { kind: 'link'; url: string }
  | { kind: 'mail'; to: string; subject: string; body: string }

/** The best way to unsubscribe from List-Unsubscribe (and List-Unsubscribe-Post), or null. */
export function unsubscribeMethod(header: string, post = ''): UnsubscribeMethod | null {
  const links = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim())
  const https = links.find((l) => /^https:\/\//i.test(l))
  if (https && /List-Unsubscribe\s*=\s*One-Click/i.test(post)) return { kind: 'one-click', url: https }
  const mailto = links.find((l) => /^mailto:/i.test(l))
  if (mailto) {
    const [addr, query = ''] = mailto.slice(7).split('?')
    const q = new URLSearchParams(query)
    const to = decodeURIComponent(addr)
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { kind: 'mail', to, subject: q.get('subject') || 'unsubscribe', body: q.get('body') || 'unsubscribe' }
  }
  return https ? { kind: 'link', url: https } : null
}

// ---------- Rules the AI proposes ----------

export interface SenderStats {
  email: string
  name: string
  count: number
  unread: number
  bulk: boolean
  kind: MailCategory
  subjects: string[]
  important: number
  not: number
}

/** One line per sender: what the AI sees when it proposes rules. Message bodies are never included. */
export function senderStats(mail: RankedMail[], prefs: MailPrefs, max = 60): SenderStats[] {
  const by = new Map<string, SenderStats>()
  for (const m of mail) {
    const email = m.from.email.toLowerCase()
    if (!email) continue
    const s = by.get(email) ?? { email, name: m.from.name, count: 0, unread: 0, bulk: false, kind: m.kind, subjects: [], important: 0, not: 0 }
    s.count++
    if (m.unread) s.unread++
    s.bulk ||= !!m.bulk
    if (s.subjects.length < 3) s.subjects.push(m.subject.slice(0, 90))
    by.set(email, s)
  }
  for (const [email, v] of Object.entries(prefs.senders)) {
    const s = by.get(email)
    if (s) Object.assign(s, { important: v.important, not: v.not })
  }
  return [...by.values()].sort((a, b) => b.important + b.not - (a.important + a.not) || b.count - a.count).slice(0, max)
}

export function rulesPrompt(stats: SenderStats[], existing: MailRule[]): string {
  return [
    'The user wants to see only the email that matters. From the senders below, propose up to 12 rules.',
    'A rule matches a sender address, or a whole domain written as "@domain.com" when several senders there behave alike, and optionally words in the subject.',
    `It sets a category (${MAIL_CATEGORIES.map((c) => c.value).join(', ')}) and/or an importance: "important" (always show), "normal", or "hide" (keep out of the inbox views).`,
    'Follow the user\'s own marks first. Hide only bulk or automated senders the user ignores or marked not important; never hide a person writing directly. Prefer fewer, broader rules.',
    'For each rule write a short "note" saying what you saw, in the language most subjects use.',
    'Answer as JSON: {"rules":[{"from":"@shop.com","category":"promotion","importance":"hide","note":"..."}]}',
    '',
    existing.length ? `Rules the user already has (don't repeat them):\n${existing.map(describeRule).join('\n')}\n` : '',
    'Senders (address | name | messages | unread | list mail | guessed kind | marked important / not important | sample subjects):',
    ...stats.map((s) => `${s.email} | ${s.name} | ${s.count} | ${s.unread} | ${s.bulk ? 'yes' : 'no'} | ${s.kind} | ${s.important}/${s.not} | ${s.subjects.join(' ; ')}`)
  ].join('\n')
}

/** The AI's proposals as rules, minus ones that repeat an existing rule. */
export function parseProposedRules(json: unknown, existing: MailRule[], idPrefix: string): MailRule[] {
  const raw = (json as { rules?: unknown })?.rules
  const list = normalizeRules((Array.isArray(raw) ? raw : []).map((r, i) => ({ ...(r && typeof r === 'object' ? r : {}), id: `${idPrefix}${i}`, source: 'ai' })))
  const key = (r: MailRule): string => `${r.from ?? ''}|${r.subject ?? ''}`
  const have = new Set(existing.map(key))
  return list.filter((r) => !have.has(key(r))).slice(0, 12)
}
