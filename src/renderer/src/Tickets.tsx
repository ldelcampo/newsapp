import { useCallback, useEffect, useState } from 'react'
import { PROJECT_WEIGHTS, type ProjectWeight, type RankedTicket, type TicketResult, type Urgency } from '@shared/jira'
import type { Settings } from '@shared/settings'
import { ArticleSkeleton } from './ArticleList'
import { Icon } from './Icon'
import { timeAgo } from './useNews'

const clean = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function useTickets(enabled: boolean): { result: TicketResult | null; loading: boolean; error: string; reload: () => void } {
  const [result, setResult] = useState<TicketResult | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')
  const load = useCallback(
    (force: boolean) => {
      if (!enabled) return setLoading(false)
      setLoading(true)
      setError('')
      window.hub
        .tickets(force)
        .then(setResult)
        .catch((e: Error) => setError(clean(e)))
        .finally(() => setLoading(false))
    },
    [enabled]
  )
  useEffect(() => load(false), [load])
  return { result, loading, error, reload: () => load(true) }
}

export const URGENCY_LABELS: Record<Urgency, string> = { now: 'Needs you today', soon: 'Soon', later: 'Later' }

export function TicketList({ tickets, compact = false }: { tickets: RankedTicket[]; compact?: boolean }): React.JSX.Element {
  return (
    <ol className={`articles tickets ${compact ? 'compact' : ''}`}>
      {tickets.map((t, i) => (
        <li key={t.id} className={`article ticket urgency-${t.urgency}`} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
          <span className="urgency-dot" title={URGENCY_LABELS[t.urgency]} aria-label={URGENCY_LABELS[t.urgency]} />
          <div className="article-body">
            <button className="article-link" onClick={() => void window.hub.openExternal(t.url)}>
              {t.summary}
            </button>
            <div className="meta">
              <span className="ticket-key">{t.key}</span>
              {!compact && <span>{t.project.name}</span>}
              <span>{t.status}</span>
              {t.reasons.slice(0, compact ? 1 : 3).map((r) => (
                <span key={r} className="reason">
                  {r}
                </span>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function TicketStatus({ result, loading, error, reload }: ReturnType<typeof useTickets>): React.JSX.Element {
  const label = loading ? 'Updating…' : result ? `Updated ${timeAgo(result.fetchedAt)} · ${result.ranking === 'jev' ? 'ranked with Jev' : 'built-in ranking'}` : ''
  const problems = [...(error ? [error] : []), ...(result?.problems ?? [])]
  return (
    <div className="news-status">
      <span className="status">{label}</span>
      <button className="ghost" onClick={reload} disabled={loading}>
        <Icon name="refresh" className={loading ? 'spin' : ''} />
        Refresh
      </button>
      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** All open tickets, grouped by urgency, with per-project importance. */
export function WorkView({ onOpen }: { onOpen: (view: 'settings') => void }): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [project, setProject] = useState('')
  useEffect(() => void window.hub.getSettings().then(setSettings), [])
  const t = useTickets(!!settings?.jiraSites.length)
  if (!settings) return <p className="muted">Loading…</p>

  if (!settings.jiraSites.length)
    return (
      <div className="card coming enter">
        <span className="badge">Jira</span>
        <p className="muted">Connect Jira to see every ticket assigned to you, across all your projects, ranked by what needs you first.</p>
        <button className="primary" onClick={() => onOpen('settings')}>
          Connect Jira
        </button>
      </div>
    )

  const setWeight = async (key: string, weight: ProjectWeight): Promise<void> => {
    const latest = await window.hub.getSettings()
    const saved = await window.hub.saveSettings({ ...latest, projectWeights: { ...latest.projectWeights, [key]: weight } })
    setSettings(saved)
    t.reload()
  }

  const all = t.result?.tickets ?? []
  const list = project ? all.filter((x) => x.project.key === project) : all
  const groups = (['now', 'soon', 'later'] as Urgency[]).map((u) => ({ u, items: list.filter((x) => x.urgency === u) })).filter((g) => g.items.length)
  const hidden = Object.entries(settings.projectWeights).filter(([, w]) => w === 'hidden').map(([k]) => k)

  return (
    <div className="news">
      <div className="toolbar enter">
        <TicketStatus {...t} />
      </div>

      {(t.result?.projects.length ?? 0) > 0 && (
        <section className="card enter projects" style={{ '--i': 1 } as React.CSSProperties}>
          <h2>Projects</h2>
          <p className="muted small">Important projects rank higher. Hidden ones are left out everywhere.</p>
          <ul className="project-list">
            {t.result!.projects.map((p) => (
              <li key={p.key}>
                <button type="button" className={project === p.key ? 'chip on' : 'chip'} aria-pressed={project === p.key} onClick={() => setProject(project === p.key ? '' : p.key)}>
                  <span className="ticket-key">{p.key}</span> {p.name} <span className="count">{p.count}</span>
                </button>
                <select aria-label={`How important is ${p.name}`} value={settings.projectWeights[p.key] ?? 'normal'} onChange={(e) => void setWeight(p.key, e.target.value as ProjectWeight)}>
                  {PROJECT_WEIGHTS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          {hidden.length > 0 && <p className="muted small">Hidden: {hidden.join(', ')}</p>}
        </section>
      )}

      <section className="card enter" style={{ '--i': 2 } as React.CSSProperties}>
        {t.loading && !t.result ? (
          <ArticleSkeleton rows={6} />
        ) : groups.length ? (
          groups.map((g) => (
            <div key={g.u} className="ticket-group">
              <h3 className={`urgency-head urgency-${g.u}`}>
                {URGENCY_LABELS[g.u]} <span className="count">{g.items.length}</span>
              </h3>
              <TicketList tickets={g.items} />
            </div>
          ))
        ) : (
          <p className="muted">{t.result ? 'Nothing open is assigned to you. Nice.' : 'No tickets loaded.'}</p>
        )}
      </section>
    </div>
  )
}
