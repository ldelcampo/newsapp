import type { Article } from './news'

/** Lowercase, accent-free words, so "economía" matches "economia". */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const words = (s: string): string[] => normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

export interface TopicMatch {
  topic: string
  inTitle: boolean
}

/**
 * Whether a word in the story is the topic word or a form of it. Short words must match
 * exactly or as a plural ("tech" is not "techo"); longer words may share a stem, so
 * "economy" finds "economic" and "elección" finds "elecciones".
 */
export function sameWord(topicWord: string, word: string): boolean {
  if (word === topicWord) return true
  const [a, b] = topicWord.length <= word.length ? [topicWord, word] : [word, topicWord]
  if (/^(s|es)$/.test(b.slice(a.length)) && b.startsWith(a)) return true
  if (a.length < 5) return false
  let common = 0
  while (common < a.length && a[common] === b[common]) common++
  return common >= 5 && common >= a.length - 3
}

/**
 * Broad topics people often type, and the words stories use for them. A story matches the
 * topic when it matches the topic itself or any of these.
 */
const ALIASES: Record<string, string[]> = {
  tech: ['technology', 'tecnologia', 'software', 'startup', 'smartphone', 'artificial intelligence', 'inteligencia artificial', 'chip', 'semiconductor', 'cyber', 'ciberseguridad', 'apple', 'google', 'microsoft', 'nvidia', 'openai'],
  tecnologia: ['tech', 'technology', 'software', 'startup', 'inteligencia artificial', 'artificial intelligence', 'ciberseguridad', 'semiconductor'],
  ai: ['artificial intelligence', 'inteligencia artificial', 'ia', 'chatbot', 'openai', 'llm'],
  ia: ['inteligencia artificial', 'artificial intelligence', 'ai', 'chatbot', 'openai'],
  sports: ['sport', 'football', 'soccer', 'futbol', 'deporte', 'nba', 'nfl', 'tennis', 'olympic'],
  deportes: ['deporte', 'futbol', 'liga mx', 'sports', 'football', 'soccer', 'tenis', 'beisbol'],
  politics: ['political', 'election', 'government', 'congress', 'senate', 'politica', 'eleccion', 'gobierno'],
  politica: ['politics', 'political', 'eleccion', 'gobierno', 'congreso', 'senado'],
  economy: ['economic', 'inflation', 'gdp', 'interest rate', 'recession', 'economia', 'inflacion'],
  economia: ['economy', 'economic', 'inflacion', 'pib', 'tasa de interes', 'recesion'],
  health: ['salud', 'medical', 'disease', 'hospital', 'vaccine'],
  salud: ['health', 'medico', 'enfermedad', 'hospital', 'vacuna'],
  science: ['ciencia', 'research', 'scientists', 'space', 'nasa'],
  ciencia: ['science', 'investigacion', 'cientificos', 'espacio', 'nasa']
}

/** The word lists that count as this topic: its own words, then any aliases. */
function topicForms(topic: string): string[][] {
  const own = words(topic)
  if (own.length === 0) return []
  return [own, ...(ALIASES[own.join(' ')] ?? []).map(words)]
}

/**
 * The user's topics an article mentions. A topic matches when all its words (or all the
 * words of one alias) appear, in the title or anywhere in title plus summary.
 */
export function topicMatches(article: Pick<Article, 'title' | 'summary'>, topics: string[]): TopicMatch[] {
  const title = words(article.title)
  const all = [...title, ...words(article.summary)]
  const has = (pool: string[], form: string[]): boolean => form.every((w) => pool.some((p) => sameWord(w, p)))
  const found: TopicMatch[] = []
  for (const topic of topics) {
    const forms = topicForms(topic)
    if (forms.some((f) => has(title, f))) found.push({ topic, inTitle: true })
    else if (forms.some((f) => has(all, f))) found.push({ topic, inTitle: false })
  }
  return found
}

/** How well an article matches the user's topics: 0 for none; title hits count double. */
export function topicScore(article: Pick<Article, 'title' | 'summary'>, topics: string[]): number {
  return topicMatches(article, topics).reduce((sum, m) => sum + (m.inTitle ? 2 : 1), 0)
}

/**
 * High: a topic is in the headline, or several topics are mentioned.
 * Medium: a topic is only in the summary. Low: none of the user's topics.
 */
export type Priority = 'high' | 'medium' | 'low'

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' }
]

export function priorityOf(matches: TopicMatch[]): Priority {
  if (matches.some((m) => m.inTitle) || matches.length >= 2) return 'high'
  return matches.length === 1 ? 'medium' : 'low'
}

/** 1 for brand new, halving every `halfLifeHours`. */
export function freshness(publishedAt: string, now: Date, halfLifeHours = 12): number {
  const ageH = Math.max(0, (now.getTime() - Date.parse(publishedAt)) / 3_600_000)
  return Math.pow(0.5, ageH / halfLifeHours)
}

export interface RankedArticle extends Article {
  score: number
  matched: boolean
  /** The user's topics this story mentions, in the user's words. */
  topics: string[]
  priority: Priority
}

/**
 * Orders articles for one user. Topic matches always rank above non-matches; within each
 * group, more matches and newer stories come first. With no topics, it is newest first.
 */
export function rankArticles(articles: Article[], topics: string[], languages: string[], now = new Date()): RankedArticle[] {
  const seen = new Set<string>()
  return articles
    .filter((a) => languages.includes(a.language))
    .filter((a) => {
      const key = normalize(a.title)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((a) => {
      const m = topicMatches(a, topics)
      const t = m.reduce((sum, x) => sum + (x.inTitle ? 2 : 1), 0)
      return {
        ...a,
        matched: t > 0,
        topics: m.map((x) => x.topic),
        priority: priorityOf(m),
        score: (t > 0 ? 10 + t : 0) + freshness(a.publishedAt, now)
      }
    })
    .sort((a, b) => b.score - a.score)
}

export interface ArticleFilter {
  /** Hide stories that match none of the user's topics. */
  onlyMatches?: boolean
  /** Keep stories that mention this topic; empty or missing means any topic. */
  topic?: string
  /** Lowest priority to show. */
  minPriority?: Priority
  query?: string
}

const RANK: Record<Priority, number> = { high: 2, medium: 1, low: 0 }

export function filterArticles(articles: RankedArticle[], f: ArticleFilter): RankedArticle[] {
  const q = normalize(f.query?.trim() ?? '')
  const min = RANK[f.minPriority ?? 'low']
  return articles.filter(
    (a) =>
      (!f.onlyMatches || a.matched) &&
      (!f.topic || a.topics.includes(f.topic)) &&
      RANK[a.priority] >= min &&
      (!q || normalize(a.title).includes(q) || normalize(a.sourceName).includes(q))
  )
}
