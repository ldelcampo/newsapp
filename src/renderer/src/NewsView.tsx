import { useState } from 'react'
import { ArticleList } from './ArticleList'
import { NewsStatus } from './NewsStatus'
import { useNews } from './useNews'

export function NewsView(): React.JSX.Element {
  const { news, loading, reload } = useNews()
  const [onlyMatches, setOnlyMatches] = useState(false)
  const list = (news?.articles ?? []).filter((a) => !onlyMatches || a.matched)

  return (
    <div className="news">
      <div className="toolbar">
        <label className="chip">
          <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
          Only my topics
        </label>
        <NewsStatus news={news} loading={loading} reload={reload} />
      </div>
      {list.length > 0 ? <ArticleList articles={list} /> : !loading && <p className="muted">No stories match.</p>}
    </div>
  )
}
