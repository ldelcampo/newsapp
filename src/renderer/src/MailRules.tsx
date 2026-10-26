import { useEffect, useState } from 'react'
import { describeRule, MAIL_CATEGORIES, normalizeRules, type MailCategory, type MailRule, type RankedMail } from '@shared/mail'
import { Icon } from './Icon'
import { errorText } from './useAccounts'

/** Saves rules into settings (they sync), keeping whatever else changed meanwhile. */
export async function saveRules(change: (rules: MailRule[]) => MailRule[]): Promise<MailRule[]> {
  const latest = await window.hub.getSettings()
  const saved = await window.hub.saveSettings({ ...latest, mailRules: change(latest.mailRules) })
  return saved.mailRules
}

const newId = (): string => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const IMPORTANCE: { value: NonNullable<MailRule['importance']> | ''; label: string }[] = [
  { value: '', label: 'Keep ranking' },
  { value: 'important', label: 'Always important' },
  { value: 'normal', label: 'Not important' },
  { value: 'hide', label: 'Hide' }
]

/** Your rules, rules your marks support, and rules the AI proposes; nothing applies until accepted. */
export function RulesPanel({ suggestions, onClose, onChanged }: { suggestions: MailRule[]; onClose: () => void; onChanged: () => void }): React.JSX.Element {
  const [rules, setRules] = useState<MailRule[] | null>(null)
  const [proposed, setProposed] = useState<MailRule[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<{ from: string; subject: string; category: MailCategory | ''; importance: MailRule['importance'] | '' }>({ from: '', subject: '', category: '', importance: 'hide' })
  useEffect(() => void window.hub.getSettings().then((s) => setRules(s.mailRules)), [])

  const change = (fn: (r: MailRule[]) => MailRule[]): void => {
    saveRules(fn).then((r) => {
      setRules(r)
      onChanged()
    }, (e: Error) => setError(errorText(e)))
  }
  const accept = (list: MailRule[]): void => {
    const ids = new Set(list.map((r) => r.id))
    setProposed((p) => p.filter((r) => !ids.has(r.id)))
    setDismissed((d) => [...d, ...ids])
    change((rs) => [...rs, ...list.map((r) => ({ ...r, id: newId() }))])
  }
  const ask = (): void => {
    setBusy(true)
    setError('')
    window.hub
      .mailProposeRules()
      .then(setProposed, (e: Error) => setError(errorText(e)))
      .finally(() => setBusy(false))
  }
  const add = (): void => {
    const [rule] = normalizeRules([{ id: newId(), source: 'you', from: draft.from, subject: draft.subject, category: draft.category || undefined, importance: draft.importance || undefined }])
    if (!rule) return setError('Give an address or @domain (or subject words), and a category or importance.')
    setError('')
    setDraft({ from: '', subject: '', category: '', importance: 'hide' })
    change((rs) => [...rs, rule])
  }
  const offered = [...suggestions, ...proposed].filter((r) => !dismissed.includes(r.id))

  return (
    <section className="card enter reader rules" aria-label="Mail rules">
      <header className="reader-actions">
        <h2 className="grow">Rules</h2>
        <button className="ghost icon-only" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <p className="muted small">Rules sort mail into categories and decide what shows under Important. They run on this computer and sync with your settings.</p>

      <div className="row wrap">
        <button className="primary" onClick={ask} disabled={busy} title="Sends sender addresses, names, counts and subjects (no message text) to the AI chosen under Settings > Fact checking.">
          <Icon name="verify" /> {busy ? 'Thinking…' : 'Suggest rules with AI'}
        </button>
        <span className="muted small">From your marks and the senders in your inbox. You approve each one.</span>
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}

      {offered.length > 0 && (
        <div className="rule-group">
          <h3 className="urgency-head">
            Suggested <span className="count">{offered.length}</span>
            {offered.length > 1 && (
              <button className="link" onClick={() => accept(offered)}>
                Accept all
              </button>
            )}
          </h3>
          <ul className="rule-list">
            {offered.map((r) => (
              <li key={r.id}>
                <div className="grow">
                  <b>{describeRule(r)}</b>
                  {r.note && <p className="muted small">{r.note}</p>}
                </div>
                <button className="ghost" onClick={() => accept([r])}>
                  <Icon name="check" /> Accept
                </button>
                <button className="ghost icon-only" aria-label="Dismiss" onClick={() => setDismissed((d) => [...d, r.id])}>
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rule-group">
        <h3 className="urgency-head">
          Your rules <span className="count">{rules?.length ?? 0}</span>
        </h3>
        {rules && rules.length === 0 && <p className="muted small">No rules yet.</p>}
        <ul className="rule-list">
          {rules?.map((r) => (
            <li key={r.id}>
              <div className="grow">
                <b>{describeRule(r)}</b>
                {r.note && <p className="muted small">{r.note}</p>}
              </div>
              <button className="ghost icon-only" aria-label="Delete rule" title="Delete rule" onClick={() => change((rs) => rs.filter((x) => x.id !== r.id))}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rule-group">
        <h3 className="urgency-head">Add a rule</h3>
        <div className="row wrap">
          <input aria-label="From address or @domain" placeholder="ana@x.com or @x.com" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <input aria-label="Subject contains" placeholder="Subject contains…" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          <select aria-label="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as MailCategory | '' })}>
            <option value="">Any category</option>
            {MAIL_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select aria-label="Importance" value={draft.importance ?? ''} onChange={(e) => setDraft({ ...draft, importance: e.target.value as MailRule['importance'] | '' })}>
            {IMPORTANCE.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={add}>
            <Icon name="plus" /> Add
          </button>
        </div>
      </div>
    </section>
  )
}

/** "Always…" for the open message: a one-click rule for its sender or domain. */
export function QuickRule({ m, onSaved }: { m: RankedMail; onSaved: (text: string) => void }): React.JSX.Element {
  const email = m.from.email.toLowerCase()
  const domain = email.includes('@') ? `@${email.split('@')[1]}` : ''
  const options: { label: string; rule: Omit<MailRule, 'id' | 'source'> }[] = [
    { label: `Always important from ${email}`, rule: { from: email, importance: 'important' } },
    { label: `Hide mail from ${email}`, rule: { from: email, importance: 'hide' } },
    ...(domain ? [{ label: `Hide everything from ${domain}`, rule: { from: domain, importance: 'hide' as const } }] : []),
    ...MAIL_CATEGORIES.filter((c) => c.value !== m.kind).map((c) => ({ label: `File ${email} under ${c.label}`, rule: { from: email, category: c.value } }))
  ]
  return (
    <select
      className="quick-rule"
      aria-label="Make a rule"
      value=""
      onChange={(e) => {
        const o = options[Number(e.target.value)]
        if (!o) return
        void saveRules((rs) => [...rs.filter((r) => r.from !== o.rule.from || r.subject), { ...o.rule, id: newId(), source: 'you' }]).then(() => onSaved(`Rule added: ${describeRule({ ...o.rule, id: '', source: 'you' })}`))
      }}
    >
      <option value="" disabled>
        Make a rule…
      </option>
      {options.map((o, i) => (
        <option key={o.label} value={i}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
