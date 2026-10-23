import { useState } from 'react'
import { DashboardView } from './DashboardView'
import { NewsView } from './NewsView'
import { SettingsView } from './SettingsView'

type View = 'dashboard' | 'mail' | 'calendar' | 'news' | 'settings'

const VIEWS: { id: View; label: string; comingIn?: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'mail', label: 'Mail', comingIn: 'Microsoft, Gmail and IONOS mail arrive in slices 5 to 7.' },
  { id: 'calendar', label: 'Calendar', comingIn: 'Calendars arrive with their accounts in slices 5 to 7.' },
  { id: 'news', label: 'News' },
  { id: 'settings', label: 'Settings' }
]

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>('dashboard')
  const current = VIEWS.find((v) => v.id === view)!

  const body = (): React.JSX.Element => {
    if (current.comingIn) return <p className="muted">{current.comingIn}</p>
    if (view === 'dashboard') return <DashboardView onOpen={setView} />
    if (view === 'news') return <NewsView />
    return <SettingsView />
  }

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Sections">
        <div className="brand">Information Hub</div>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={v.id === view ? 'nav active' : 'nav'}
            aria-current={v.id === view ? 'page' : undefined}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>
      <main className="content">
        <h1>{current.label}</h1>
        {body()}
      </main>
    </div>
  )
}
