import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MailMessage } from '../shared/accounts'
import {
  applyVerdict,
  EMPTY_PREFS,
  JEV_MAIL_QUESTIONS,
  jevMailState,
  normalizePrefs,
  parseJevMail,
  prunePrefs,
  rankMail,
  type MailPrefs,
  type MailResult,
  type MailSignal,
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
    return { fetchedAt: this.now().toISOString(), items: rankMail(feed.items, this.prefs, this.now(), ai), problems, ranking: jevUsed ? 'jev' : 'local' }
  }

  /** Records "important" or "not important" on a message (null takes it back). */
  feedback(id: string, verdict: Verdict | null): void {
    const m = this.last.find((x) => x.id === id)
    if (!m) throw new Error('That message is no longer loaded. Refresh and try again.')
    this.prefs = prunePrefs(applyVerdict(this.prefs, m, verdict, this.now()), this.now())
    writeFileSync(this.prefsFile, JSON.stringify(this.prefs))
  }

  /** Forgets everything the user taught the ranking. */
  resetFeedback(): void {
    this.prefs = EMPTY_PREFS
    writeFileSync(this.prefsFile, JSON.stringify(this.prefs))
  }

  /** How many senders the ranking has learned about, for Settings. */
  learned(): number {
    return Object.keys(this.prefs.senders).length
  }
}
