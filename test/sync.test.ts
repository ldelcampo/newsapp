import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AccountStore, RateLimit } from '../server/accounts'
import { AccountVault, type Protector } from '../src/main/account'
import { SettingsStore } from '../src/main/settings-store'
import { FolderRemote, ServerRemote, SettingsSync } from '../src/main/settings-sync'
import { deriveKeys, open, seal } from '../src/main/sync-crypto'
import { normalizeSettings } from '../src/shared/settings'
import { mergeDoc, stampChanges, toDoc } from '../src/shared/sync'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'hub-sync-'))
const source = { id: 'reforma', name: 'Reforma', url: 'https://example.com/rss', language: 'es', region: 'MX', lean: 'unrated' }

describe('sync merge', () => {
  it('takes each setting from whichever side changed it last', () => {
    const local = normalizeSettings({ topics: ['AI'], theme: 'dark' })
    const doc = toDoc(normalizeSettings({ topics: ['economía'], theme: 'light' }), { topics: '2026-10-24T10:00:00Z', theme: '2026-10-24T08:00:00Z' }, 'mini', 'x')
    const m = mergeDoc(local, { topics: '2026-10-24T09:00:00Z', theme: '2026-10-24T09:00:00Z' }, doc)
    expect(m.settings.topics).toEqual(['economía'])
    expect(m.settings.theme).toBe('dark')
    expect(m.changed).toBe(true)
  })

  it('lets a new computer adopt the shared settings, but never shares or loses API keys', () => {
    const withKey = normalizeSettings({ customSources: [{ ...source, apiKey: 'secret' }] })
    const doc = toDoc(withKey, {}, 'macbook', 'x')
    expect(JSON.stringify(doc)).not.toContain('secret')
    const fresh = mergeDoc(normalizeSettings({}), {}, doc)
    expect(fresh.settings.customSources[0].name).toBe('Reforma')
    expect(fresh.settings.customSources[0].apiKey).toBeUndefined()
    const back = mergeDoc(withKey, {}, { ...doc, stamps: { ...doc.stamps, customSources: '2026-10-24T10:00:00Z' } })
    expect(back.settings.customSources[0].apiKey).toBe('secret')
  })

  it('ignores broken or foreign files and never syncs the folder setting itself', () => {
    const local = normalizeSettings({ topics: ['AI'], syncFolder: '/Users/a/iCloud' })
    expect(mergeDoc(local, {}, { nope: true }).changed).toBe(false)
    expect(mergeDoc(local, {}, null).changed).toBe(false)
    const doc = toDoc(normalizeSettings({ syncFolder: '/elsewhere', topics: ['x'] }), { topics: '9' }, 'mini', 'x')
    expect(mergeDoc(local, {}, doc).settings.syncFolder).toBe('/Users/a/iCloud')
  })

  it('stamps only what changed', () => {
    const a = normalizeSettings({ topics: ['AI'] })
    expect(stampChanges(a, { ...a, topics: ['AI', 'MX'] }, {}, 'T')).toEqual({ topics: 'T' })
  })
})

const settle = (s: SettingsSync): Promise<void> => s.sync()

describe('two computers sharing a folder', () => {
  it('carries a change from one to the other, in both directions', async () => {
    const shared = tmp()
    let t = 0
    const clock = (): string => new Date(Date.UTC(2026, 9, 24, 0, 0, t++)).toISOString()
    const aStore = new SettingsStore(tmp())
    const bStore = new SettingsStore(tmp())
    const seen: string[][] = []
    const a = new SettingsSync(aStore, tmp(), () => undefined, 'macbook', clock)
    const b = new SettingsSync(bStore, tmp(), (s) => seen.push(s.topics), 'mini', clock)
    await a.use(new FolderRemote(shared, () => undefined), { mode: 'folder', folder: shared })
    await b.use(new FolderRemote(shared, () => undefined), { mode: 'folder', folder: shared })

    a.save({ ...aStore.load(), topics: ['economía', 'AI'] })
    await settle(a)
    await b.sync()
    expect(bStore.load().topics).toEqual(['economía', 'AI'])
    expect(seen).toEqual([['economía', 'AI']])

    b.save({ ...bStore.load(), onlyMyTopics: true })
    await settle(b)
    await a.sync()
    expect(aStore.load().onlyMyTopics).toBe(true)
    expect(aStore.load().topics).toEqual(['economía', 'AI'])
    expect(JSON.parse(readFileSync(join(shared, 'Information Hub', 'settings-sync.json'), 'utf8')).device).toBe('mini')
    a.stop()
    b.stop()
  })

  it('reports a missing folder instead of failing', async () => {
    const store = new SettingsStore(tmp())
    const s = new SettingsSync(store, tmp(), () => undefined, 'x')
    await s.use(new FolderRemote('/no/such/folder', () => undefined), { mode: 'folder', folder: '/no/such/folder' })
    expect(s.getStatus().error).toMatch(/missing/)
    s.stop()
  })
})

describe('sync encryption', () => {
  it('derives the same keys from the same passphrase, and different ones otherwise', () => {
    const k = deriveKeys('Luis@Example.com', 'correct horse battery')
    expect(deriveKeys('luis@example.com', 'correct horse battery').authKey).toBe(k.authKey)
    expect(deriveKeys('luis@example.com', 'correct horse battery!').authKey).not.toBe(k.authKey)
    expect(k.encKey.toString('base64')).not.toBe(k.authKey)
  })

  it('seals so that only the key opens it, and rejects tampering', () => {
    const { encKey } = deriveKeys('a@b.co', 'passphrase-123')
    const box = seal(encKey, 'hola')
    expect(box).not.toContain('hola')
    expect(open(encKey, box)).toBe('hola')
    expect(() => open(deriveKeys('a@b.co', 'other-passphrase').encKey, box)).toThrow()
    const raw = Buffer.from(box, 'base64')
    raw[raw.length - 1] ^= 1
    expect(() => open(encKey, raw.toString('base64'))).toThrow()
  })
})

describe('account store', () => {
  const key = 'A'.repeat(43) + '='

  it('signs up, signs in, and keeps only hashes of keys and tokens', () => {
    const dir = tmp()
    const s = new AccountStore(dir)
    const up = s.signUp('Luis@Example.com', key)
    expect('token' in up).toBe(true)
    expect(s.signUp('luis@example.com', key)).toHaveProperty('error')
    expect(s.signIn('luis@example.com', 'B'.repeat(44))).toEqual({ error: 'Wrong email or passphrase.' })
    expect(s.signIn('nobody@example.com', key)).toEqual({ error: 'Wrong email or passphrase.' })
    const inn = s.signIn('luis@example.com', key) as { token: string }
    expect(s.userFor(inn.token)).toBeTruthy()
    const files = readFileSync(join(dir, 'users.json'), 'utf8') + readFileSync(join(dir, 'sessions.json'), 'utf8')
    expect(files).not.toContain(key)
    expect(files).not.toContain(inn.token)
    s.signOut(inn.token)
    expect(s.userFor(inn.token)).toBeNull()
  })

  it('refuses a write based on an old version', () => {
    const s = new AccountStore(tmp())
    const user = s.userFor((s.signUp('a@b.co', key) as { token: string }).token)!
    expect(s.putBlob(user, 0, 'one')).toHaveProperty('blob.version', 1)
    expect(s.putBlob(user, 0, 'two')).toHaveProperty('conflict.version', 1)
    expect(s.putBlob(user, 1, 'two')).toHaveProperty('blob.version', 2)
    expect(s.putBlob(user, 2, 'x'.repeat(600_000))).toHaveProperty('error')
  })

  it('expires sessions', () => {
    let now = new Date('2026-10-24T00:00:00Z')
    const s = new AccountStore(tmp(), () => now)
    const { token } = s.signUp('a@b.co', key) as { token: string }
    now = new Date('2027-06-01T00:00:00Z')
    expect(s.userFor(token)).toBeNull()
  })

  it('rate limits per key', () => {
    let t = 0
    const r = new RateLimit(2, 1000, () => t)
    expect([r.allow('ip'), r.allow('ip'), r.allow('ip'), r.allow('other')]).toEqual([true, true, false, true])
    t = 1001
    expect(r.allow('ip')).toBe(true)
  })
})

describe('two computers syncing through the news server', () => {
  let server: Server
  let url = ''

  beforeAll(async () => {
    process.env.DATA_DIR = tmp()
    const { handle } = await import('../server/index')
    server = createServer(handle)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => server.close())

  const protector: Protector = { encrypt: (s) => Buffer.from(s).reverse(), decrypt: (b) => Buffer.from(b).reverse().toString() }

  it('creates the account on one computer, signs in on another, and merges both ways', async () => {
    const pass = 'correct horse battery'
    const aVault = new AccountVault(tmp(), protector)
    const bVault = new AccountVault(tmp(), protector)
    const aAcc = await aVault.signIn(url, 'luis@example.com', pass, true)
    await expect(bVault.signIn(url, 'luis@example.com', 'wrong passphrase', false)).rejects.toThrow(/Wrong/)
    const bAcc = await bVault.signIn(url, 'luis@example.com', pass, false)
    expect(bVault.load()?.email).toBe('luis@example.com')

    let t = 0
    const clock = (): string => new Date(Date.UTC(2026, 9, 24, 0, 0, t++)).toISOString()
    const aStore = new SettingsStore(tmp())
    const bStore = new SettingsStore(tmp())
    const a = new SettingsSync(aStore, tmp(), () => undefined, 'macbook', clock)
    const b = new SettingsSync(bStore, tmp(), () => undefined, 'mini', clock)
    await a.use(new ServerRemote(aAcc), { mode: 'account', folder: '', email: aAcc.email })
    await b.use(new ServerRemote(bAcc), { mode: 'account', folder: '', email: bAcc.email })

    a.save({ ...aStore.load(), topics: ['economía'] })
    // The other computer changes something else before seeing that, so its write conflicts and merges.
    b.save({ ...bStore.load(), theme: 'light' })
    await settle(a)
    await settle(b)
    await a.sync()
    expect(a.getStatus().error).toBeUndefined()
    expect(b.getStatus().error).toBeUndefined()
    expect(aStore.load()).toMatchObject({ topics: ['economía'], theme: 'light' })
    expect(bStore.load()).toMatchObject({ topics: ['economía'], theme: 'light' })

    // The server only ever holds ciphertext.
    const res = await fetch(`${url}/api/sync`, { headers: { authorization: `Bearer ${aAcc.token}` } })
    expect(await res.text()).not.toContain('econom')
    a.stop()
    b.stop()
  })

  it('reports an ended session and asks to sign in again', async () => {
    let ended = false
    const store = new SettingsStore(tmp())
    const s = new SettingsSync(store, tmp(), () => undefined, 'x')
    const fake = { server: url, email: 'a@b.co', token: 'nope', encKey: Buffer.alloc(32) }
    await s.use(new ServerRemote(fake, undefined, () => (ended = true)), { mode: 'account', folder: '' })
    expect(ended).toBe(true)
    expect(s.getStatus().error).toMatch(/Sign in again/)
    s.stop()
  })

  it('refuses plain http servers other than this computer, and short passphrases', async () => {
    const v = new AccountVault(tmp(), protector)
    await expect(v.signIn('http://example.com', 'a@b.co', 'long enough pass', true)).rejects.toThrow(/https/)
    await expect(v.signIn(url, 'a@b.co', 'short', true)).rejects.toThrow(/10 characters/)
  })
})
