import { useState } from 'react'
import { cleanSiteUrl, siteKind } from '@shared/jira'
import type { Settings } from '@shared/settings'
import { JevKeyField } from './JevKeyField'

const TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens'

/** Connect Jira sites and choose how tickets are ranked. Lives inside the Settings form. */
export function JiraCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(settings.jiraSites.length === 0)
  const cleaned = cleanSiteUrl(url)
  const cloud = !cleaned || siteKind(cleaned) === 'cloud'

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const r = await window.hub.jiraConnect({ url, email, token })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    onChange({ jiraSites: r.settings.jiraSites, dashboard: r.settings.dashboard })
    setUrl('')
    setToken('')
    setAdding(false)
  }

  // Enter in these fields connects instead of submitting the whole settings form.
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void connect()
    }
  }

  return (
    <>
      {settings.jiraSites.length > 0 && (
        <ul className="site-list">
          {settings.jiraSites.map((s) => (
            <li key={s.id}>
              <span className="dot ok" aria-hidden="true" />
              <span>
                <b>{s.url.replace(/^https?:\/\//, '')}</b>
                <span className="muted small"> · {s.name || s.email}</span>
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => void window.hub.jiraDisconnect(s.id).then((saved) => onChange({ jiraSites: saved.jiraSites }))}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="jira-form">
          <div className="grid2">
            <label className="field">
              <span>Jira address</span>
              <input id="jiraUrl" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={onKey} placeholder="yourteam.atlassian.net" autoComplete="off" />
            </label>
            {cloud && (
              <label className="field">
                <span>Your Atlassian email</span>
                <input id="jiraEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onKey} autoComplete="email" />
              </label>
            )}
          </div>
          <label className="field">
            <span>{cloud ? 'API token' : 'Personal access token'}</span>
            <input id="jiraToken" type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={onKey} autoComplete="off" />
            <small className="muted">
              {cloud ? (
                <>
                  Create one at{' '}
                  <button type="button" className="link" onClick={() => void window.hub.openExternal(TOKEN_PAGE)}>
                    id.atlassian.com
                  </button>
                  . It’s kept in your keychain, and tickets are read straight from Jira by this computer.
                </>
              ) : (
                'Create one in Jira under your profile, Personal Access Tokens. It’s kept in your keychain.'
              )}
            </small>
          </label>
          <div className="actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void connect()}>
              {busy ? 'Checking…' : 'Connect Jira'}
            </button>
            {settings.jiraSites.length > 0 && (
              <button type="button" className="ghost" onClick={() => setAdding(false)}>
                Cancel
              </button>
            )}
            {error && <span className="error" role="alert">{error}</span>}
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="ghost" onClick={() => setAdding(true)}>
            Add another Jira site
          </button>
        </div>
      )}

      <fieldset className="field">
        <legend>Ranking</legend>
        <label className="radio">
          <input type="radio" name="ticketRanking" checked={settings.ticketRanking === 'local'} onChange={() => onChange({ ticketRanking: 'local' })} />
          Built in: due dates, priority, status, blockers and your project choices. Nothing leaves this computer.
        </label>
        <label className="radio">
          <input type="radio" name="ticketRanking" checked={settings.ticketRanking === 'jev'} onChange={() => onChange({ ticketRanking: 'jev' })} />
          Jev by TypeSafe AI: also judges urgency from each ticket’s text. Your top 30 tickets’ titles and descriptions are sent to TypeSafe AI.
        </label>
      </fieldset>

      {settings.ticketRanking === 'jev' && <JevKeyField />}
    </>
  )
}
