import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { replySubject, type MailAction, type MailBody, type MailDraft, type MailMessage } from '../shared/accounts'
import { extractJson } from '../shared/factcheck'
import type { FactCheckProvider } from './ai-providers'
import { toSnippet } from './accounts/imap'
import {
  applySnooze,
  learnedRules,
  parseProposedRules,
  rulesPrompt,
  senderStats,
  type MailRule,
  type RankedMail,
  MAIL_AI_SYSTEM,
  parseReplies,
  parseSummary,
  replyPrompt,
  summaryPrompt,
  unsubscribeMethod,
  type MailSummary,
  type ReplyIdea,
  applyVerdict,
  EMPTY_PREFS,
  JEV_MAIL_QUESTIONS,
  jevMailState,
  normalizePrefs,
  parseJevMail,
  prunePrefs,
  rankMail,
  snoozeUntil,
  type MailPrefs,
  type MailResult,
  type MailSignal,
  type SnoozeOption,
  type Verdict
} from '../shared/mail'
import type { Settings } from '../shared/settings'
import type { AccountService } from './accounts/service'
import { askJev, JEV_SECRET } from './jev'
import type { SecretStore } from './secrets'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** Messages per account, and in all, that the inbox shows. */
const PER_ACCOUNT = 50
const TOTAL = 150
/** Jev reads the top messages only, each once. */
const JEV_TOP = 30
const JEV_KEEP_DAYS = 14

/**
 * The inbox across every account, ranked by what needs the user. What the user teaches the
 * ranking stays in mail-prefs.json on this computer; it is never synced.
 */
export class MailService {
  private readonly prefsFile: string
  private readonly jevFile: string
  private prefs: MailPrefs
  private jevCache: Record<string, MailSignal & { at: string }>
  /** The last messages shown, so feedback can find a message's sender. */
  private last: MailMessage[] = []
  /** The same, ranked, for proposing rules. */
  private ranked: RankedMail[] = []

  constructor(
    dir: string,
    private readonly accounts: AccountService,
    private readonly secrets: SecretStore,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
    private readonly now: () => Date = () => new Date(),
    /** The AI chosen under Fact checking, used for replies and summaries; null when it has no key. */
    private readonly ai: () => FactCheckProvider | null = () => null
  ) {
    this.prefsFile = join(dir, 'mail-prefs.json')
    this.jevFile = join(dir, 'jev-mail-cache-2.json')
    this.prefs = normalizePrefs(this.read(this.prefsFile))
    this.jevCache = (this.read(this.jevFile) as typeof this.jevCache) ?? {}
  }

  private read(file: string): unknown {
    try {
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
    } catch {
      return null
    }
  }

  private async jev(messages: MailMessage[], key: string, problems: string[]): Promise<Record<string, MailSignal>> {
    const todo = messages.filter((m) => !this.jevCache[m.id])
    let failed = ''
    for (let i = 0; i < todo.length && !failed; i += 4) {
      await Promise.all(
        todo.slice(i, i + 4).map(async (m) => {
          try {
            const answer = await askJev(this.fetchFn, key, jevMailState(m, this.prefs, this.now()), JEV_MAIL_QUESTIONS)
            this.jevCache[m.id] = { ...parseJevMail(answer), at: this.now().toISOString() }
          } catch (e) {
            failed ||= (e as Error).message
          }
        })
      )
    }
    if (failed) problems.push(`Jev ranking: ${failed} Using the built-in ranking for the rest.`)
    const cutoff = new Date(this.now().getTime() - JEV_KEEP_DAYS * 86_400_000).toISOString()
    for (const [id, v] of Object.entries(this.jevCache)) if (v.at < cutoff) delete this.jevCache[id]
    writeFileSync(this.jevFile, JSON.stringify(this.jevCache))
    return this.jevCache
  }

  async load(settings: Settings, force = false): Promise<MailResult> {
    const feed = await this.accounts.recentMail(TOTAL, PER_ACCOUNT, force)
    const problems = [...feed.problems]
    this.last = feed.items
    let ai: Record<string, MailSignal> = {}
    if (settings.mailRanking === 'jev' && feed.items.length) {
      const key = this.secrets.get(JEV_SECRET)
      if (!key) problems.push('Jev ranking is on, but there is no TypeSafe AI key on this computer. Add it in Settings.')
      else {
        // Only mail that might need the user: unread or recent, not already judged by the user.
        const local = rankMail(feed.items, this.prefs, this.now(), {}, settings.mailRules).filter((m) => !m.verdict && (m.unread || m.urgency !== 'later'))
        ai = await this.jev(local.slice(0, JEV_TOP), key, problems)
      }
    }
    const jevUsed = feed.items.some((m) => ai[m.id])
    const now = this.now().toISOString()
    const ranked = rankMail(feed.items, this.prefs, this.now(), ai, settings.mailRules)
    this.ranked = ranked
    return {
      fetchedAt: now,
      items: ranked.filter((m) => !(m.snoozedUntil && m.snoozedUntil > now)),
      snoozed: ranked.filter((m) => m.snoozedUntil && m.snoozedUntil > now).sort((a, b) => a.snoozedUntil!.localeCompare(b.snoozedUntil!)),
      problems,
      ranking: jevUsed ? 'jev' : 'local',
      readOnly: this.accounts.readOnly(),
      suggestions: learnedRules(this.prefs, settings.mailRules)
    }
  }

  /** Changes messages at their providers. Archiving or trashing one ends its snooze; reading one back from a snooze does too. */
  async act(ids: string[], action: MailAction): Promise<void> {
    const byAccount = new Map<string, string[]>()
    for (const id of ids) {
      const m = this.last.find((x) => x.id === id)
      if (!m) throw new Error('That message is no longer loaded. Refresh and try again.')
      byAccount.set(m.accountId, [...(byAccount.get(m.accountId) ?? []), id])
    }
    for (const [accountId, list] of byAccount) await this.accounts.act(accountId, list, action)
    if (action === 'archive' || action === 'trash') {
      this.last = this.last.filter((m) => !ids.includes(m.id))
      for (const id of ids) this.prefs = applySnooze(this.prefs, id, null)
      this.save()
    } else if (action === 'read') {
      const now = this.now().toISOString()
      const woke = ids.filter((id) => this.prefs.snoozed[id] && this.prefs.snoozed[id] <= now)
      for (const id of woke) this.prefs = applySnooze(this.prefs, id, null)
      if (woke.length) this.save()
    }
  }

  /** Hides a message until the chosen time (null brings it back now). Returns when it comes back. */
  snooze(id: string, option: SnoozeOption | null): string | null {
    if (!this.last.some((x) => x.id === id)) throw new Error('That message is no longer loaded. Refresh and try again.')
    const until = option ? snoozeUntil(option, this.now()) : null
    this.prefs = applySnooze(this.prefs, id, until)
    this.save()
    return until?.toISOString() ?? null
  }

  /** The message's text for an AI: the plain part, or text made from the HTML. */
  private async plain(accountId: string, id: string): Promise<{ body: MailBody; from: string; text: string }> {
    const body = await this.accounts.message(accountId, id)
    const text = body.text.trim() || toSnippet(body.html.replace(/<(br|\/p|\/div|\/tr|\/li)\b[^>]*>/gi, '\n'), true, 100_000)
    return { body, from: body.from.name ? `${body.from.name} <${body.from.email}>` : body.from.email, text }
  }

  private provider(): FactCheckProvider {
    const p = this.ai()
    if (!p) throw new Error('Choose an AI and save its key under Settings > Fact checking to get suggestions.')
    return p
  }

  /** Three short replies written by the user's AI. Only this message is sent to it, and only on request. */
  async replyIdeas(accountId: string, id: string, me: string): Promise<{ ideas: ReplyIdea[]; draft: Omit<MailDraft, 'text'> }> {
    const p = this.provider()
    const { body, from, text } = await this.plain(accountId, id)
    const answer = await p.ask({ system: MAIL_AI_SYSTEM, prompt: replyPrompt({ from, subject: body.subject, text }, me) })
    const ideas = parseReplies(extractJson(answer.text))
    if (!ideas.length) throw new Error('The AI didn’t suggest any replies. Try again.')
    return { ideas, draft: this.replyDraft(body) }
  }

  async summary(accountId: string, id: string): Promise<MailSummary> {
    const p = this.provider()
    const { body, from, text } = await this.plain(accountId, id)
    const answer = await p.ask({ system: MAIL_AI_SYSTEM, prompt: summaryPrompt({ from, subject: body.subject, text }) })
    return parseSummary(extractJson(answer.text))
  }

  /** To, Cc and subject for replying to a message: to its Reply-To or sender. */
  replyDraft(body: MailBody, all = false): Omit<MailDraft, 'text'> {
    return { accountId: body.accountId, to: body.replyTo || body.from.email, cc: all ? body.cc : '', subject: replySubject(body.subject), replyTo: body.id }
  }

  async send(draft: MailDraft): Promise<void> {
    await this.accounts.send(draft)
    // A reply means the message was dealt with.
    if (draft.replyTo && this.last.some((m) => m.id === draft.replyTo && m.unread)) await this.act([draft.replyTo], 'read').catch(() => undefined)
  }

  /**
   * Unsubscribes the way the sender offers: a one-click POST, an email from the account, or a
   * page to open (returned as `open`, since that needs the user in a browser).
   */
  async unsubscribe(accountId: string, id: string): Promise<{ done: true; how: string } | { open: string }> {
    const body = await this.accounts.message(accountId, id)
    const method = unsubscribeMethod(body.unsubscribe ?? '', body.unsubscribePost ?? '')
    if (!method) throw new Error('This sender doesn’t offer a way to unsubscribe.')
    if (method.kind === 'link') return { open: method.url }
    if (method.kind === 'one-click') {
      let ok = false
      try {
        const res = await this.fetchFn(method.url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000)
        })
        ok = res.ok
      } catch {
        ok = false
      }
      if (!ok) return { open: method.url }
      return { done: true, how: 'The sender confirmed it.' }
    }
    await this.accounts.send({ accountId, to: method.to, cc: '', subject: method.subject, text: method.body })
    return { done: true, how: `An unsubscribe email went to ${method.to}.` }
  }

  /**
   * Asks the user's AI to propose rules from the senders in the inbox and the user's marks. Only
   * sender addresses, names, counts and subjects are sent; nothing is applied until accepted.
   */
  async proposeRules(settings: Settings): Promise<MailRule[]> {
    const p = this.provider()
    if (!this.ranked.length) await this.load(settings)
    const stats = senderStats(this.ranked, this.prefs)
    if (!stats.length) throw new Error('There’s no mail to learn from yet.')
    const answer = await p.ask({ system: MAIL_AI_SYSTEM, prompt: rulesPrompt(stats, settings.mailRules) })
    const rules = parseProposedRules(extractJson(answer.text), settings.mailRules, `ai:${this.now().getTime().toString(36)}:`)
    if (!rules.length) throw new Error('The AI found no rules worth adding. Mark a few more messages and try again.')
    return rules
  }

  /** A message from the last list, if it is still there. */
  loaded(id: string): MailMessage | undefined {
    return this.last.find((m) => m.id === id)
  }

  private save(): void {
    writeFileSync(this.prefsFile, JSON.stringify(this.prefs))
  }

  /** Records "important" or "not important" on a message (null takes it back). */
  feedback(id: string, verdict: Verdict | null): void {
    const m = this.last.find((x) => x.id === id)
    if (!m) throw new Error('That message is no longer loaded. Refresh and try again.')
    this.prefs = prunePrefs(applyVerdict(this.prefs, m, verdict, this.now()), this.now())
    this.save()
  }

  /** Forgets everything the user taught the ranking; snoozes stay. */
  resetFeedback(): void {
    this.prefs = { ...EMPTY_PREFS, snoozed: this.prefs.snoozed }
    this.save()
  }

  /** How many senders the ranking has learned about, for Settings. */
  learned(): number {
    return Object.keys(this.prefs.senders).length
  }
}

/** The Jira description for a task made from an email: who sent it, when, the text, and a link back. */
export function taskDescription(body: MailBody, link?: string): string {
  const text = (body.text.trim() || toSnippet(body.html, true, 100_000)).slice(0, 4000)
  return [
    `From ${body.from.name ? `${body.from.name} <${body.from.email}>` : body.from.email}, ${new Date(body.receivedAt).toUTCString()}`,
    `Subject: ${body.subject}`,
    text,
    link ? `Open the email: ${link}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}
