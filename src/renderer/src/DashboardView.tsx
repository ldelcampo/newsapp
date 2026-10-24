import { useEffect, useState } from 'react'
import type { Settings } from '@shared/settings'
import { ArticleList, ArticleSkeleton } from './ArticleList'
import { Icon } from './Icon'
import { NewsStatus } from './NewsStatus'
import { useNews } from './useNews'

export function DashboardView({ onOpen }: { onOpen: (view: 'news' | 'settings') => void }): React.JSX.Element {
  const { news, loading, reload } = useNews()
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => void window.hub.getSettings().then(setSettings), [])

  const articles = news?.articles ?? []
  const top = articles.slice(0, 5)
  const matches = articles.filter((a) => a.matched).length
  const outlets = new Set(articles.map((a) => a.sourceId)).size
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="dashboard">
      <header className="hero enter" style={{ '--i': 0 } as React.CSSProperties}>
        <p className="eyebrow">{today}</p>
        <p className="greeting">
          {greeting}
          {settings?.displayName ? `, ${settings.displayName}` : ''}.
        </p>
      </header>

      <div className="stats">
        {[
          { label: 'Stories today', value: articles.length },
          { label: 'Match your topics', value: matches },
          { label: 'Outlets reporting', value: outlets }
        ].map((s, i) => (
          <div key={s.label} className="stat enter" style={{ '--i': i + 1 } as React.CSSProperties}>
            <span className="stat-value">{loading && !news ? '—' : s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      <section className="card wide glow enter" style={{ '--i': 4 } as React.CSSProperties}>
        <header className="card-head">
          <h2>
            <span className="live" aria-hidden="true" />
            Top stories
          </h2>
          <button className="link" onClick={() => onOpen('news')}>
            All news <Icon name="arrow" />
          </button>
        </header>
        {settings && settings.topics.length === 0 && (
          <p className="hint">
            Showing the newest stories.{' '}
            <button className="link" onClick={() => onOpen('settings')}>
              Add topics
            </button>{' '}
            to see what matters to you first.
          </p>
        )}
        {loading && !news ? <ArticleSkeleton rows={5} /> : top.length > 0 ? <ArticleList articles={top} ranked /> : <p className="muted">No stories yet.</p>}
        <NewsStatus news={news} loading={loading} reload={reload} />
      </section>

      <section className="card enter" style={{ '--i': 5 } as React.CSSProperties}>
        <h2>
          <Icon name="calendar" /> Next meetings
        </h2>
        <p className="muted">Connect a calendar to see your day here. Arrives with accounts in slices 5 to 7.</p>
      </section>
      <section className="card enter" style={{ '--i': 6 } as React.CSSProperties}>
        <h2>
          <Icon name="mail" /> Mail that needs you
        </h2>
        <p className="muted">Connect Gmail, Microsoft or IONOS mail to see priority messages here. Arrives in slices 5 to 8.</p>
      </section>
    </div>
  )
}
