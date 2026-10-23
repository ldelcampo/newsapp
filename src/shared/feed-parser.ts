import { XMLParser } from 'fast-xml-parser'
import type { Article, Source } from './news'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: '#text',
  processEntities: true,
  htmlEntities: true
})

export interface ParsedFeed {
  title: string
  language?: string
  items: Omit<Article, 'sourceId' | 'sourceName' | 'language' | 'lean' | 'id'>[]
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])

/** Text of a node that may be a string, a {#text} object or missing. */
function text(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return text(v[0])
  if (typeof v === 'object' && '#text' in (v as object)) return text((v as Record<string, unknown>)['#text'])
  return ''
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Plain text from HTML, as feeds often put markup (and its entities) inside CDATA. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function toIso(date: string): string | null {
  if (!date) return null
  const t = Date.parse(date)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

function atomLink(links: unknown): string {
  const all = asArray(links as Record<string, string> | Record<string, string>[])
  const alt = all.find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? all[0]
  return alt?.['@href'] ?? text(alt)
}

/** Parses RSS 2.0, RSS 1.0 (RDF) and Atom. Throws when the document is not a feed. */
export function parseFeed(xml: string): ParsedFeed {
  const doc = parser.parse(xml) as Record<string, any>

  if (doc.rss?.channel) {
    const ch = doc.rss.channel
    return {
      title: stripHtml(text(ch.title)),
      language: text(ch.language) || undefined,
      items: asArray(ch.item).map((it: any) => ({
        title: stripHtml(text(it.title)),
        summary: stripHtml(text(it.description)).slice(0, 400),
        url: text(it.link) || text(it.guid),
        publishedAt: toIso(text(it.pubDate) || text(it['dc:date'])) ?? ''
      }))
    }
  }

  if (doc['rdf:RDF']) {
    const rdf = doc['rdf:RDF']
    return {
      title: stripHtml(text(rdf.channel?.title)),
      language: text(rdf.channel?.['dc:language']) || undefined,
      items: asArray(rdf.item).map((it: any) => ({
        title: stripHtml(text(it.title)),
        summary: stripHtml(text(it.description)).slice(0, 400),
        url: text(it.link) || it['@rdf:about'] || '',
        publishedAt: toIso(text(it['dc:date'])) ?? ''
      }))
    }
  }

  if (doc.feed) {
    const f = doc.feed
    return {
      title: stripHtml(text(f.title)),
      language: f['@xml:lang'] || undefined,
      items: asArray(f.entry).map((it: any) => ({
        title: stripHtml(text(it.title)),
        summary: stripHtml(text(it.summary) || text(it.content)).slice(0, 400),
        url: atomLink(it.link),
        publishedAt: toIso(text(it.published) || text(it.updated)) ?? ''
      }))
    }
  }

  throw new Error('This address does not return an RSS or Atom feed.')
}

export function feedUrl(source: Pick<Source, 'url' | 'apiKey' | 'apiKeyParam'>): string {
  if (!source.apiKey) return source.url
  const u = new URL(source.url)
  u.searchParams.set(source.apiKeyParam || 'api-key', source.apiKey)
  return u.toString()
}

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Turns a parsed feed into articles, dropping items with no title or link. */
export function toArticles(source: Source, feed: ParsedFeed, now = new Date()): Article[] {
  return feed.items
    .filter((it) => it.title && it.url)
    .map((it) => ({
      ...it,
      // Undated items count as just published, so they are not buried.
      publishedAt: it.publishedAt || now.toISOString(),
      id: `${source.id}-${hash(it.url)}`,
      sourceId: source.id,
      sourceName: source.name,
      language: source.language,
      lean: source.lean
    }))
}

/** Fetches and parses one source. */
export async function fetchSource(source: Source, timeoutMs = 15000): Promise<Article[]> {
  const res = await fetch(feedUrl(source), {
    headers: { 'user-agent': 'InformationHub/0.1 (+https://github.com/ldelcampo/newsapp)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow'
  }).catch((e: Error) => {
    if (e.name === 'TimeoutError') throw new Error('The address took too long to answer.')
    throw new Error('Could not connect to that address. Check it and your internet connection.')
  })
  if (!res.ok) throw new Error(`The feed answered with HTTP ${res.status}.`)
  return toArticles(source, parseFeed(await res.text()))
}
