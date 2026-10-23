import { useCallback, useEffect, useState } from 'react'
import type { NewsResult } from '@shared/api'

export function useNews(): { news: NewsResult | null; loading: boolean; reload: () => void } {
  const [news, setNews] = useState<NewsResult | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    void window.hub
      .loadNews()
      .then(setNews)
      .finally(() => setLoading(false))
  }, [])

  useEffect(reload, [reload])
  return { news, loading, reload }
}

export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}
