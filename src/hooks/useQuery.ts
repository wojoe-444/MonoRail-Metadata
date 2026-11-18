import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * A small data-fetching hook with a shared cache, so moving between pages
 * shows the last answer at once and refreshes it in the background.
 *
 *   const { data, error, loading, refetch } = useQuery(['table', fqn], () => getTable(fqn))
 *
 * `key` identifies the request; pass `null` to skip (e.g. while an id is missing).
 * After a write, call `invalidate('table')` to refetch every query whose key
 * starts with that part, or `refetch()` for this one.
 */

type Key = readonly unknown[]

interface Entry {
  data?: unknown
  error?: unknown
  promise?: Promise<unknown>
  at: number
}

const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()
let version = 0

function emit() {
  version++
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

const hash = (key: Key) => JSON.stringify(key)

/** Refetch every active query whose key starts with these parts. */
export function invalidate(...prefix: unknown[]) {
  const p = JSON.stringify(prefix).slice(0, -1)
  for (const [k, e] of cache) if (k.startsWith(p)) e.at = 0
  emit()
}

/** Put a known answer in the cache, e.g. the entity a PATCH returned. */
export function setQueryData<T>(key: Key, data: T) {
  cache.set(hash(key), { data, at: Date.now() })
  emit()
}

export interface QueryState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  refetch: () => void
}

export function useQuery<T>(key: Key | null, fn: () => Promise<T>, { staleMs = 30_000 }: { staleMs?: number } = {}): QueryState<T> {
  const k = key ? hash(key) : null
  useSyncExternalStore(subscribe, () => version)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const [, force] = useState(0)

  const load = useCallback(
    (forced: boolean) => {
      if (!k) return
      const e = cache.get(k)
      if (!forced && e && (e.promise || Date.now() - e.at < staleMs)) return
      const entry: Entry = { ...(e ?? {}), at: e?.at ?? 0 }
      const p = fnRef
        .current()
        .then((data) => {
          cache.set(k, { data, at: Date.now() })
        })
        .catch((error: unknown) => {
          cache.set(k, { data: entry.data, error, at: Date.now() })
        })
        .finally(() => emit())
      entry.promise = p
      cache.set(k, entry)
      force((n) => n + 1)
    },
    [k, staleMs],
  )

  const entry = k ? cache.get(k) : undefined
  useEffect(() => {
    load(false)
  })

  return {
    data: entry?.data as T | undefined,
    error: entry?.error instanceof Error ? entry.error : entry?.error ? new Error(String(entry.error)) : undefined,
    loading: Boolean(k) && (!entry || (Boolean(entry.promise) && entry.data === undefined)),
    refetch: () => load(true),
  }
}
