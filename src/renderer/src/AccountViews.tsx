import { ArticleSkeleton } from './ArticleList'
import { ConnectPrompt, EventList, MailList, NextMeeting, Problems, useNow } from './Inbox'
import { useAccounts, useEvents, useMail } from './useAccounts'

export function MailView({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  const { accounts } = useAccounts()
  const { feed, error } = useMail()
  if (accounts && !accounts.some((a) => a.mail)) return <ConnectPrompt what="mail" onOpen={onAdd} />
  return (
    <section className="card enter">
      {error && <p className="error small">Couldn’t load mail: {error}</p>}
      {!feed && !error && <ArticleSkeleton rows={6} />}
      {feed && feed.items.length === 0 && <p className="muted">Your inbox is empty.</p>}
      {feed && <MailList mail={feed.items} accounts={accounts?.filter((a) => a.mail) ?? []} />}
      {feed && <Problems problems={feed.problems} />}
    </section>
  )
}

export function CalendarView({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  const { accounts } = useAccounts()
  const { feed, error } = useEvents()
  const now = useNow(15_000)
  if (accounts && !accounts.some((a) => a.calendar)) return <ConnectPrompt what="calendar" onOpen={onAdd} />
  const upcoming = (feed?.items ?? []).filter((e) => e.end > now.toISOString())
  const next = upcoming.find((e) => !e.allDay)
  const shown = (accounts ?? []).filter((a) => a.calendar)
  return (
    <section className="card enter">
      {error && <p className="error small">Couldn’t load your calendar: {error}</p>}
      {!feed && !error && <ArticleSkeleton rows={4} />}
      {feed && upcoming.length === 0 && <p className="muted">Nothing on your calendar for the next 7 days.</p>}
      {next && <NextMeeting e={next} now={now} accounts={shown} />}
      {upcoming.length > 1 && <EventList events={upcoming.filter((e) => e !== next)} accounts={shown} now={now} />}
      {feed && <Problems problems={feed.problems} />}
    </section>
  )
}
