import { useEffect, useRef, useState } from 'react'
import { PROVIDERS, STEP_LABELS, VERDICTS, type FactCheckStep, type FactReport, type Link } from '@shared/factcheck'
import { LEANS, type Lean } from '@shared/news'
import type { RankedArticle } from '@shared/ranking'
import { Icon } from './Icon'
import { timeAgo } from './useNews'

const STEPS = Object.keys(STEP_LABELS) as FactCheckStep[]
const LEAN_ORDER: Lean[] = ['left', 'center-left', 'center', 'center-right', 'right', 'unrated']
const leanLabel = (v: Lean): string => LEANS.find((l) => l.value === v)?.label ?? v

function Ext({ link }: { link: Link }): React.JSX.Element {
  return (
    <button type="button" className="link small" title={link.url} onClick={() => void window.hub.openExternal(link.url)}>
      {link.title}
    </button>
  )
}

function LeanBar({ leans }: { leans: FactReport['coverage']['leans'] }): React.JSX.Element {
  const total = LEAN_ORDER.reduce((n, l) => n + (leans[l] ?? 0), 0)
  return (
    <div className="lean-bar" role="img" aria-label={LEAN_ORDER.filter((l) => leans[l]).map((l) => `${leanLabel(l)} ${leans[l]}`).join(', ')}>
      {LEAN_ORDER.filter((l) => leans[l]).map((l) => (
        <span key={l} className={`seg lean-${l}`} style={{ flexGrow: leans[l] }} title={`${leanLabel(l)}: ${leans[l]}`} />
      ))}
      {total === 0 && <span className="seg" style={{ flexGrow: 1 }} />}
    </div>
  )
}

/** A story's fact-check: coverage first, then each claim with its verdict and sources. */
export function VerifyPanel({ article, onClose }: { article: RankedArticle; onClose: () => void }): React.JSX.Element {
  const [report, setReport] = useState<FactReport | null>(null)
  const [step, setStep] = useState<FactCheckStep | null>(null)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)

  const run = (): void => {
    setError('')
    setStep('coverage')
    window.hub
      .verifyArticle(article.id)
      .then(setReport)
      .catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      .finally(() => setStep(null))
  }

  useEffect(() => {
    dialog.current?.showModal()
    const off = window.hub.onVerifyStep((id, s) => id === article.id && setStep(s))
    void window.hub.savedReport(article.id).then((saved) => (saved ? setReport(saved) : run()))
    return off
  }, [article.id])

  const providerLabel = PROVIDERS.find((p) => p.id === report?.provider)?.label
  const busy = step !== null
  const cov = report?.coverage

  return (
    <dialog ref={dialog} className="verify" onClose={onClose} aria-labelledby="verify-title">
      <header className="verify-head">
        <div>
          <p className="eyebrow">Verify facts</p>
          <h2 id="verify-title">{article.title}</h2>
          <p className="muted small">
            {article.sourceName} · {timeAgo(article.publishedAt)}
          </p>
        </div>
        <button type="button" className="ghost icon-only" aria-label="Close" onClick={() => dialog.current?.close()}>
          <Icon name="close" />
        </button>
      </header>

      {busy && (
        <ol className="steps" aria-live="polite">
          {STEPS.map((s, i) => {
            const at = STEPS.indexOf(step!)
            return (
              <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''}>
                {i < at ? <Icon name="check" /> : <span className="step-dot" />}
                {STEP_LABELS[s]}
              </li>
            )
          })}
        </ol>
      )}

      {error && !busy && <p className="error">{error}</p>}

      {cov && (
        <section className="verify-section">
          <h3>Coverage</h3>
          <div className="coverage">
            <div className="stat">
              <span className="stat-value">{cov.outlets.length}</span>
              <span className="stat-label">of your sources</span>
            </div>
            {cov.gdelt && (
              <div className="stat">
                <span className="stat-value">{cov.gdelt.publishers}</span>
                <span className="stat-label">publishers worldwide{cov.gdelt.countries ? ` in ${cov.gdelt.countries} countries` : ''}</span>
              </div>
            )}
            <div className="stat">
              <span className="stat-value small-value">{timeAgo(cov.firstSeen)}</span>
              <span className="stat-label">first reported</span>
            </div>
          </div>
          <LeanBar leans={cov.leans} />
          {cov.outlets.length === 1 && <p className="hint">Only one of your sources carries this story so far.</p>}
          <ul className="outlets">
            {cov.outlets.map((o) => (
              <li key={o.url}>
                <span className={`lean lean-${o.lean}`}>{leanLabel(o.lean)}</span> <b>{o.name}</b> <Ext link={{ title: o.title, url: o.url }} />
              </li>
            ))}
          </ul>
          {cov.gdelt && cov.gdelt.sample.length > 0 && (
            <details>
              <summary className="muted small">Some of the other publishers (GDELT, last 3 days)</summary>
              <ul className="outlets">
                {cov.gdelt.sample.map((l) => (
                  <li key={l.url}>
                    <Ext link={l} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {report && report.claims.length > 0 && (
        <section className="verify-section">
          <h3>Claims</h3>
          {report.summary && <p>{report.summary}</p>}
          <ol className="claims">
            {report.claims.map((c, i) => (
              <li key={i} className="claim">
                <span className={`verdict v-${c.verdict}`}>{VERDICTS.find((v) => v.value === c.verdict)?.label}</span>
                <div className="claim-body">
                  <p className="claim-text">{c.claim}</p>
                  {c.explanation && <p className="muted small">{c.explanation}</p>}
                  {(c.sources.length > 0 || c.factChecks.length > 0) && (
                    <ul className="claim-sources">
                      {c.sources.map((s) => (
                        <li key={s.url}>
                          <Ext link={s} />
                        </li>
                      ))}
                      {c.factChecks.map((f) => (
                        <li key={f.url}>
                          <span className="fc-rating">
                            {f.publisher}: {f.rating}
                          </span>{' '}
                          <Ext link={{ title: f.title || f.claim, url: f.url }} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {report && report.problems.length > 0 && (
        <ul className="problems">
          {report.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <footer className="verify-foot">
        <p className="muted small">
          {report?.provider
            ? `Checked ${timeAgo(report.createdAt)} by ${providerLabel} (${report.model}). AI can be wrong: open the sources before relying on a verdict.`
            : 'Coverage comes from your sources and GDELT.'}
        </p>
        <button type="button" className="ghost" disabled={busy} onClick={run}>
          <Icon name="refresh" className={busy ? 'spin' : ''} />
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </footer>
    </dialog>
  )
}
