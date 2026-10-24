export type Lean = 'left' | 'center-left' | 'center' | 'center-right' | 'right' | 'unrated'

export interface Source {
  id: string
  name: string
  /** RSS or Atom feed URL. */
  url: string
  /** ISO 639-1 code. */
  language: string
  /** Where the outlet is based, e.g. "UK", "MX", "Global". */
  region: string
  lean: Lean
  /** Some feeds need a key; it is appended as a query parameter. */
  apiKey?: string
  apiKeyParam?: string
}

export interface Article {
  id: string
  sourceId: string
  sourceName: string
  language: string
  lean: Lean
  title: string
  summary: string
  url: string
  /** ISO timestamp. */
  publishedAt: string
}

export const LEANS: { value: Lean; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center-left', label: 'Centre-left' },
  { value: 'center', label: 'Centre' },
  { value: 'center-right', label: 'Centre-right' },
  { value: 'right', label: 'Right' },
  { value: 'unrated', label: 'Not rated' }
]

/** Free feeds the app ships with. Leans are our own editable starting point, not a licensed rating. */
export const DEFAULT_SOURCES: Source[] = [
  { id: 'bbc', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', language: 'en', region: 'UK', lean: 'center' },
  { id: 'npr', name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', language: 'en', region: 'US', lean: 'center-left' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', language: 'en', region: 'UK', lean: 'center-left' },
  { id: 'dw', name: 'DW', url: 'https://rss.dw.com/rdf/rss-en-all', language: 'en', region: 'DE', lean: 'center' },
  { id: 'france24', name: 'France 24', url: 'https://www.france24.com/en/rss', language: 'en', region: 'FR', lean: 'center' },
  { id: 'aljazeera', name: 'Al Jazeera English', url: 'https://www.aljazeera.com/xml/rss/all.xml', language: 'en', region: 'QA', lean: 'center-left' },
  { id: 'nyt', name: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', language: 'en', region: 'US', lean: 'center-left' },
  { id: 'wsj', name: 'The Wall Street Journal', url: 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews', language: 'en', region: 'US', lean: 'center-right' },
  { id: 'elpais', name: 'El País', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', language: 'es', region: 'ES', lean: 'center-left' },
  { id: 'bbcmundo', name: 'BBC Mundo', url: 'https://feeds.bbci.co.uk/mundo/rss.xml', language: 'es', region: 'UK', lean: 'center' },
  { id: 'dwes', name: 'DW Español', url: 'https://rss.dw.com/rdf/rss-sp-all', language: 'es', region: 'DE', lean: 'center' },
  { id: 'france24es', name: 'France 24 Español', url: 'https://www.france24.com/es/rss', language: 'es', region: 'FR', lean: 'center' },
  { id: 'eluniversal', name: 'El Universal', url: 'https://www.eluniversal.com.mx/arc/outboundfeeds/rss/?outputType=xml', language: 'es', region: 'MX', lean: 'center' },
  { id: 'elfinanciero', name: 'El Financiero', url: 'https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/?outputType=xml', language: 'es', region: 'MX', lean: 'center-right' },
  { id: 'expansion', name: 'Expansión', url: 'https://expansion.mx/rss', language: 'es', region: 'MX', lean: 'center-right' },
  { id: 'animalpolitico', name: 'Animal Político', url: 'https://www.animalpolitico.com/feed', language: 'es', region: 'MX', lean: 'center-left' }
]
