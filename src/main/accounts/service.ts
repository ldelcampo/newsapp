import { mergeEvents, mergeMail, type Account, type CalendarEvent, type MailAction, type MailBody, type MailMessage, type Provider } from '../../shared/accounts'
import { AuthExpiredError, type Connector } from './connector'
import type { AccountFeed } from '../../shared/api'
import type { AccountStore } from './store'

const MAIL_TTL = 2 * 60_000
const EVENTS_TTL = 5 * 60_000

/** Every connected account behind one interface; answers are cached briefly to stay inside provider rate limits. */
export class AccountService {
  private readonly cache = new Map<string, { at: number; value: unknown }>()

  constructor(
    private readonly store: AccountStore,
    private readonly connectors: Partial<Record<Provider, Connector>>,
    private readonly now: () => number = Date.now
  ) {}

  /** Providers this build can connect. */
  providers(): Provider[] {
    return (Object.keys(this.connectors) as Provider[]).filter((p) => this.connectors[p])
  }

  list(): Account[] {
    return this.store.list()
  }

  private connector(provider: Provider): Connector {
    const c = this.connectors[provider]
    if (!c) throw new Error(`This build can't connect ${provider} accounts yet.`)
    return c
  }

  async add(provider: Provider, input?: unknown): Promise<Account> {
    const account = await this.connector(provider).add(input)
    this.cache.clear()
    return this.store.put({ ...account, status: 'ok' })
  }

  async update(id: string, patch: { mail?: boolean; calendar?: boolean }): Promise<Account> {
    const old = this.store.get(id)
    if (!old) throw new Error('That account is no longer connected.')
    const c = this.connector(old.provider)
    let account: Account = { ...old, mail: patch.mail ?? old.mail, calendar: patch.calendar ?? old.calendar }
    // A switch turned on may need a permission the first sign-in didn't include (or the user unticked).
    const turnedOn = (account.mail && !old.mail) || (account.calendar && !old.calendar)
    if (turnedOn && c.reconsent) account = await c.reconsent(account)
    this.cache.clear()
    return this.store.put(account)
  }

  /** Signs in again after the saved sign-in stopped working. */
  async reconnect(id: string): Promise<Account> {
    const account = this.store.get(id)
    if (!account) throw new Error('That account is no longer connected.')
    const c = this.connector(account.provider)
    const fresh = c.reconsent ? await c.reconsent(account) : await c.add()
    this.cache.clear()
    return this.store.put({ ...account, ...fresh, mail: account.mail, calendar: account.calendar, status: 'ok' })
  }

  async remove(id: string): Promise<void> {
    const account = this.store.get(id)
    if (!account) return
    await this.connectors[account.provider]?.remove?.(account).catch(() => undefined)
    this.store.remove(id)
    this.cache.clear()
  }

  private async gather<T>(kind: string, ttl: number, enabled: (a: Account) => boolean, load: (c: Connector, a: Account) => Promise<T[]>): Promise<{ lists: T[][]; problems: string[] }> {
    const accounts = this.store.list().filter((a) => enabled(a) && this.connectors[a.provider])
    const problems: string[] = []
    const lists = await Promise.all(
      accounts.map(async (a) => {
        const key = `${kind}:${a.id}`
        const hit = this.cache.get(key)
        if (hit && this.now() - hit.at < ttl) return hit.value as T[]
        try {
          const items = await load(this.connectors[a.provider]!, a)
          this.cache.set(key, { at: this.now(), value: items })
          if (a.status === 'reauth') this.store.put({ ...a, status: 'ok' })
          return items
        } catch (e) {
          if (e instanceof AuthExpiredError) this.store.put({ ...a, status: 'reauth' })
          problems.push(`${a.email || a.name}: ${(e as Error).message}`)
          // An older answer beats an empty list.
          return (hit?.value as T[]) ?? []
        }
      })
    )
    return { lists, problems }
  }

  /** Newest inbox mail: up to `perAccount` from each account, `limit` in all. `force` skips the cache. */
  async recentMail(limit = 30, perAccount = limit, force = false): Promise<AccountFeed<MailMessage>> {
    if (force) for (const k of [...this.cache.keys()]) if (k.startsWith('mail:')) this.cache.delete(k)
    const { lists, problems } = await this.gather('mail', MAIL_TTL, (a) => a.mail, (c, a) => c.recentMail(a, perAccount))
    return { items: mergeMail(lists, limit), problems }
  }

  /** Accounts whose sign-in only allows reading mail. */
  readOnly(): string[] {
    return this.store.list().filter((a) => a.mail && this.connectors[a.provider]?.canChange?.(a) === false).map((a) => a.id)
  }

  /** Changes messages at the provider, then updates the cached inbox to match, so the next list shows it at once. */
  async act(accountId: string, ids: string[], action: MailAction): Promise<void> {
    const account = this.store.get(accountId)
    if (!account) throw new Error('That account is no longer connected.')
    const c = this.connector(account.provider)
    if (!c.act) throw new Error('This account can’t change mail from the app yet.')
    try {
      await c.act(account, ids, action)
    } catch (e) {
      if (e instanceof AuthExpiredError) this.store.put({ ...account, status: 'reauth' })
      throw e
    }
    const key = `mail:${accountId}`
    const hit = this.cache.get(key)
    if (!hit) return
    const set = new Set(ids)
    const list = (hit.value as MailMessage[]).flatMap((m): MailMessage[] => {
      if (!set.has(m.id)) return [m]
      if (action === 'archive' || action === 'trash') return []
      if (action === 'read' || action === 'unread') return [{ ...m, unread: action === 'unread' }]
      return [{ ...m, starred: action === 'star' }]
    })
    this.cache.set(key, { at: hit.at, value: list })
  }

  async message(accountId: string, id: string): Promise<MailBody> {
    const account = this.store.get(accountId)
    if (!account) throw new Error('That account is no longer connected.')
    const c = this.connector(account.provider)
    if (!c.message) throw new Error('This account can’t open messages in the app yet.')
    try {
      return await c.message(account, id)
    } catch (e) {
      if (e instanceof AuthExpiredError) this.store.put({ ...account, status: 'reauth' })
      throw e
    }
  }

  /** Events from now until `days` days ahead. */
  async upcomingEvents(days = 7): Promise<AccountFeed<CalendarEvent>> {
    const now = new Date(this.now())
    const from = new Date(now)
    from.setHours(0, 0, 0, 0)
    const to = new Date(from.getTime() + days * 86_400_000)
    const { lists, problems } = await this.gather(`events:${days}`, EVENTS_TTL, (a) => a.calendar, (c, a) => c.events(a, from.toISOString(), to.toISOString()))
    return { items: mergeEvents(lists, now), problems }
  }
}
