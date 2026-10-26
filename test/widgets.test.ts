import { describe, expect, it } from 'vitest'
import { WidgetService } from '../src/main/widget-service'
import { normalizeSettings } from '../src/shared/settings'
import { DEFAULT_DASHBOARD, normalizeDashboard, parseMarketRates, parsePlaces, parseRates, parseWeather, placeQuery } from '../src/shared/widgets'

describe('dashboard settings', () => {
  it('starts with the default widgets', () => {
    expect(normalizeSettings({}).dashboard).toEqual(DEFAULT_DASHBOARD)
  })

  it('keeps order, size and options, and drops unknown or broken widgets', () => {
    const d = normalizeDashboard([
      { id: 'w1', type: 'currency', size: 'wide', base: 'EUR', symbols: ['MXN', 'EUR', 'XXX', 'MXN', 'USD'] },
      { id: 'w2', type: 'stock-ticker', size: 'small' },
      { id: 'w3', type: 'clocks', size: 'huge', zones: ['Asia/Tokyo', 'Mars/Olympus'] },
      { id: 'w1', type: 'stats' },
      { id: 'w4', type: 'weather', place: { name: 'Nowhere', latitude: 200, longitude: 0 } }
    ])
    expect(d.map((w) => w.id)).toEqual(['w1', 'w3', 'w4'])
    expect(d[0]).toEqual({ id: 'w1', type: 'currency', size: 'wide', base: 'EUR', symbols: ['MXN', 'USD'] })
    expect(d[1]).toMatchObject({ size: 'small', zones: ['Asia/Tokyo'] })
    expect(d[2]).toMatchObject({ place: { name: 'Mexico City' } })
  })

  it('keeps a topic on each news widget', () => {
    const d = normalizeDashboard([
      { id: 'n1', type: 'top-stories', size: 'wide' },
      { id: 'n2', type: 'top-stories', size: 'medium', topic: '  Banxico ' },
      { id: 'n3', type: 'top-stories', size: 'small', topic: 42 }
    ])
    expect(d.map((w) => (w.type === 'top-stories' ? w.topic : null))).toEqual(['', 'Banxico', ''])
  })

  it('keeps a project and label filter on each Jira widget', () => {
    const d = normalizeDashboard([
      { id: 't1', type: 'tickets', size: 'medium' },
      { id: 't2', type: 'tickets', size: 'small', project: 'OPS', label: ' billing ' }
    ])
    expect(d[0]).toMatchObject({ project: '', label: '' })
    expect(d[1]).toMatchObject({ project: 'OPS', label: 'billing' })
  })

  it('allows an empty dashboard', () => {
    expect(normalizeDashboard([])).toEqual([])
  })
})

describe('widget data', () => {
  it('reads Frankfurter rates, Open-Meteo weather and places', () => {
    expect(parseRates({ amount: 1, base: 'USD', date: '2026-10-23', rates: { MXN: 18.4, EUR: 0.92 } })).toEqual({
      base: 'USD',
      date: '2026-10-23',
      rates: { MXN: 18.4, EUR: 0.92 },
      source: 'ecb'
    })
    expect(parseMarketRates({ data: { currency: 'USD', rates: { MXN: '18.5714', EUR: '0.8941', BTC: '0.0000087' } } }, ['MXN', 'EUR', 'XYZ'], Date.UTC(2026, 9, 26, 15, 21))).toEqual({
      base: 'USD',
      date: '2026-10-26T15:21:00.000Z',
      rates: { MXN: 18.5714, EUR: 0.8941 },
      source: 'market'
    })
    expect(() => parseMarketRates({ data: { currency: 'USD', rates: {} } }, ['MXN'], 0)).toThrow()
    expect(
      parseWeather({ current: { temperature_2m: 21.4, weather_code: 2, is_day: 0 }, current_units: { temperature_2m: '°C' }, daily: { temperature_2m_max: [24], temperature_2m_min: [12] } })
    ).toEqual({ temperature: 21.4, code: 2, description: 'Partly cloudy', kind: 'partly', isDay: false, high: 24, low: 12, unit: '°C' })
    expect(parsePlaces({ results: [{ name: 'Monterrey', latitude: 25.67, longitude: -100.31, admin1: 'Nuevo León', country: 'Mexico' }, { name: 'bad' }] })).toEqual([
      { name: 'Monterrey, Nuevo León, Mexico', latitude: 25.67, longitude: -100.31 }
    ])
    expect(() => parseRates({ error: 'x' })).toThrow()
  })

  it('caches answers so repeated loads make one request, and serves the old answer on failure', async () => {
    let t = 0
    let calls = 0
    let fail = false
    const fetchFn = async (url: string): Promise<Response> => {
      calls++
      if (fail) throw new Error('offline')
      if (url.includes('frankfurter')) return new Response(JSON.stringify({ base: 'USD', date: '2026-10-23', rates: { EUR: 0.92 } }))
      return new Response(JSON.stringify({ data: { currency: 'USD', rates: { MXN: '18.4', EUR: '0.89' } } }))
    }
    const svc = new WidgetService(fetchFn as typeof fetch, () => t)
    await svc.rates('USD', ['MXN'])
    await svc.rates('USD', ['MXN', 'EUR'])
    t += 4 * 60_000
    await svc.rates('USD', ['EUR'])
    expect(calls).toBe(1)
    t += 2 * 60_000
    fail = true
    const old = await svc.rates('USD', ['MXN'])
    expect(old).toMatchObject({ source: 'market', rates: { MXN: 18.4 } })
    expect(calls).toBe(2)
    await expect(svc.rates('EUR', ['MXN'])).rejects.toThrow('offline')
  })

  it('falls back to ECB rates when market rates are unavailable', async () => {
    const fetchFn = async (url: string): Promise<Response> =>
      url.includes('coinbase') ? new Response('busy', { status: 429 }) : new Response(JSON.stringify({ base: 'USD', date: '2026-10-26', rates: { MXN: 18.6155 } }))
    const r = await new WidgetService(fetchFn as typeof fetch).rates('USD', ['MXN'])
    expect(r).toEqual({ base: 'USD', date: '2026-10-26', rates: { MXN: 18.6155 }, source: 'ecb' })
  })
})

describe('place search', () => {
  const answer = {
    results: [
      { name: 'Monterrey', latitude: 25.67, longitude: -100.31, admin1: 'Nuevo León', country: 'Mexico', country_code: 'MX' },
      { name: 'Monterrey', latitude: 4.87, longitude: -72.9, admin1: 'Casanare', country: 'Colombia', country_code: 'CO' }
    ]
  }
  it('searches the name before the comma and narrows by the rest', () => {
    expect(placeQuery(' Monterrey , Mexico ')).toEqual({ name: 'Monterrey', near: ['Mexico'] })
    expect(parsePlaces(answer, ['mexico']).map((p) => p.name)).toEqual(['Monterrey, Nuevo León, Mexico'])
    expect(parsePlaces(answer, ['nuevo leon'])).toHaveLength(1)
    expect(parsePlaces(answer, ['CO'])[0].name).toBe('Monterrey, Casanare, Colombia')
    // Nothing matches the extra words: show every result rather than none.
    expect(parsePlaces(answer, ['Peru'])).toHaveLength(2)
  })
  it('puts big cities first and drops same-named places in the same state', () => {
    const hamlet = (admin1: string) => ({ name: 'Querétaro', latitude: 16, longitude: -92, admin1, country: 'Mexico', country_code: 'MX' })
    const json = {
      results: [
        { ...hamlet('Chiapas'), population: 2203 },
        hamlet('Veracruz'),
        hamlet('Chiapas'),
        { name: 'Querétaro City', latitude: 20.59, longitude: -100.39, admin1: 'Querétaro', country: 'Mexico', country_code: 'MX', population: 1594212 }
      ]
    }
    expect(parsePlaces(json).map((p) => p.name)).toEqual([
      'Querétaro City, Querétaro, Mexico',
      'Querétaro, Chiapas, Mexico',
      'Querétaro, Veracruz, Mexico'
    ])
  })
})

