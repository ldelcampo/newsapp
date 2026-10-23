import { useEffect, useState } from 'react'
import type { Settings } from '@shared/settings'
import { ArticleList } from './ArticleList'
import { NewsStatus } from './NewsStatus'
import { useNews } from './useNews'

export function DashboardView({ onOpen }: { onOpen: (view: 'news' | 'settings') => void }): React.JSX.Element {
  const { news, loading, reload } = useNews()
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => void window.hub.getSettings().then(setSettings), [])

  const top = news?.articles.slice(0, 5) ?? []
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="dashboard">
      <p className="lede">
        {greeting}
        {settings?.displayName ? `, ${settings.displayName}` : ''}.
      </p>
      <section className="card wide">
        <header className="card-head">
          <h2>Top stories</h2>
          <button className="link" onClick={() => onOpen('news')}>All news</button>
        </header>
        {settings && settings.topics.length === 0 && (
          <p className="muted small">
            Showing the newest stories. <button className="link" onClick={() => onOpen('settings')}>Add topics</button> to see what matters to you first.
          </p>
        )}
        {top.length > 0 ? <ArticleList articles={top} /> : !loading && <p className="muted">No stories yet.</p>}
        <NewsStatus news={news} loading={loading} reload={reload} />
      </section>
      <section className="card">
        <h2>Next meetings</h2>
        <p className="muted">Connect a calendar to see your day here. Arrives with accounts in slices 5 to 7.</p>
      </section>
      <section className="card">
        <h2>Mail that needs you</h2>
        <p className="muted">Connect Gmail, Microsoft or IONOS mail to see priority messages here. Arrives in slices 5 to 8.</p>
      </section>
    </div>
  )
}
