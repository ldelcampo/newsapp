import { useEffect, useState } from 'react'
import type { Account, MailDraft } from '@shared/accounts'
import type { MailSummary, RankedMail, ReplyIdea } from '@shared/mail'
import type { Settings } from '@shared/settings'
import { Icon } from './Icon'
import { errorText } from './useAccounts'

type Draft = Omit<MailDraft, 'text'> & { text: string }

/** Writes new mail or a reply. Sending goes through the account the mail is from. */
export function Composer({
  initial,
  accounts,
  onClose,
  onSent
}: {
  initial: Draft
  accounts: Account[]
  onClose: () => void
  onSent: (text: string) => void
}): React.JSX.Element {
  const [d, setD] = useState<Draft>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setD(initial), [initial])
  const set = (patch: Partial<Draft>): void => setD((x) => ({ ...x, ...patch }))
  const send = (): void => {
    setBusy(true)
    setError('')
    window.hub.mailSend(d).then(
      () => onSent(d.replyTo ? 'Reply sent' : 'Sent'),
      (e: Error) => {
        setBusy(false)
        setError(errorText(e))
      }
    )
  }
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
      onKeyDown={(e) => {
        // ⌘↵ / Ctrl+↵ sends; keys inside the form never reach the reader's shortcuts.
        e.stopPropagation()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) send()
      }}
    >
      {!d.replyTo && accounts.length > 1 && (
        <label className="field">
          <span>From</span>
          <select value={d.accountId} onChange={(e) => set({ accountId: e.target.value })}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>To</span>
        <input value={d.to} onChange={(e) => set({ to: e.target.value })} placeholder="name@example.com, …" autoFocus={!d.to} />
      </label>
      <label className="field">
        <span>Cc</span>
        <input value={d.cc} onChange={(e) => set({ cc: e.target.value })} />
      </label>
      <label className="field">
        <span>Subject</span>
        <input value={d.subject} onChange={(e) => set({ subject: e.target.value })} />
      </label>
      <textarea aria-label="Message" rows={8} value={d.text} onChange={(e) => set({ text: e.target.value })} autoFocus={!!d.to} />
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send'}
        </button>
        <button className="ghost" type="button" onClick={onClose} disabled={busy}>
          Discard
        </button>
        <span className="muted small">⌘↵ to send</span>
        {error && (
          <span className="error small" role="alert">
            {error}
          </span>
        )}
      </div>
    </form>
  )
}

/** Reply, AI help, Jira task and unsubscribe, under an open message. */
export function ReaderTools({
  m,
  accounts,
  readOnly,
  onDone
}: {
  m: RankedMail
  accounts: Account[]
  readOnly: boolean
  onDone: (text: string, error?: boolean) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [ideas, setIdeas] = useState<ReplyIdea[] | null>(null)
  const [summary, setSummary] = useState<MailSummary | null>(null)
  const [task, setTask] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    setDraft(null)
    setIdeas(null)
    setSummary(null)
    setTask(false)
    setError('')
  }, [m.id])

  const run = <T,>(what: string, job: Promise<T>, then: (v: T) => void): void => {
    setBusy(what)
    setError('')
    job.then(then, (e: Error) => setError(errorText(e))).finally(() => setBusy(''))
  }
  const reply = (all: boolean, text = ''): void => run('reply', window.hub.mailReplyDraft(m.accountId, m.id, all), (d) => setDraft({ ...d, text }))
  const suggest = (): void =>
    run('ideas', window.hub.mailReplyIdeas(m.accountId, m.id), (r) => {
      setIdeas(r.ideas)
      if (!draft) setDraft({ ...r.draft, text: '' })
    })
  const unsubscribe = (): void =>
    run('unsub', window.hub.mailUnsubscribe(m.accountId, m.id), (r) => {
      if ('open' in r) {
        void window.hub.openExternal(r.open)
        onDone('The sender’s unsubscribe page opened in your browser.')
      } else onDone(`Unsubscribed. ${r.how}`)
    })

  return (
    <div className="reader-tools">
      <div className="row wrap">
        <button className="ghost" disabled={readOnly || !!busy} onClick={() => reply(false)}>
          Reply
        </button>
        <button className="ghost" disabled={readOnly || !!busy} onClick={() => reply(true)}>
          Reply all
        </button>
        <button className="ghost" disabled={readOnly || !!busy} onClick={suggest} title="Your AI from Settings > Fact checking writes three short replies. This message is sent to it.">
          <Icon name="verify" /> {busy === 'ideas' ? 'Thinking…' : 'Suggest replies'}
        </button>
        <button className="ghost" disabled={!!busy} onClick={() => run('summary', window.hub.mailSummary(m.accountId, m.id), setSummary)} title="Your AI from Settings > Fact checking summarises this message.">
          {busy === 'summary' ? 'Summarising…' : 'Summarise'}
        </button>
        <button className="ghost" disabled={!!busy} onClick={() => setTask((t) => !t)}>
          <Icon name="tickets" /> Make a task
        </button>
        {m.unsubscribe && (
          <button className="ghost" disabled={!!busy} onClick={unsubscribe}>
            {busy === 'unsub' ? 'Unsubscribing…' : 'Unsubscribe'}
          </button>
        )}
      </div>
      {readOnly && <p className="muted small">Allow changes for this account (above) to reply from here.</p>}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {summary && (
        <div className="hint summary-box">
          <p>{summary.summary}</p>
          {summary.asks.length > 0 && (
            <p className="small">
              <b>Asks you:</b> {summary.asks.join(' · ')}
            </p>
          )}
          {summary.dates.length > 0 && (
            <p className="small">
              <b>Dates:</b> {summary.dates.join(' · ')}
            </p>
          )}
        </div>
      )}
      {task && <TaskForm m={m} onCreated={(key, url) => (setTask(false), onDone(`Created ${key}`), void window.hub.openExternal(url))} />}
      {ideas && (
        <div className="chips ideas">
          {ideas.map((i) => (
            <button key={i.label + i.text} className="chip" title={i.text} onClick={() => setDraft((d) => (d ? { ...d, text: i.text } : d))}>
              {i.label}
            </button>
          ))}
        </div>
      )}
      {draft && (
        <Composer
          initial={draft}
          accounts={accounts}
          onClose={() => (setDraft(null), setIdeas(null))}
          onSent={(t) => {
            setDraft(null)
            setIdeas(null)
            onDone(t)
          }}
        />
      )}
    </div>
  )
}

/** Picks a Jira site and project, then creates a task from the message. */
function TaskForm({ m, onCreated }: { m: RankedMail; onCreated: (key: string, url: string) => void }): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [projects, setProjects] = useState<{ siteId: string; key: string; name: string }[]>([])
  const [siteId, setSiteId] = useState('')
  const [projectKey, setProjectKey] = useState('')
  const [summary, setSummary] = useState(m.subject)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void window.hub.getSettings().then((s) => {
      setSettings(s)
      setSiteId(s.jiraSites[0]?.id ?? '')
      if (!s.jiraSites.length) return
      void window.hub.tickets().then((r) => {
        const seen = new Map<string, { siteId: string; key: string; name: string }>()
        for (const t of r.tickets) seen.set(`${t.siteId}:${t.project.key}`, { siteId: t.siteId, key: t.project.key, name: t.project.name })
        const list = [...seen.values()]
        setProjects(list)
        setProjectKey((k) => k || list[0]?.key || '')
      })
    })
  }, [])
  if (!settings) return <p className="muted small">Loading…</p>
  if (!settings.jiraSites.length) return <p className="hint small">Connect Jira in Settings to turn mail into tasks.</p>
  const create = (): void => {
    setBusy(true)
    setError('')
    window.hub.mailTask(m.accountId, m.id, { siteId, projectKey, summary }).then(
      (r) => onCreated(r.key, r.url),
      (e: Error) => {
        setBusy(false)
        setError(errorText(e))
      }
    )
  }
  return (
    <div className="task-form">
      <div className="row wrap">
        {settings.jiraSites.length > 1 && (
          <select aria-label="Jira site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {settings.jiraSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.url.replace(/^https:\/\//, '')}
              </option>
            ))}
          </select>
        )}
        <input aria-label="Project key" list="task-projects" value={projectKey} onChange={(e) => setProjectKey(e.target.value.toUpperCase())} placeholder="Project key" size={8} />
        <datalist id="task-projects">
          {projects
            .filter((p) => p.siteId === siteId)
            .map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
        </datalist>
        <input aria-label="Task title" value={summary} onChange={(e) => setSummary(e.target.value)} className="grow" />
        <button className="primary" disabled={busy || !projectKey} onClick={create}>
          {busy ? 'Creating…' : 'Create task'}
        </button>
      </div>
      <p className="muted small">The task gets the email’s text and a link back to it, and is assigned to you.</p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
