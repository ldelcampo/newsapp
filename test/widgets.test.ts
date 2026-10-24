import { describe, expect, it } from 'vitest'
import { WidgetService } from '../src/main/widget-service'
import { normalizeSettings } from '../src/shared/settings'
import { DEFAULT_DASHBOARD, normalizeDashboard, parsePlaces, parseRates, parseWeather } from '../src/shared/widgets'

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

  it('allows an empty dashboard', () => {
    expect(normalizeDashboard([])).toEqual([])
  })
})

describe('widget data', () => {
  it('reads Frankfurter rates, Open-Meteo weather and places', () => {
    expect(parseRates({ amount: 1, base: 'USD', date: '2026-10-23', rates: { MXN: 18.4, EUR: 0.92 } })).toEqual({
      base: 'USD',
      date: '2026-10-23',
      rates: { MXN: 18.4, EUR: 0.92 }
    })
    expect(
      parseWeather({ current: { temperature_2m: 21.4, weather_code: 2 }, current_units: { temperature_2m: '°C' }, daily: { temperature_2m_max: [24], temperature_2m_min: [12] } })
    ).toEqual({ temperature: 21.4, code: 2, description: 'Partly cloudy', high: 24, low: 12, unit: '°C' })
    expect(parsePlaces({ results: [{ name: 'Monterrey', latitude: 25.67, longitude: -100.31, admin1: 'Nuevo León', country: 'Mexico' }, { name: 'bad' }] })).toEqual([
      { name: 'Monterrey, Nuevo León, Mexico', latitude: 25.67, longitude: -100.31 }
    ])
    expect(() => parseRates({ error: 'x' })).toThrow()
  })

  it('caches answers so repeated loads make one request, and serves the old answer on failure', async () => {
    let t = 0
    let calls = 0
    let fail = false
    const fetchFn = async (): Promise<Response> => {
      calls++
      if (fail) throw new Error('offline')
      return new Response(JSON.stringify({ base: 'USD', date: '2026-10-23', rates: { MXN: 18.4 } }))
    }
    const svc = new WidgetService(fetchFn as typeof fetch, () => t)
    await svc.rates('USD', ['MXN'])
    await svc.rates('USD', ['MXN'])
    t += 30 * 60_000
    await svc.rates('USD', ['MXN'])
    expect(calls).toBe(1)
    t += 31 * 60_000
    fail = true
    expect((await svc.rates('USD', ['MXN'])).rates.MXN).toBe(18.4)
    expect(calls).toBe(2)
    await expect(svc.rates('USD', ['EUR'])).rejects.toThrow('offline')
  })
})
