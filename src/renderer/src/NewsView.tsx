import { useEffect, useState } from 'react'
import { filterArticles, PRIORITIES, type Priority } from '@shared/ranking'
import type { NewsLayout, Settings } from '@shared/settings'
import { ArticleList, ArticleMosaic, ArticleSkeleton } from './ArticleList'
import { Icon } from './Icon'
import { NewsStatus } from './NewsStatus'
import { useNews } from './useNews'

export function NewsView(): React.JSX.Element {
  const { news, loading, reload } = useNews()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [onlyMatches, setOnlyMatches] = useState(false)
  const [topic, setTopic] = useState('')
  const [minPriority, setMinPriority] = useState<Priority>('low')
  const [query, setQuery] = useState('')

  useEffect(() => {
    void window.hub.getSettings().then((s) => {
      setSettings(s)
      setOnlyMatches(s.onlyMyTopics)
    })
  }, [])

  const layout = settings?.newsLayout ?? 'mosaic'
  const setLayout = (newsLayout: NewsLayout): void => {
    if (!settings) return
    const next = { ...settings, newsLayout }
    setSettings(next)
    void window.hub.saveSettings(next)
  }

  const all = news?.articles ?? []
  const list = filterArticles(all, { onlyMatches, topic, minPriority, query })
  const topics = settings?.topics ?? []
  const countFor = (t: string): number => all.filter((a) => a.topics.includes(t)).length

  return (
    <div className="news">
      <div className="toolbar enter">
        <input id="news-search" className="search" placeholder="Search headlines or outlets" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="toggle">
          <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
          <span className="track" aria-hidden="true" />
          Only my topics
        </label>
        <label className="field-inline">
          <span className="muted small">Priority</span>
          <select id="priority" value={minPriority} onChange={(e) => setMinPriority(e.target.value as Priority)}>
            <option value="low">Any</option>
            <option value="medium">Medium and high</option>
            <option value="high">High only</option>
          </select>
        </label>
        <NewsStatus news={news} loading={loading} reload={reload} />
      </div>

      {topics.length > 0 && (
        <div className="chips topic-filter enter" role="group" aria-label="Filter by topic" style={{ '--i': 1 } as React.CSSProperties}>
          <button type="button" className={topic === '' ? 'chip on' : 'chip'} aria-pressed={topic === ''} onClick={() => setTopic('')}>
            All topics
          </button>
          {topics.map((t) => (
            <button type="button" key={t} className={topic === t ? 'chip on' : 'chip'} aria-pressed={topic === t} onClick={() => setTopic(topic === t ? '' : t)}>
              {t} <span className="count">{countFor(t)}</span>
            </button>
          ))}
        </div>
      )}

      <section className="card enter" style={{ '--i': 2 } as React.CSSProperties}>
        <div className="card-head">
          <p className="muted small" aria-live="polite">
            {loading && !news ? 'Loading stories…' : `${list.length} of ${all.length} stories`}
            {minPriority !== 'low' && ` · ${PRIORITIES.find((p) => p.value === minPriority)?.label}${minPriority === 'medium' ? ' and high' : ''} priority`}
          </p>
          <div className="sizes layout-switch" role="group" aria-label="Layout">
            {(['mosaic', 'list'] as const).map((l) => (
              <button type="button" key={l} className={layout === l ? 'on' : ''} aria-pressed={layout === l} onClick={() => setLayout(l)}>
                <Icon name={l} /> {l === 'mosaic' ? 'Mosaic' : 'List'}
              </button>
            ))}
          </div>
        </div>
        {loading && !news ? (
          <ArticleSkeleton rows={8} />
        ) : list.length === 0 ? (
          <p className="muted">No stories match these filters.</p>
        ) : layout === 'mosaic' ? (
          <ArticleMosaic articles={list} />
        ) : (
          <ArticleList articles={list} />
        )}
      </section>
    </div>
  )
}
