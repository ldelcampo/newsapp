import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/settings-store'
import { SettingsSync } from '../src/main/settings-sync'
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

describe('two computers sharing a folder', () => {
  it('carries a change from one to the other, in both directions', () => {
    const shared = tmp()
    let t = 0
    const clock = (): string => new Date(Date.UTC(2026, 9, 24, 0, 0, t++)).toISOString()
    const mkStore = (): SettingsStore => new SettingsStore(tmp())
    const aStore = mkStore()
    const bStore = mkStore()
    const seen: string[][] = []
    const a = new SettingsSync(aStore, tmp(), () => undefined, 'macbook', clock)
    const b = new SettingsSync(bStore, tmp(), (s) => seen.push(s.topics), 'mini', clock)

    a.save({ ...aStore.load(), topics: ['economía', 'AI'], syncFolder: shared })
    b.save({ ...bStore.load(), syncFolder: shared })
    expect(bStore.load().topics).toEqual(['economía', 'AI'])
    expect(seen).toEqual([['economía', 'AI']])

    b.save({ ...bStore.load(), onlyMyTopics: true })
    a.sync()
    expect(aStore.load().onlyMyTopics).toBe(true)
    expect(aStore.load().topics).toEqual(['economía', 'AI'])
    expect(JSON.parse(readFileSync(join(shared, 'Information Hub', 'settings-sync.json'), 'utf8')).device).toBe('mini')
    a.stop()
    b.stop()
  })

  it('reports a missing folder instead of failing', () => {
    const store = new SettingsStore(tmp())
    const s = new SettingsSync(store, tmp(), () => undefined, 'x')
    s.save({ ...store.load(), syncFolder: '/no/such/folder' })
    expect(s.getStatus().error).toMatch(/missing/)
    s.stop()
  })
})
