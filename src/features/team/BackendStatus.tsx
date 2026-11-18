import { useEffect } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { href } from '@/lib/router'
import { cn } from '@/lib/utils'
import { getHealth } from '@/features/om/api'
import { timeAgo } from '@/features/om/entity'

/**
 * Top-bar pill in team mode: whether the shared worker is alive. When it isn't,
 * browsing still works (from the replica) and changes wait in the queue.
 */
export function BackendStatus() {
  const health = useQuery(['health'], getHealth, { staleMs: 10_000 })
  const team = health.data?.team

  useEffect(() => {
    if (health.data?.mode !== 'team') return
    const t = setInterval(() => invalidate('health'), 15_000)
    return () => clearInterval(t)
  }, [health.data?.mode])

  if (!team) return null
  const online = team.worker.online
  const label = !team.replica.ready ? 'Loading catalog' : online ? 'Team backend' : 'Worker offline'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href('/settings')}
          className={cn(
            'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:flex',
            online && team.replica.ready
              ? 'text-muted-foreground hover:text-foreground'
              : 'border-warning/40 bg-warning-soft text-warning-soft-foreground',
          )}
        >
          <span className={cn('size-2 rounded-full', online && team.replica.ready ? 'bg-success' : 'bg-warning')} aria-hidden />
          {label}
        </a>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {online
          ? `Worker seen ${timeAgo(team.worker.lastSeen ?? undefined)}. Catalog at change ${team.replica.seq}.`
          : team.worker.lastSeen
            ? `No heartbeat since ${timeAgo(team.worker.lastSeen)}. You can browse; changes are queued until it's back.`
            : 'No worker has written a heartbeat to the bucket yet. Start it with npm run worker.'}
      </TooltipContent>
    </Tooltip>
  )
}
