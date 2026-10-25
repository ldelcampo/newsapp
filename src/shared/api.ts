import type { TicketResult } from './jira'
import type { FactCheckStep, FactReport, ProviderId, SecretName } from './factcheck'
import type { Account, CalendarEvent, ConnectionTest, MailAction, MailBody, Provider } from './accounts'
import type { MailResult, SnoozeOption, Verdict } from './mail'
import type { Source, SourceStatus } from './news'
import type { RankedArticle } from './ranking'
import type { Settings } from './settings'
import type { Place, Rates, Weather } from './widgets'

export interface NewsResult {
  /** When these articles were downloaded. */
  fetchedAt: string
  /** True when the server was unreachable and cached articles are shown. */
  offline: boolean
  /** Where the included sources came from. */
  via: 'server' | 'this computer'
  /** Human-readable problems with the server or the user's own sources. */
  problems: string[]
  /** Latest fetch result per source. */
  sources: SourceStatus[]
  articles: RankedArticle[]
}

export interface SyncStatus {
  /** 'account': the user's account on the news server; 'folder': a shared folder. */
  mode: 'off' | 'folder' | 'account'
  folder: string
  email?: string
  server?: string
  /** Last successful read or write of the shared file. */
  syncedAt?: string
  /** The computer that last wrote the shared file. */
  lastDevice?: string
  error?: string
}

export type SourceTest = { ok: true; count: number; sample: string[] } | { ok: false; error: string }

export type UpdateState =
  | { status: 'idle' | 'checking' | 'current' }
  /** No build has been published yet. */
  | { status: 'none' }
  /** Running from source, which never updates itself. */
  | { status: 'dev' }
  /** macOS only updates apps that live in the Applications folder. */
  | { status: 'move' }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

/** Mail or events from every enabled account, plus a note for each account that failed. */
export interface AccountFeed<T> {
  items: T[]
  problems: string[]
}

/** What the preload script exposes to the renderer as `window.hub`. */
export interface HubApi {
  getSettings(): Promise<Settings>
  saveSettings(next: Settings): Promise<Settings>
  appInfo(): Promise<{ version: string; platform: string; dataDir: string }>
  loadNews(): Promise<NewsResult>
  /** Status per source from the latest news load in this session. */
  sourceStatuses(): Promise<SourceStatus[]>
  testSource(source: Source): Promise<SourceTest>
  syncStatus(): Promise<SyncStatus>
  /** Merges the sync folder now and returns the result. */
  syncNow(): Promise<SyncStatus>
  /** Asks the user for a folder; null when they cancel. */
  chooseSyncFolder(): Promise<string | null>
  /** The iCloud Drive folder on this Mac, or null. */
  iCloudFolder(): Promise<string | null>
  /** Creates an account (create=true) or signs in, then starts syncing through it. */
  syncSignIn(server: string, email: string, passphrase: string, create: boolean): Promise<SyncStatus>
  syncSignOut(): Promise<SyncStatus>
  /** Calls back when another computer's changes arrive; returns an unsubscribe function. */
  onSettingsChanged(cb: (s: Settings) => void): () => void
  openExternal(url: string): Promise<void>
  /** macOS: moves the app into Applications and relaunches it from there. */
  moveToApplications(): Promise<boolean>
  /** Exchange rates for the currency widget (cached for an hour). */
  rates(base: string, symbols: string[]): Promise<Rates>
  /** Weather for the weather widget (cached for 30 minutes). */
  weather(place: Place): Promise<Weather>
  /** Places matching a name, for choosing the weather location. */
  findPlaces(query: string): Promise<Place[]>
  /** Checks the token with Jira, keeps it in the keychain and adds the site to Settings. */
  jiraConnect(input: { url: string; email: string; token: string }): Promise<{ ok: true; settings: Settings } | { ok: false; error: string }>
  jiraDisconnect(siteId: string): Promise<Settings>
  /** Open tickets from every connected site, ranked (cached for 5 minutes unless forced). */
  tickets(force?: boolean): Promise<TicketResult>
  hasJevKey(): Promise<boolean>
  /** An empty key removes it. Returns whether a key is stored. */
  setJevKey(key: string): Promise<boolean>
  /** Account types this build can connect (Microsoft needs an app registration). */
  accountProviders(): Promise<Provider[]>
  /** Connected mail and calendar accounts. */
  accounts(): Promise<Account[]>
  /** Signs in (Microsoft, Google) or checks the typed details (IMAP), then saves the account. */
  addAccount(provider: Provider, input?: unknown): Promise<Account>
  updateAccount(id: string, patch: { mail?: boolean; calendar?: boolean }): Promise<Account>
  /** Signs in again after the provider rejected the saved sign-in. */
  reconnectAccount(id: string): Promise<Account>
  removeAccount(id: string): Promise<void>
  /** Checks IMAP and SMTP logins and looks for a calendar, without saving anything. */
  testImap(input: unknown): Promise<ConnectionTest>
  /** Inbox mail across accounts with mail switched on, ranked by what needs the user (cached for 2 minutes unless forced). */
  recentMail(force?: boolean): Promise<MailResult>
  /** One message in full, for reading in the app. Doesn't mark it as read. */
  mailBody(accountId: string, id: string): Promise<MailBody>
  /** Teaches the ranking that a message (and its sender) is important or not; null takes it back. */
  mailFeedback(id: string, verdict: Verdict | null): Promise<void>
  /** Archive, trash, read/unread or star messages at their providers. */
  mailAct(ids: string[], action: MailAction): Promise<void>
  /** Hides a message until later; null brings it back now. Returns when it comes back. */
  mailSnooze(id: string, option: SnoozeOption | null): Promise<string | null>
  /** How many senders the ranking has learned about. */
  mailLearned(): Promise<number>
  /** Forgets everything the user taught the mail ranking. */
  resetMailFeedback(): Promise<void>
  /** Events from today through the next 7 days, across accounts with calendar switched on (cached for 5 minutes). */
  upcomingEvents(): Promise<AccountFeed<CalendarEvent>>
  getUpdate(): Promise<UpdateState>
  checkForUpdate(): Promise<UpdateState>
  installUpdate(): Promise<void>
  /** Calls back on every update state change; returns an unsubscribe function. */
  onUpdate(cb: (state: UpdateState) => void): () => void
  /** Checks a story from the latest news load: coverage always, claims when an AI key is set. */
  verifyArticle(articleId: string): Promise<FactReport>
  /** The saved report for a story, if it was checked before. */
  savedReport(articleId: string): Promise<FactReport | null>
  /** Calls back as a check moves through its steps; returns an unsubscribe function. */
  onVerifyStep(cb: (articleId: string, step: FactCheckStep) => void): () => void
  /** Which keys are saved. The keys themselves never reach this window. */
  secrets(): Promise<Record<SecretName, boolean>>
  /** Saves a key in the OS keychain, or removes it when `value` is empty. */
  setSecret(name: SecretName, value: string): Promise<Record<SecretName, boolean>>
  /** Sends a tiny request to see that a provider, key and model work. */
  testProvider(provider: ProviderId): Promise<{ ok: true } | { ok: false; error: string }>
}
