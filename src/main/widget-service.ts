import { USER_AGENT } from '../shared/polite-fetch'
import { parsePlaces, parseRates, placeQuery, parseWeather, type Place, type Rates, type Weather } from '../shared/widgets'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Live data for dashboard widgets, from free services that need no key. Each answer is kept
 * for a while (rates change once a day, weather every 15 minutes), so dashboards and repeated
 * refreshes stay far below the services' fair-use limits.
 */
export class WidgetService {
  private readonly cache = new Map<string, { at: number; value: unknown }>()

  constructor(
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now
  ) {}

  private async cached<T>(url: string, ttlMs: number, parse: (json: unknown) => T): Promise<T> {
    const hit = this.cache.get(url)
    if (hit && this.now() - hit.at < ttlMs) return hit.value as T
    try {
      const res = await this.fetchFn(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`The service answered ${res.status}`)
      const value = parse(await res.json())
      this.cache.set(url, { at: this.now(), value })
      return value
    } catch (e) {
      // An older answer beats an empty widget.
      if (hit) return hit.value as T
      throw e
    }
  }

  rates(base: string, symbols: string[]): Promise<Rates> {
    const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}&symbols=${symbols.map(encodeURIComponent).join(',')}`
    return this.cached(url, 60 * 60_000, parseRates)
  }

  weather(place: Place): Promise<Weather> {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude.toFixed(2)}&longitude=${place.longitude.toFixed(2)}` +
      '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1'
    return this.cached(url, 30 * 60_000, parseWeather)
  }

  async places(query: string): Promise<Place[]> {
    const { name, near } = placeQuery(query)
    if (name.length < 2) return []
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=${near.length ? 20 : 6}&format=json`
    // The raw answer is cached, since the same name can be narrowed in different ways.
    return parsePlaces(await this.cached(url, 24 * 60 * 60_000, (j) => j), near).slice(0, 6)
  }
}
