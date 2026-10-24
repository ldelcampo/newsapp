// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeSettings, type Settings } from '../src/shared/settings'
import { SettingsView } from '../src/renderer/src/SettingsView'

// The cards that talk to accounts, Jira and sync have their own tests; here they stay empty.
vi.mock('../src/renderer/src/AccountsCard', () => ({ AccountsCard: () => null }))
vi.mock('../src/renderer/src/JiraCard', () => ({ JiraCard: () => null }))
vi.mock('../src/renderer/src/SyncCard', () => ({ SyncCard: () => null }))
vi.mock('../src/renderer/src/FactCheckEditor', () => ({ FactCheckEditor: () => null }))

let stored: Settings

beforeEach(() => {
  stored = normalizeSettings({})
  const hub = new Proxy(
    {
      getSettings: vi.fn(async () => stored),
      saveSettings: vi.fn(async (next: unknown) => (stored = normalizeSettings(next))),
      sourceStatuses: vi.fn(async () => []),
      testSource: vi.fn(async () => ({ ok: true, count: 30, sample: ['Show HN'] })),
      appInfo: vi.fn(async () => ({ version: '0.1.0', platform: 'darwin', dataDir: '/tmp' })),
      onUpdate: vi.fn(() => () => undefined)
    } as Record<string, unknown>,
    // Anything else the view asks for answers with nothing, so unrelated cards still render.
    { get: (target, key: string) => target[key] ?? vi.fn(async () => null) }
  )
  Object.assign(window, { hub })
})
afterEach(cleanup)

describe('Settings, adding a source', () => {
  it('keeps the source after leaving Settings without pressing Save', async () => {
    const first = render(<SettingsView />)
    await screen.findByText('Add a source')
    fireEvent.change(document.getElementById('src-name')!, { target: { value: 'Hacker News' } })
    fireEvent.change(document.getElementById('src-url')!, { target: { value: 'https://hnrss.org/frontpage' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Test feed' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Add source$/ })))
    expect(stored.customSources.map((s) => s.name)).toEqual(['Hacker News'])

    // Going to another section unmounts Settings; coming back loads it again.
    first.unmount()
    render(<SettingsView />)
    expect(await screen.findByText('Hacker News')).toBeTruthy()
  })
})
