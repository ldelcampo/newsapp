export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  displayName: string
  theme: Theme
  /** Topics the news ranking should favour, in the user's own words. */
  topics: string[]
  /** ISO 639-1 codes of the languages news may be in. */
  newsLanguages: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  theme: 'system',
  topics: [],
  newsLanguages: ['en']
}

export const NEWS_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' }
]

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
    newsLanguages: langs && langs.length > 0 ? langs : DEFAULT_SETTINGS.newsLanguages
  }
}
