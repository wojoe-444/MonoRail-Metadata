import { useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { search } from '@/features/om/api'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { OwnerList, TierBadge } from '@/features/om/components/Labels'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import { displayName, entityHref, entityLabel, formatCount } from '@/features/om/entity'
import type { SearchSource } from '@/features/om/types'
import { useQuery } from '@/hooks/useQuery'

const PAGE = 10

/**
 * Data assets matching an Elasticsearch filter (tag, term, domain, data
 * product), paged, with tier and owners. `onRemove` adds a remove button per row.
 */
export function AssetList({
  title = 'Assets',
  description,
  filter,
  action,
  onRemove,
  emptyTitle = 'No assets yet',
  emptyDescription,
}: {
  title?: string
  description?: ReactNode
  filter: object
  action?: ReactNode
  onRemove?: (asset: SearchSource) => Promise<unknown>
  emptyTitle?: string
  emptyDescription?: ReactNode
}) {
  const [page, setPage] = useState(0)
  const key = JSON.stringify(filter)
  useEffect(() => setPage(0), [key])
  const q = useQuery(['search', 'governance-assets', key, page], () =>
    search({ index: 'dataAsset', queryFilter: filter, from: page * PAGE, size: PAGE, sortField: 'name.keyword', sortOrder: 'asc' }),
  )
  const total = q.data?.hits.total.value ?? 0
  const hits = q.data?.hits.hits.map((h) => h._source) ?? []
  const [removing, setRemoving] = useState<string>()
  const [error, setError] = useState<string>()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description ?? (q.data ? `${formatCount(total)} ${total === 1 ? 'asset' : 'assets'}` : ' ')}</CardDescription>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {q.error && !q.data ? (
          <ErrorState error={q.error} onRetry={q.refetch} />
        ) : !q.data ? (
          <LoadingState />
        ) : !hits.length ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <>
            <div className="-mx-2 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="hidden md:table-cell">Owners</TableHead>
                    {onRemove && (
                      <TableHead className="w-10">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hits.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="max-w-0 min-w-48">
                        <a
                          href={entityHref(a.entityType, a.fullyQualifiedName ?? a.name)}
                          className="flex min-w-0 items-center gap-2 hover:underline"
                        >
                          <EntityIcon type={a.entityType} tableType={a.tableType} bare />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{displayName(a)}</span>
                            <span className="block truncate font-mono text-xs text-muted-foreground">{a.fullyQualifiedName}</span>
                          </span>
                        </a>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{entityLabel(a.entityType)}</TableCell>
                      <TableCell>{a.tier ? <TierBadge tier={a.tier} /> : <span className="text-muted-foreground">–</span>}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <OwnerList owners={a.owners} empty="–" compact />
                      </TableCell>
                      {onRemove && (
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label={`Remove ${displayName(a)}`}
                                disabled={removing === a.id}
                                onClick={async () => {
                                  setRemoving(a.id)
                                  setError(undefined)
                                  try {
                                    await onRemove(a)
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : String(e))
                                  } finally {
                                    setRemoving(undefined)
                                  }
                                }}
                              >
                                <X className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Remove</TooltipContent>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {total > PAGE && (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {formatCount(total)}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="Previous page"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="Next page"
                    disabled={(page + 1) * PAGE >= total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** A query_filter is {query: clause}; inside a bool it must be the bare clause. */
const unwrap = (f: object): object => ('query' in f ? (f as { query: object }).query : f)

/** Search tables and pick several to add (to a data product). `exclude` filters out what's already there. */
export function AddAssetsDialog({
  open,
  onOpenChange,
  title,
  exclude,
  onAdd,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  exclude?: object
  onAdd: (assets: { id: string; type: string }[]) => Promise<unknown>
}) {
  const id = useId()
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [selected, setSelected] = useState<Map<string, SearchSource>>(new Map())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) {
      setQ('')
      setDq('')
      setSelected(new Map())
      setError(undefined)
    }
  }, [open])
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 200)
    return () => clearTimeout(t)
  }, [q])
  const results = useQuery(open ? ['search', 'add-assets', dq, JSON.stringify(exclude ?? null)] : null, () =>
    search({ q: dq, index: 'table', size: 25, queryFilter: exclude ? { query: { bool: { must_not: [unwrap(exclude)] } } } : undefined }),
  )
  const hits = results.data?.hits.hits.map((h) => h._source) ?? []
  const toggle = (a: SearchSource) =>
    setSelected((s) => {
      const next = new Map(s)
      if (next.has(a.id)) next.delete(a.id)
      else next.set(a.id, a)
      return next
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Search tables and pick the ones to add.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Label htmlFor={`${id}-q`} className="sr-only">
            Search tables
          </Label>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id={`${id}-q`} placeholder="Search tables…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" autoFocus />
        </div>
        <div className="-mx-2 flex max-h-80 flex-col gap-0.5 overflow-y-auto px-2">
          {results.error && !results.data ? (
            <ErrorState error={results.error} onRetry={results.refetch} />
          ) : !results.data ? (
            <LoadingState />
          ) : !hits.length ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No tables match.</p>
          ) : (
            hits.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-accent hover:text-accent-foreground"
              >
                <Checkbox
                  checked={selected.has(a.id)}
                  onCheckedChange={() => toggle(a)}
                  className="mt-0.5"
                  aria-label={`Select ${displayName(a)}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{displayName(a)}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{a.fullyQualifiedName}</span>
                </span>
                {a.tier && <TierBadge tier={a.tier} />}
              </label>
            ))
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={!selected.size || saving}
              onClick={async () => {
                setSaving(true)
                setError(undefined)
                try {
                  await onAdd([...selected.values()].map((a) => ({ id: a.id, type: a.entityType })))
                  onOpenChange(false)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setSaving(false)
                }
              }}
            >
              {saving ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
