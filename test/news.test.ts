import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { feedUrl, parseFeed, toArticles } from '../src/shared/feed-parser'
import type { Article, Source } from '../src/shared/news'
import { aboutTopic, filterArticles, rankArticles, topicScore } from '../src/shared/ranking'
import { normalizeSettings } from '../src/shared/settings'

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8')
const source: Source = { id: 'ex', name: 'Example', url: 'https://example.com/rss', language: 'es', region: 'MX', lean: 'center' }

describe('parseFeed', () => {
  it('reads RSS 2.0 with CDATA and HTML', () => {
    const feed = parseFeed(fixture('rss2.xml'))
    expect(feed.title).toBe('Example News')
    expect(feed.items[0]).toEqual({
      title: 'Banxico recorta la tasa de interés',
      summary: 'La economía mexicana & los mercados.',
      url: 'https://example.com/banxico',
      publishedAt: '2026-10-23T18:00:00.000Z',
      imageUrl: 'https://img.example.com/banxico.jpg?w=800&h=450'
    })
  })

  it('takes an https image from inline HTML when there is no media tag', () => {
    expect(parseFeed(fixture('rss2.xml')).items[1].imageUrl).toBe('https://img.example.com/inline.png')
  })

  it('reads Atom and picks the alternate link', () => {
    const [item] = parseFeed(fixture('atom.xml')).items
    expect(item.url).toBe('https://example.org/ai-chips')
    expect(item.publishedAt).toBe('2026-10-23T12:00:00.000Z')
  })

  it('reads RSS 1.0 (RDF), as DW publishes', () => {
    const [item] = parseFeed(fixture('rdf.xml')).items
    expect(item).toMatchObject({ title: 'Germany budget deal', url: 'https://dw.example/a' })
  })

  it('rejects pages that are not feeds', () => {
    expect(() => parseFeed('<html><body>Hi</body></html>')).toThrow(/not return an RSS or Atom feed/)
  })
})

describe('toArticles', () => {
  it('drops untitled items, dates undated ones now, and tags the source', () => {
    const now = new Date('2026-10-24T00:00:00Z')
    const list = toArticles(source, parseFeed(fixture('rss2.xml')), now)
    expect(list.map((a) => a.title)).toEqual(['Banxico recorta la tasa de interés', 'Sin fecha'])
    expect(list[1].publishedAt).toBe(now.toISOString())
    expect(list[0]).toMatchObject({ sourceId: 'ex', sourceName: 'Example', language: 'es', lean: 'center' })
  })
})

describe('feedUrl', () => {
  it('adds the API key under its parameter name', () => {
    expect(feedUrl({ url: 'https://api.example/feed?x=1', apiKey: 'k', apiKeyParam: 'key' })).toBe('https://api.example/feed?x=1&key=k')
  })
})

const art = (title: string, hoursAgo: number, language = 'en', summary = ''): Article => ({
  id: title,
  sourceId: 's',
  sourceName: 'S',
  language,
  lean: 'center',
  title,
  summary,
  url: `https://x/${encodeURIComponent(title)}`,
  publishedAt: new Date(Date.parse('2026-10-24T00:00:00Z') - hoursAgo * 3_600_000).toISOString()
})

describe('ranking', () => {
  const now = new Date('2026-10-24T00:00:00Z')

  it('matches topics without accents and across plurals', () => {
    expect(topicScore({ title: 'La economia crece', summary: '' }, ['economía'])).toBe(2)
    expect(topicScore({ title: 'Markets', summary: 'Elections in Mexico' }, ['election'])).toBe(1)
    expect(topicScore({ title: 'Weather', summary: '' }, ['economía'])).toBe(0)
  })

  it('does not match a short topic inside a different word', () => {
    // "Tech" used to match "techo" (roof) in a football story.
    expect(topicScore({ title: 'Kevin Álvarez ve el techo de las Águilas muy lejos', summary: '' }, ['Tech'])).toBe(0)
    expect(topicScore({ title: 'AI firms', summary: '' }, ['AI'])).toBe(2)
    expect(topicScore({ title: 'Said the aide', summary: '' }, ['AI'])).toBe(0)
    expect(topicScore({ title: 'New chips', summary: '' }, ['chip'])).toBe(2)
  })

  it('matches word forms and common aliases for broad topics', () => {
    expect(topicScore({ title: 'Economic outlook dims', summary: '' }, ['economical'])).toBe(2)
    expect(topicScore({ title: 'Las elecciones judiciales', summary: '' }, ['elección'])).toBe(2)
    expect(topicScore({ title: 'Nvidia unveils a new chip', summary: '' }, ['Tech'])).toBe(2)
    expect(topicScore({ title: 'Markets', summary: 'La inteligencia artificial avanza' }, ['IA'])).toBe(1)
  })

  it('puts topic matches above newer non-matches', () => {
    const list = rankArticles([art('Celebrity news', 0), art('Old AI story', 30), art('Fresh AI story', 1)], ['AI'], ['en'], now)
    expect(list.map((a) => a.title)).toEqual(['Fresh AI story', 'Old AI story', 'Celebrity news'])
    expect(list[2].matched).toBe(false)
  })

  it('is newest first without topics, filters languages, and removes duplicate headlines', () => {
    const list = rankArticles([art('B', 5), art('A', 1), art('a', 2), art('Español', 0, 'es')], [], ['en'], now)
    expect(list.map((a) => a.title)).toEqual(['A', 'B'])
  })

  it('rates priority: topic in the headline or several topics is high, summary only is medium', () => {
    const list = rankArticles(
      [
        { ...art('AI chips rally', 1), summary: '' },
        { ...art('Markets today', 2), summary: 'Chipmakers lead on AI demand' },
        { ...art('Tariffs hit Mexico', 3), summary: 'The economy slows' },
        art('Celebrity news', 0)
      ],
      ['AI', 'Mexico', 'economy'],
      ['en'],
      now
    )
    const by = Object.fromEntries(list.map((a) => [a.title, a]))
    expect(by['AI chips rally'].priority).toBe('high')
    expect(by['Markets today'].priority).toBe('medium')
    expect(by['Tariffs hit Mexico'].priority).toBe('high')
    expect(by['Tariffs hit Mexico'].topics).toEqual(['Mexico', 'economy'])
    expect(by['Celebrity news'].priority).toBe('low')
  })

  it('filters by only my topics, one topic, minimum priority and search', () => {
    const list = rankArticles(
      [{ ...art('AI chips rally', 1) }, { ...art('Markets today', 2), summary: 'AI demand' }, art('Mexico votes', 3), art('Celebrity news', 0)],
      ['AI', 'Mexico'],
      ['en'],
      now
    )
    const titles = (f: Parameters<typeof filterArticles>[1]): string[] => filterArticles(list, f).map((a) => a.title)
    expect(titles({})).toHaveLength(4)
    expect(titles({ onlyMatches: true })).toEqual(['AI chips rally', 'Mexico votes', 'Markets today'])
    expect(titles({ topic: 'Mexico' })).toEqual(['Mexico votes'])
    expect(titles({ minPriority: 'high' })).toEqual(['AI chips rally', 'Mexico votes'])
    expect(titles({ minPriority: 'medium', topic: 'AI' })).toEqual(['AI chips rally', 'Markets today'])
    expect(titles({ query: 'CELEB' })).toEqual(['Celebrity news'])
  })
})

describe('custom sources in settings', () => {
  it('keeps valid sources and drops broken ones', () => {
    const s = normalizeSettings({
      customSources: [
        { id: 'r', name: 'Reforma', url: 'https://reforma.example/rss', language: 'es', lean: 'weird' },
        { id: 'x', name: 'No URL', url: 'ftp://nope' },
        'junk'
      ],
      newsServerUrl: 'https://news.example.com/'
    })
    expect(s.customSources).toEqual([{ id: 'r', name: 'Reforma', url: 'https://reforma.example/rss', language: 'es', region: 'Global', lean: 'unrated' }])
    expect(s.newsServerUrl).toBe('https://news.example.com')
  })
})

describe('aboutTopic', () => {
  it('finds stories on any topic, headline matches first, even one the user never saved', () => {
    const now = new Date()
    const list = rankArticles(
      [art('Markets calm', 0, 'en', 'Banxico held rates'), art('Football results', 1), art('Banxico cuts rates', 2)],
      ['football'],
      ['en'],
      now
    )
    expect(aboutTopic(list, 'Banxico').map((a) => a.title)).toEqual(['Banxico cuts rates', 'Markets calm'])
    expect(aboutTopic(list, '  ')).toHaveLength(3)
  })
})
