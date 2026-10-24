import type { GoogleClient } from './google-oauth'

/**
 * The app's Google OAuth client ("Desktop app" type). CI bakes it into builds from the
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET repository secrets; when running from source,
 * put them in a .env.local file as MAIN_VITE_GOOGLE_CLIENT_ID / MAIN_VITE_GOOGLE_CLIENT_SECRET.
 */
export function googleClient(): GoogleClient | null {
  const clientId = process.env.GOOGLE_CLIENT_ID || import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : null
}
