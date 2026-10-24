import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Accounts and end-to-end encrypted settings for sync. The app derives two keys from the
 * user's passphrase: an auth key it sends here, and an encryption key it never sends. So
 * this server can check who is signing in, but only ever stores ciphertext it cannot read.
 */

interface User {
  id: string
  email: string
  salt: string
  /** scrypt of the auth key, so a leaked file can't be used to sign in. */
  hash: string
  createdAt: string
}

interface Session {
  userId: string
  expiresAt: string
}

export interface Blob {
  version: number
  /** base64 AES-256-GCM ciphertext, made by the app. */
  data: string
  updatedAt: string
}

const SESSION_DAYS = 180
export const MAX_BLOB_BYTES = 512 * 1024

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const hashKey = (authKey: string, salt: string): string => scryptSync(authKey, salt, 32).toString('hex')

export class AccountStore {
  private users: Record<string, User>
  private sessions: Record<string, Session>

  constructor(
    private readonly dir: string,
    private readonly now = (): Date => new Date()
  ) {
    mkdirSync(join(dir, 'blobs'), { recursive: true })
    this.users = this.read('users.json') ?? {}
    this.sessions = this.read('sessions.json') ?? {}
  }

  private read<T>(name: string): T | null {
    const f = join(this.dir, name)
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null
  }

  private write(name: string, value: unknown): void {
    const f = join(this.dir, name)
    writeFileSync(`${f}.tmp`, JSON.stringify(value))
    renameSync(`${f}.tmp`, f)
  }

  private newSession(userId: string): string {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(this.now().getTime() + SESSION_DAYS * 86_400_000).toISOString()
    // Only a hash of the token is kept, like a password.
    this.sessions[sha(token)] = { userId, expiresAt }
    this.write('sessions.json', this.sessions)
    return token
  }

  signUp(emailRaw: string, authKey: string): { token: string } | { error: string } {
    const email = emailRaw.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' }
    if (!/^[A-Za-z0-9+/=_-]{40,100}$/.test(authKey)) return { error: 'Invalid key.' }
    if (Object.values(this.users).some((u) => u.email === email)) return { error: 'An account with this email already exists. Sign in instead.' }
    const id = randomBytes(12).toString('hex')
    const salt = randomBytes(16).toString('hex')
    this.users[id] = { id, email, salt, hash: hashKey(authKey, salt), createdAt: this.now().toISOString() }
    this.write('users.json', this.users)
    return { token: this.newSession(id) }
  }

  signIn(emailRaw: string, authKey: string): { token: string } | { error: string } {
    const email = emailRaw.trim().toLowerCase()
    const user = Object.values(this.users).find((u) => u.email === email)
    // Same work and message whether or not the email exists.
    const expected = Buffer.from(user?.hash ?? '0'.repeat(64), 'hex')
    const got = Buffer.from(hashKey(authKey, user?.salt ?? 'none'), 'hex')
    if (!user || !timingSafeEqual(expected, got)) return { error: 'Wrong email or passphrase.' }
    return { token: this.newSession(user.id) }
  }

  userFor(token: string | undefined): string | null {
    if (!token) return null
    const s = this.sessions[sha(token)]
    if (!s || s.expiresAt < this.now().toISOString()) return null
    return s.userId
  }

  signOut(token: string): void {
    delete this.sessions[sha(token)]
    this.write('sessions.json', this.sessions)
  }

  getBlob(userId: string): Blob | null {
    return this.read<Blob>(join('blobs', `${userId}.json`))
  }

  /** Saves only if the app saw the latest version, so two computers can't overwrite each other. */
  putBlob(userId: string, expected: number, data: string): { blob: Blob } | { conflict: Blob } | { error: string } {
    if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_BLOB_BYTES) return { error: 'Too large.' }
    const current = this.getBlob(userId)
    if ((current?.version ?? 0) !== expected) return { conflict: current! }
    const blob: Blob = { version: expected + 1, data, updatedAt: this.now().toISOString() }
    this.write(join('blobs', `${userId}.json`), blob)
    return { blob }
  }
}

/** A few attempts per minute per address, so passphrases can't be guessed at speed. */
export class RateLimit {
  private hits = new Map<string, number[]>()
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now = Date.now
  ) {}

  allow(key: string): boolean {
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs)
    if (recent.length >= this.max) return false
    recent.push(t)
    this.hits.set(key, recent)
    return true
  }
}
