import { useEffect, useState } from 'react'

const JEV_PAGE = 'https://typesafe.ai'

/** The TypeSafe AI key, shared by Jira and mail ranking. Saved straight to the keychain, not with the form. */
export function JevKeyField(): React.JSX.Element {
  const [hasJev, setHasJev] = useState(false)
  const [jevKey, setJevKey] = useState('')
  useEffect(() => void window.hub.hasJevKey().then(setHasJev), [])
  return (
    <label className="field">
      <span>TypeSafe AI key {hasJev && <span className="ok small">· saved</span>}</span>
      <div className="row">
        <input type="password" value={jevKey} placeholder={hasJev ? 'Paste a new key to replace it' : 'Paste your API key'} onChange={(e) => setJevKey(e.target.value)} autoComplete="off" />
        <button type="button" className="ghost" disabled={!jevKey.trim()} onClick={() => void window.hub.setJevKey(jevKey).then((has) => (setHasJev(has), setJevKey('')))}>
          Save key
        </button>
        {hasJev && (
          <button type="button" className="ghost" onClick={() => void window.hub.setJevKey('').then(setHasJev)}>
            Remove
          </button>
        )}
      </div>
      <small className="muted">
        Get one at{' '}
        <button type="button" className="link" onClick={() => void window.hub.openExternal(JEV_PAGE)}>
          typesafe.ai
        </button>
        . Kept in your keychain and used for both Jira and mail. If Jev is unreachable, the built-in ranking is used.
      </small>
    </label>
  )
}
