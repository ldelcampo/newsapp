import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type ICachePlugin,
  type TokenCacheContext
} from '@azure/msal-node'
import type { Account, CalendarEvent, MailMessage } from '../../shared/accounts'
import { CALENDAR_SCOPES, MAIL_SCOPES, eventsUrl, mailUrl, parseEvents, parseMessages } from '../../shared/microsoft-graph'
import { USER_AGENT } from '../../shared/polite-fetch'
import { AuthExpiredError, type Connector } from './connector'
import type { AccountStore } from './store'

/**
 * The app's registration in Microsoft Entra (Azure). It is not a secret: desktop apps are
 * "public clients" that sign in with PKCE. HUB_MICROSOFT_CLIENT_ID overrides it for testing.
 */
export const MICROSOFT_CLIENT_ID = process.env.HUB_MICROSOFT_CLIENT_ID || ''

/** "common" accepts both work or school accounts and personal Outlook.com accounts. */
const AUTHORITY = 'https://login.microsoftonline.com/common'
const CACHE_KEY = 'microsoft:token-cache'

/** Who signed in; homeAccountId is MSAL's stable key for the account. */
export interface MicrosoftUser {
  homeAccountId: string
  username: string
  name: string
}

/** Token handling, separate from Graph calls so the connector can be tested without MSAL. */
export interface MicrosoftTokens {
  signIn(scopes: string[]): Promise<MicrosoftUser>
  token(homeAccountId: string, scopes: string[]): Promise<string>
  forget(homeAccountId: string): Promise<void>
}

const page = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;background:#05070f;color:#e8ecff"><div><h1 style="font-weight:600">${title}</h1><p>${text}</p></div>`

/** MSAL with its token cache kept in the encrypted secrets file. Sign-in opens the system browser. */
export class MsalTokens implements MicrosoftTokens {
  private client: PublicClientApplication | null = null

  constructor(
    private readonly store: AccountStore,
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly clientId = MICROSOFT_CLIENT_ID
  ) {}

  /** Created on first use, so a build without a client ID still starts. */
  private get pca(): PublicClientApplication {
    if (this.client) return this.client
    if (!this.clientId) throw new Error('Microsoft sign-in isn’t set up in this build yet.')
    const cachePlugin: ICachePlugin = {
      beforeCacheAccess: async (ctx: TokenCacheContext) => {
        const saved = this.store.getSecret(CACHE_KEY)
        if (saved) ctx.tokenCache.deserialize(saved)
      },
      afterCacheAccess: async (ctx: TokenCacheContext) => {
        if (ctx.cacheHasChanged) this.store.setSecret(CACHE_KEY, ctx.tokenCache.serialize())
      }
    }
    this.client = new PublicClientApplication({ auth: { clientId: this.clientId, authority: AUTHORITY }, cache: { cachePlugin } })
    return this.client
  }

  async signIn(scopes: string[]): Promise<MicrosoftUser> {
    const result = await this.pca.acquireTokenInteractive({
      scopes,
      // Always show the account picker, so a second Microsoft account can be added.
      prompt: 'select_account',
      openBrowser: this.openBrowser,
      successTemplate: page('You’re signed in', 'You can close this tab and go back to Information Hub.'),
      errorTemplate: page('Sign-in didn’t finish', 'Close this tab and try again from Information Hub.')
    })
    if (!result.account) throw new Error('Microsoft didn’t say which account signed in.')
    return { homeAccountId: result.account.homeAccountId, username: result.account.username, name: result.account.name ?? '' }
  }

  async token(homeAccountId: string, scopes: string[]): Promise<string> {
    const account = await this.pca.getTokenCache().getAccountByHomeId(homeAccountId)
    if (!account) throw new AuthExpiredError()
    try {
      return (await this.pca.acquireTokenSilent({ account, scopes })).accessToken
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) throw new AuthExpiredError()
      throw e
    }
  }

  async forget(homeAccountId: string): Promise<void> {
    const cache = this.pca.getTokenCache()
    const account = await cache.getAccountByHomeId(homeAccountId)
    if (account) await cache.removeAccount(account)
  }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const ID_PREFIX = 'microsoft:'
const homeIdOf = (account: Account): string => account.id.slice(ID_PREFIX.length)

/** Outlook mail and calendar for work, school and personal Microsoft accounts, through Microsoft Graph. */
export class MicrosoftConnector implements Connector {
  readonly provider = 'microsoft' as const

  constructor(
    private readonly tokens: MicrosoftTokens,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly now: () => Date = () => new Date()
  ) {}

  private scopes(calendar: boolean): string[] {
    return calendar ? [...MAIL_SCOPES, ...CALENDAR_SCOPES] : MAIL_SCOPES
  }

  /** input: { calendar?: boolean }; false connects mail only and never asks for calendar access. */
  async add(input?: unknown): Promise<Account> {
    const calendar = (input as { calendar?: unknown } | undefined)?.calendar !== false
    const user = await this.tokens.signIn(this.scopes(calendar))
    return {
      id: ID_PREFIX + user.homeAccountId,
      provider: 'microsoft',
      email: user.username,
      name: user.name,
      mail: true,
      calendar,
      addedAt: this.now().toISOString()
    }
  }

  /** Called with the switches as the user wants them, e.g. calendar just turned on. */
  async reconsent(account: Account): Promise<Account> {
    const scopes = this.scopes(account.calendar)
    // Already granted (e.g. calendar was switched off and on again): no browser needed.
    if (account.status !== 'reauth') {
      try {
        await this.tokens.token(homeIdOf(account), scopes)
        return account
      } catch {
        // Fall through to an interactive sign-in.
      }
    }
    const user = await this.tokens.signIn(scopes)
    if (ID_PREFIX + user.homeAccountId !== account.id) {
      throw new Error(`You signed in as ${user.username}. Choose ${account.email} to update this account.`)
    }
    return { ...account, email: user.username, name: user.name || account.name }
  }

  async remove(account: Account): Promise<void> {
    await this.tokens.forget(homeIdOf(account))
  }

  private async graph(account: Account, url: string, scopes: string[]): Promise<unknown> {
    const token = await this.tokens.token(homeIdOf(account), scopes)
    const res = await this.fetchFn(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'user-agent': USER_AGENT,
        // Event times come back in UTC, whatever the mailbox's time zone is.
        prefer: 'outlook.timezone="UTC"'
      },
      signal: AbortSignal.timeout(15_000)
    })
    if (res.status === 401) throw new AuthExpiredError()
    if (res.status === 403) throw new Error('Your organization doesn’t allow this app to read it. Ask your IT admin to approve Information Hub.')
    if (res.status === 429) throw new Error('Microsoft asked us to slow down. Trying again in a few minutes.')
    if (!res.ok) throw new Error(`Microsoft answered ${res.status}`)
    return res.json()
  }

  async recentMail(account: Account, limit: number): Promise<MailMessage[]> {
    return parseMessages(await this.graph(account, mailUrl(Math.min(limit, 50)), MAIL_SCOPES), account.id)
  }

  async events(account: Account, fromISO: string, toISO: string): Promise<CalendarEvent[]> {
    return parseEvents(await this.graph(account, eventsUrl(fromISO, toISO), CALENDAR_SCOPES), account.id)
  }
}
