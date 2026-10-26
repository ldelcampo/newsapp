import { normalizeSite, PROJECT_WEIGHTS, type JiraSite, type ProjectWeight, type TicketRanking } from './jira'
import { normalizeRules, type MailRanking, type MailRule } from './mail'
import { DEFAULT_FACT_CHECK, normalizeFactCheck, type FactCheckSettings } from './factcheck'
import { LEANS, type Source } from './news'
import { DEFAULT_DASHBOARD, normalizeDashboard, type Widget } from './widgets'

export type Theme = 'system' | 'light' | 'dark'
export type NewsLayout = 'mosaic' | 'list'

export interface Settings {
  displayName: string
  theme: Theme
  /** Topics the news ranking should favour, in the user's own words. */
  topics: string[]
  /** Show only stories that match the topics, on the dashboard and in News. */
  onlyMyTopics: boolean
  /** How the News view lays out stories. */
  newsLayout: NewsLayout
  /** ISO 639-1 codes of the languages news may be in. */
  newsLanguages: string[]
  /** Where the shared news server runs; empty means this computer fetches the feeds itself. */
  newsServerUrl: string
  /** Sources this user added; the app fetches them itself. */
  customSources: Source[]
  /** Dashboard widgets in display order. */
  dashboard: Widget[]
  /** Connected Jira sites. Their tokens live in the OS keychain, not here. */
  jiraSites: JiraSite[]
  /** How much each Jira project counts, by project key. Missing means normal. */
  projectWeights: Record<string, ProjectWeight>
  /** 'jev' sends ticket text to TypeSafe AI for scoring; 'local' never sends anything. */
  ticketRanking: TicketRanking
  /** 'jev' sends the sender, subject and preview of top mail to TypeSafe AI; 'local' never sends anything. */
  mailRanking: MailRanking
  /** Mail rules the user approved; they sync, and run on each computer. */
  mailRules: MailRule[]
  /** Which AI checks facts. Its keys live in the OS keychain, not here. */
  factCheck: FactCheckSettings,
  /** Folder shared between this user's computers (iCloud Drive, Dropbox…); empty means no sync. Never synced itself. */
  syncFolder: string
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  theme: 'dark',
  topics: [],
  onlyMyTopics: false,
  newsLayout: 'mosaic',
  newsLanguages: ['en'],
  newsServerUrl: '',
  customSources: [],
  dashboard: DEFAULT_DASHBOARD,
  jiraSites: [],
  projectWeights: {},
  ticketRanking: 'local',
  mailRanking: 'local',
  mailRules: [],
  factCheck: DEFAULT_FACT_CHECK,
  syncFolder: ''
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
    onlyMyTopics: r.onlyMyTopics === true,
    newsLayout: r.newsLayout === 'list' ? 'list' : 'mosaic',
    newsLanguages: langs && langs.length > 0 ? langs : DEFAULT_SETTINGS.newsLanguages,
    newsServerUrl:
      typeof r.newsServerUrl === 'string' && (r.newsServerUrl.trim() === '' || /^https?:\/\//.test(r.newsServerUrl.trim()))
        ? r.newsServerUrl.trim().replace(/\/+$/, '')
        : DEFAULT_SETTINGS.newsServerUrl,
    customSources: Array.isArray(r.customSources)
      ? r.customSources.map(normalizeSource).filter((x): x is Source => x !== null)
      : DEFAULT_SETTINGS.customSources,
    dashboard: normalizeDashboard(r.dashboard),
    jiraSites: Array.isArray(r.jiraSites) ? r.jiraSites.map(normalizeSite).filter((x): x is JiraSite => x !== null) : [],
    projectWeights: Object.fromEntries(
      Object.entries(r.projectWeights && typeof r.projectWeights === 'object' ? r.projectWeights : {}).filter(
        ([k, v]) => /^[A-Z][A-Z0-9_]{0,30}$/.test(k) && PROJECT_WEIGHTS.some((w) => w.value === v && v !== 'normal')
      )
    ) as Record<string, ProjectWeight>,
    ticketRanking: r.ticketRanking === 'jev' ? 'jev' : 'local',
    mailRanking: r.mailRanking === 'jev' ? 'jev' : 'local',
    mailRules: normalizeRules(r.mailRules),
    factCheck: normalizeFactCheck(r.factCheck),
    // Only absolute paths (macOS/Linux or a Windows drive).
    syncFolder: typeof r.syncFolder === 'string' && /^(\/|[A-Za-z]:[\\/])/.test(r.syncFolder) ? r.syncFolder : ''
  }
}
