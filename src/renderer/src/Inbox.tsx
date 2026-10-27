import { useEffect, useState } from 'react'
import { meetingPhase, type Account, type CalendarEvent } from '@shared/accounts'
import { categoryLabel, type MailUrgency, type RankedMail, type Verdict } from '@shared/mail'
import { Icon } from './Icon'
import { timeAgo } from './useNews'

/** Which account an item came from, shown only when more than one account is connected. */
export function AccountTag({ accounts, id }: { accounts: Account[]; id: string }): React.JSX.Element | null {
  if (accounts.length < 2) return null
  const a = accounts.find((x) => x.id === id)
  return a ? <span className={`acct acct-${a.provider}`}>{a.email || a.name}</span> : null
}

const URGENCY_LABEL: Record<MailUrgency, string> = { now: 'Needs you today', soon: 'Soon', later: 'Later' }

export function MailList({
  mail,
  accounts,
  compact = false,
  selected,
  onSelect,
  onVerdict,
  actions,
  checked,
  onCheck
}: {
  mail: RankedMail[]
  accounts: Account[]
  compact?: boolean
  selected?: string
  /** Opens a message in the reader; without it, subjects open the provider's site. */
  onSelect?: (m: RankedMail) => void
  onVerdict?: (m: RankedMail, verdict: Verdict | null) => void
  /** Buttons shown on hover, such as archive and snooze. */
  actions?: (m: RankedMail) => React.ReactNode
  /** Messages ticked for a bulk action; with `onCheck`, each row gets a checkbox. */
  checked?: ReadonlySet<string>
  /** Ticks or unticks one message, or (`range`) every message from the last one ticked. */
  onCheck?: (m: RankedMail, how: 'toggle' | 'range') => void
}): React.JSX.Element {
  // The whole row opens the message; ⌘/Ctrl-click ticks it and Shift-click ticks a run.
  const click = (e: React.MouseEvent, m: RankedMail): void => {
    if ((e.target as HTMLElement).closest('button:not(.subject), input, select, label')) return
    if (onCheck && (e.metaKey || e.ctrlKey)) onCheck(m, 'toggle')
    else if (onCheck && e.shiftKey) onCheck(m, 'range')
    else onSelect?.(m)
  }
  return (
    <ol className={`mail ${compact ? 'compact' : ''} ${onSelect ? 'clickable' : ''} ${checked?.size ? 'checking' : ''}`}>
      {mail.map((m, i) => (
        <li
          key={`${m.accountId}:${m.id}`}
          className={`urgency-${m.urgency} ${m.unread ? 'unread' : ''} ${selected === m.id ? 'selected' : ''} ${checked?.has(m.id) ? 'checked' : ''}`}
          style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
          onClick={onSelect ? (e) => click(e, m) : undefined}
          // Keeps Shift-click from selecting text across rows.
          onMouseDown={onCheck ? (e) => e.shiftKey && e.preventDefault() : undefined}
        >
          {onCheck && (
            <input
              type="checkbox"
              className="mail-check"
              aria-label={`Select “${m.subject}”`}
              checked={checked?.has(m.id) ?? false}
              readOnly
              onClick={(e) => onCheck(m, e.shiftKey ? 'range' : 'toggle')}
            />
          )}
          <span className="urgency-dot" title={URGENCY_LABEL[m.urgency]} aria-label={`${URGENCY_LABEL[m.urgency]}${m.unread ? ', unread' : ''}`} />
          <div className="mail-body">
            <div className="mail-top">
              <span className="from">{m.from.name || m.from.email}</span>
              <span className="muted small">{timeAgo(m.receivedAt)}</span>
            </div>
            {onSelect ? (
              <button className="article-link subject">{m.subject}</button>
            ) : m.webUrl ? (
              <button className="article-link subject" onClick={() => void window.hub.openExternal(m.webUrl!)}>
                {m.subject}
              </button>
            ) : (
              <span className="subject">{m.subject}</span>
            )}
            {!compact && m.snippet && <p className="summary">{m.snippet}</p>}
            <div className="meta">
              {!compact && m.kind && <span className="reason kind">{categoryLabel(m.kind)}</span>}
              {m.reasons.slice(0, compact ? 1 : 3).map((r) => (
                <span key={r} className="reason">
                  {r}
                </span>
              ))}
              <AccountTag accounts={accounts} id={m.accountId} />
            </div>
          </div>
          {(onVerdict || actions) && (
            <div className="mail-side">
              {actions?.(m)}
              {onVerdict && <VerdictButtons m={m} onVerdict={onVerdict} />}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

/** "Important" and "Not important": they teach the ranking about this sender too. Pressing again takes it back. */
export function VerdictButtons({ m, onVerdict }: { m: RankedMail; onVerdict: (m: RankedMail, v: Verdict | null) => void }): React.JSX.Element {
  return (
    <div className="mail-verdict" role="group" aria-label="Teach the ranking">
      <button
        className={m.verdict === 'important' ? 'chip on' : 'chip'}
        aria-pressed={m.verdict === 'important'}
        title="Important: rank this and more mail from this sender higher"
        onClick={() => onVerdict(m, m.verdict === 'important' ? null : 'important')}
      >
        <Icon name="up" /> <span className="label">Important</span>
      </button>
      <button
        className={m.verdict === 'not' ? 'chip on' : 'chip'}
        aria-pressed={m.verdict === 'not'}
        title="Not important: rank this and more mail from this sender lower"
        onClick={() => onVerdict(m, m.verdict === 'not' ? null : 'not')}
      >
        <Icon name="down" /> <span className="label">Not important</span>
      </button>
    </div>
  )
}

export function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

const clock = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso)
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

const when = (e: CalendarEvent): string => (e.allDay ? 'All day' : `${clock(e.start)} – ${clock(e.end)}`)

function JoinButton({ e }: { e: CalendarEvent }): React.JSX.Element | null {
  if (!e.joinUrl) return null
  return (
    <button className="primary join" onClick={() => void window.hub.openExternal(e.joinUrl!)}>
      Join
    </button>
  )
}

function countdownText(phase: ReturnType<typeof meetingPhase>): string {
  if (phase.phase === 'now') return phase.minutes > 0 ? `${phase.minutes} min left` : 'Ending'
  if (phase.minutes < 60) return `in ${phase.minutes} min`
  const h = Math.floor(phase.minutes / 60)
  const m = phase.minutes % 60
  return h < 24 ? `in ${h} h${m ? ` ${m} min` : ''}` : `in ${Math.round(h / 24)} d`
}

/**
 * The next timed meeting with a countdown ring that fills over the last hour, pulses in the
 * last 10 minutes, and turns into a progress ring while the meeting runs.
 */
export function NextMeeting({ e, now, accounts }: { e: CalendarEvent; now: Date; accounts: Account[] }): React.JSX.Element {
  const p = meetingPhase(e, now)
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className={`next-meeting ${p.phase}`}>
      <svg className="ring" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} className="ring-track" />
        <circle cx="32" cy="32" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - p.progress)} />
      </svg>
      <div className="next-text">
        <span className="countdown" role="timer">
          {countdownText(p)}
        </span>
        <span className="next-title">{e.title}</span>
        <span className="muted small">
          {dayLabel(e.start, now) === 'Today' ? '' : `${dayLabel(e.start, now)}, `}
          {when(e)}
          {e.location ? ` · ${e.location}` : ''}
        </span>
        <AccountTag accounts={accounts} id={e.accountId} />
      </div>
      <JoinButton e={e} />
    </div>
  )
}

/** Events grouped by day. */
export function EventList({ events, accounts, now, limit }: { events: CalendarEvent[]; accounts: Account[]; now: Date; limit?: number }): React.JSX.Element {
  const shown = limit ? events.slice(0, limit) : events
  const days: [string, CalendarEvent[]][] = []
  for (const e of shown) {
    const label = dayLabel(e.allDay || e.start > now.toISOString() ? e.start : now.toISOString(), now)
    const last = days[days.length - 1]
    if (last && last[0] === label) last[1].push(e)
    else days.push([label, [e]])
  }
  return (
    <div className="events">
      {days.map(([label, list]) => (
        <section key={label}>
          <h3 className="day">{label}</h3>
          <ol>
            {list.map((e) => {
              const live = !e.allDay && meetingPhase(e, now).phase === 'now'
              return (
                <li key={`${e.accountId}:${e.id}`} className={live ? 'live-event' : ''}>
                  <span className="event-time">{when(e)}</span>
                  <div className="event-body">
                    {e.webUrl ? (
                      <button className="article-link" onClick={() => void window.hub.openExternal(e.webUrl!)}>
                        {e.title}
                      </button>
                    ) : (
                      <span>{e.title}</span>
                    )}
                    {e.location && <span className="muted small">{e.location}</span>}
                    <AccountTag accounts={accounts} id={e.accountId} />
                  </div>
                  <JoinButton e={e} />
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

/** Shown in place of mail or events until an account is connected. */
export function ConnectPrompt({ what, onOpen }: { what: 'mail' | 'calendar'; onOpen: () => void }): React.JSX.Element {
  return (
    <p className="hint">
      {what === 'mail' ? 'Connect a mail account to see your inbox here.' : 'Connect a calendar to see your day here.'}{' '}
      <button className="link" onClick={onOpen}>
        Add an account <Icon name="arrow" />
      </button>
    </p>
  )
}

export function Problems({ problems }: { problems: string[] }): React.JSX.Element | null {
  if (problems.length === 0) return null
  return (
    <ul className="problems">
      {problems.map((p) => (
        <li key={p} className="error small">
          {p}
        </li>
      ))}
    </ul>
  )
}
