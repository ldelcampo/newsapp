import type { NewsResult } from '@shared/api'
import { Icon } from './Icon'
import { timeAgo } from './useNews'

export function NewsStatus({ news, loading, reload }: { news: NewsResult | null; loading: boolean; reload: () => void }): React.JSX.Element {
  const label = loading
    ? 'Updating…'
    : news
      ? news.offline
        ? `Offline · showing news from ${timeAgo(news.fetchedAt)}`
        : `Updated ${timeAgo(news.fetchedAt)} · via ${news.via}`
      : ''
  return (
    <div className="news-status">
      <span className={news?.offline ? 'status offline' : 'status'}>{label}</span>
      <button className="ghost" onClick={reload} disabled={loading}>
        <Icon name="refresh" className={loading ? 'spin' : ''} />
        Refresh
      </button>
      {news && news.problems.length > 0 && (
        <ul className="problems">
          {news.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
