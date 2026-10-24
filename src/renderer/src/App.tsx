import { useEffect, useState } from 'react'
import { applyTheme } from './theme'
import { DashboardView } from './DashboardView'
import { Icon } from './Icon'
import { NewsView } from './NewsView'
import { SettingsView } from './SettingsView'
import { WorkView } from './Tickets'
import { UpdateBanner } from './UpdateBanner'

type View = 'dashboard' | 'work' | 'mail' | 'calendar' | 'news' | 'settings'

const VIEWS: { id: View; label: string; comingIn?: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'work', label: 'Work' },
  { id: 'news', label: 'News' },
  { id: 'mail', label: 'Mail', comingIn: 'Microsoft, Gmail and IONOS mail arrive in slices 5 to 7.' },
  { id: 'calendar', label: 'Calendar', comingIn: 'Calendars arrive with their accounts in slices 5 to 7.' },
  { id: 'settings', label: 'Settings' }
]

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>('dashboard')
  // Bumped when another computer's changes arrive, so the open view reloads them.
  const [revision, setRevision] = useState(0)
  const [remoteNotice, setRemoteNotice] = useState(false)
  useEffect(
    () =>
      window.hub.onSettingsChanged((s) => {
        applyTheme(s.theme)
        setRemoteNotice(true)
        setTimeout(() => setRemoteNotice(false), 4000)
        // Settings may hold unsaved edits, so it keeps its form until the user leaves it.
        setRevision((r) => r + 1)
      }),
    []
  )
  const current = VIEWS.find((v) => v.id === view)!

  const body = (): React.JSX.Element => {
    if (current.comingIn)
      return (
        <div className="card coming enter">
          <span className="badge">Coming soon</span>
          <p className="muted">{current.comingIn}</p>
        </div>
      )
    if (view === 'dashboard') return <DashboardView onOpen={setView} />
    if (view === 'news') return <NewsView />
    if (view === 'work') return <WorkView onOpen={setView} />
    return <SettingsView />
  }

  return (
    <div className="shell">
      <div className="ambient" aria-hidden="true" />
      <nav className="sidebar" aria-label="Sections">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            Information <b>Hub</b>
          </span>
        </div>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={v.id === view ? 'nav active' : 'nav'}
            aria-current={v.id === view ? 'page' : undefined}
            onClick={() => setView(v.id)}
          >
            <Icon name={v.id} />
            {v.label}
            {v.comingIn && <span className="soon" aria-label="coming soon" />}
          </button>
        ))}
      </nav>
      <main className="content">
        {/* The key replays the entrance animation on every view change. */}
        <div className="view" key={view === 'settings' ? view : `${view}-${revision}`}>
          <h1 className="title">{current.label}</h1>
          {body()}
        </div>
      </main>
      <UpdateBanner />
      {remoteNotice && (
        <div className="sync-toast" role="status">
          Changes from your other computer were applied.
        </div>
      )}
    </div>
  )
}
