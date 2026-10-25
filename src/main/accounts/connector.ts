import type { Account, CalendarEvent, MailBody, MailMessage, Provider } from '../../shared/accounts'

/** One mail/calendar provider. The service calls only the accounts whose switches are on. */
export interface Connector {
  provider: Provider
  /** Signs in (or checks the details the user typed), saves the secrets and returns the new account. */
  add(input?: unknown): Promise<Account>
  /** Forgets provider-side state, such as cached tokens; the service deletes the account's own secret. */
  remove?(account: Account): Promise<void>
  /** Signs in again to grant what a switch now needs, such as calendar access. */
  reconsent?(account: Account): Promise<Account>
  recentMail(account: Account, limit: number): Promise<MailMessage[]>
  /** One message in full, by the id recentMail gave it. */
  message?(account: Account, id: string): Promise<MailBody>
  events(account: Account, fromISO: string, toISO: string): Promise<CalendarEvent[]>
}

/** Thrown when a saved sign-in no longer works; the account shows a Reconnect button. */
export class AuthExpiredError extends Error {
  constructor(message = 'Sign in again to keep this account connected.') {
    super(message)
    this.name = 'AuthExpiredError'
  }
}
