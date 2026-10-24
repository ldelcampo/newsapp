import { useEffect, useState } from 'react'
import { PROVIDERS, type FactCheckSettings, type ProviderId, type SecretName } from '@shared/factcheck'

/** A write-only key field: shows whether a key is saved, never the key itself. */
function KeyField({ name, label, saved, url, onSaved }: { name: SecretName; label: string; saved: boolean; url?: string; onSaved: (s: Record<SecretName, boolean>) => void }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const store = (v: string): void => {
    setError('')
    window.hub
      .setSecret(name, v)
      .then((s) => {
        setValue('')
        onSaved(s)
      })
      .catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }
  return (
    <label className="field">
      <span>{label}</span>
      <div className="key-row">
        <input type="password" autoComplete="off" spellCheck={false} value={value} placeholder={saved ? 'Saved in your keychain' : 'Paste your key'} onChange={(e) => setValue(e.target.value)} />
        <button type="button" className="ghost" disabled={!value.trim()} onClick={() => store(value)}>
          Save key
        </button>
        {saved && (
          <button type="button" className="ghost" onClick={() => store('')}>
            Remove
          </button>
        )}
      </div>
      {error ? (
        <small className="error">{error}</small>
      ) : (
        url && (
          <small className="muted">
            Get one at{' '}
            <button type="button" className="link" onClick={() => void window.hub.openExternal(url)}>
              {new URL(url).host}
            </button>
            . Kept encrypted on this computer only.
          </small>
        )
      )}
    </label>
  )
}

export function FactCheckEditor({ value, onChange }: { value: FactCheckSettings; onChange: (next: FactCheckSettings) => void }): React.JSX.Element {
  const [saved, setSaved] = useState<Record<SecretName, boolean> | null>(null)
  const [test, setTest] = useState<{ state: 'idle' | 'busy' } | { state: 'ok' } | { state: 'fail'; error: string }>({ state: 'idle' })
  const info = PROVIDERS.find((p) => p.id === value.provider)!

  useEffect(() => {
    void window.hub.secrets().then(setSaved)
  }, [])

  const runTest = (): void => {
    setTest({ state: 'busy' })
    void window.hub.testProvider(value.provider).then((r) => setTest(r.ok ? { state: 'ok' } : { state: 'fail', error: r.error }))
  }

  return (
    <div className="factcheck">
      <p className="muted small">
        Verify facts counts the outlets covering a story for free. To check its claims, pick an AI service and bring your own key. Only the story and its
        coverage are sent to that service.
      </p>
      <div className="grid2">
        <label className="field">
          <span>AI service</span>
          <select id="fc-provider" value={value.provider} onChange={(e) => onChange({ ...value, provider: e.target.value as ProviderId })}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Model</span>
          <input id="fc-model" value={value.models[value.provider]} placeholder={info.defaultModel} onChange={(e) => onChange({ ...value, models: { ...value.models, [value.provider]: e.target.value } })} />
        </label>
      </div>

      {info.needsKey && saved && <KeyField key={info.id} name={info.id as SecretName} label={`${info.label} API key`} saved={saved[info.id as SecretName]} url={info.keyUrl} onSaved={setSaved} />}
      {info.id === 'ollama' && (
        <label className="field">
          <span>Ollama address</span>
          <input id="fc-ollama" value={value.ollamaUrl} onChange={(e) => onChange({ ...value, ollamaUrl: e.target.value })} />
          <small className="muted">Runs on your own computer, so nothing leaves it. Install Ollama and pull the model first.</small>
        </label>
      )}
      {info.webSearch && (
        <label className="toggle">
          <input id="fc-web" type="checkbox" checked={value.webSearch} onChange={(e) => onChange({ ...value, webSearch: e.target.checked })} />
          <span className="track" aria-hidden="true" />
          Let {info.label.split(' ')[0]} search the web for more evidence (slower, a few cents more per check)
        </label>
      )}
      <div className="actions">
        <button type="button" className="ghost" disabled={test.state === 'busy'} onClick={runTest}>
          {test.state === 'busy' ? 'Testing…' : 'Test connection'}
        </button>
        <span role="status" className={test.state === 'ok' ? 'ok' : test.state === 'fail' ? 'error small' : 'muted small'}>
          {test.state === 'ok' ? 'Works' : test.state === 'fail' ? test.error : 'Save first if you changed the service or model.'}
        </span>
      </div>

      {saved && (
        <KeyField
          name="googleFactCheck"
          label="Google Fact Check API key (optional)"
          saved={saved.googleFactCheck}
          url="https://console.cloud.google.com/apis/library/factchecktools.googleapis.com"
          onSaved={setSaved}
        />
      )}
    </div>
  )
}
