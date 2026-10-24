import { useState } from 'react'
import { guessImapSettings, IMAP_PRESETS, type Account, type ImapSettings } from '@shared/accounts'

const clean = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Adds an IMAP account (IONOS and any other provider), or takes a new password for one.
 * It sits inside the Settings form, so it uses plain buttons rather than a nested form.
 */
export function ImapAccountForm({ account, onDone, onCancel }: { account?: Account; onDone: (message: string) => void; onCancel: () => void }): React.JSX.Element {
  const [email, setEmail] = useState(account?.email ?? '')
  const [name, setName] = useState(account?.name ?? '')
  const [password, setPassword] = useState('')
  const [calendar, setCalendar] = useState(account?.calendar ?? true)
  const [preset, setPreset] = useState(account ? 'custom' : 'ionos-mx')
  const [servers, setServers] = useState<ImapSettings>(account?.imap ?? { user: '', ...IMAP_PRESETS[0].settings })
  // The login follows the address until the user edits it.
  const [userEdited, setUserEdited] = useState(!!account)
  const [busy, setBusy] = useState<'' | 'test' | 'save'>('')
  const [result, setResult] = useState<{ text: string; error?: boolean }>({ text: '' })

  const input = { email, name, password, calendar, imap: { ...servers, user: userEdited ? servers.user : email.trim() }, accountId: account?.id }
  const set = (patch: Partial<ImapSettings>): void => {
    setServers({ ...servers, ...patch })
    setResult({ text: '' })
  }

  const choosePreset = (id: string): void => {
    setPreset(id)
    const p = IMAP_PRESETS.find((x) => x.id === id)
    if (p && id !== 'other') set(p.settings)
    else if (id === 'other') set(guessImapSettings(email))
  }

  const onEmail = (value: string): void => {
    setEmail(value)
    setResult({ text: '' })
    // Known providers (iCloud, Fastmail, Yahoo) fill themselves in from the address.
    const domain = value.split('@')[1]?.toLowerCase()
    const known = IMAP_PRESETS.find((p) => domain && p.domains.includes(domain))
    if (known && !account) {
      setPreset(known.id)
      setServers({ ...servers, ...known.settings })
    }
  }

  const test = async (): Promise<void> => {
    setBusy('test')
    setResult({ text: 'Checking the incoming and outgoing servers…' })
    try {
      const r = await window.hub.testImap(input)
      if (!r.ok) setResult({ text: r.error, error: true })
      else if (r.calendar === 'found') setResult({ text: 'Mail and calendar both work.' })
      else if (r.calendar === 'none') setResult({ text: r.note ?? 'Mail works; no calendar found.' })
      else setResult({ text: 'Mail works.' })
    } catch (e) {
      setResult({ text: clean(e), error: true })
    } finally {
      setBusy('')
    }
  }

  const save = async (): Promise<void> => {
    setBusy('save')
    setResult({ text: 'Connecting…' })
    try {
      const a = await window.hub.addAccount('imap', input)
      setPassword('')
      onDone(account ? `Reconnected ${a.email}.` : `Connected ${a.email}${calendar && !a.calendar ? '. No calendar was found, so it is mail only.' : '.'}`)
    } catch (e) {
      setResult({ text: clean(e), error: true })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="imap-form card-inset">
      <h3>{account ? `Enter the password for ${account.email}` : 'Add IONOS or other mail (IMAP)'}</h3>
      <div className="grid2">
        <label className="field">
          <span>Email address</span>
          <input type="email" autoComplete="off" value={email} disabled={!!account} onChange={(e) => onEmail(e.target.value)} placeholder="you@company.com" />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => (setPassword(e.target.value), setResult({ text: '' }))} />
        </label>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company" />
        </label>
        <label className="field">
          <span>Provider</span>
          <select value={preset} onChange={(e) => choosePreset(e.target.value)}>
            {account && <option value="custom">Current servers</option>}
            {IMAP_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="toggle">
        <input type="checkbox" checked={calendar} onChange={(e) => setCalendar(e.target.checked)} />
        <span className="track" aria-hidden="true" />
        Also connect the calendar, if the provider has one (CalDAV)
      </label>

      <details open={preset === 'other'}>
        <summary>Server settings</summary>
        <div className="grid2">
          <label className="field">
            <span>Incoming (IMAP) server</span>
            <input value={servers.imapHost} onChange={(e) => set({ imapHost: e.target.value })} placeholder="imap.example.com" />
          </label>
          <label className="field">
            <span>Port</span>
            <input inputMode="numeric" value={servers.imapPort} onChange={(e) => set({ imapPort: Number(e.target.value) || 0 })} />
          </label>
          <label className="field">
            <span>Outgoing (SMTP) server</span>
            <input value={servers.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} placeholder="smtp.example.com" />
          </label>
          <label className="field">
            <span>Port</span>
            <input inputMode="numeric" value={servers.smtpPort} onChange={(e) => set({ smtpPort: Number(e.target.value) || 0 })} />
          </label>
          <label className="field">
            <span>Login name</span>
            <input
              value={userEdited ? servers.user : email}
              onChange={(e) => {
                setUserEdited(true)
                set({ user: e.target.value })
              }}
            />
          </label>
          <label className="field">
            <span>Calendar (CalDAV) address</span>
            <input value={servers.caldavUrl} onChange={(e) => set({ caldavUrl: e.target.value })} placeholder="Found automatically when possible" />
          </label>
        </div>
      </details>

      <div className="actions">
        <button type="button" className="primary" disabled={!!busy || !email || !password} onClick={() => void save()}>
          {busy === 'save' ? 'Connecting…' : account ? 'Reconnect' : 'Connect'}
        </button>
        <button type="button" className="ghost" disabled={!!busy || !email || !password} onClick={() => void test()}>
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>
        <button type="button" className="ghost" disabled={!!busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {result.text && (
        <p role="status" className={result.error ? 'error' : 'ok'}>
          {result.text}
        </p>
      )}
      <small className="muted">Your password is encrypted with your system keychain and never leaves this computer, except to sign in to your mail server.</small>
    </div>
  )
}
