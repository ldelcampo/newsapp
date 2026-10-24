import { useState } from 'react'
import type { SourceTest } from '@shared/api'
import { DEFAULT_SOURCES, LEANS, type Lean, type Source } from '@shared/news'
import { NEWS_LANGUAGES } from '@shared/settings'

const EMPTY = { name: '', url: '', language: 'en', region: '', lean: 'unrated' as Lean, apiKey: '', apiKeyParam: '' }

export function SourcesEditor({ sources, onChange }: { sources: Source[]; onChange: (next: Source[]) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(EMPTY)
  const [test, setTest] = useState<SourceTest | null>(null)
  const [testing, setTesting] = useState(false)

  const candidate = (): Source => ({
    id: `custom-${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
    name: draft.name.trim(),
    url: draft.url.trim(),
    language: draft.language,
    region: draft.region.trim() || 'Global',
    lean: draft.lean,
    ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim(), apiKeyParam: draft.apiKeyParam.trim() || 'api-key' } : {})
  })

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(await window.hub.testSource(candidate()))
    setTesting(false)
  }

  const add = (): void => {
    onChange([...sources, candidate()])
    setDraft(EMPTY)
    setTest(null)
  }

  const set = (patch: Partial<typeof EMPTY>): void => {
    setDraft({ ...draft, ...patch })
    setTest(null)
  }

  return (
    <div className="sources">
      <details>
        <summary>Included sources ({DEFAULT_SOURCES.length})</summary>
        <ul className="source-list">
          {DEFAULT_SOURCES.map((s) => (
            <li key={s.id}>
              {s.name} <span className="muted small">· {s.language.toUpperCase()} · {s.region} · {LEANS.find((l) => l.value === s.lean)?.label}</span>
            </li>
          ))}
        </ul>
      </details>

      {sources.length > 0 && (
        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.id}>
              {s.name} <span className="muted small">· {s.language.toUpperCase()} · {s.region}</span>
              <button type="button" className="link" onClick={() => onChange(sources.filter((x) => x.id !== s.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <fieldset className="add-source">
        <legend>Add a source</legend>
        <div className="grid2">
          <label className="field">
            <span>Name</span>
            <input id="src-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Reforma" />
          </label>
          <label className="field">
            <span>Feed address (RSS or Atom)</span>
            <input id="src-url" value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/rss" />
          </label>
          <label className="field">
            <span>Language</span>
            <select id="src-lang" value={draft.language} onChange={(e) => set({ language: e.target.value })}>
              {NEWS_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Region</span>
            <input id="src-region" value={draft.region} onChange={(e) => set({ region: e.target.value })} placeholder="MX" />
          </label>
          <label className="field">
            <span>Editorial lean</span>
            <select id="src-lean" value={draft.lean} onChange={(e) => set({ lean: e.target.value as Lean })}>
              {LEANS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>API key (only if the source needs one)</span>
            <input id="src-key" type="password" value={draft.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />
          </label>
          {draft.apiKey && (
            <label className="field">
              <span>Key parameter name</span>
              <input id="src-key-param" value={draft.apiKeyParam} onChange={(e) => set({ apiKeyParam: e.target.value })} placeholder="api-key" />
            </label>
          )}
        </div>
        <div className="actions">
          <button type="button" className="ghost" onClick={runTest} disabled={testing || !draft.name || !draft.url}>
            {testing ? 'Testing…' : 'Test feed'}
          </button>
          <button type="button" className="primary" onClick={add} disabled={!test?.ok}>
            Add source
          </button>
        </div>
        {test &&
          (test.ok ? (
            <p className="ok small">
              Works: {test.count} articles, for example "{test.sample[0]}". Add it, then Save.
            </p>
          ) : (
            <p className="error small">{test.error}</p>
          ))}
      </fieldset>
    </div>
  )
}
