import { useState } from 'react'
import { ArticleList, ArticleSkeleton } from './ArticleList'
import { NewsStatus } from './NewsStatus'
import { useNews } from './useNews'

export function NewsView(): React.JSX.Element {
  const { news, loading, reload } = useNews()
  const [onlyMatches, setOnlyMatches] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const list = (news?.articles ?? []).filter(
    (a) => (!onlyMatches || a.matched) && (!q || a.title.toLowerCase().includes(q) || a.sourceName.toLowerCase().includes(q))
  )

  return (
    <div className="news">
      <div className="toolbar enter">
        <input id="news-search" className="search" placeholder="Search headlines or outlets" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="toggle">
          <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
          <span className="track" aria-hidden="true" />
          Only my topics
        </label>
        <NewsStatus news={news} loading={loading} reload={reload} />
      </div>
      <section className="card enter" style={{ '--i': 1 } as React.CSSProperties}>
        {loading && !news ? <ArticleSkeleton rows={8} /> : list.length > 0 ? <ArticleList articles={list} /> : <p className="muted">No stories match.</p>}
      </section>
    </div>
  )
}
