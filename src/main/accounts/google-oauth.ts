import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { AuthExpiredError } from './connector'

/**
 * Google sign-in for an installed app: OAuth 2.0 with PKCE and a loopback redirect. The app
 * listens on a random 127.0.0.1 port, opens Google's consent page in the user's browser and
 * takes the code Google sends back. Tokens never leave this computer.
 */

/** A "Desktop app" OAuth client. Google says its secret is not confidential in installed apps. */
export interface GoogleClient {
  clientId: string
  clientSecret: string
}

export interface GoogleTokens {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  expiresAt: number
  /** Space-separated scopes Google actually granted; the user may untick some. */
  scope: string
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export const SCOPES = {
  identity: ['openid', 'email', 'profile'],
  /** Read, label, archive and trash; not permanent deletion. */
  mail: 'https://www.googleapis.com/auth/gmail.modify',
  /** For replies and new mail. */
  send: 'https://www.googleapis.com/auth/gmail.send',
  /** What the first builds asked for; such sign-ins can read but not change mail. */
  mailReadOnly: 'https://www.googleapis.com/auth/gmail.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.readonly'
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

const base64url = (b: Buffer): string => b.toString('base64url')

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

export function authUrl(o: { client: GoogleClient; redirectUri: string; scopes: string[]; challenge: string; state: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: o.client.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: o.scopes.join(' '),
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
    // A refresh token, so the app keeps working after the first hour.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  })
  if (o.loginHint) q.set('login_hint', o.loginHint)
  return `${AUTH_URL}?${q}`
}

const DONE_PAGE = (ok: boolean): string => `<!doctype html><meta charset="utf-8"><title>Atalia</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#333">
<p>${ok ? 'Signed in. You can close this tab and go back to Atalia.' : 'Sign-in was cancelled. You can close this tab.'}</p></body>`

/** Opens the consent page and resolves with the code Google redirects back to the loopback port. */
export function signInInBrowser(open: (url: string) => void, makeUrl: (redirectUri: string, state: string) => string): Promise<{ code: string; redirectUri: string }> {
  const state = base64url(randomBytes(16))
  return new Promise((resolve, reject) => {
    let redirectUri = ''
    const finish = (err: Error | null, code?: string): void => {
      clearTimeout(timer)
      server.close()
      if (err) reject(err)
      else resolve({ code: code!, redirectUri })
    }
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', redirectUri)
      if (url.pathname !== '/' || url.searchParams.get('state') !== state) {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end(DONE_PAGE(!!code))
      if (code) finish(null, code)
      else finish(new Error(url.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Google didn’t complete the sign-in.'))
    })
    const timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), SIGN_IN_TIMEOUT_MS)
    server.on('error', (e) => finish(e))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      redirectUri = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
      open(makeUrl(redirectUri, state))
    })
  })
}

async function tokenRequest(fetchFn: FetchFn, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000)
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    // invalid_grant: the refresh token was revoked, expired or the password changed.
    if (json.error === 'invalid_grant') throw new AuthExpiredError('Google signed this account out. Reconnect it.')
    throw new Error(`Google sign-in failed: ${String(json.error_description ?? json.error ?? res.status)}`)
  }
  return json
}

function toTokens(json: Record<string, unknown>, now: number, previousRefresh = ''): GoogleTokens {
  if (typeof json.access_token !== 'string') throw new Error('Google sent no access token.')
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : previousRefresh,
    expiresAt: now + Number(json.expires_in ?? 3600) * 1000,
    scope: typeof json.scope === 'string' ? json.scope : ''
  }
}

export async function exchangeCode(fetchFn: FetchFn, client: GoogleClient, code: string, verifier: string, redirectUri: string, now = Date.now()): Promise<GoogleTokens> {
  const json = await tokenRequest(fetchFn, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    client_id: client.clientId,
    client_secret: client.clientSecret
  })
  const tokens = toTokens(json, now)
  if (!tokens.refreshToken) throw new Error('Google sent no refresh token. Try again.')
  return tokens
}

export async function refreshTokens(fetchFn: FetchFn, client: GoogleClient, tokens: GoogleTokens, now = Date.now()): Promise<GoogleTokens> {
  const json = await tokenRequest(fetchFn, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret
  })
  const next = toTokens(json, now, tokens.refreshToken)
  // A refresh answer may omit scope; keep what we knew.
  return next.scope ? next : { ...next, scope: tokens.scope }
}

export async function revoke(fetchFn: FetchFn, token: string): Promise<void> {
  await fetchFn(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
}
