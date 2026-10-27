import { useEffect, useRef, useState } from 'react'
import type { NewsResult } from '@shared/api'
import { ticketsFor } from '@shared/jira'
import { aboutTopic, filterArticles } from '@shared/ranking'
import type { Settings } from '@shared/settings'
import { CURRENCIES, type Place, type Rates, type Weather, type Widget, type WidgetSize } from '@shared/widgets'
import { ArticleList, ArticleMosaic, ArticleSkeleton } from './ArticleList'
import { ConnectPrompt, EventList, MailList, NextMeeting, Problems, useNow } from './Inbox'
import { useAccounts, useEvents, useMail } from './useAccounts'
import { Icon } from './Icon'
import { NewsStatus } from './NewsStatus'
import { Pager, usePage } from './Pager'
import { TicketList, TicketStatus, useTickets } from './Tickets'
import { WeatherScene } from './WeatherScene'

export interface WidgetContext {
  settings: Settings
  news: NewsResult | null
  loading: boolean
  reload: () => void
  /** Opens a section; for Mail, `mailId` opens that message there. */
  onOpen: (view: 'news' | 'settings' | 'work' | 'mail' | 'calendar', mailId?: string) => void
}

/** Runs an async load whenever `key` changes; keeps the last result while reloading. */
function useLoad<T>(key: string, load: () => Promise<T>, everyMs = 0): { data: T | null; error: string } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setError('')
    const run = (): void => {
      load()
        .then((d) => {
          if (!live) return
          setData(d)
          setError('')
        })
        .catch((e: Error) => live && setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    }
    run()
    const timer = everyMs ? setInterval(run, everyMs) : undefined
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [key])
  return { data, error }
}

const STORY_COUNT: Record<WidgetSize, number> = { small: 3, medium: 5, wide: 7 }

function TopStories({ ctx, size, topic }: { ctx: WidgetContext; size: WidgetSize; topic: string }): React.JSX.Element {
  const { settings, news, loading, reload, onOpen } = ctx
  const all = news?.articles ?? []
  const list = topic ? aboutTopic(all, topic) : filterArticles(all, { onlyMatches: settings.onlyMyTopics })
  const p = usePage(list, STORY_COUNT[size], `${topic}:${settings.onlyMyTopics}`)
  return (
    <>
      <header className="card-head">
        <h2>
          <span className="live" aria-hidden="true" />
          {topic ? (
            <>
              {topic} <span className="topic-tag">Topic</span>
            </>
          ) : (
            'Top stories'
          )}
        </h2>
        <button className="link" onClick={() => onOpen('news')}>
          All news <Icon name="arrow" />
        </button>
      </header>
      {!topic && settings.topics.length === 0 && (
        <p className="hint">
          Showing the newest stories.{' '}
          <button className="link" onClick={() => onOpen('settings')}>
            Add topics
          </button>{' '}
          to see what matters to you first.
        </p>
      )}
      {loading && !news ? (
        <ArticleSkeleton rows={STORY_COUNT[size]} />
      ) : list.length === 0 ? (
        <p className="muted">{topic ? `No stories about ${topic} right now.` : settings.onlyMyTopics ? 'No stories match your topics right now.' : 'No stories yet.'}</p>
      ) : size === 'wide' ? (
        <div className="paged" key={p.at}>
          <ArticleMosaic articles={p.page} compact />
        </div>
      ) : (
        <div className="paged" key={p.at}>
          <ArticleList articles={p.page} ranked={size !== 'small' && p.at === 0} compact={size === 'small'} />
        </div>
      )}
      <div className="widget-foot">
        {size !== 'small' && <NewsStatus news={news} loading={loading} reload={reload} />}
        <Pager {...p} total={list.length} perPage={STORY_COUNT[size]} label="Stories" />
      </div>
    </>
  )
}

function NeedsYou({ ctx, size, project, label }: { ctx: WidgetContext; size: WidgetSize; project: string; label: string }): React.JSX.Element {
  const connected = ctx.settings.jiraSites.length > 0
  const t = useTickets(connected)
  const tickets = ticketsFor(t.result?.tickets ?? [], { project, label })
  const now = tickets.filter((x) => x.urgency === 'now').length
  const p = usePage(tickets, STORY_COUNT[size], `${project}:${label}`)
  const projectName = t.result?.projects.find((x) => x.key === project)?.name
  return (
    <>
      <header className="card-head">
        <h2>
          <Icon name="work" /> {project || label ? [projectName ?? project, label && `#${label}`].filter(Boolean).join(' · ') : 'Needs you today'}
          {now > 0 && <span className="pill urgent">{now}</span>}
        </h2>
        {connected && (
          <button className="link" onClick={() => ctx.onOpen('work')}>
            All tickets <Icon name="arrow" />
          </button>
        )}
      </header>
      {!connected ? (
        <p className="hint">
          See your Jira tickets here, most urgent first.{' '}
          <button className="link" onClick={() => ctx.onOpen('settings')}>
            Connect Jira
          </button>
        </p>
      ) : t.loading && !t.result ? (
        <ArticleSkeleton rows={STORY_COUNT[size]} />
      ) : tickets.length ? (
        <div className="paged" key={p.at}>
          <TicketList tickets={p.page} compact={size === 'small'} />
        </div>
      ) : (
        <p className="muted">{!t.result ? '' : project || label ? 'Nothing open here is assigned to you.' : 'Nothing open is assigned to you. Nice.'}</p>
      )}
      {connected && (
        <div className="widget-foot">
          {size !== 'small' && <TicketStatus {...t} />}
          <Pager {...p} total={tickets.length} perPage={STORY_COUNT[size]} label="Tickets" />
        </div>
      )}
      {connected && size === 'small' && (t.error || t.result?.problems.length) ? <p className="problems small">{t.error || t.result?.problems[0]}</p> : null}
    </>
  )
}

function Stats({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const articles = ctx.news?.articles ?? []
  const items = [
    { label: 'Stories today', value: articles.length },
    { label: 'Match your topics', value: articles.filter((a) => a.matched).length },
    { label: 'High priority', value: articles.filter((a) => a.priority === 'high' && a.matched).length },
    { label: 'Outlets reporting', value: new Set(articles.map((a) => a.sourceId)).size }
  ]
  return (
    <div className="stats">
      {items.map((s) => (
        <div key={s.label} className="stat">
          <span className="stat-value">{ctx.loading && !ctx.news ? '—' : s.value}</span>
          <span className="stat-label">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

const money = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: n >= 10 ? 2 : 4, minimumFractionDigits: 2 })

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Animates a number from its previous value; `changed` is 'up' or 'down' briefly after a change. */
function useCountUp(value: number): { shown: number; changed: '' | 'up' | 'down' } {
  const [shown, setShown] = useState(value)
  const [changed, setChanged] = useState<'' | 'up' | 'down'>('')
  const from = useRef<number | null>(null)
  useEffect(() => {
    const start = from.current ?? value * 0.9
    const first = from.current === null
    from.current = value
    if (start === value || reducedMotion()) return setShown(value)
    if (!first) setChanged(value > start ? 'up' : 'down')
    let frame = 0
    const t0 = performance.now()
    const step = (t: number): void => {
      const p = Math.min(1, (t - t0) / 900)
      setShown(start + (value - start) * (1 - Math.pow(1 - p, 3)))
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    const done = setTimeout(() => setChanged(''), 2000)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(done)
    }
  }, [value])
  return { shown, changed }
}

function Rate({ value }: { value: number | undefined }): React.JSX.Element {
  const { shown, changed } = useCountUp(value ?? 0)
  return <span className={`rate ${changed}`}>{value !== undefined ? money(shown) : '—'}</span>
}

function Currency({ widget }: { widget: Extract<Widget, { type: 'currency' }> }): React.JSX.Element {
  const { data, error } = useLoad<Rates>(`${widget.base}:${widget.symbols.join(',')}`, () => window.hub.rates(widget.base, widget.symbols), 5 * 60_000)
  return (
    <>
      <h2>
        <Icon name="currency" /> Exchange rates
      </h2>
      {error && !data && <p className="error small">Couldn’t load rates: {error}</p>}
      {!data && !error && <ArticleSkeleton rows={2} />}
      {data && (
        <>
          <ul className="rates">
            {widget.symbols.map((c) => (
              <li key={c}>
                <span className="muted">1 {data.base} =</span>
                <Rate value={data.rates[c]} />
                <span className="code">{c}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {data.source === 'market'
              ? `Market rates, ${new Date(data.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
              : `European Central Bank reference rates, ${new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
          </p>
        </>
      )}
    </>
  )
}

function WeatherCard({ widget }: { widget: Extract<Widget, { type: 'weather' }> }): React.JSX.Element {
  const p = widget.place
  // The main process caches weather for 30 minutes, so asking every 10 picks up each update soon after.
  const { data, error } = useLoad<Weather>(`${p.latitude},${p.longitude}`, () => window.hub.weather(p), 10 * 60_000)
  return (
    <>
      <h2>
        <Icon name="weather" /> {p.name.split(',')[0]}
      </h2>
      {error && !data && <p className="error small">Couldn’t load the weather: {error}</p>}
      {!data && !error && <ArticleSkeleton rows={1} />}
      {data && (
        <div className="weather">
          <WeatherScene kind={data.kind} isDay={data.isDay} />
          <span className="temp">{Math.round(data.temperature)}°</span>
          <span className="weather-text">
            {data.description}
            <span className="muted small">
              High {Math.round(data.high)}° · Low {Math.round(data.low)}°
            </span>
          </span>
        </div>
      )}
    </>
  )
}

export const cityOf = (zone: string): string => zone.split('/').pop()!.replace(/_/g, ' ')

/** Hours and minutes in a zone, with the separator as its own part so it can blink. */
function timeParts(now: Date, zone: string): { hm: [string, string]; suffix: string; hour: number } {
  const parts = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: '2-digit', minute: '2-digit' }).formatToParts(now)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(now))
  return { hm: [get('hour'), get('minute')], suffix: get('dayPeriod'), hour }
}

function Clocks({ widget }: { widget: Extract<Widget, { type: 'clocks' }> }): React.JSX.Element {
  const now = useNow(1_000)
  const localDay = now.toLocaleDateString('en-CA')
  return (
    <>
      <h2>
        <Icon name="clocks" /> World clocks
      </h2>
      <ul className="clocks">
        {widget.zones.map((z) => {
          const day = now.toLocaleDateString('en-CA', { timeZone: z })
          const t = timeParts(now, z)
          const daytime = t.hour >= 6 && t.hour < 19
          return (
            <li key={z}>
              <span className={daytime ? 'daypart day' : 'daypart night'} title={daytime ? 'Daytime' : 'Night'} aria-hidden="true" />
              <span className="city">{cityOf(z)}</span>
              <span className="time">
                {t.hm[0]}
                <span className="colon">:</span>
                {t.hm[1]}
                {t.suffix && <small> {t.suffix}</small>}
              </span>
              <span className="muted small">{day === localDay ? 'Today' : day > localDay ? 'Tomorrow' : 'Yesterday'}</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function WidgetBody({ widget, ctx }: { widget: Widget; ctx: WidgetContext }): React.JSX.Element {
  switch (widget.type) {
    case 'top-stories':
      return <TopStories ctx={ctx} size={widget.size} topic={widget.topic} />
    case 'stats':
      return <Stats ctx={ctx} />
    case 'tickets':
      return <NeedsYou ctx={ctx} size={widget.size} project={widget.project} label={widget.label} />
    case 'currency':
      return <Currency widget={widget} />
    case 'weather':
      return <WeatherCard widget={widget} />
    case 'clocks':
      return <Clocks widget={widget} />
    case 'meetings':
      return <Meetings ctx={ctx} size={widget.size} />
    case 'mail':
      return <Mail ctx={ctx} size={widget.size} />
  }
}

const MAIL_COUNT: Record<WidgetSize, number> = { small: 3, medium: 5, wide: 6 }

function Mail({ ctx, size }: { ctx: WidgetContext; size: WidgetSize }): React.JSX.Element {
  const { accounts } = useAccounts()
  const { feed, error } = useMail()
  const withMail = accounts?.filter((a) => a.mail) ?? []
  const today = feed?.items.filter((m) => m.urgency === 'now' && m.unread).length ?? 0
  const unread = feed?.items.filter((m) => m.unread).length ?? 0
  const p = usePage(feed?.items ?? [], MAIL_COUNT[size])
  return (
    <>
      <header className="card-head">
        <h2>
          <Icon name="mail" /> Mail
          {today > 0 ? <span className="count">{today} need you today</span> : unread > 0 && <span className="count">{unread} unread</span>}
        </h2>
        {withMail.length > 0 && (
          <button className="link" onClick={() => ctx.onOpen('mail')}>
            All mail <Icon name="arrow" />
          </button>
        )}
      </header>
      {accounts && withMail.length === 0 ? (
        <ConnectPrompt what="mail" onOpen={() => ctx.onOpen('settings')} />
      ) : !feed && !error ? (
        <ArticleSkeleton rows={MAIL_COUNT[size]} />
      ) : (
        <>
          {error && <p className="error small">Couldn’t load mail: {error}</p>}
          {feed && feed.items.length === 0 && <p className="muted">Your inbox is empty.</p>}
          {feed && (
            <div className="paged" key={p.at}>
              <MailList mail={p.page} accounts={withMail} compact={size === 'small'} onSelect={(m) => ctx.onOpen('mail', m.id)} />
            </div>
          )}
          {feed && <Pager {...p} total={feed.items.length} perPage={MAIL_COUNT[size]} label="Mail" />}
          {feed && <Problems problems={feed.problems} />}
        </>
      )}
    </>
  )
}

function Meetings({ ctx, size }: { ctx: WidgetContext; size: WidgetSize }): React.JSX.Element {
  const { accounts } = useAccounts()
  const { feed, error } = useEvents()
  // Every 15 s, so the countdown never lags by more than a moment.
  const now = useNow(15_000)
  const withCalendar = accounts?.filter((a) => a.calendar) ?? []
  const nowISO = now.toISOString()
  const upcoming = (feed?.items ?? []).filter((e) => e.end > nowISO)
  const next = upcoming.find((e) => !e.allDay)
  const rest = upcoming.filter((e) => e !== next)
  return (
    <>
      <header className="card-head">
        <h2>
          <Icon name="calendar" /> Next meetings
        </h2>
        {withCalendar.length > 0 && (
          <button className="link" onClick={() => ctx.onOpen('calendar')}>
            Calendar <Icon name="arrow" />
          </button>
        )}
      </header>
      {accounts && withCalendar.length === 0 ? (
        <ConnectPrompt what="calendar" onOpen={() => ctx.onOpen('settings')} />
      ) : !feed && !error ? (
        <ArticleSkeleton rows={2} />
      ) : (
        <>
          {error && <p className="error small">Couldn’t load your calendar: {error}</p>}
          {feed && upcoming.length === 0 && <p className="muted">Nothing on your calendar this week.</p>}
          {next && <NextMeeting e={next} now={now} accounts={withCalendar} />}
          {size !== 'small' && rest.length > 0 && <EventList events={rest} accounts={withCalendar} now={now} limit={size === 'wide' ? 6 : 3} />}
          {feed && <Problems problems={feed.problems} />}
        </>
      )}
    </>
  )
}

// ---------- Options shown while customizing ----------

function PlacePicker({ place, onPick }: { place: Place; onPick: (p: Place) => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Place[]>([])
  const [error, setError] = useState('')
  const search = (e: React.FormEvent | React.MouseEvent): void => {
    e.preventDefault()
    setError('')
    window.hub
      .findPlaces(query)
      .then((r) => {
        setFound(r)
        if (r.length === 0) setError('No places found. Try just the city name.')
      })
      .catch((e: Error) => setError(`Search failed: ${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`))
  }
  return (
    <div className="widget-option">
      <span className="small muted">Place: {place.name}</span>
      <div className="row">
        <input aria-label="Find a place" placeholder="City, optionally with state or country" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(e)} />
        <button type="button" className="ghost" onClick={search}>
          Search
        </button>
      </div>
      {error && <span className="small muted">{error}</span>}
      {found.length > 0 && (
        <div className="chips">
          {found.map((p) => (
            <button
              type="button"
              key={`${p.latitude},${p.longitude}`}
              className="chip"
              onClick={() => {
                onPick(p)
                setFound([])
                setQuery('')
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ListPicker({ label, items, options, render = (s) => s, max, onChange }: {
  label: string
  items: string[]
  options: string[]
  render?: (s: string) => string
  max: number
  onChange: (items: string[]) => void
}): React.JSX.Element {
  const rest = options.filter((o) => !items.includes(o))
  return (
    <div className="widget-option">
      <div className="chips">
        {items.map((i) => (
          <span key={i} className="chip on">
            {render(i)}
            <button type="button" className="chip-x" aria-label={`Remove ${render(i)}`} disabled={items.length <= 1} onClick={() => onChange(items.filter((x) => x !== i))}>
              <Icon name="close" />
            </button>
          </span>
        ))}
      </div>
      {items.length < max && (
        <select aria-label={label} value="" onChange={(e) => e.target.value && onChange([...items, e.target.value])}>
          <option value="">{label}</option>
          {rest.map((o) => (
            <option key={o} value={o}>
              {render(o)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

const ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['America/Mexico_City', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Madrid', 'Asia/Tokyo']
  }
})()

function TopicPicker({ topic, topics, onPick }: { topic: string; topics: string[]; onPick: (t: string) => void }): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const pick = (t: string): void => {
    onPick(t.trim())
    setTyped('')
  }
  return (
    <div className="widget-option">
      <span className="small muted">Topic</span>
      <div className="chips">
        {['', ...topics, ...(topic && !topics.includes(topic) ? [topic] : [])].map((t) => (
          <button type="button" key={t || 'all'} className={topic === t ? 'chip on' : 'chip'} aria-pressed={topic === t} onClick={() => pick(t)}>
            {t || 'All my topics'}
          </button>
        ))}
      </div>
      <div className="row">
        <input aria-label="Any other topic" placeholder="Or type any topic, like “Banxico” or “Fórmula 1”" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && typed.trim() && pick(typed)} />
        <button type="button" className="ghost" disabled={!typed.trim()} onClick={() => pick(typed)}>
          Use
        </button>
      </div>
    </div>
  )
}

function TicketFilter({ widget, onChange }: { widget: Extract<Widget, { type: 'tickets' }>; onChange: (w: Widget) => void }): React.JSX.Element {
  const t = useTickets(true)
  const projects = t.result?.projects ?? []
  const labels = t.result?.labels ?? []
  return (
    <div className="widget-option">
      <span className="small muted">Show tickets from</span>
      <div className="row">
        <select aria-label="Project" value={widget.project} onChange={(e) => onChange({ ...widget, project: e.target.value })}>
          <option value="">All projects</option>
          {[...projects, ...(widget.project && !projects.some((p) => p.key === widget.project) ? [{ key: widget.project, name: widget.project, count: 0 }] : [])].map((p) => (
            <option key={p.key} value={p.key}>
              {p.key} · {p.name} ({p.count})
            </option>
          ))}
        </select>
        <select aria-label="Label" value={widget.label} onChange={(e) => onChange({ ...widget, label: e.target.value })}>
          <option value="">Any label</option>
          {[...labels, ...(widget.label && !labels.some((l) => l.name === widget.label) ? [{ name: widget.label, count: 0 }] : [])].map((l) => (
            <option key={l.name} value={l.name}>
              {l.name} ({l.count})
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function WidgetOptions({ widget, topics, onChange }: { widget: Widget; topics: string[]; onChange: (w: Widget) => void }): React.JSX.Element | null {
  switch (widget.type) {
    case 'tickets':
      return <TicketFilter widget={widget} onChange={onChange} />
    case 'top-stories':
      return <TopicPicker topic={widget.topic} topics={topics} onPick={(topic) => onChange({ ...widget, topic })} />
    case 'currency':
      return (
        <>
          <label className="widget-option">
            <span className="small muted">Base currency</span>
            <select value={widget.base} onChange={(e) => onChange({ ...widget, base: e.target.value, symbols: widget.symbols.filter((s) => s !== e.target.value) })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <ListPicker label="Add a currency" items={widget.symbols} options={CURRENCIES.filter((c) => c !== widget.base)} max={8} onChange={(symbols) => onChange({ ...widget, symbols })} />
        </>
      )
    case 'weather':
      return <PlacePicker place={widget.place} onPick={(place) => onChange({ ...widget, place })} />
    case 'clocks':
      return <ListPicker label="Add a city" items={widget.zones} options={ZONES} render={cityOf} max={6} onChange={(zones) => onChange({ ...widget, zones })} />
    default:
      return null
  }
}
