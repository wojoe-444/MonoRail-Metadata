import { useCallback } from 'react'

import { invalidate, setQueryData, useQuery } from '@/hooks/useQuery'

import { getCurrentUser, getEntity, patchEntity } from './api'
import { diffPatch } from './entity'
import type { EntityBase } from './types'

/**
 * Load one entity by FQN and edit it.
 *
 *   const { entity, query, save } = useEntity<Table>('table', fqn, getTable)
 *   await save({ ...entity, description: 'New text' })
 *
 * `save` diffs the new object against the loaded one, sends the JSON Patch,
 * and puts the server's answer back in the cache. It also invalidates searches,
 * so lists show the change.
 */
export function useEntity<T extends EntityBase>(entityType: string, fqn: string | null, load?: (fqn: string) => Promise<T>) {
  const key = fqn ? (['entity', entityType, fqn] as const) : null
  const query = useQuery<T>(key, () => (load ? load(fqn!) : getEntity<T>(entityType, fqn!)))
  const entity = query.data

  const save = useCallback(
    async (next: T) => {
      if (!entity || !key) return
      const ops = diffPatch(entity, next)
      if (!ops.length) return entity
      const updated = await patchEntity<T>(entityType, entity.id, ops)
      // PATCH answers carry only the fields the server was asked for on update, so keep what we had.
      setQueryData(key, { ...entity, ...updated })
      invalidate('search')
      return updated
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entity, entityType, fqn],
  )

  return { entity, query, save }
}

/** The OpenMetadata user the server acts as. */
export function useCurrentUser() {
  return useQuery(['current-user'], getCurrentUser, { staleMs: 10 * 60_000 }).data
}
