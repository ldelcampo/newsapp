/** Jev, TypeSafe AI's decision model: one typed question set about one piece of text. */

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const JEV_SECRET = 'jev'

/** Asks Jev the questions about `state` and returns its raw answer. Errors are worded for people. */
export async function askJev(fetchFn: FetchFn, key: string, state: string, questions: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetchFn(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions }),
      signal: AbortSignal.timeout(20_000)
    })
  } catch (e) {
    throw new Error((e as Error).name === 'TimeoutError' ? 'TypeSafe AI did not answer in time.' : 'Could not reach TypeSafe AI.')
  }
  if (res.status === 401 || res.status === 403) throw new Error('TypeSafe AI refused the API key.')
  if (res.status === 402) throw new Error('TypeSafe AI says the account has no credit left.')
  if (res.status === 429) throw new Error('TypeSafe AI asked us to slow down.')
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`TypeSafe AI answered ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}.`)
  }
  return res.json()
}
