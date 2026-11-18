import { useState } from 'react'
import { Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { displayName, entityPath, openMetadataPath, plainTags, timeAgo } from '@/features/om/entity'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { OwnerList, TagList } from '@/features/om/components/Labels'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import { useQuery } from '@/hooks/useQuery'
import { href } from '@/lib/router'

import { listOf, type AnyEntity } from './api'
import type { TypeInfo } from './catalog'

/** Every entity of one type, a page at a time, as OpenMetadata lists them. */
export function EntityList({ info }: { info: TypeInfo }) {
  const [deleted, setDeleted] = useState(false)
  return <ListBody key={`${info.type}|${deleted}`} info={info} deleted={deleted} onDeletedChange={setDeleted} />
}

function ListBody({ info, deleted, onDeletedChange }: { info: TypeInfo; deleted: boolean; onDeletedChange: (v: boolean) => void }) {
  const first = useQuery(['openmetadata', 'list', info.type, deleted], () => listOf(info.type, { deleted }))
  const [more, setMore] = useState<{ rows: AnyEntity[]; after?: string }>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<Error>()
  const [filter, setFilter] = useState('')

  const rows = [...(first.data?.data ?? []), ...(more?.rows ?? [])]
  const after = more ? more.after : first.data?.paging.after
  const total = first.data?.paging.total
  const f = filter.trim().toLowerCase()
  const shown = f ? rows.filter((e) => [e.name, e.displayName, e.fullyQualifiedName].some((s) => s?.toLowerCase().includes(f))) : rows
  const hasOwners = rows.some((e) => 'owners' in e)
  const hasTags = rows.some((e) => 'tags' in e)
  const dedicated = !entityPath(info.type, 'x').startsWith('/openmetadata')

  const loadMore = async () => {
    setLoadingMore(true)
    setMoreError(undefined)
    try {
      const page = await listOf(info.type, { deleted, after })
      setMore({ rows: [...(more?.rows ?? []), ...page.data], after: page.paging.after })
    } catch (e) {
      setMoreError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EntityIcon type={info.type} className="size-7" />
          {info.plural}
          {total !== undefined && (
            <Badge variant="secondary" className="tabular-nums">
              {total}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {info.description}
          {dedicated && ' This type also has its own page in the app, linked from each entity.'}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Switch id="om-deleted" checked={deleted} onCheckedChange={onDeletedChange} />
          <Label htmlFor="om-deleted" className="text-xs font-normal text-muted-foreground">
            Include deleted
          </Label>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length > 0 && (
          <div className="relative max-w-sm">
            <Label htmlFor="om-filter" className="sr-only">
              Filter {info.plural.toLowerCase()} by name
            </Label>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="om-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={after ? 'Filter the loaded rows by name' : 'Filter by name'}
              className="pl-8"
            />
          </div>
        )}
        {first.data === undefined ? (
          first.error ? (
            <ErrorState error={first.error} onRetry={first.refetch} />
          ) : (
            <LoadingState />
          )
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<EntityIcon type={info.type} bare className="size-5" />}
            title={`No ${info.plural.toLowerCase()}`}
            description={<>OpenMetadata has none of these yet. They arrive through ingestion, the API, or OpenMetadata&apos;s own tools.</>}
          />
        ) : shown.length === 0 ? (
          <EmptyState title="No matches" description={after ? 'Only loaded rows are filtered. Load more to look further.' : undefined} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                {hasOwners && <TableHead className="hidden md:table-cell">Owners</TableHead>}
                {hasTags && <TableHead className="hidden lg:table-cell">Tags</TableHead>}
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((e) => {
                const fqn = e.fullyQualifiedName ?? e.name
                return (
                  <TableRow key={e.id}>
                    <TableCell className="max-w-0 min-w-48">
                      <a href={href(openMetadataPath(info.type, fqn))} className="block truncate font-medium hover:underline">
                        {displayName(e)}
                      </a>
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-xs text-muted-foreground">{fqn}</span>
                        {e.deleted && <Badge variant="outline">Deleted</Badge>}
                      </div>
                    </TableCell>
                    {hasOwners && (
                      <TableCell className="hidden md:table-cell">
                        <OwnerList owners={e.owners} compact empty="–" />
                      </TableCell>
                    )}
                    {hasTags && (
                      <TableCell className="hidden max-w-64 lg:table-cell">
                        <TagList tags={plainTags(e.tags)} />
                      </TableCell>
                    )}
                    <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
                      <div>{timeAgo(e.updatedAt)}</div>
                      {e.updatedBy && <div>{e.updatedBy}</div>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {moreError && <ErrorState error={moreError} onRetry={loadMore} />}
        {after && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground tabular-nums">
              {rows.length} of {total ?? '?'} loaded
            </span>
            <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
