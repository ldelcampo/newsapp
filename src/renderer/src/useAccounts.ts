import { useCallback, useEffect, useState } from 'react'
import type { Account, CalendarEvent } from '@shared/accounts'
import type { MailResult } from '@shared/mail'
import type { AccountFeed } from '@shared/api'

const errorText = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Mail or events across accounts, refreshed every `everyMs` (the main process caches, so this is cheap). */
function useFeed<F>(load: (force: boolean) => Promise<F>, everyMs: number): { feed: F | null; error: string; loading: boolean; reload: (force?: boolean) => void } {
  const [feed, setFeed] = useState<F | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reload = useCallback((force = false) => {
    setLoading(true)
    load(force)
      .then((f) => {
        setFeed(f)
        setError('')
      })
      .catch((e: Error) => setError(errorText(e)))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    reload()
    const t = setInterval(() => reload(), everyMs)
    return () => clearInterval(t)
  }, [reload, everyMs])
  return { feed, error, loading, reload }
}

export const useMail = (): ReturnType<typeof useFeed<MailResult>> => useFeed((force) => window.hub.recentMail(force), 2 * 60_000)
export const useEvents = (): ReturnType<typeof useFeed<AccountFeed<CalendarEvent>>> => useFeed(() => window.hub.upcomingEvents(), 5 * 60_000)

export function useAccounts(): { accounts: Account[] | null; refresh: () => void } {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const refresh = useCallback(() => void window.hub.accounts().then(setAccounts), [])
  useEffect(refresh, [refresh])
  return { accounts, refresh }
}

export { errorText }
