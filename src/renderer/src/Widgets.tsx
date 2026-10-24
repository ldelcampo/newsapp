import { useEffect, useRef, useState } from 'react'
import type { NewsResult } from '@shared/api'
import { filterArticles } from '@shared/ranking'
import type { Settings } from '@shared/settings'
import { CURRENCIES, type Place, type Rates, type Weather, type Widget, type WidgetSize } from '@shared/widgets'
import { ArticleList, ArticleSkeleton } from './ArticleList'
import { Icon } from './Icon'
import { NewsStatus } from './NewsStatus'
import { TicketList, TicketStatus, useTickets } from './Tickets'
import { WeatherScene } from './WeatherScene'

export interface WidgetContext {
  settings: Settings
  news: NewsResult | null
  loading: boolean
  reload: () => void
  onOpen: (view: 'news' | 'settings' | 'work') => void
}

/** Runs an async load whenever `key` changes; keeps the last result while reloading. */
function useLoad<T>(key: string, load: () => Promise<T>): { data: T | null; error: string } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setError('')
    load()
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    return () => {
      live = false
    }
  }, [key])
  return { data, error }
}

const STORY_COUNT: Record<WidgetSize, number> = { small: 3, medium: 5, wide: 6 }

function TopStories({ ctx, size }: { ctx: WidgetContext; size: WidgetSize }): React.JSX.Element {
  const { settings, news, loading, reload, onOpen } = ctx
  const list = filterArticles(news?.articles ?? [], { onlyMatches: settings.onlyMyTopics }).slice(0, STORY_COUNT[size])
  return (
    <>
      <header className="card-head">
        <h2>
          <span className="live" aria-hidden="true" />
          Top stories
        </h2>
        <button className="link" onClick={() => onOpen('news')}>
          All news <Icon name="arrow" />
        </button>
      </header>
      {settings.topics.length === 0 && (
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
      ) : list.length > 0 ? (
        <ArticleList articles={list} ranked={size !== 'small'} compact={size === 'small'} />
      ) : (
        <p className="muted">{settings.onlyMyTopics ? 'No stories match your topics right now.' : 'No stories yet.'}</p>
      )}
      {size !== 'small' && <NewsStatus news={news} loading={loading} reload={reload} />}
    </>
  )
}

function NeedsYou({ ctx, size }: { ctx: WidgetContext; size: WidgetSize }): React.JSX.Element {
  const connected = ctx.settings.jiraSites.length > 0
  const t = useTickets(connected)
  const tickets = t.result?.tickets ?? []
  const now = tickets.filter((x) => x.urgency === 'now').length
  return (
    <>
      <header className="card-head">
        <h2>
          <Icon name="work" /> Needs you today
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
        <TicketList tickets={tickets.slice(0, STORY_COUNT[size])} compact={size === 'small'} />
      ) : (
        <p className="muted">{t.result ? 'Nothing open is assigned to you. Nice.' : ''}</p>
      )}
      {connected && size !== 'small' && <TicketStatus {...t} />}
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
  const { data, error } = useLoad<Rates>(`${widget.base}:${widget.symbols.join(',')}`, () => window.hub.rates(widget.base, widget.symbols))
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
          <p className="muted small">European Central Bank reference rates, {new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</p>
        </>
      )}
    </>
  )
}

function WeatherCard({ widget }: { widget: Extract<Widget, { type: 'weather' }> }): React.JSX.Element {
  const p = widget.place
  const { data, error } = useLoad<Weather>(`${p.latitude},${p.longitude}`, () => window.hub.weather(p))
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

function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
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
      return <TopStories ctx={ctx} size={widget.size} />
    case 'stats':
      return <Stats ctx={ctx} />
    case 'tickets':
      return <NeedsYou ctx={ctx} size={widget.size} />
    case 'currency':
      return <Currency widget={widget} />
    case 'weather':
      return <WeatherCard widget={widget} />
    case 'clocks':
      return <Clocks widget={widget} />
    case 'meetings':
      return (
        <>
          <h2>
            <Icon name="calendar" /> Next meetings
          </h2>
          <p className="muted">Connect a calendar to see your day here. Arrives with accounts.</p>
        </>
      )
    case 'mail':
      return (
        <>
          <h2>
            <Icon name="mail" /> Mail that needs you
          </h2>
          <p className="muted">Connect Gmail, Microsoft or IONOS mail to see priority messages here. Arrives with accounts.</p>
        </>
      )
  }
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
        if (r.length === 0) setError('No places found.')
      })
      .catch(() => setError('Search failed. Check your connection.'))
  }
  return (
    <div className="widget-option">
      <span className="small muted">Place: {place.name}</span>
      <div className="row">
        <input aria-label="Find a place" placeholder="Find a city" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(e)} />
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

export function WidgetOptions({ widget, onChange }: { widget: Widget; onChange: (w: Widget) => void }): React.JSX.Element | null {
  switch (widget.type) {
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
