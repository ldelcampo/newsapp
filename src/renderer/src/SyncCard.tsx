import { useEffect, useState } from 'react'
import type { SyncStatus } from '@shared/api'
import type { Settings } from '@shared/settings'
import { Icon } from './Icon'
import { timeAgo } from './useNews'

const cleanError = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const prettyFolder = (f: string): string => f.replace(/^.*Mobile Documents\/com~apple~CloudDocs/, 'iCloud Drive')

/** Sync settings: an account on the news server (end-to-end encrypted), or a shared folder. */
export function SyncCard({ settings, onFolder }: { settings: Settings; onFolder: (folder: string) => Promise<void> }): React.JSX.Element {
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [iCloud, setICloud] = useState<string | null>(null)
  const [how, setHow] = useState<'account' | 'folder'>('account')
  const [create, setCreate] = useState(true)
  const [server, setServer] = useState(settings.newsServerUrl)
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.hub.syncStatus().then(setSync)
    void window.hub.iCloudFolder().then(setICloud)
  }, [])

  const signIn = async (): Promise<void> => {
    setError('')
    if (create && pass !== pass2) return setError('The passphrases don’t match.')
    setBusy(true)
    try {
      setSync(await window.hub.syncSignIn(server, email, pass, create))
      setPass('')
      setPass2('')
    } catch (e) {
      setError(cleanError(e as Error))
    } finally {
      setBusy(false)
    }
  }
  const noSubmit = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void signIn()
    }
  }

  const statusLine = sync?.error ? (
    <p className="error small">{sync.error}</p>
  ) : (
    sync?.syncedAt && (
      <p className="muted small">
        Up to date {timeAgo(sync.syncedAt)}
        {sync.lastDevice ? ` · last change from ${sync.lastDevice}` : ''}
      </p>
    )
  )

  return (
    <section className="card enter" style={{ '--i': 3 } as React.CSSProperties}>
      <h2>Sync between your computers</h2>
      <p className="muted small">
        Your topics, languages, sources, dashboard and theme follow you to every computer you sign in on. Mail, accounts and API keys stay on each computer.
      </p>

      {sync?.mode === 'account' ? (
        <>
          <p className="small">
            Signed in as <b>{sync.email}</b> on <code>{sync.server}</code>. Your settings are encrypted on this computer before they’re sent.
          </p>
          {statusLine}
          <div className="actions">
            <button type="button" className="ghost" onClick={() => void window.hub.syncNow().then(setSync)}>
              <Icon name="refresh" /> Sync now
            </button>
            <button type="button" className="ghost" onClick={() => void window.hub.syncSignOut().then(setSync)}>
              Sign out
            </button>
          </div>
        </>
      ) : sync?.mode === 'folder' ? (
        <>
          <p className="small">
            Syncing through <code>{prettyFolder(sync.folder)}</code>
          </p>
          {statusLine}
          <div className="actions">
            <button type="button" className="ghost" onClick={() => void window.hub.syncNow().then(setSync)}>
              <Icon name="refresh" /> Sync now
            </button>
            <button type="button" className="ghost" onClick={() => void onFolder('').then(() => window.hub.syncStatus().then(setSync))}>
              Stop syncing
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="sizes sync-how" role="tablist">
            <button type="button" role="tab" aria-selected={how === 'account'} className={how === 'account' ? 'on' : ''} onClick={() => setHow('account')}>
              With an account
            </button>
            <button type="button" role="tab" aria-selected={how === 'folder'} className={how === 'folder' ? 'on' : ''} onClick={() => setHow('folder')}>
              With a shared folder
            </button>
          </div>
          {how === 'account' ? (
            <div className="sync-form">
              <div className="grid2">
                <label className="field">
                  <span>Email</span>
                  <input id="sync-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={noSubmit} />
                </label>
                <label className="field">
                  <span>Server</span>
                  <input id="sync-server" value={server} placeholder="https://news.example.com" onChange={(e) => setServer(e.target.value)} onKeyDown={noSubmit} />
                </label>
                <label className="field">
                  <span>Passphrase</span>
                  <input id="sync-pass" type="password" autoComplete={create ? 'new-password' : 'current-password'} value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={noSubmit} />
                </label>
                {create && (
                  <label className="field">
                    <span>Repeat passphrase</span>
                    <input id="sync-pass2" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} onKeyDown={noSubmit} />
                  </label>
                )}
              </div>
              {create && (
                <p className="hint small">
                  Your passphrase is the key that encrypts your data, and it never leaves this computer. Nobody can reset it, not even us, so keep it somewhere safe.
                </p>
              )}
              {error && <p className="error small">{error}</p>}
              <div className="actions">
                <button type="button" className="primary" disabled={busy || !email || !pass || !server} onClick={() => void signIn()}>
                  {busy ? 'Working…' : create ? 'Create account' : 'Sign in'}
                </button>
                <button type="button" className="link" onClick={() => setCreate(!create)}>
                  {create ? 'I already have an account' : 'Create a new account'}
                </button>
              </div>
            </div>
          ) : (
            <div className="actions">
              {iCloud && (
                <button type="button" className="primary" onClick={() => void onFolder(iCloud).then(() => window.hub.syncStatus().then(setSync))}>
                  Use iCloud Drive
                </button>
              )}
              <button
                type="button"
                className="ghost"
                onClick={() => void window.hub.chooseSyncFolder().then((f) => (f ? onFolder(f).then(() => window.hub.syncStatus().then(setSync)) : undefined))}
              >
                Choose a folder…
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
