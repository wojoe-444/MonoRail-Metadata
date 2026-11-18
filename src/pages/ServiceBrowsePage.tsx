import { useState } from 'react'
import { Pencil, Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useQuery } from '@/hooks/useQuery'
import { href, navigate, useSearchParams } from '@/lib/router'
import { latestStatus, listIngestionPipelines, serviceCounts } from '@/features/admin/api'
import { ConnectionSummary } from '@/features/admin/ConnectionSummary'
import { describeSchedule, Fact, PipelineStateBadge, pipelineTypeLabel } from '@/features/admin/pipelines'
import { getEntity, listEntities, search } from '@/features/om/api'
import { displayName, entityHref, entityLabel, formatCount, plainTags, tierOf, timeAgo } from '@/features/om/entity'
import { DescriptionDialog } from '@/features/om/components/Editors'
import { EntityHeader } from '@/features/om/components/EntityHeader'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { OwnerList, TagChip, TierBadge } from '@/features/om/components/Labels'
import { Markdown } from '@/features/om/components/Markdown'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import type { Database, DatabaseSchema, DatabaseService, EntityBase, EntityReference, Table as TableEntity } from '@/features/om/types'
import { useEntity } from '@/features/om/useEntity'

type Level = 'databaseService' | 'database' | 'databaseSchema'
const LEVELS: Level[] = ['databaseService', 'database', 'databaseSchema']
const CHILD: Record<Level, 'database' | 'databaseSchema' | 'table'> = {
  databaseService: 'database',
  database: 'databaseSchema',
  databaseSchema: 'table',
}
const FIELDS = 'owners,tags,domains,followers'

type Browsable = (DatabaseService | Database | DatabaseSchema) & EntityBase

/** Walk a service: service → projects (OpenMetadata databases) → datasets (schemas) → tables. */
export function ServiceBrowsePage() {
  const params = useSearchParams()
  const type = (LEVELS as string[]).includes(params.get('type') ?? '') ? (params.get('type') as Level) : 'databaseService'
  const fqn = params.get('fqn')
  const { entity, query, save } = useEntity<Browsable>(type, fqn, (f) => getEntity<Browsable>(type, f, FIELDS))
  const [editing, setEditing] = useState(false)

  if (!fqn)
    return (
      <EmptyState
        title="Nothing selected"
        description="Pick a service to browse."
        action={<Button onClick={() => navigate('/services')}>All services</Button>}
      />
    )
  if (query.error && !entity) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!entity) return <LoadingState />

  const e = entity as Browsable & { service?: EntityReference; database?: EntityReference }
  const parents = [e.service, e.database].filter(Boolean) as EntityReference[]
  const childType = CHILD[type]

  return (
    <div className="flex flex-col gap-6">
      <EntityHeader
        entity={entity}
        entityType={type}
        parents={parents}
        badges={'serviceType' in entity && entity.serviceType ? <Badge variant="primary">{entity.serviceType}</Badge> : undefined}
        onSave={save}
        onFollowChange={query.refetch}
        fields={type === 'databaseService' ? ['owners', 'domains', 'tags'] : ['owners', 'tier', 'domains', 'tags']}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>About</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Markdown placeholder={`No description yet. Say what this ${entityLabel(type).toLowerCase()} holds and who should use it.`}>
              {entity.description}
            </Markdown>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Summary type={type} entity={e} />
          </CardContent>
        </Card>
      </div>

      {type === 'databaseService' && (
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <CardDescription>Secrets are never shown.</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <a href={href('/services')}>Manage services</a>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <ConnectionSummary
              serviceType={(entity as DatabaseService).serviceType}
              config={(entity as DatabaseService).connection?.config}
            />
            <ServicePipelines serviceFqn={fqn} />
          </CardContent>
        </Card>
      )}

      <Children parentType={type} parentFqn={fqn} childType={childType} />

      <DescriptionDialog
        open={editing}
        onOpenChange={setEditing}
        title={`Description of ${displayName(entity)}`}
        value={entity.description}
        onSave={(description) => save({ ...entity, description })}
      />
    </div>
  )
}

/** Figures for the current level: how much sits under it. */
function Summary({ type, entity }: { type: Level; entity: Browsable }) {
  const fqn = entity.fullyQualifiedName ?? entity.name
  const counts = useQuery(['search', 'browse-counts', type, fqn], async () => {
    if (type === 'databaseService') return serviceCounts(entity.name)
    if (type === 'database') {
      const [datasets, tables] = await Promise.all([
        listEntities('databaseSchema', { database: fqn, limit: 0, fields: undefined }).then((r) => r.paging.total),
        search({
          index: 'table',
          size: 0,
          queryFilter: {
            query: {
              bool: {
                should: [{ term: { 'database.fullyQualifiedName': fqn } }, { term: { 'database.fullyQualifiedName.keyword': fqn } }],
              },
            },
          },
        }).then((r) => r.hits.total.value),
      ])
      return { datasets, tables }
    }
    return { tables: await listEntities('table', { databaseSchema: fqn, limit: 0, fields: undefined }).then((r) => r.paging.total) }
  })
  const c = (counts.data ?? {}) as Partial<Record<'projects' | 'datasets' | 'tables', number>>
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {type === 'databaseService' && <Fact label="Projects">{formatCount(c.projects)}</Fact>}
      {type !== 'databaseSchema' && <Fact label="Datasets">{formatCount(c.datasets)}</Fact>}
      <Fact label="Tables">{formatCount(c.tables)}</Fact>
      <Fact label="Updated">{timeAgo(entity.updatedAt)}</Fact>
      <Fact label="Updated by">{entity.updatedBy ?? '–'}</Fact>
      <Fact label="Version" mono>
        {entity.version ?? '–'}
      </Fact>
    </div>
  )
}

function ServicePipelines({ serviceFqn }: { serviceFqn: string }) {
  const pipelines = useQuery(['ingestion', 'service', serviceFqn], () => listIngestionPipelines(serviceFqn))
  if (!pipelines.data?.data.length) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-muted-foreground">Ingestion</div>
      <div className="flex flex-wrap gap-2">
        {pipelines.data.data.map((p) => (
          <a
            key={p.id}
            href={entityHref('ingestionPipeline', p.fullyQualifiedName ?? p.name)}
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            title={describeSchedule(p.airflowConfig?.scheduleInterval)}
          >
            {pipelineTypeLabel(p.pipelineType)}
            <PipelineStateBadge state={latestStatus(p)?.pipelineState} />
          </a>
        ))}
      </div>
    </div>
  )
}

type Child = (Database | DatabaseSchema | TableEntity) & { tableType?: string; usageSummary?: TableEntity['usageSummary'] }

function Children({
  parentType,
  parentFqn,
  childType,
}: {
  parentType: Level
  parentFqn: string
  childType: 'database' | 'databaseSchema' | 'table'
}) {
  const [filter, setFilter] = useState('')
  const param = parentType === 'databaseService' ? 'service' : parentType
  const fields = childType === 'table' ? 'owners,tags,usageSummary' : 'owners,tags'
  const children = useQuery(['browse', childType, parentFqn], () =>
    listEntities<Child>(childType, { [param]: parentFqn, fields, limit: 500 }),
  )
  const label = entityLabel(childType)
  const plural = label === 'Dataset' ? 'Datasets' : label === 'Project' ? 'Projects' : 'Tables'
  const f = filter.trim().toLowerCase()
  const rows = (children.data?.data ?? []).filter(
    (c) => !f || c.name.toLowerCase().includes(f) || (c.description ?? '').toLowerCase().includes(f),
  )
  const total = children.data?.paging.total ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>{plural}</CardTitle>
        <CardDescription>
          {children.data ? `${formatCount(total)} ${total === 1 ? label.toLowerCase() : plural.toLowerCase()}` : ' '}
        </CardDescription>
        <CardAction>
          <div className="relative w-56 max-w-full">
            <Label htmlFor="browse-filter" className="sr-only">
              Filter {plural.toLowerCase()}
            </Label>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="browse-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="h-8 pl-8"
            />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {children.error && !children.data ? (
          <ErrorState error={children.error} onRetry={children.refetch} />
        ) : !children.data ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState
            title={f ? 'Nothing matches the filter' : `No ${plural.toLowerCase()} yet`}
            description={f ? undefined : 'Run the metadata ingestion to load them.'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead>
                <TableHead>Owners</TableHead>
                {childType === 'table' && <TableHead className="hidden sm:table-cell">Labels</TableHead>}
                {childType === 'table' && <TableHead className="text-right">Queries / wk</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => {
                const cfqn = c.fullyQualifiedName ?? c.name
                const tier = tierOf(c.tags)
                return (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-[16rem]">
                      <a href={entityHref(childType, cfqn)} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                        <EntityIcon type={childType} tableType={c.tableType} bare />
                        <span className="truncate">{displayName(c)}</span>
                      </a>
                    </TableCell>
                    <TableCell className="hidden max-w-md truncate text-muted-foreground md:table-cell" title={c.description}>
                      {c.description?.split('\n')[0] || '–'}
                    </TableCell>
                    <TableCell>
                      <OwnerList owners={c.owners} compact empty="–" />
                    </TableCell>
                    {childType === 'table' && (
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex items-center gap-1">
                          <TierBadge tier={tier} />
                          {c.tableType && c.tableType !== 'Regular' && (
                            <Badge variant="outline">{c.tableType.replace(/([A-Z])/g, ' $1').trim()}</Badge>
                          )}
                          {plainTags(c.tags)
                            .slice(0, 2)
                            .map((t) => (
                              <TagChip key={t.tagFQN} tag={t} />
                            ))}
                        </div>
                      </TableCell>
                    )}
                    {childType === 'table' && (
                      <TableCell className="text-right tabular-nums">{formatCount(c.usageSummary?.weeklyStats?.count)}</TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {children.data && total > children.data.data.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the first {children.data.data.length} of {formatCount(total)}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
