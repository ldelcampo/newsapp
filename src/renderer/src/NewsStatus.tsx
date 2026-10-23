import type { NewsResult } from '@shared/api'
import { timeAgo } from './useNews'

export function NewsStatus({ news, loading, reload }: { news: NewsResult | null; loading: boolean; reload: () => void }): React.JSX.Element {
  return (
    <div className="news-status">
      <span className="muted small">
        {loading ? 'Updating…' : news ? `${news.offline ? 'Offline, showing news from' : 'Updated'} ${timeAgo(news.fetchedAt)}` : ''}
      </span>
      <button className="secondary" onClick={reload} disabled={loading}>
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
