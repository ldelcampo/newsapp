import type { RankedArticle } from '@shared/ranking'
import { LEANS } from '@shared/news'
import { timeAgo } from './useNews'

const leanLabel = (v: string): string => LEANS.find((l) => l.value === v)?.label ?? v

export function ArticleList({ articles }: { articles: RankedArticle[] }): React.JSX.Element {
  return (
    <ul className="articles">
      {articles.map((a) => (
        <li key={a.id} className="article">
          <button className="article-link" onClick={() => void window.hub.openExternal(a.url)}>
            {a.title}
          </button>
          {a.summary && <p className="summary">{a.summary}</p>}
          <div className="meta">
            <span>{a.sourceName}</span>
            <span className={`lean lean-${a.lean}`}>{leanLabel(a.lean)}</span>
            <span>{a.language.toUpperCase()}</span>
            <span>{timeAgo(a.publishedAt)}</span>
            {a.matched && <span className="match">Matches your topics</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}
