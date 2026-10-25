import { useEffect, useMemo, useState } from 'react'
import type { Account, MailAction, MailBody } from '@shared/accounts'
import { byDate, SNOOZE_OPTIONS, type MailUrgency, type RankedMail, type SnoozeOption, type Verdict } from '@shared/mail'
import { ArticleSkeleton } from './ArticleList'
import { Icon } from './Icon'
import { AccountTag, ConnectPrompt, MailList, Problems, VerdictButtons } from './Inbox'
import { Composer, ReaderTools } from './MailCompose'
import { errorText, useAccounts, useMail } from './useAccounts'
import { timeAgo } from './useNews'

type Tab = 'needs' | 'all' | 'snoozed'
/** Changes shown before the provider confirms them; `gone` hides archived, trashed and snoozed mail. */
type Override = Partial<Pick<RankedMail, 'unread' | 'starred' | 'snoozedUntil'>> & { verdict?: Verdict | null; gone?: boolean }

const ACTION_LABELS: Record<MailAction, string> = { read: 'Marked as read', unread: 'Marked as unread', archive: 'Archived', trash: 'Moved to Trash', star: 'Starred', unstar: 'Unstarred' }
const until = (iso: string): string => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

/** Every inbox in one list: "Needs you" ranks it, "All mail" keeps inbox order. */
export function MailView({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  const { accounts, refresh } = useAccounts()
  const { feed, error, loading, reload } = useMail()
  const [tab, setTab] = useState<Tab>('needs')
  const [account, setAccount] = useState('')
  const [openId, setOpenId] = useState('')
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [composing, setComposing] = useState(false)

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

  const set = (id: string, o: Override): void => setOverrides((x) => ({ ...x, [id]: { ...x[id], ...o } }))
  const undo = (id: string, keys: (keyof Override)[]): void =>
    setOverrides((x) => ({ ...x, [id]: Object.fromEntries(Object.entries(x[id] ?? {}).filter(([k]) => !keys.includes(k as keyof Override))) }))
  const say = (text: string, isError = false): void => {
    setNotice({ text, error: isError })
    if (!isError) setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 4000)
  }

  const act = (m: RankedMail, action: MailAction, quiet = false): void => {
    const o: Override =
      action === 'archive' || action === 'trash' ? { gone: true } : action === 'read' || action === 'unread' ? { unread: action === 'unread' } : { starred: action === 'star' }
    set(m.id, o)
    if (o.gone && openId === m.id) setOpenId('')
    window.hub.mailAct([m.id], action).then(
      () => !quiet && say(ACTION_LABELS[action]),
      (e: Error) => {
        undo(m.id, Object.keys(o) as (keyof Override)[])
        if (!quiet) say(errorText(e), true)
      }
    )
  }
  const snooze = (m: RankedMail, option: SnoozeOption | null): void => {
    window.hub.mailSnooze(m.id, option).then(
      (at) => {
        set(m.id, { snoozedUntil: at ?? undefined })
        if (at && openId === m.id) setOpenId('')
        say(at ? `Snoozed until ${until(at)}` : 'Back in your inbox')
        reload()
      },
      (e: Error) => say(errorText(e), true)
    )
  }
  const verdict = (m: RankedMail, v: Verdict | null): void => {
    set(m.id, { verdict: v })
    window.hub
      .mailFeedback(m.id, v)
      .then(() => reload())
      .catch(() => undo(m.id, ['verdict']))
  }
  const select = (m: RankedMail): void => {
    setComposing(false)
    setOpenId(m.id)
    // Opening a message reads it, as in any mail app; read-only accounts just skip this.
    if (m.unread && !feed?.readOnly.includes(m.accountId)) act(m, 'read', true)
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

  // Keyboard: e archive, # delete, s star, u unread, Esc closes the message.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'e') act(open, 'archive')
      else if (e.key === '#') act(open, 'trash')
      else if (e.key === 's') act(open, open.starred ? 'unstar' : 'star')
      else if (e.key === 'u') act(open, 'unread')
      else if (e.key === 'Escape') setOpenId('')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (accounts && withMail.length === 0) return <ConnectPrompt what="mail" onOpen={onAdd} />

  const needs = items.filter((m) => m.verdict !== 'not' && (m.verdict === 'important' || m.urgency !== 'later'))
  const groups = (['now', 'soon'] as MailUrgency[]).map((u) => ({ u, list: needs.filter((m) => (m.verdict === 'important' ? 'now' : m.urgency) === u) })).filter((g) => g.list.length)
  const all = [...items].sort(byDate)
  const readOnly = withMail.filter((a) => feed?.readOnly.includes(a.id))

  const actions = (m: RankedMail): React.JSX.Element => <MailActions m={m} onAct={act} onSnooze={snooze} />
  const list = (mail: RankedMail[]): React.JSX.Element => (
    <MailList mail={mail} accounts={withMail} selected={openId} onSelect={select} onVerdict={verdict} actions={actions} />
  )
  const status = loading ? 'Updating…' : feed ? `Updated ${timeAgo(feed.fetchedAt)} · ${feed.ranking === 'jev' ? 'ranked with Jev' : 'built-in ranking'}` : ''

  return (
    <div className={`mail-view ${open || composing ? 'reading' : ''}`}>
      <div className="toolbar enter">
        <div className="news-status">
          <span className="status">{status}</span>
          <button className="ghost" onClick={() => reload(true)} disabled={loading}>
            <Icon name="refresh" className={loading ? 'spin' : ''} />
            Refresh
          </button>
          <button className="primary" onClick={() => (setOpenId(''), setComposing(true))}>
            <Icon name="edit" /> Write
          </button>
        </div>
        <div className="chips" role="tablist" aria-label="Which mail">
          <button role="tab" className={tab === 'needs' ? 'chip on' : 'chip'} aria-selected={tab === 'needs'} onClick={() => setTab('needs')}>
            Needs you <span className="count">{needs.length}</span>
          </button>
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
          {feed && tab === 'snoozed' && (snoozed.length ? list(snoozed) : <p className="muted">Nothing is snoozed.</p>)}
          {feed && <Problems problems={feed.problems} />}
        </section>
        {open && (
          <Reader
            m={open}
            accounts={withMail}
            onClose={() => setOpenId('')}
            onVerdict={verdict}
            actions={actions(open)}
            tools={<ReaderTools m={open} accounts={withMail} readOnly={!!feed?.readOnly.includes(open.accountId)} onDone={say} />}
          />
        )}
        {!open && !composing && (
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
