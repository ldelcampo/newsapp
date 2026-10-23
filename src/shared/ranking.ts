import type { Article } from './news'

/** Lowercase, accent-free words, so "economía" matches "economia". */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const words = (s: string): string[] => normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * How well an article matches the user's topics: 0 for none. A topic matches when all its
 * words appear (prefix match, so "econom" style stems and plurals work); title hits count double.
 */
export function topicScore(article: Pick<Article, 'title' | 'summary'>, topics: string[]): number {
  const title = words(article.title)
  const body = words(article.summary)
  const has = (pool: string[], w: string): boolean => pool.some((p) => p.startsWith(w) || (w.length > 4 && w.startsWith(p) && p.length >= 4))
  let score = 0
  for (const topic of topics) {
    const tw = words(topic)
    if (tw.length === 0) continue
    if (tw.every((w) => has(title, w))) score += 2
    else if (tw.every((w) => has(title, w) || has(body, w))) score += 1
  }
  return score
}

/** 1 for brand new, halving every `halfLifeHours`. */
export function freshness(publishedAt: string, now: Date, halfLifeHours = 12): number {
  const ageH = Math.max(0, (now.getTime() - Date.parse(publishedAt)) / 3_600_000)
  return Math.pow(0.5, ageH / halfLifeHours)
}

export interface RankedArticle extends Article {
  score: number
  matched: boolean
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
      const t = topicScore(a, topics)
      return { ...a, matched: t > 0, score: (t > 0 ? 10 + t : 0) + freshness(a.publishedAt, now) }
    })
    .sort((a, b) => b.score - a.score)
}
