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

/** A steady hue per source, so a story without a picture still gets a recognisable cover. */
function sourceHue(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/**
 * The first story leads as a 2×2 tile and every other story is a 1×2 tile, with or without a picture,
 * so the grid packs without holes and keeps the ranking order. A missing or broken picture becomes a
 * tinted cover with the source name instead of changing the tile's size.
 */
function MosaicTile({ a, i, compact, onVerify }: { a: RankedArticle; i: number; compact: boolean; onVerify: () => void }): React.JSX.Element {
  const [image, setImage] = useState<'loading' | 'ok' | 'failed'>('loading')
  const hero = i === 0
  const picture = !!a.imageUrl && image !== 'failed'
  return (
    <li className={`tile ${hero ? 'tile-hero' : 'tile-photo'}`} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
      {picture ? (
        <div className={`tile-image ${image}`}>
          <img src={a.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={() => setImage('ok')} onError={() => setImage('failed')} />
        </div>
      ) : (
        <div className="tile-image tile-cover" style={{ '--hue': sourceHue(a.sourceName) } as React.CSSProperties} aria-hidden="true">
          <span>{a.sourceName}</span>
        </div>
      )}
      <div className="tile-body">
        {a.matched && <span className={`match priority-${a.priority}`}>{a.topics.join(', ')}</span>}
        <button className="article-link" onClick={() => void window.hub.openExternal(a.url)}>
          {a.title}
        </button>
        {a.summary && hero && !compact && <p className="summary">{a.summary}</p>}
        <div className="meta">
          <span className="source">{a.sourceName}</span>
          <span className={`lean lean-${a.lean}`}>{leanLabel(a.lean)}</span>
          <span>{timeAgo(a.publishedAt)}</span>
          {!compact && (
            <button type="button" className="verify-btn" aria-label="Verify facts" title="Verify facts" onClick={onVerify}>
              <Icon name="verify" />
              {hero && 'Verify'}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/** Stories as a mosaic of tiles: a lead story, then same-size tiles in ranking order, packed without gaps. */
export function ArticleMosaic({ articles, compact = false }: { articles: RankedArticle[]; compact?: boolean }): React.JSX.Element {
  const [verifying, setVerifying] = useState<RankedArticle | null>(null)
  return (
    <>
      <ol className={`mosaic ${compact ? 'compact' : ''}`}>
        {articles.map((a, i) => (
          <MosaicTile key={a.id} a={a} i={i} compact={compact} onVerify={() => setVerifying(a)} />
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
