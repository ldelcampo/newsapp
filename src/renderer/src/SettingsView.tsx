import { useEffect, useState } from 'react'
import { NEWS_LANGUAGES, type Settings, type Theme } from '@shared/settings'
import { SourcesEditor } from './SourcesEditor'
import { applyTheme } from './theme'
import { Icon } from './Icon'
import type { SyncStatus, UpdateState } from '@shared/api'
import { timeAgo } from './useNews'

function describeUpdate(u: UpdateState): string {
  switch (u.status) {
    case 'checking': return 'Checking for updates…'
    case 'current': return 'You have the latest version.'
    case 'none': return 'No updates have been published yet. You have the newest build.'
    case 'move': return 'Updates only work when the app is in your Applications folder.'
    case 'dev': return 'This copy runs from source, so it doesn’t update itself.'
    case 'downloading': return `Downloading update, ${u.percent}%`
    case 'ready': return `Version ${u.version} is ready. Restart to update.`
    case 'error': return `Could not check: ${u.message}`
    default: return 'Updates are checked automatically in installed builds.'
  }
}

export function SettingsView(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [topicsText, setTopicsText] = useState('')
  const [status, setStatus] = useState('')
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const [info, setInfo] = useState<{ version: string; platform: string; dataDir: string } | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [iCloud, setICloud] = useState<string | null>(null)

  useEffect(() => {
    void window.hub.getSettings().then((s) => {
      setSettings(s)
      setTopicsText(s.topics.join(', '))
    })
    void window.hub.appInfo().then(setInfo)
    void window.hub.syncStatus().then(setSync)
    void window.hub.iCloudFolder().then(setICloud)
    return window.hub.onUpdate(setUpdateState)
  }, [])

  if (!settings) return <p className="muted">Loading settings…</p>

  const update = (patch: Partial<Settings>): void => {
    setSettings({ ...settings, ...patch })
    setStatus('')
  }

  /** Sync starts as soon as a folder is picked, without waiting for Save. */
  const useSyncFolder = async (folder: string): Promise<void> => {
    const saved = await window.hub.saveSettings({ ...settings, syncFolder: folder })
    setSettings(saved)
    setTopicsText(saved.topics.join(', '))
    setSync(await window.hub.syncStatus())
  }

  const toggleLanguage = (code: string): void => {
    const has = settings.newsLanguages.includes(code)
    update({ newsLanguages: has ? settings.newsLanguages.filter((c) => c !== code) : [...settings.newsLanguages, code] })
  }

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const topics = topicsText.split(',').map((t) => t.trim()).filter(Boolean)
    const saved = await window.hub.saveSettings({ ...settings, topics })
    setSettings(saved)
    applyTheme(saved.theme)
    setTopicsText(saved.topics.join(', '))
    setStatus('Saved')
  }

  return (
    <form className="settings" onSubmit={save}>
      <section className="card enter" style={{ '--i': 0 } as React.CSSProperties}>
        <h2>You</h2>
        <div className="grid2">
          <label className="field">
            <span>Your name</span>
            <input id="displayName" value={settings.displayName} onChange={(e) => update({ displayName: e.target.value })} placeholder="Shown on the dashboard" />
          </label>
          <label className="field">
            <span>Theme</span>
            <select id="theme" value={settings.theme} onChange={(e) => update({ theme: e.target.value as Theme })}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Match system</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card enter" style={{ '--i': 1 } as React.CSSProperties}>
        <h2>News</h2>
        <label className="field">
          <span>Topics</span>
          <input
            id="topics"
            value={topicsText}
            onChange={(e) => {
              setTopicsText(e.target.value)
              setStatus('')
            }}
            placeholder="economy, artificial intelligence, Mexico"
          />
          <small className="muted">Separate topics with commas. Stories that match them come first.</small>
        </label>

        <label className="toggle">
          <input id="onlyMyTopics" type="checkbox" checked={settings.onlyMyTopics} onChange={(e) => update({ onlyMyTopics: e.target.checked })} />
          <span className="track" aria-hidden="true" />
          Show only stories that match my topics, on the dashboard and in News
        </label>

        <fieldset className="field">
          <legend>Languages</legend>
          <div className="chips">
            {NEWS_LANGUAGES.map((l) => (
              <label key={l.code} className={settings.newsLanguages.includes(l.code) ? 'chip on' : 'chip'}>
                <input type="checkbox" checked={settings.newsLanguages.includes(l.code)} onChange={() => toggleLanguage(l.code)} />
                {l.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>News server</span>
          <input id="newsServerUrl" value={settings.newsServerUrl} placeholder="Empty: this computer fetches the news itself" onChange={(e) => update({ newsServerUrl: e.target.value })} />
          <small className="muted">A shared server collects the included sources for everyone. Your topics never leave this computer.</small>
        </label>
      </section>

      <section className="card enter" style={{ '--i': 2 } as React.CSSProperties}>
        <h2>Sources</h2>
        <SourcesEditor sources={settings.customSources} onChange={(customSources) => update({ customSources })} />
      </section>

      <section className="card enter" style={{ '--i': 3 } as React.CSSProperties}>
        <h2>Sync between your computers</h2>
        <p className="muted small">
          Your topics, languages, sources, dashboard and theme follow you to every computer that uses the same folder. Mail, accounts and API keys stay on each
          computer.
        </p>
        {settings.syncFolder ? (
          <>
            <p className="small">
              Syncing through <code>{settings.syncFolder.replace(/^.*Mobile Documents\/com~apple~CloudDocs/, 'iCloud Drive')}</code>
            </p>
            {sync?.error ? (
              <p className="error small">{sync.error}</p>
            ) : (
              sync?.syncedAt && (
                <p className="muted small">
                  Up to date {timeAgo(sync.syncedAt)}
                  {sync.lastDevice ? ` · last change from ${sync.lastDevice}` : ''}
                </p>
              )
            )}
            <div className="actions">
              <button type="button" className="ghost" onClick={() => void window.hub.syncNow().then(setSync)}>
                <Icon name="refresh" /> Sync now
              </button>
              <button type="button" className="ghost" onClick={() => void useSyncFolder('')}>
                Stop syncing
              </button>
            </div>
          </>
        ) : (
          <div className="actions">
            {iCloud && (
              <button type="button" className="primary" onClick={() => void useSyncFolder(iCloud)}>
                Use iCloud Drive
              </button>
            )}
            <button type="button" className="ghost" onClick={() => void window.hub.chooseSyncFolder().then((f) => (f ? useSyncFolder(f) : undefined))}>
              Choose a folder…
            </button>
          </div>
        )}
      </section>

      <div className="actions sticky-save">
        <button type="submit" className="primary">Save</button>
        <span role="status" className="ok">{status}</span>
      </div>

      {info && (
        <div className="about">
          <p className="muted small">
            Version {info.version} · {info.platform} · data in <code>{info.dataDir}</code>
          </p>
          <button
            type="button"
            className="ghost"
            disabled={updateState?.status === 'checking'}
            onClick={() => {
              setUpdateState({ status: 'checking' })
              window.hub
                .checkForUpdate()
                .then(setUpdateState)
                .catch(() => setUpdateState({ status: 'error', message: 'The check didn’t finish. Try again.' }))
            }}
          >
            <Icon name="refresh" className={updateState?.status === 'checking' ? 'spin' : ''} />
            {updateState?.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          {updateState?.status === 'move' && (
            <button type="button" className="primary" onClick={() => void window.hub.moveToApplications()}>
              Move to Applications
            </button>
          )}
          {updateState?.status === 'ready' && (
            <button type="button" className="primary" onClick={() => void window.hub.installUpdate()}>
              Restart to update
            </button>
          )}
          {updateState && (
            <span role="status" className={`update-state ${updateState.status}`}>
              {describeUpdate(updateState)}
            </span>
          )}
        </div>
      )}
    </form>
  )
}
