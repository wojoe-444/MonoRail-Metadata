import { StatTile } from '@/components/charts/StatTile'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getHealth, search } from '@/features/om/api'
import { displayName, entityLabel, formatCount, openMetadataPath, timeAgo } from '@/features/om/entity'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { EmptyState, Loaded } from '@/features/om/components/States'
import { useQuery } from '@/hooks/useQuery'
import { href } from '@/lib/router'
import { cn } from '@/lib/utils'

import { useCount } from './api'
import { GROUPS, TYPES, typeInfo, type TypeGroup, type TypeInfo } from './catalog'
import { CountText } from './TypeNav'

/** The landing view: how much of each kind there is, the server behind it, and what changed lately. */
export function Overview() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TotalTile label="Entities" types={TYPES} hero />
        {GROUPS.filter((g) => ['assets', 'services', 'governance'].includes(g.id)).map((g) => (
          <TotalTile key={g.id} label={g.label} types={g.types} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ServerCard />
        <RecentCard className="xl:col-span-2" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {GROUPS.map((g) => (
          <GroupCard key={g.id} group={g} />
        ))}
      </div>
    </div>
  )
}

/** Sum of the counts of some types. `types` is a fixed list, so the hooks run in the same order every time. */
function useTotal(types: TypeInfo[]) {
  const counts = types.map((t) => useCount(t.type)) // eslint-disable-line react-hooks/rules-of-hooks
  const loaded = counts.filter((c) => c.data !== undefined || c.error)
  return {
    total: counts.reduce((n, c) => n + (c.data ?? 0), 0),
    done: loaded.length === counts.length,
    nonEmpty: counts.filter((c) => (c.data ?? 0) > 0).length,
  }
}

function TotalTile({ label, types, hero }: { label: string; types: TypeInfo[]; hero?: boolean }) {
  const { total, done, nonEmpty } = useTotal(types)
  return (
    <StatTile
      label={label}
      value={done || total ? formatCount(total) : '…'}
      hint={done ? `${nonEmpty} of ${types.length} types in use` : 'Counting…'}
      hero={hero}
    />
  )
}

const MODE_LABEL = { demo: 'Demo catalog', openmetadata: 'OpenMetadata', team: 'Team backend' } as const

function ServerCard() {
  const health = useQuery(['health'], getHealth)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Server</CardTitle>
        <CardDescription>Where these entities come from.</CardDescription>
      </CardHeader>
      <CardContent>
        <Loaded query={health}>
          {(h) => {
            const version = h.openmetadata.version ?? h.team?.worker.omVersion
            const ok = h.mode === 'team' ? Boolean(h.team?.worker.online) : h.openmetadata.ok
            const facts: [string, string][] = [
              ['Backend', MODE_LABEL[h.mode]],
              ['OpenMetadata', h.mode === 'demo' ? 'In-process demo (2.0.8 shapes)' : (h.openmetadata.url ?? 'Through the worker')],
              ['Version', version ?? '–'],
            ]
            return (
              <div className="flex flex-col gap-3">
                <div>
                  {ok ? (
                    <Badge variant="success">Reachable</Badge>
                  ) : (
                    <Badge variant="warning">{h.mode === 'team' ? 'Worker offline' : 'Unreachable'}</Badge>
                  )}
                </div>
                <dl className="flex flex-col gap-2">
                  {facts.map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="truncate text-sm" title={v}>
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
                {h.openmetadata.error && <p className="text-xs text-muted-foreground">{h.openmetadata.error}</p>}
              </div>
            )
          }}
        </Loaded>
      </CardContent>
    </Card>
  )
}

function RecentCard({ className }: { className?: string }) {
  // `all` also holds columns (tableColumn), which aren't entities of their own: keep the types this page opens.
  const recent = useQuery(['search', 'openmetadata', 'recent'], async () => {
    const res = await search({ index: 'all', size: 30, sortField: 'updatedAt', sortOrder: 'desc' })
    return { ...res, hits: { ...res.hits, hits: res.hits.hits.filter((h) => typeInfo(h._source.entityType)).slice(0, 8) } }
  })
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Recently changed</CardTitle>
        <CardDescription>The latest edits across every searchable type.</CardDescription>
      </CardHeader>
      <CardContent>
        <Loaded query={recent}>
          {(res) =>
            res.hits.hits.length === 0 ? (
              <EmptyState title="Nothing yet" description="Entities show here as they're created or changed." />
            ) : (
              <ul className="flex flex-col divide-y">
                {res.hits.hits.map(({ _source: e }) => (
                  <li key={e.id} className="flex min-w-0 items-center gap-3 py-2">
                    <EntityIcon type={e.entityType} className="size-7" />
                    <div className="min-w-0 flex-1">
                      <a
                        href={href(openMetadataPath(e.entityType, e.fullyQualifiedName ?? e.name))}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {displayName(e)}
                      </a>
                      <div className="truncate text-xs text-muted-foreground">
                        {entityLabel(e.entityType)} · <span className="font-mono">{e.fullyQualifiedName}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>{timeAgo(e.updatedAt)}</div>
                      {e.updatedBy && <div className="truncate">{e.updatedBy}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        </Loaded>
      </CardContent>
    </Card>
  )
}

function GroupCard({ group }: { group: TypeGroup }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{group.label}</CardTitle>
        <CardDescription>{group.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {group.types.map((t) => (
            <GroupItem key={t.type} info={t} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function GroupItem({ info }: { info: TypeInfo }) {
  const count = useCount(info.type)
  const empty = count.data === 0 || Boolean(count.error)
  return (
    <li>
      <a
        href={href(openMetadataPath(info.type))}
        title={count.error ? `Not available: ${count.error.message}` : info.description}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
          empty && 'text-muted-foreground',
        )}
      >
        <EntityIcon type={info.type} bare />
        <span className="min-w-0 flex-1 truncate">{info.plural}</span>
        <CountText count={count} />
      </a>
    </li>
  )
}
