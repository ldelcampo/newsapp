import { useEffect, useMemo, useState } from 'react'
import type { Account, MailBody } from '@shared/accounts'
import { byDate, type MailUrgency, type RankedMail, type Verdict } from '@shared/mail'
import { ArticleSkeleton } from './ArticleList'
import { Icon } from './Icon'
import { AccountTag, ConnectPrompt, MailList, Problems, VerdictButtons } from './Inbox'
import { errorText, useAccounts, useMail } from './useAccounts'
import { timeAgo } from './useNews'

type Tab = 'needs' | 'all'

/** Every inbox in one list: "Needs you" ranks it, "All mail" keeps inbox order. */
export function MailView({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  const { accounts } = useAccounts()
  const { feed, error, loading, reload } = useMail()
  const [tab, setTab] = useState<Tab>('needs')
  const [account, setAccount] = useState('')
  const [open, setOpen] = useState<RankedMail | null>(null)
  // Verdicts show at once; the next load brings the re-ranked list.
  const [verdicts, setVerdicts] = useState<Record<string, Verdict | null>>({})

  const withMail = accounts?.filter((a) => a.mail) ?? []
  const items = useMemo(
    () => (feed?.items ?? []).map((m) => (m.id in verdicts ? { ...m, verdict: verdicts[m.id] ?? undefined } : m)).filter((m) => !account || m.accountId === account),
    [feed, verdicts, account]
  )
  if (accounts && withMail.length === 0) return <ConnectPrompt what="mail" onOpen={onAdd} />

  const needs = items.filter((m) => m.verdict !== 'not' && (m.verdict === 'important' || m.urgency !== 'later'))
  const groups = (['now', 'soon'] as MailUrgency[]).map((u) => ({ u, list: needs.filter((m) => (m.verdict === 'important' ? 'now' : m.urgency) === u) })).filter((g) => g.list.length)
  const all = [...items].sort(byDate)

  const verdict = (m: RankedMail, v: Verdict | null): void => {
    setVerdicts((x) => ({ ...x, [m.id]: v }))
    if (open?.id === m.id) setOpen({ ...open, verdict: v ?? undefined })
    window.hub
      .mailFeedback(m.id, v)
      .then(() => reload())
      .catch(() => setVerdicts((x) => ({ ...x, [m.id]: m.verdict ?? null })))
  }
  const list = (mail: RankedMail[]): React.JSX.Element => (
    <MailList mail={mail} accounts={withMail} selected={open?.id} onSelect={setOpen} onVerdict={verdict} />
  )
  const status = loading ? 'Updating…' : feed ? `Updated ${timeAgo(feed.fetchedAt)} · ${feed.ranking === 'jev' ? 'ranked with Jev' : 'built-in ranking'}` : ''

  return (
    <div className={`mail-view ${open ? 'reading' : ''}`}>
      <div className="toolbar enter">
        <div className="news-status">
          <span className="status">{status}</span>
          <button className="ghost" onClick={() => reload(true)} disabled={loading}>
            <Icon name="refresh" className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>
        <div className="chips" role="tablist" aria-label="Which mail">
          <button role="tab" className={tab === 'needs' ? 'chip on' : 'chip'} aria-selected={tab === 'needs'} onClick={() => setTab('needs')}>
            Needs you <span className="count">{needs.length}</span>
          </button>
          <button role="tab" className={tab === 'all' ? 'chip on' : 'chip'} aria-selected={tab === 'all'} onClick={() => setTab('all')}>
            All mail <span className="count">{items.length}</span>
          </button>
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

      <div className="mail-panes">
        <section className="card enter mail-list-card" style={{ '--i': 1 } as React.CSSProperties}>
          {error && <p className="error small">Couldn’t load mail: {error}</p>}
          {!feed && !error && <ArticleSkeleton rows={6} />}
          {feed && items.length === 0 && <p className="muted">Your inbox is empty.</p>}
          {feed && tab === 'needs' && items.length > 0 && needs.length === 0 && <p className="muted">Nothing needs you right now.</p>}
          {feed && tab === 'needs' &&
            groups.map((g) => (
              <div key={g.u} className="ticket-group">
                <h3 className={`urgency-head urgency-${g.u}`}>
                  {g.u === 'now' ? 'Needs you today' : 'Soon'} <span className="count">{g.list.length}</span>
                </h3>
                {list(g.list)}
              </div>
            ))}
          {feed && tab === 'all' && list(all)}
          {feed && <Problems problems={feed.problems} />}
        </section>
        {open && <Reader m={open} accounts={withMail} onClose={() => setOpen(null)} onVerdict={verdict} />}
      </div>
    </div>
  )
}

/** One message in full. HTML runs in a sandbox with no scripts, and remote images stay off until asked for. */
function Reader({ m, accounts, onClose, onVerdict }: { m: RankedMail; accounts: Account[]; onClose: () => void; onVerdict: (m: RankedMail, v: Verdict | null) => void }): React.JSX.Element {
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
          <VerdictButtons m={m} onVerdict={onVerdict} />
          {m.webUrl && (
            <button className="ghost" onClick={() => void window.hub.openExternal(m.webUrl!)} title="Open in the provider’s site">
              <Icon name="external" /> Open
            </button>
          )}
          <button className="ghost icon-only" onClick={onClose} aria-label="Close message">
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
      {body && (body.html ? <iframe className="mail-frame" title="Message" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={frameDoc(body.html, images)} /> : <pre className="mail-text">{body.text}</pre>)}
      {body && body.attachments.length > 0 && (
        <p className="muted small">
          Attachments: {body.attachments.join(', ')}
          {m.webUrl ? ' (open the message in your mail to download them)' : ''}
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
