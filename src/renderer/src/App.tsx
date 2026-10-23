import { useState } from 'react'
import { SettingsView } from './SettingsView'

type View = 'today' | 'mail' | 'calendar' | 'news' | 'settings'

const VIEWS: { id: View; label: string; comingIn?: string }[] = [
  { id: 'today', label: 'Today', comingIn: 'The merged agenda and priorities arrive in slice 8.' },
  { id: 'mail', label: 'Mail', comingIn: 'Microsoft, Gmail and IONOS mail arrive in slices 5 to 7.' },
  { id: 'calendar', label: 'Calendar', comingIn: 'Calendars arrive with their accounts in slices 5 to 7.' },
  { id: 'news', label: 'News', comingIn: 'The topic news reader arrives in slice 1.' },
  { id: 'settings', label: 'Settings' }
]

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>('settings')
  const current = VIEWS.find((v) => v.id === view)!

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
        {current.comingIn ? <p className="muted">{current.comingIn}</p> : <SettingsView />}
      </main>
    </div>
  )
}
