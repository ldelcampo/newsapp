import { useEffect, useState } from 'react'
import { NEWS_LANGUAGES, type Settings, type Theme } from '@shared/settings'

export function SettingsView(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [topicsText, setTopicsText] = useState('')
  const [status, setStatus] = useState('')
  const [info, setInfo] = useState<{ version: string; platform: string; dataDir: string } | null>(null)

  useEffect(() => {
    void window.hub.getSettings().then((s) => {
      setSettings(s)
      setTopicsText(s.topics.join(', '))
    })
    void window.hub.appInfo().then(setInfo)
  }, [])

  if (!settings) return <p className="muted">Loading settings…</p>

  const update = (patch: Partial<Settings>): void => {
    setSettings({ ...settings, ...patch })
    setStatus('')
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
    setTopicsText(saved.topics.join(', '))
    setStatus('Saved')
  }

  return (
    <form className="settings" onSubmit={save}>
      <label className="field">
        <span>Your name</span>
        <input
          id="displayName"
          value={settings.displayName}
          onChange={(e) => update({ displayName: e.target.value })}
          placeholder="Shown on the Today screen"
        />
      </label>

      <label className="field">
        <span>Theme</span>
        <select id="theme" value={settings.theme} onChange={(e) => update({ theme: e.target.value as Theme })}>
          <option value="system">Match system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>

      <label className="field">
        <span>News topics</span>
        <input
          id="topics"
          value={topicsText}
          onChange={(e) => {
            setTopicsText(e.target.value)
            setStatus('')
          }}
          placeholder="economy, artificial intelligence, Mexico"
        />
        <small className="muted">Separate topics with commas.</small>
      </label>

      <fieldset className="field">
        <legend>News languages</legend>
        <div className="chips">
          {NEWS_LANGUAGES.map((l) => (
            <label key={l.code} className="chip">
              <input
                type="checkbox"
                checked={settings.newsLanguages.includes(l.code)}
                onChange={() => toggleLanguage(l.code)}
              />
              {l.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="actions">
        <button type="submit" className="primary">Save</button>
        <span role="status" className="ok">{status}</span>
      </div>

      {info && (
        <p className="muted small">
          Version {info.version} · {info.platform} · data in <code>{info.dataDir}</code>
        </p>
      )}
    </form>
  )
}
