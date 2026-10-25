import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/settings-store'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings'

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'hub-'))

describe('normalizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
  })

  it('trims topics and drops unknown languages', () => {
    const s = normalizeSettings({ topics: [' AI ', '', 3], newsLanguages: ['es', 'xx'], theme: 'neon' })
    expect(s.topics).toEqual(['AI'])
    expect(s.newsLanguages).toEqual(['es'])
    expect(s.theme).toBe('dark')
  })

  it('falls back to English when no language is left', () => {
    expect(normalizeSettings({ newsLanguages: [] }).newsLanguages).toEqual(['en'])
  })
})

describe('SettingsStore', () => {
  it('keeps settings across instances, as across app restarts', () => {
    const dir = tempDir()
    new SettingsStore(dir).save({ displayName: 'Luis', topics: ['economía'], newsLanguages: ['es', 'en'], theme: 'dark' })
    expect(new SettingsStore(dir).load()).toEqual({
      displayName: 'Luis',
      topics: ['economía'],
      newsLanguages: ['es', 'en'],
      theme: 'dark',
      onlyMyTopics: false,
      newsServerUrl: '',
      customSources: [],
      dashboard: DEFAULT_SETTINGS.dashboard,
      jiraSites: [],
      projectWeights: {},
      ticketRanking: 'local',
      mailRanking: 'local',
      mailRules: [],
      factCheck: DEFAULT_SETTINGS.factCheck,
      syncFolder: ''
    })
  })

  it('loads defaults from a corrupt file', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), '{not json')
    expect(new SettingsStore(dir).load()).toEqual(DEFAULT_SETTINGS)
  })
})
