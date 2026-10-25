import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MailAction, MailMessage } from '../shared/accounts'
import {
  applySnooze,
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

  constructor(
    dir: string,
    private readonly accounts: AccountService,
    private readonly secrets: SecretStore,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
    private readonly now: () => Date = () => new Date()
  ) {
    this.prefsFile = join(dir, 'mail-prefs.json')
    this.jevFile = join(dir, 'jev-mail-cache.json')
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
        const local = rankMail(feed.items, this.prefs, this.now()).filter((m) => !m.verdict && (m.unread || m.urgency !== 'later'))
        ai = await this.jev(local.slice(0, JEV_TOP), key, problems)
      }
    }
    const jevUsed = feed.items.some((m) => ai[m.id])
    const now = this.now().toISOString()
    const ranked = rankMail(feed.items, this.prefs, this.now(), ai)
    return {
      fetchedAt: now,
      items: ranked.filter((m) => !(m.snoozedUntil && m.snoozedUntil > now)),
      snoozed: ranked.filter((m) => m.snoozedUntil && m.snoozedUntil > now).sort((a, b) => a.snoozedUntil!.localeCompare(b.snoozedUntil!)),
      problems,
      ranking: jevUsed ? 'jev' : 'local',
      readOnly: this.accounts.readOnly()
    }
  }

  /** Changes messages at their providers. Archiving or trashing one also ends its snooze. */
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
