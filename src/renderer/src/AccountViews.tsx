import { ArticleSkeleton } from './ArticleList'
import { ConnectPrompt, EventList, NextMeeting, Problems, useNow } from './Inbox'
import { useAccounts, useEvents } from './useAccounts'

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
