import { normalizeSettings, type Settings } from './settings'

/** Settings that follow the user between devices. Everything else stays on each device. */
export const SYNCED_KEYS = ['displayName', 'theme', 'topics', 'onlyMyTopics', 'newsLanguages', 'newsServerUrl', 'customSources', 'dashboard', 'projectWeights', 'ticketRanking'] as const
export type SyncedKey = (typeof SYNCED_KEYS)[number]

/** When each setting last changed (ISO time). A missing stamp is older than any other. */
export type Stamps = Partial<Record<SyncedKey, string>>

/** The file shared through the sync folder. */
export interface SyncDoc {
  version: 1
  /** Which computer wrote it last, for the status line. */
  device: string
  writtenAt: string
  values: Partial<Pick<Settings, SyncedKey>>
  stamps: Stamps
}

/** Stamped as changed "at the beginning of time", so any real change on another device wins. */
const UNSTAMPED = '0'

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Stamps every synced setting that differs between `prev` and `next`. */
export function stampChanges(prev: Settings, next: Settings, stamps: Stamps, now: string): Stamps {
  const out = { ...stamps }
  for (const k of SYNCED_KEYS) if (!same(prev[k], next[k])) out[k] = now
  return out
}

/** The shareable copy: API keys never leave the device that holds them. */
export function toDoc(settings: Settings, stamps: Stamps, device: string, now: string): SyncDoc {
  const values: SyncDoc['values'] = {}
  const out: Stamps = {}
  for (const k of SYNCED_KEYS) {
    const v = settings[k]
    ;(values as Record<string, unknown>)[k] = k === 'customSources' ? settings.customSources.map(({ apiKey: _key, ...rest }) => rest) : v
    out[k] = stamps[k] ?? UNSTAMPED
  }
  return { version: 1, device, writtenAt: now, values, stamps: out }
}

/**
 * Takes each setting from whichever side changed it last. Sources keep this device's API
 * keys, matched by id, since the shared copy has none.
 */
export function mergeDoc(local: Settings, stamps: Stamps, raw: unknown): { settings: Settings; stamps: Stamps; changed: boolean } {
  const doc = raw as Partial<SyncDoc> | null
  if (!doc || doc.version !== 1 || typeof doc.values !== 'object' || !doc.values) return { settings: local, stamps, changed: false }
  // Validate the other device's values the same way as a settings file.
  const theirs = normalizeSettings({ ...local, ...doc.values })
  const merged: Settings = { ...local }
  const outStamps: Stamps = { ...stamps }
  let changed = false
  for (const k of SYNCED_KEYS) {
    const remote = typeof doc.stamps?.[k] === 'string' ? doc.stamps[k]! : ''
    if (!(k in doc.values) || remote <= (stamps[k] ?? '')) continue
    outStamps[k] = remote
    let value: unknown = theirs[k]
    if (k === 'customSources') {
      const keys = new Map(local.customSources.filter((s) => s.apiKey).map((s) => [s.id, s]))
      value = theirs.customSources.map((s) => {
        const mine = keys.get(s.id)
        return mine ? { ...s, apiKey: mine.apiKey, apiKeyParam: mine.apiKeyParam } : s
      })
    }
    if (!same(merged[k], value)) {
      ;(merged as unknown as Record<string, unknown>)[k] = value
      changed = true
    }
  }
  return { settings: merged, stamps: outStamps, changed }
}
