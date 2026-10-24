import type { RankedArticle } from '@shared/ranking'
import { LEANS } from '@shared/news'
import { timeAgo } from './useNews'

const leanLabel = (v: string): string => LEANS.find((l) => l.value === v)?.label ?? v

export function ArticleList({ articles, ranked = false }: { articles: RankedArticle[]; ranked?: boolean }): React.JSX.Element {
  return (
    <ol className={ranked ? 'articles ranked' : 'articles'}>
      {articles.map((a, i) => (
        <li key={a.id} className="article" style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
          {ranked && <span className="rank">{String(i + 1).padStart(2, '0')}</span>}
          <div className="article-body">
            <button className="article-link" onClick={() => void window.hub.openExternal(a.url)}>
              {a.title}
            </button>
            {a.summary && <p className="summary">{a.summary}</p>}
            <div className="meta">
              <span className="source">{a.sourceName}</span>
              <span className={`lean lean-${a.lean}`}>{leanLabel(a.lean)}</span>
              <span>{a.language.toUpperCase()}</span>
              <span>{timeAgo(a.publishedAt)}</span>
              {a.matched && <span className="match">Matches your topics</span>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function ArticleSkeleton({ rows = 4 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="skeleton" aria-label="Loading stories">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <span className="bar w80" />
          <span className="bar w55" />
          <span className="bar w30" />
        </div>
      ))}
    </div>
  )
}
