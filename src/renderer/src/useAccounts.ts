import { useCallback, useEffect, useState } from 'react'
import type { Account, CalendarEvent, MailMessage } from '@shared/accounts'
import type { AccountFeed } from '@shared/api'

const errorText = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Mail or events across accounts, refreshed every `everyMs` (the main process caches, so this is cheap). */
function useFeed<T>(load: () => Promise<AccountFeed<T>>, everyMs: number): { feed: AccountFeed<T> | null; error: string; reload: () => void } {
  const [feed, setFeed] = useState<AccountFeed<T> | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    load()
      .then((f) => {
        setFeed(f)
        setError('')
      })
      .catch((e: Error) => setError(errorText(e)))
  }, [])
  useEffect(() => {
    reload()
    const t = setInterval(reload, everyMs)
    return () => clearInterval(t)
  }, [reload, everyMs])
  return { feed, error, reload }
}

export const useMail = (): ReturnType<typeof useFeed<MailMessage>> => useFeed(() => window.hub.recentMail(), 2 * 60_000)
export const useEvents = (): ReturnType<typeof useFeed<CalendarEvent>> => useFeed(() => window.hub.upcomingEvents(), 5 * 60_000)

export function useAccounts(): { accounts: Account[] | null; refresh: () => void } {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const refresh = useCallback(() => void window.hub.accounts().then(setAccounts), [])
  useEffect(refresh, [refresh])
  return { accounts, refresh }
}

export { errorText }
