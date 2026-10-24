import type { RankedArticle } from '@shared/ranking'
import { LEANS } from '@shared/news'
import { useState } from 'react'
import { Icon } from './Icon'
import { timeAgo } from './useNews'
import { VerifyPanel } from './VerifyPanel'

/** Story image that removes itself if it fails to load. */
function Thumb({ src, featured }: { src: string; featured: boolean }): React.JSX.Element | null {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')
  if (state === 'failed') return null
  return (
    <div className={`thumb ${featured ? 'featured' : ''} ${state}`}>
      <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={() => setState('ok')} onError={() => setState('failed')} />
    </div>
  )
}

const leanLabel = (v: string): string => LEANS.find((l) => l.value === v)?.label ?? v

export function ArticleList({ articles, ranked = false, compact = false }: { articles: RankedArticle[]; ranked?: boolean; compact?: boolean }): React.JSX.Element {
  const [verifying, setVerifying] = useState<RankedArticle | null>(null)
  return (
    <>
      <ol className={`articles ${ranked ? 'ranked' : ''} ${compact ? 'compact' : ''}`}>
        {articles.map((a, i) => (
          <li key={a.id} className={ranked && i === 0 ? 'article lead' : 'article'} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
            {ranked && <span className="rank">{String(i + 1).padStart(2, '0')}</span>}
            <div className="article-body">
              <button className="article-link" onClick={() => void window.hub.openExternal(a.url)}>
                {a.title}
              </button>
              {a.summary && !compact && <p className="summary">{a.summary}</p>}
              <div className="meta">
                <span className="source">{a.sourceName}</span>
                <span className={`lean lean-${a.lean}`}>{leanLabel(a.lean)}</span>
                <span>{a.language.toUpperCase()}</span>
                <span>{timeAgo(a.publishedAt)}</span>
                {a.matched && (
                  <span className={`match priority-${a.priority}`} title={`${a.priority === 'high' ? 'High' : 'Medium'} priority`}>
                    {a.topics.join(', ')}
                  </span>
                )}
                {!compact && (
                  <button type="button" className="verify-btn" onClick={() => setVerifying(a)}>
                    <Icon name="verify" />
                    Verify facts
                  </button>
                )}
              </div>
            </div>
            {a.imageUrl && !compact && <Thumb src={a.imageUrl} featured={ranked && i === 0} />}
          </li>
        ))}
      </ol>
      {verifying && <VerifyPanel article={verifying} onClose={() => setVerifying(null)} />}
    </>
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
