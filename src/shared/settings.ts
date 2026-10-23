import { LEANS, type Source } from './news'

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  displayName: string
  theme: Theme
  /** Topics the news ranking should favour, in the user's own words. */
  topics: string[]
  /** ISO 639-1 codes of the languages news may be in. */
  newsLanguages: string[]
  /** Where the shared news server runs. */
  newsServerUrl: string
  /** Sources this user added; the app fetches them itself. */
  customSources: Source[]
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  theme: 'system',
  topics: [],
  newsLanguages: ['en'],
  newsServerUrl: 'http://localhost:8787',
  customSources: []
}

export const NEWS_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' }
]

function normalizeSource(raw: unknown): Source | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const url = str(r.url)
  if (!str(r.id) || !str(r.name) || !/^https?:\/\//.test(url)) return null
  const lean = LEANS.some((l) => l.value === r.lean) ? (r.lean as Source['lean']) : 'unrated'
  return {
    id: str(r.id),
    name: str(r.name),
    url,
    language: NEWS_LANGUAGES.some((l) => l.code === r.language) ? (r.language as string) : 'en',
    region: str(r.region) || 'Global',
    lean,
    ...(str(r.apiKey) ? { apiKey: str(r.apiKey), apiKeyParam: str(r.apiKeyParam) || 'api-key' } : {})
  }
}

/** Fills gaps and drops unknown or malformed fields, so an old or hand-edited file still loads. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : undefined
  const theme = r.theme === 'light' || r.theme === 'dark' || r.theme === 'system' ? r.theme : DEFAULT_SETTINGS.theme
  const langs = strings(r.newsLanguages)?.filter((c) => NEWS_LANGUAGES.some((l) => l.code === c))
  return {
    displayName: typeof r.displayName === 'string' ? r.displayName : DEFAULT_SETTINGS.displayName,
    theme,
    topics: strings(r.topics) ?? DEFAULT_SETTINGS.topics,
    newsLanguages: langs && langs.length > 0 ? langs : DEFAULT_SETTINGS.newsLanguages,
    newsServerUrl:
      typeof r.newsServerUrl === 'string' && /^https?:\/\//.test(r.newsServerUrl.trim())
        ? r.newsServerUrl.trim().replace(/\/+$/, '')
        : DEFAULT_SETTINGS.newsServerUrl,
    customSources: Array.isArray(r.customSources)
      ? r.customSources.map(normalizeSource).filter((x): x is Source => x !== null)
      : DEFAULT_SETTINGS.customSources
  }
}
