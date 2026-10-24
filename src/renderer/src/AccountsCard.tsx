import { useEffect, useState } from 'react'
import { providerLabel, type Account, type Provider } from '@shared/accounts'
import { Icon } from './Icon'
import { ImapAccountForm } from './ImapAccountForm'

const clean = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Mail and calendar accounts. Changes apply at once; they are not part of the Save button. */
export function AccountsCard(): React.JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' })
  // The IMAP form is open for a new account, or for a new password on an existing one.
  const [imapFor, setImapFor] = useState<'new' | Account | null>(null)

  useEffect(() => void window.hub.accounts().then(setAccounts), [])

  const run = async (key: string, waiting: string, task: () => Promise<string>): Promise<void> => {
    setBusy(key)
    setStatus({ text: waiting })
    try {
      setStatus({ text: await task() })
    } catch (e) {
      setStatus({ text: clean(e), error: true })
    } finally {
      setAccounts(await window.hub.accounts())
      setBusy('')
    }
  }

  const add = (provider: Provider): Promise<void> =>
    run(`add:${provider}`, 'Finish signing in in your browser…', async () => {
      const a = await window.hub.addAccount(provider)
      return `Connected ${a.email}.`
    })

  const toggle = (a: Account, patch: { mail?: boolean; calendar?: boolean }): Promise<void> =>
    run(a.id, '', async () => {
      await window.hub.updateAccount(a.id, patch)
      return ''
    })

  return (
    <div className="accounts">
      {accounts.length === 0 && <p className="muted">Connect an account to see your mail and meetings here. Sign-ins stay on this computer, encrypted by your system keychain.</p>}
      <ul className="account-list">
        {accounts.map((a) => (
          <li key={a.id} className="account">
            <span className={`avatar provider-${a.provider}`} aria-hidden="true">
              {(a.name || a.email)[0]?.toUpperCase()}
            </span>
            <span className="account-who">
              <b>{a.email}</b>
              <span className="muted small">
                {providerLabel(a.provider)}
                {a.name ? ` · ${a.name}` : ''}
              </span>
            </span>
            {a.status === 'reauth' ? (
              <button
                type="button"
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  a.provider === 'imap'
                    ? setImapFor(a)
                    : void run(a.id, 'Finish signing in in your browser…', async () => (await window.hub.reconnectAccount(a.id), `Reconnected ${a.email}.`))
                }
              >
                Reconnect
              </button>
            ) : (
              <>
                <label className="toggle">
                  <input type="checkbox" checked={a.mail} disabled={!!busy || (a.mail && !a.calendar)} onChange={(e) => void toggle(a, { mail: e.target.checked })} />
                  <span className="track" aria-hidden="true" />
                  Mail
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={a.calendar} disabled={!!busy || (a.calendar && !a.mail)} onChange={(e) => void toggle(a, { calendar: e.target.checked })} />
                  <span className="track" aria-hidden="true" />
                  Calendar
                </label>
              </>
            )}
            <button
              type="button"
              className="tool remove"
              aria-label={`Remove ${a.email}`}
              title="Remove"
              disabled={!!busy}
              onClick={() => void run(a.id, '', async () => (await window.hub.removeAccount(a.id), `Removed ${a.email}.`))}
            >
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
      {imapFor && (
        <ImapAccountForm
          key={imapFor === 'new' ? 'new' : imapFor.id}
          account={imapFor === 'new' ? undefined : imapFor}
          onCancel={() => setImapFor(null)}
          onDone={(text) => {
            setImapFor(null)
            setStatus({ text })
            void window.hub.accounts().then(setAccounts)
          }}
        />
      )}
      <div className="actions add-account">
        <button type="button" className="ghost" disabled={!!busy} onClick={() => void add('google')}>
          <Icon name="plus" /> {busy === 'add:google' ? 'Waiting for Google…' : 'Add Google account'}
        </button>
        <button type="button" className="ghost" disabled={!!busy || imapFor !== null} onClick={() => setImapFor('new')}>
          <Icon name="plus" /> Add IONOS or other mail
        </button>
      </div>
      <small className="muted">Turn Calendar off for a mail-only account. Turning a switch back on may ask you to sign in again.</small>
      {status.text && (
        <p role="status" className={status.error ? 'error' : 'ok'}>
          {status.text}
        </p>
      )}
    </div>
  )
}
