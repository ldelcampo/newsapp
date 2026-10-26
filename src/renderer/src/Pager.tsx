import { useEffect, useState } from 'react'
import { Icon } from './Icon'

/** One page of `items`; goes back to the first page when the list's length changes. */
export function usePage<T>(items: T[], perPage: number): { page: T[]; at: number; pages: number; go: (n: number) => void } {
  const [at, setAt] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / perPage))
  useEffect(() => setAt(0), [items.length, perPage])
  const current = Math.min(at, pages - 1)
  return { page: items.slice(current * perPage, (current + 1) * perPage), at: current, pages, go: (n) => setAt(Math.max(0, Math.min(pages - 1, n))) }
}

/** Previous and next arrows with "4–6 of 23"; nothing when everything fits on one page. */
export function Pager({ at, pages, total, perPage, go, label }: { at: number; pages: number; total: number; perPage: number; go: (n: number) => void; label: string }): React.JSX.Element | null {
  if (pages <= 1) return null
  const from = at * perPage + 1
  const to = Math.min(total, from + perPage - 1)
  return (
    <nav className="pager" aria-label={`${label} pages`}>
      <button type="button" className="tool" aria-label="Previous page" disabled={at === 0} onClick={() => go(at - 1)}>
        <Icon name="left" />
      </button>
      {pages <= 7 && (
        <span className="pager-dots" aria-hidden="true">
          {Array.from({ length: pages }, (_, i) => (
            <span key={i} className={i === at ? 'on' : ''} />
          ))}
        </span>
      )}
      <span className="pager-count" aria-live="polite">
        {from}–{to} of {total}
      </span>
      <button type="button" className="tool" aria-label="Next page" disabled={at >= pages - 1} onClick={() => go(at + 1)}>
        <Icon name="right" />
      </button>
    </nav>
  )
}
