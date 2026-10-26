import { useEffect, useState } from 'react'
import { applyTheme } from './theme'
import { CalendarView } from './AccountViews'
import { MailView } from './MailView'
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
  { id: 'mail', label: 'Mail' },
  { id: 'calendar', label: 'Calendar' },
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
    if (view === 'mail') return <MailView onAdd={() => setView('settings')} />
    if (view === 'calendar') return <CalendarView onAdd={() => setView('settings')} />
    return <SettingsView />
  }

  return (
    <div className="shell">
      <div className="ambient" aria-hidden="true" />
      <nav className="sidebar" aria-label="Sections">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 100 100" aria-hidden="true">
            <rect width="100" height="100" rx="22.4" fill="#2a1d66" />
            <path d="M22 84 L44 18 L56 18 L78 84 L64 84 L50 38 L36 84 Z" fill="#f3ecdf" />
            <circle className="brand-lamp" cx="50" cy="60" r="8.5" fill="#ffb86b" />
          </svg>
          <b>Atalia</b>
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
      <main className={`content ${view === 'mail' ? 'wide' : ''}`}>
        {/* The key replays the entrance animation on every view change. Settings keeps unsaved edits and
            the dashboard updates itself, so only the other views reload when another computer's changes arrive. */}
        <div className="view" key={view === 'settings' || view === 'dashboard' ? view : `${view}-${revision}`}>
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
