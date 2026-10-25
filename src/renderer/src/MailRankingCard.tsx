import { useEffect, useState } from 'react'
import type { Settings } from '@shared/settings'
import { JevKeyField } from './JevKeyField'

/** How mail is ranked, and what the ranking has learned. Lives inside the Settings form. */
export function MailRankingCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const [learned, setLearned] = useState(0)
  useEffect(() => void window.hub.mailLearned().then(setLearned), [])
  return (
    <>
      <fieldset className="field">
        <legend>Mail priority</legend>
        <label className="radio">
          <input type="radio" name="mailRanking" checked={settings.mailRanking === 'local'} onChange={() => onChange({ mailRanking: 'local' })} />
          Built in: who it’s addressed to, newsletters, questions, Gmail’s markers and what you mark important. Nothing leaves this computer.
        </label>
        <label className="radio">
          <input type="radio" name="mailRanking" checked={settings.mailRanking === 'jev'} onChange={() => onChange({ mailRanking: 'jev' })} />
          Jev by TypeSafe AI: also judges urgency from each message. The sender, subject and preview of your top 30 unread or recent messages are sent to TypeSafe AI, once per message.
        </label>
      </fieldset>
      {settings.mailRanking === 'jev' && <JevKeyField />}
      <p className="muted small">
        {learned > 0 ? `The ranking has learned from your choices about ${learned} sender${learned === 1 ? '' : 's'}. ` : 'Mark messages Important or Not important in Mail and the ranking learns your senders. '}
        {learned > 0 && (
          <button type="button" className="link" onClick={() => void window.hub.resetMailFeedback().then(() => setLearned(0))}>
            Forget them
          </button>
        )}
      </p>
    </>
  )
}
