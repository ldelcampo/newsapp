import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, MailAction, MailBody } from '@shared/accounts'
import { byDate, MAIL_CATEGORIES, SNOOZE_OPTIONS, type MailCategory, type MailUrgency, type RankedMail, type SnoozeOption, type Verdict } from '@shared/mail'
import { ArticleSkeleton } from './ArticleList'
import { Icon } from './Icon'
import { AccountTag, ConnectPrompt, MailList, Problems, VerdictButtons } from './Inbox'
import { Composer, ReaderTools } from './MailCompose'
import { QuickRule, RulesPanel } from './MailRules'
import { errorText, useAccounts, useMail } from './useAccounts'
import { timeAgo } from './useNews'

type Tab = 'needs' | 'all' | 'snoozed' | MailCategory
/** Changes shown before the provider confirms them; `gone` hides archived, trashed and snoozed mail. */
type Override = Partial<Pick<RankedMail, 'unread' | 'starred' | 'snoozedUntil'>> & { verdict?: Verdict | null; gone?: boolean }

const ACTION_LABELS: Record<MailAction, string> = { read: 'Marked as read', unread: 'Marked as unread', archive: 'Archived', trash: 'Moved to Trash', star: 'Starred', unstar: 'Unstarred' }
const until = (iso: string): string => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

const many = (n: number, text: string): string => (n > 1 ? `${text} (${n} messages)` : text)

/** Every inbox in one list: "Needs you" ranks it, "All mail" keeps inbox order. `focus` opens that message once it loads. */
export function MailView({ focus = '', onAdd }: { focus?: string; onAdd: () => void }): React.JSX.Element {
  const { accounts, refresh } = useAccounts()
  const { feed, error, loading, reload } = useMail()
  const [tab, setTab] = useState<Tab>('needs')
  const [account, setAccount] = useState('')
  const [openId, setOpenId] = useState('')
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [composing, setComposing] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  // Ticked messages for bulk actions, and the last one ticked, where a Shift-click run starts.
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const anchor = useRef('')
  const focused = useRef(false)

  const withMail = accounts?.filter((a) => a.mail) ?? []
  const apply = (m: RankedMail): RankedMail & { gone?: boolean } => {
    const o = overrides[m.id]
    if (!o) return m
    const { verdict, ...rest } = o
    return { ...m, ...rest, ...(verdict !== undefined ? { verdict: verdict ?? undefined } : {}) }
  }
  const [items, snoozed] = useMemo(() => {
    const now = new Date().toISOString()
    const every = [...(feed?.items ?? []), ...(feed?.snoozed ?? [])].map(apply).filter((m) => !m.gone && (!account || m.accountId === account))
    const later = (m: RankedMail): boolean => !!m.snoozedUntil && m.snoozedUntil > now
    return [every.filter((m) => !later(m)), every.filter(later).sort((a, b) => a.snoozedUntil!.localeCompare(b.snoozedUntil!))]
  }, [feed, overrides, account])
  const open = [...items, ...snoozed].find((m) => m.id === openId) ?? null

  const set = (ids: string[], o: Override): void => setOverrides((x) => ({ ...x, ...Object.fromEntries(ids.map((id) => [id, { ...x[id], ...o }])) }))
  const undo = (ids: string[], keys: (keyof Override)[]): void =>
    setOverrides((x) => ({ ...x, ...Object.fromEntries(ids.map((id) => [id, Object.fromEntries(Object.entries(x[id] ?? {}).filter(([k]) => !keys.includes(k as keyof Override)))])) }))
  const say = (text: string, isError = false): void => {
    setNotice({ text, error: isError })
    if (!isError) setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 4000)
  }

  const act = (ms: RankedMail[], action: MailAction, quiet = false): void => {
    if (!ms.length) return
    const ids = ms.map((m) => m.id)
    const o: Override =
      action === 'archive' || action === 'trash' ? { gone: true } : action === 'read' || action === 'unread' ? { unread: action === 'unread' } : { starred: action === 'star' }
    set(ids, o)
    if (o.gone && ids.includes(openId)) setOpenId('')
    window.hub.mailAct(ids, action).then(
      () => !quiet && say(many(ids.length, ACTION_LABELS[action])),
      (e: Error) => {
        undo(ids, Object.keys(o) as (keyof Override)[])
        if (!quiet) say(errorText(e), true)
      }
    )
  }
  const snooze = (ms: RankedMail[], option: SnoozeOption | null): void => {
    Promise.all(ms.map((m) => window.hub.mailSnooze(m.id, option))).then(
      (ats) => {
        ms.forEach((m, i) => set([m.id], { snoozedUntil: ats[i] ?? undefined }))
        if (ats[0] && ms.some((m) => m.id === openId)) setOpenId('')
        say(many(ms.length, ats[0] ? `Snoozed until ${until(ats[0])}` : 'Back in your inbox'))
        reload()
      },
      (e: Error) => (say(errorText(e), true), reload())
    )
  }
  const verdict = (ms: RankedMail[], v: Verdict | null): void => {
    const ids = ms.map((m) => m.id)
    set(ids, { verdict: v })
    Promise.all(ids.map((id) => window.hub.mailFeedback(id, v)))
      .then(() => reload())
      .catch(() => undo(ids, ['verdict']))
  }
  const select = (m: RankedMail): void => {
    setComposing(false)
    setRulesOpen(false)
    setOpenId(m.id)
    // Opening a message reads it, as in any mail app, and lets mail back from a snooze go; read-only accounts just skip this.
    const woke = !!m.snoozedUntil && m.snoozedUntil <= new Date().toISOString()
    if ((m.unread || woke) && !feed?.readOnly.includes(m.accountId)) act([m], 'read', true)
  }
  const allowChanges = (id: string): void => {
    window.hub.reconnectAccount(id).then(
      () => {
        refresh()
        reload(true)
        say('Changes are allowed now.')
      },
      (e: Error) => say(errorText(e), true)
    )
  }

  const needs = items.filter((m) => m.verdict !== 'not' && (m.verdict === 'important' || (m.urgency !== 'later' && !m.hidden)))
  const kinds = MAIL_CATEGORIES.map((c) => ({ ...c, list: items.filter((m) => m.kind === c.value && !m.hidden).sort(byDate) })).filter((c) => c.list.length || tab === c.value)
  const inKind = kinds.find((c) => c.value === tab)?.list
  const groups = (['now', 'soon'] as MailUrgency[]).map((u) => ({ u, list: needs.filter((m) => m.urgency === u) })).filter((g) => g.list.length)
  const all = [...items].sort(byDate)
  const readOnly = withMail.filter((a) => feed?.readOnly.includes(a.id))
  /** The messages in the open tab, in the order shown. */
  const visible = tab === 'needs' ? groups.flatMap((g) => g.list) : tab === 'all' ? all : tab === 'snoozed' ? snoozed : (inKind ?? [])
  const picked = visible.filter((m) => checked.has(m.id))

  const check = (m: RankedMail, how: 'toggle' | 'range'): void => {
    const from = visible.findIndex((x) => x.id === anchor.current)
    const to = visible.findIndex((x) => x.id === m.id)
    setChecked((prev) => {
      const next = new Set(prev)
      if (how === 'range' && from >= 0 && to >= 0) for (const x of visible.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(x.id)
      else if (next.has(m.id)) next.delete(m.id)
      else next.add(m.id)
      return next
    })
    anchor.current = m.id
  }
  const clearChecks = (): void => setChecked(new Set())
  const bulk = (fn: () => void, keep = false): void => {
    fn()
    if (!keep) clearChecks()
  }
  useEffect(clearChecks, [tab, account])

  // A message chosen on the dashboard: open it in the tab that shows it.
  useEffect(() => {
    if (!focus || focused.current || !feed) return
    focused.current = true
    const m = [...items, ...snoozed].find((x) => x.id === focus)
    if (!m) return
    setTab(snoozed.includes(m) ? 'snoozed' : needs.includes(m) ? 'needs' : 'all')
    select(m)
    requestAnimationFrame(() => document.querySelector('.mail li.selected')?.scrollIntoView({ block: 'nearest' }))
  }, [feed, focus])

  // Keyboard: e archive, # delete, s star, u unread, Esc closes the message. With messages ticked, the keys act on those;
  // ⌘/Ctrl-A ticks every message in the tab.
  useEffect(() => {
    const targets = picked.length ? picked : open ? [open] : []
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && visible.length && !composing && !rulesOpen) {
        e.preventDefault()
        return setChecked(new Set(visible.map((m) => m.id)))
      }
      if (e.metaKey || e.ctrlKey || e.altKey || !targets.length) return
      const starAll = targets.some((m) => !m.starred)
      if (e.key === 'e') bulk(() => act(targets, 'archive'))
      else if (e.key === '#') bulk(() => act(targets, 'trash'))
      else if (e.key === 's') bulk(() => act(targets, starAll ? 'star' : 'unstar'), true)
      else if (e.key === 'u') bulk(() => act(targets, picked.length && targets.every((m) => m.unread) ? 'read' : 'unread'), true)
      else if (e.key === 'Escape') picked.length ? clearChecks() : setOpenId('')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (accounts && withMail.length === 0) return <ConnectPrompt what="mail" onOpen={onAdd} />

  const actions = (m: RankedMail): React.JSX.Element => <MailActions m={m} onAct={(x, a) => act([x], a)} onSnooze={(x, o) => snooze([x], o)} />
  const list = (mail: RankedMail[]): React.JSX.Element => (
    <MailList mail={mail} accounts={withMail} selected={openId} onSelect={select} onVerdict={(m, v) => verdict([m], v)} actions={actions} checked={checked} onCheck={check} />
  )
  const status = loading ? 'Updating…' : feed ? `Updated ${timeAgo(feed.fetchedAt)} · ${feed.ranking === 'jev' ? 'ranked with Jev' : 'built-in ranking'}` : ''

  return (
    <div className={`mail-view ${open || composing || rulesOpen ? 'reading' : ''}`}>
      <div className="toolbar enter">
        <div className="news-status">
          <span className="status">{status}</span>
          <button className="ghost" onClick={() => reload(true)} disabled={loading}>
            <Icon name="refresh" className={loading ? 'spin' : ''} />
            Refresh
          </button>
          <button className="primary" onClick={() => (setOpenId(''), setRulesOpen(false), setComposing(true))}>
            <Icon name="edit" /> Write
          </button>
          <button className={rulesOpen ? 'ghost on' : 'ghost'} onClick={() => (setOpenId(''), setComposing(false), setRulesOpen((r) => !r))}>
            <Icon name="settings" /> Rules
            {(feed?.suggestions.length ?? 0) > 0 && <span className="count">{feed!.suggestions.length} new</span>}
          </button>
        </div>
        <div className="chips" role="tablist" aria-label="Which mail">
          <button role="tab" className={tab === 'needs' ? 'chip on' : 'chip'} aria-selected={tab === 'needs'} onClick={() => setTab('needs')}>
            Important <span className="count">{needs.length}</span>
          </button>
          {kinds.map((c) => (
            <button key={c.value} role="tab" className={tab === c.value ? 'chip on' : 'chip'} aria-selected={tab === c.value} onClick={() => setTab(c.value)}>
              {c.label} <span className="count">{c.list.length}</span>
            </button>
          ))}
          <button role="tab" className={tab === 'all' ? 'chip on' : 'chip'} aria-selected={tab === 'all'} onClick={() => setTab('all')}>
            All mail <span className="count">{items.length}</span>
          </button>
          {(snoozed.length > 0 || tab === 'snoozed') && (
            <button role="tab" className={tab === 'snoozed' ? 'chip on' : 'chip'} aria-selected={tab === 'snoozed'} onClick={() => setTab('snoozed')}>
              Snoozed <span className="count">{snoozed.length}</span>
            </button>
          )}
          {withMail.length > 1 && (
            <select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">All accounts</option>
              {withMail.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email || a.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {readOnly.map((a) => (
        <p key={a.id} className="hint small enter">
          {a.email} can only read mail. To archive, delete, star or reply from here, Google needs to allow changes.{' '}
          <button className="link" onClick={() => allowChanges(a.id)}>
            Allow changes <Icon name="arrow" />
          </button>
        </p>
      ))}
      {notice && (
        <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button className="ghost icon-only" onClick={() => setNotice(null)} aria-label="Dismiss">
            <Icon name="close" />
          </button>
        </div>
      )}

      <div className="mail-panes">
        <section className="card enter mail-list-card" style={{ '--i': 1 } as React.CSSProperties}>
          {feed && visible.length > 0 && (
            <BulkBar
              picked={picked}
              total={visible.length}
              onAll={() => setChecked(picked.length === visible.length ? new Set() : new Set(visible.map((m) => m.id)))}
              onClear={clearChecks}
              onAct={(a) => bulk(() => act(picked, a), a !== 'archive' && a !== 'trash')}
              onSnooze={(o) => bulk(() => snooze(picked, o))}
              onVerdict={(v) => bulk(() => verdict(picked, v), true)}
            />
          )}
          {error && <p className="error small">Couldn’t load mail: {error}</p>}
          {!feed && !error && <ArticleSkeleton rows={6} />}
          {feed && tab !== 'snoozed' && items.length === 0 && <p className="muted">Your inbox is empty.</p>}
          {feed && tab === 'needs' && items.length > 0 && needs.length === 0 && <p className="muted">Nothing needs you right now.</p>}
          {feed &&
            tab === 'needs' &&
            groups.map((g) => (
              <div key={g.u} className="ticket-group">
                <h3 className={`urgency-head urgency-${g.u}`}>
                  {g.u === 'now' ? 'Needs you today' : 'Soon'} <span className="count">{g.list.length}</span>
                </h3>
                {list(g.list)}
              </div>
            ))}
          {feed && tab === 'all' && list(all)}
          {feed && inKind && list(inKind)}
          {feed && tab === 'snoozed' && (snoozed.length ? list(snoozed) : <p className="muted">Nothing is snoozed.</p>)}
          {feed && <Problems problems={feed.problems} />}
        </section>
        {open && (
          <Reader
            m={open}
            accounts={withMail}
            onClose={() => setOpenId('')}
            onVerdict={(m, v) => verdict([m], v)}
            actions={
              <>
                {actions(open)}
                <QuickRule m={open} onSaved={(t) => (say(t), reload())} />
              </>
            }
            tools={<ReaderTools m={open} accounts={withMail} readOnly={!!feed?.readOnly.includes(open.accountId)} onDone={say} />}
          />
        )}
        {rulesOpen && !open && !composing && <RulesPanel suggestions={feed?.suggestions ?? []} onClose={() => setRulesOpen(false)} onChanged={() => reload()} />}
        {!open && !composing && !rulesOpen && (
          <section className="card reader reader-empty" aria-hidden="true">
            <Icon name="mail" />
            <p className="muted">Choose a message to read it here.</p>
            <p className="muted small">Keys in a message: e archive · # delete · s star · u unread · Esc close</p>
          </section>
        )}
        {composing && !open && (
          <section className="card enter reader" aria-label="New message">
            <header className="reader-actions">
              <h2 className="grow">New message</h2>
              <button className="ghost icon-only" onClick={() => setComposing(false)} aria-label="Close">
                <Icon name="close" />
              </button>
            </header>
            <Composer
              initial={{ accountId: withMail.find((a) => !feed?.readOnly.includes(a.id))?.id ?? withMail[0]?.id ?? '', to: '', cc: '', subject: '', text: '' }}
              accounts={withMail.filter((a) => !feed?.readOnly.includes(a.id))}
              onClose={() => setComposing(false)}
              onSent={(t) => (setComposing(false), say(t))}
            />
          </section>
        )}
      </div>
    </div>
  )
}

/** The select-all box over the list and, once messages are ticked, what can be done to all of them at once. */
function BulkBar({
  picked,
  total,
  onAll,
  onClear,
  onAct,
  onSnooze,
  onVerdict
}: {
  picked: RankedMail[]
  total: number
  onAll: () => void
  onClear: () => void
  onAct: (a: MailAction) => void
  onSnooze: (o: SnoozeOption | null) => void
  onVerdict: (v: Verdict) => void
}): React.JSX.Element {
  const n = picked.length
  const unread = picked.some((m) => m.unread)
  const unstarred = picked.some((m) => !m.starred)
  return (
    <div className={`bulk-bar ${n ? 'on' : ''}`} role="toolbar" aria-label="Selected messages">
      <input
        type="checkbox"
        aria-label={n === total ? 'Select none' : 'Select all'}
        title={n === total ? 'Select none' : 'Select all (⌘A)'}
        checked={n > 0 && n === total}
        ref={(el) => void (el && (el.indeterminate = n > 0 && n < total))}
        onChange={onAll}
      />
      {n === 0 ? (
        <span className="muted small">Select messages to act on several at once · ⌘-click or Shift-click</span>
      ) : (
        <>
          <b className="bulk-count">{n} selected</b>
          <div className="mail-actions" role="group" aria-label="Actions for the selected messages">
            <button className="ghost icon-only" title="Archive (e)" aria-label="Archive selected" onClick={() => onAct('archive')}>
              <Icon name="archive" />
            </button>
            <button className="ghost icon-only" title="Delete (#)" aria-label="Delete selected" onClick={() => onAct('trash')}>
              <Icon name="trash" />
            </button>
            <button className="ghost icon-only" title={unread ? 'Mark as read' : 'Mark as unread (u)'} aria-label={unread ? 'Mark selected as read' : 'Mark selected as unread'} onClick={() => onAct(unread ? 'read' : 'unread')}>
              <Icon name="mail" />
            </button>
            <button className="ghost icon-only" title={unstarred ? 'Star (s)' : 'Unstar (s)'} aria-label={unstarred ? 'Star selected' : 'Unstar selected'} onClick={() => onAct(unstarred ? 'star' : 'unstar')}>
              <Icon name="star" />
            </button>
            <label className="snooze" title="Snooze">
              <Icon name="snooze" />
              <select aria-label="Snooze selected" value="" onChange={(e) => onSnooze(e.target.value === 'wake' ? null : (e.target.value as SnoozeOption))}>
                <option value="" disabled>
                  Snooze until…
                </option>
                {SNOOZE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                {picked.some((m) => m.snoozedUntil) && <option value="wake">Unsnooze now</option>}
              </select>
            </label>
            <button className="ghost icon-only" title="Important" aria-label="Mark selected important" onClick={() => onVerdict('important')}>
              <Icon name="up" />
            </button>
            <button className="ghost icon-only" title="Not important" aria-label="Mark selected not important" onClick={() => onVerdict('not')}>
              <Icon name="down" />
            </button>
          </div>
          <button className="ghost icon-only" title="Clear selection (Esc)" aria-label="Clear selection" onClick={onClear}>
            <Icon name="close" />
          </button>
        </>
      )}
    </div>
  )
}

/** Archive, delete, star, read/unread and snooze for one message. */
function MailActions({ m, onAct, onSnooze }: { m: RankedMail; onAct: (m: RankedMail, a: MailAction) => void; onSnooze: (m: RankedMail, o: SnoozeOption | null) => void }): React.JSX.Element {
  return (
    <div className="mail-actions" role="group" aria-label="Message actions">
      <button className="ghost icon-only" title="Archive (e)" aria-label="Archive" onClick={() => onAct(m, 'archive')}>
        <Icon name="archive" />
      </button>
      <button className="ghost icon-only" title="Delete (#)" aria-label="Delete" onClick={() => onAct(m, 'trash')}>
        <Icon name="trash" />
      </button>
      <button
        className={`ghost icon-only ${m.starred ? 'starred' : ''}`}
        title={m.starred ? 'Unstar (s)' : 'Star (s)'}
        aria-label={m.starred ? 'Unstar' : 'Star'}
        aria-pressed={!!m.starred}
        onClick={() => onAct(m, m.starred ? 'unstar' : 'star')}
      >
        <Icon name="star" />
      </button>
      <button className="ghost icon-only" title={m.unread ? 'Mark as read' : 'Mark as unread (u)'} aria-label={m.unread ? 'Mark as read' : 'Mark as unread'} onClick={() => onAct(m, m.unread ? 'read' : 'unread')}>
        <Icon name="mail" />
      </button>
      <label className="snooze" title={m.snoozedUntil ? `Snoozed until ${until(m.snoozedUntil)}` : 'Snooze'}>
        <Icon name="snooze" />
        <select aria-label="Snooze" value="" onChange={(e) => onSnooze(m, e.target.value === 'wake' ? null : (e.target.value as SnoozeOption))}>
          <option value="" disabled>
            Snooze until…
          </option>
          {SNOOZE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {m.snoozedUntil && <option value="wake">Unsnooze now</option>}
        </select>
      </label>
    </div>
  )
}

/** One message in full. HTML runs in a sandbox with no scripts, and remote images stay off until asked for. */
function Reader({
  m,
  accounts,
  onClose,
  onVerdict,
  actions,
  tools
}: {
  m: RankedMail
  accounts: Account[]
  onClose: () => void
  onVerdict: (m: RankedMail, v: Verdict | null) => void
  actions: React.ReactNode
  tools: React.ReactNode
}): React.JSX.Element {
  const [body, setBody] = useState<MailBody | null>(null)
  const [error, setError] = useState('')
  const [images, setImages] = useState(false)
  useEffect(() => {
    setBody(null)
    setError('')
    setImages(false)
    window.hub.mailBody(m.accountId, m.id).then(setBody, (e: Error) => setError(errorText(e)))
  }, [m.accountId, m.id])
  const remote = !!body?.html && /<img[^>]+src=["']?https?:/i.test(body.html)

  return (
    <section className="card enter reader" aria-label="Message">
      <header className="reader-head">
        <div className="reader-actions">
          {actions}
          <VerdictButtons m={m} onVerdict={onVerdict} />
          {m.webUrl && (
            <button className="ghost icon-only" onClick={() => void window.hub.openExternal(m.webUrl!)} title="Open in Gmail" aria-label="Open in Gmail">
              <Icon name="external" />
            </button>
          )}
          <button className="ghost icon-only" onClick={onClose} aria-label="Close message" title="Close (Esc)">
            <Icon name="close" />
          </button>
        </div>
        <h2>{m.subject}</h2>
        <p className="small">
          <b>{m.from.name || m.from.email}</b> {m.from.name && <span className="muted">&lt;{m.from.email}&gt;</span>}
        </p>
        {body && (
          <p className="muted small">
            To {body.to || '(hidden)'}
            {body.cc ? ` · Cc ${body.cc}` : ''} · {new Date(body.receivedAt).toLocaleString()}
          </p>
        )}
        <AccountTag accounts={accounts} id={m.accountId} />
        {m.reasons.length > 0 && (
          <div className="meta">
            {m.reasons.map((r) => (
              <span key={r} className="reason">
                {r}
              </span>
            ))}
          </div>
        )}
      </header>
      {tools}
      {error && <p className="error small">Couldn’t open this message: {error}</p>}
      {!body && !error && <ArticleSkeleton rows={4} />}
      {body && remote && !images && (
        <p className="hint small">
          Remote images are off, so senders can’t tell you opened this.{' '}
          <button className="link" onClick={() => setImages(true)}>
            <Icon name="image" /> Show images
          </button>
        </p>
      )}
      {body &&
        (body.html ? (
          <iframe className="mail-frame" title="Message" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={frameDoc(body.html, images)} />
        ) : (
          <pre className="mail-text">{body.text}</pre>
        ))}
      {body && body.attachments.length > 0 && (
        <p className="muted small">
          Attachments: {body.attachments.join(', ')}
          {m.webUrl ? ' (open the message in Gmail to download them)' : ''}
        </p>
      )}
    </section>
  )
}

/** The message's HTML inside a page whose policy blocks scripts, and remote images unless allowed. Links open in the browser. */
export function frameDoc(html: string, images: boolean): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'${images ? ' https:' : ''}; img-src data: cid:${images ? ' https:' : ''}; font-src data:${images ? ' https:' : ''}`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{margin:0;padding:16px;background:#fff;color:#222;font:15px/1.5 system-ui,sans-serif;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`
}
