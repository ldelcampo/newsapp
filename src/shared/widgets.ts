/** Dashboard widgets: what each one is, its size, and its options. Saved in Settings. */

export type WidgetType = 'top-stories' | 'stats' | 'currency' | 'weather' | 'clocks' | 'meetings' | 'mail' | 'tickets'
export type WidgetSize = 'small' | 'medium' | 'wide'

export interface Place {
  name: string
  latitude: number
  longitude: number
}

export type Widget =
  | { id: string; type: 'top-stories' | 'stats' | 'meetings' | 'mail' | 'tickets'; size: WidgetSize }
  | { id: string; type: 'currency'; size: WidgetSize; base: string; symbols: string[] }
  | { id: string; type: 'weather'; size: WidgetSize; place: Place }
  | { id: string; type: 'clocks'; size: WidgetSize; zones: string[] }

export const WIDGET_TYPES: { type: WidgetType; label: string; description: string; size: WidgetSize }[] = [
  { type: 'tickets', label: 'Needs you today', description: 'Your Jira tickets, most urgent first', size: 'medium' },
  { type: 'top-stories', label: 'Top stories', description: 'The most relevant news for your topics', size: 'wide' },
  { type: 'stats', label: 'News at a glance', description: 'Stories today, topic matches and outlets', size: 'wide' },
  { type: 'currency', label: 'Exchange rates', description: 'Daily reference rates from the European Central Bank', size: 'medium' },
  { type: 'weather', label: 'Weather', description: 'Current weather and today’s range for a place', size: 'small' },
  { type: 'clocks', label: 'World clocks', description: 'The time in the cities you work with', size: 'small' },
  { type: 'meetings', label: 'Next meetings', description: 'Countdown to your next meeting, across calendars', size: 'medium' },
  { type: 'mail', label: 'Mail', description: 'The mail that needs you first, from every account', size: 'medium' }
]

export const SIZES: { value: WidgetSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' }
]

/** Currencies the ECB publishes reference rates for. */
export const CURRENCIES = [
  'USD', 'EUR', 'MXN', 'GBP', 'JPY', 'CAD', 'CHF', 'CNY', 'BRL', 'AUD', 'INR', 'KRW', 'SEK', 'NOK', 'DKK',
  'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'ZAR', 'NZD', 'SGD', 'HKD', 'ILS', 'IDR', 'MYR', 'PHP', 'THB', 'ISK'
]

export const MEXICO_CITY: Place = { name: 'Mexico City', latitude: 19.43, longitude: -99.13 }

export function newWidget(type: WidgetType, id = `${type}-${Date.now().toString(36)}`): Widget {
  const size = WIDGET_TYPES.find((w) => w.type === type)?.size ?? 'medium'
  switch (type) {
    case 'currency':
      return { id, type, size, base: 'USD', symbols: ['MXN', 'EUR'] }
    case 'weather':
      return { id, type, size, place: MEXICO_CITY }
    case 'clocks':
      return { id, type, size, zones: ['America/Mexico_City', 'America/New_York', 'Europe/Madrid'] }
    default:
      return { id, type, size }
  }
}

export const DEFAULT_DASHBOARD: Widget[] = [
  newWidget('tickets', 'tickets'),
  newWidget('stats', 'stats'),
  newWidget('top-stories', 'top-stories'),
  newWidget('currency', 'currency'),
  newWidget('weather', 'weather'),
  newWidget('meetings', 'meetings'),
  newWidget('mail', 'mail')
]

function validZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z })
    return true
  } catch {
    return false
  }
}

/** Drops widgets and options the app doesn't know, so an old or hand-edited file still loads. */
export function normalizeWidget(raw: unknown): Widget | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = WIDGET_TYPES.find((w) => w.type === r.type)?.type
  if (!type || typeof r.id !== 'string' || !r.id) return null
  const base = newWidget(type, r.id)
  const size = SIZES.some((s) => s.value === r.size) ? (r.size as WidgetSize) : base.size
  const codes = (v: unknown): string[] => (Array.isArray(v) ? v.filter((c): c is string => CURRENCIES.includes(c as string)) : [])
  switch (base.type) {
    case 'currency': {
      const b = CURRENCIES.includes(r.base as string) ? (r.base as string) : base.base
      const symbols = codes(r.symbols).filter((c) => c !== b)
      return { ...base, size, base: b, symbols: symbols.length ? [...new Set(symbols)].slice(0, 8) : base.symbols.filter((c) => c !== b) }
    }
    case 'weather': {
      const p = (r.place ?? {}) as Record<string, unknown>
      const ok = typeof p.name === 'string' && p.name && Math.abs(Number(p.latitude)) <= 90 && Math.abs(Number(p.longitude)) <= 180
      return { ...base, size, place: ok ? { name: p.name as string, latitude: Number(p.latitude), longitude: Number(p.longitude) } : base.place }
    }
    case 'clocks': {
      const zones = Array.isArray(r.zones) ? r.zones.filter((z): z is string => typeof z === 'string' && validZone(z)) : []
      return { ...base, size, zones: zones.length ? [...new Set(zones)].slice(0, 6) : base.zones }
    }
    default:
      return { ...base, size }
  }
}

export function normalizeDashboard(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) return DEFAULT_DASHBOARD
  const seen = new Set<string>()
  return raw.map(normalizeWidget).filter((w): w is Widget => w !== null && !seen.has(w.id) && !!seen.add(w.id))
}

// ---------- Live data for widgets ----------

export interface Rates {
  base: string
  date: string
  rates: Record<string, number>
}

/** Frankfurter's /latest response. */
export function parseRates(json: unknown): Rates {
  const j = json as { base?: unknown; date?: unknown; rates?: unknown }
  if (typeof j?.base !== 'string' || typeof j.date !== 'string' || !j.rates || typeof j.rates !== 'object') throw new Error('Unexpected exchange-rate response')
  const rates: Record<string, number> = {}
  for (const [k, v] of Object.entries(j.rates)) if (typeof v === 'number') rates[k] = v
  return { base: j.base, date: j.date, rates }
}

export interface Weather {
  temperature: number
  code: number
  description: string
  kind: WeatherKind
  isDay: boolean
  high: number
  low: number
  unit: string
}

/** Which animated scene the weather widget shows. */
export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'

/** WMO weather codes, as Open-Meteo reports them. */
const WMO: [number[], string, WeatherKind][] = [
  [[0], 'Clear sky', 'clear'],
  [[1, 2], 'Partly cloudy', 'partly'],
  [[3], 'Overcast', 'cloudy'],
  [[45, 48], 'Fog', 'fog'],
  [[51, 53, 55, 56, 57], 'Drizzle', 'drizzle'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain', 'rain'],
  [[71, 73, 75, 77, 85, 86], 'Snow', 'snow'],
  [[95, 96, 99], 'Thunderstorm', 'storm']
]

export const describeWeather = (code: number): string => WMO.find(([codes]) => codes.includes(code))?.[1] ?? 'Unknown'
export const weatherKind = (code: number): WeatherKind => WMO.find(([codes]) => codes.includes(code))?.[2] ?? 'cloudy'

/** Open-Meteo's /forecast response with current temperature_2m,weather_code,is_day and daily max/min. */
export function parseWeather(json: unknown): Weather {
  const j = json as {
    current?: { temperature_2m?: unknown; weather_code?: unknown; is_day?: unknown }
    current_units?: { temperature_2m?: unknown }
    daily?: { temperature_2m_max?: unknown[]; temperature_2m_min?: unknown[] }
  }
  const t = j?.current?.temperature_2m
  const code = j?.current?.weather_code
  if (typeof t !== 'number' || typeof code !== 'number') throw new Error('Unexpected weather response')
  const high = Number(j.daily?.temperature_2m_max?.[0] ?? t)
  const low = Number(j.daily?.temperature_2m_min?.[0] ?? t)
  return { temperature: t, code, description: describeWeather(code), kind: weatherKind(code), isDay: j.current?.is_day !== 0, high, low, unit: String(j.current_units?.temperature_2m ?? '°C') }
}

/** Open-Meteo's geocoding /search response. */
export function parsePlaces(json: unknown, near: string[] = []): Place[] {
  const results = (json as { results?: unknown[] })?.results ?? []
  const places = results.flatMap((r) => {
    const x = r as { name?: unknown; latitude?: unknown; longitude?: unknown; admin1?: unknown; country?: unknown; country_code?: unknown }
    if (typeof x.name !== 'string' || typeof x.latitude !== 'number' || typeof x.longitude !== 'number') return []
    const where = [x.admin1, x.country].filter((s): s is string => typeof s === 'string' && s !== x.name)
    const tags = [x.admin1, x.country, x.country_code].filter((s): s is string => typeof s === 'string').map(fold)
    return [{ place: { name: [x.name, ...where].join(', '), latitude: x.latitude, longitude: x.longitude }, tags }]
  })
  // "Monterrey, Mexico": keep the matches in that state or country, if any.
  const wanted = near.map(fold).filter(Boolean)
  const inside = places.filter((p) => wanted.every((w) => p.tags.some((t) => t.startsWith(w) || t === w)))
  return (inside.length ? inside : places).map((p) => p.place)
}

/** Lower case without accents, so "nuevo leon" finds "Nuevo León". */
const fold = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/**
 * Open-Meteo matches place names only, so "Monterrey, Mexico" finds nothing. The part before
 * the first comma is the name; the rest narrows the results.
 */
export function placeQuery(raw: string): { name: string; near: string[] } {
  const [name, ...near] = raw.split(',').map((s) => s.trim())
  return { name: name ?? '', near: near.filter(Boolean) }
}
