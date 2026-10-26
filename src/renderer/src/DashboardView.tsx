import { useEffect, useRef, useState } from 'react'
import type { Settings } from '@shared/settings'
import { newWidget, SIZES, WIDGET_TYPES, type Widget, type WidgetSize, type WidgetType } from '@shared/widgets'
import { Icon } from './Icon'
import { useNews } from './useNews'
import { WidgetBody, WidgetOptions, type WidgetContext } from './Widgets'

const ROW = 2 // px; must match grid-auto-rows in styles.css
const GAP = 18

/**
 * Masonry packing: each card spans as many tiny grid rows as its height needs, so shorter
 * widgets slide up into the space beside taller ones instead of leaving gaps.
 */
function useMasonry(ref: React.RefObject<HTMLDivElement | null>, ready: boolean): void {
  useEffect(() => {
    const grid = ref.current
    if (!grid) return
    const fit = (el: HTMLElement): void => {
      el.style.gridRowEnd = `span ${Math.ceil((el.offsetHeight + GAP) / ROW)}`
    }
    const sizes = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target as HTMLElement)))
    const watch = (): void => Array.from(grid.children).forEach((c) => sizes.observe(c))
    const added = new MutationObserver(watch)
    watch()
    added.observe(grid, { childList: true })
    return () => {
      sizes.disconnect()
      added.disconnect()
    }
  }, [ref, ready])
}

/** Widget types that only make sense once on a dashboard. */
const SINGLE: WidgetType[] = ['stats', 'meetings', 'mail']

/** A second news widget starts on one of the user's topics no other news widget shows yet. */
function withFreeTopic(w: Widget, widgets: Widget[], topics: string[]): Widget {
  if (w.type !== 'top-stories') return w
  const taken = widgets.flatMap((x) => (x.type === 'top-stories' ? [x.topic] : []))
  if (taken.length === 0) return w
  return { ...w, size: 'medium', topic: topics.find((t) => !taken.includes(t)) ?? '' }
}

export function DashboardView({ onOpen }: { onOpen: WidgetContext['onOpen'] }): React.JSX.Element {
  const { news, loading, reload } = useNews()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [editing, setEditing] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const grid = useRef<HTMLDivElement>(null)
  useMasonry(grid, settings !== null)
  useEffect(() => void window.hub.getSettings().then(setSettings), [])

  if (!settings) return <p className="muted">Loading…</p>

  const widgets = settings.dashboard
  const setWidgets = (dashboard: Widget[]): void => {
    const next = { ...settings, dashboard }
    setSettings(next)
    // Saves run in order, so a quick series of edits never lands out of order.
    saving.current = saving.current.then(() => window.hub.saveSettings(next))
  }
  const replace = (w: Widget): void => setWidgets(widgets.map((x) => (x.id === w.id ? w : x)))
  const move = (id: string, to: number): void => {
    const from = widgets.findIndex((w) => w.id === id)
    if (from < 0 || to < 0 || to >= widgets.length || from === to) return
    const next = [...widgets]
    const [w] = next.splice(from, 1)
    next.splice(to, 0, w)
    setWidgets(next)
  }

  const ctx: WidgetContext = { settings, news, loading, reload, onOpen }
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const addable = WIDGET_TYPES.filter((t) => !SINGLE.includes(t.type) || !widgets.some((w) => w.type === t.type))

  return (
    <div ref={grid} className={editing ? 'dashboard editing' : 'dashboard'}>
      <header className="hero enter" style={{ '--i': 0 } as React.CSSProperties}>
        <div>
          <p className="eyebrow">{today}</p>
          <p className="greeting">
            {greeting}
            {settings.displayName ? `, ${settings.displayName}` : ''}.
          </p>
        </div>
        <button className={editing ? 'primary' : 'ghost'} onClick={() => setEditing(!editing)}>
          <Icon name={editing ? 'check' : 'edit'} /> {editing ? 'Done' : 'Customize'}
        </button>
      </header>

      {widgets.length === 0 && !editing && (
        <section className="card size-wide enter">
          <p className="muted">Your dashboard is empty.</p>
          <button className="link" onClick={() => setEditing(true)}>
            Add widgets <Icon name="arrow" />
          </button>
        </section>
      )}

      {widgets.map((w, i) => (
        <section
          key={w.id}
          data-widget={w.type}
          className={`card widget size-${w.size} enter ${w.type === 'top-stories' ? 'glow' : ''} ${dragging === w.id ? 'dragging' : ''}`}
          style={{ '--i': Math.min(i + 1, 8) } as React.CSSProperties}
          draggable={editing}
          onDragStart={(e) => {
            setDragging(w.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDragging(null)}
          onDragOver={(e) => editing && dragging && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (dragging) move(dragging, i)
            setDragging(null)
          }}
        >
          {editing && (
            <div className="widget-tools" aria-label={`${WIDGET_TYPES.find((t) => t.type === w.type)?.label} options`}>
              <Icon name="grip" className="grip" />
              <button type="button" className="tool" aria-label="Move earlier" disabled={i === 0} onClick={() => move(w.id, i - 1)}>
                <Icon name="left" />
              </button>
              <button type="button" className="tool" aria-label="Move later" disabled={i === widgets.length - 1} onClick={() => move(w.id, i + 1)}>
                <Icon name="right" />
              </button>
              <div className="sizes" role="group" aria-label="Size">
                {SIZES.map((s) => (
                  <button type="button" key={s.value} className={w.size === s.value ? 'on' : ''} aria-pressed={w.size === s.value} aria-label={s.label} title={s.label} onClick={() => replace({ ...w, size: s.value as WidgetSize })}>
                    {w.size === 'small' ? s.label[0] : s.label}
                  </button>
                ))}
              </div>
              <button type="button" className="tool remove" aria-label="Remove widget" onClick={() => setWidgets(widgets.filter((x) => x.id !== w.id))}>
                <Icon name="close" />
              </button>
            </div>
          )}
          <WidgetBody widget={w} ctx={ctx} />
          {editing && <WidgetOptions widget={w} topics={settings.topics} onChange={replace} />}
        </section>
      ))}

      {editing && (
        <section className="card size-wide add-widgets enter" style={{ '--i': 2 } as React.CSSProperties}>
          <h2>
            <Icon name="plus" /> Add a widget
          </h2>
          <div className="widget-catalog">
            {addable.map((t) => (
              <button key={t.type} type="button" className="catalog-item" onClick={() => setWidgets([...widgets, withFreeTopic(newWidget(t.type), widgets, settings.topics)])}>
                <Icon name={t.type === 'top-stories' ? 'stories' : t.type} />
                <span>
                  <b>{t.label}</b>
                  <span className="muted small">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="muted small">Drag widgets or use the arrows to reorder them. Changes are saved as you go.</p>
        </section>
      )}
    </div>
  )
}
