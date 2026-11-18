import { collectionOf, enc, om } from '@/features/om/api'
import type { EntityBase, Paged } from '@/features/om/types'
import { useQuery } from '@/hooks/useQuery'
import { ApiError, qs } from '@/lib/api'

/**
 * Generic OpenMetadata calls for any entity type, on top of `om()`. OpenMetadata answers 400 when
 * a collection doesn't have a field that was asked for, so lists and reads ask for the useful
 * fields first and fall back to the defaults, remembering which collections refused.
 */

/** An entity of any type: the common fields, plus whatever its type has. */
export type AnyEntity = EntityBase & Record<string, unknown>

const refused = new Set<string>()

/** Try each field list in turn (widest first), then none. */
async function withFields<T>(key: string, options: string[], call: (fields: string | undefined) => Promise<T>): Promise<T> {
  for (const fields of options) {
    const k = `${key}|${fields}`
    if (refused.has(k)) continue
    try {
      return await call(fields)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 400)) throw e
      refused.add(k)
    }
  }
  return call(undefined)
}

const LIST_FIELDS = ['owners,tags', 'owners']

/** How many entities of a type there are (a one-row list, for its `paging.total`). */
export async function countOf(type: string): Promise<number> {
  const res = await om<Paged<unknown>>(`/${collectionOf(type)}${qs({ limit: 1 })}`)
  return res.paging?.total ?? res.data.length
}

export function listOf(type: string, { after, deleted, limit = 50 }: { after?: string; deleted?: boolean; limit?: number } = {}) {
  const path = collectionOf(type)
  return withFields(path, LIST_FIELDS, (fields) =>
    om<Paged<AnyEntity>>(`/${path}${qs({ limit, after, fields, include: deleted ? 'all' : undefined })}`),
  )
}

/** One entity by FQN (or name), with every field its type has. */
export function getOf(type: string, fqn: string) {
  const path = collectionOf(type)
  return withFields(path, ['*'], (fields) => om<AnyEntity>(`/${path}/name/${enc(fqn)}${qs({ fields })}`))
}

/** The count of one type, shared by the navigator and the overview. Undefined while loading. */
export function useCount(type: string) {
  return useQuery(['openmetadata', 'count', type], () => countOf(type), { staleMs: 5 * 60_000 })
}
