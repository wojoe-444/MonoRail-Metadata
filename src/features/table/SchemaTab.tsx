import { Fragment, useState } from 'react'
import { ChevronRight, Key, Pencil, Search, Tag } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table as T, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatPercent } from '@/features/om/entity'
import { DescriptionDialog, TagPickerDialog } from '@/features/om/components/Editors'
import { Markdown } from '@/features/om/components/Markdown'
import { TagList } from '@/features/om/components/Labels'
import { EmptyState } from '@/features/om/components/States'
import type { Column, ColumnProfile, Table, TagLabel } from '@/features/om/types'
import { cn } from '@/lib/utils'

/**
 * Columns with types, descriptions, tags and the latest profile. Descriptions
 * and tags are editable per column; edits go through `onSave` with the whole table.
 */
export function SchemaTab({
  table,
  profiles,
  onSave,
}: {
  table: Table
  profiles?: Record<string, ColumnProfile | undefined>
  onSave?: (next: Table) => Promise<unknown>
}) {
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ path: number[]; what: 'description' | 'tags' } | null>(null)
  const f = filter.trim().toLowerCase()

  const matches = (c: Column): boolean =>
    !f ||
    c.name.toLowerCase().includes(f) ||
    (c.description ?? '').toLowerCase().includes(f) ||
    (c.tags ?? []).some((t) => t.tagFQN.toLowerCase().includes(f)) ||
    (c.children ?? []).some(matches)

  const at = (path: number[]): Column | undefined => {
    let cols = table.columns
    let c: Column | undefined
    for (const i of path) {
      c = cols[i]
      cols = c?.children ?? []
    }
    return c
  }

  const update = (path: number[], change: Partial<Column>) => {
    const next = structuredClone(table)
    let cols = next.columns
    let c: Column | undefined
    for (const i of path) {
      c = cols[i]
      cols = c?.children ?? []
    }
    if (c) Object.assign(c, change)
    return onSave?.(next)
  }

  const editingColumn = editing ? at(editing.path) : undefined
  const partitionCols = new Set(table.tablePartition?.columns?.map((c) => c.columnName))
  const clusterCols = new Set(table.tableConstraints?.filter((c) => c.constraintType === 'CLUSTER_KEY').flatMap((c) => c.columns))

  const rows = (cols: Column[], path: number[], depth: number): React.ReactNode =>
    cols.map((c, i) => {
      if (!matches(c)) return null
      const p = [...path, i]
      const key = c.fullyQualifiedName ?? p.join('.')
      const hasKids = Boolean(c.children?.length)
      const isOpen = open.has(key) || Boolean(f)
      const prof = profiles?.[c.name]
      return (
        <Fragment key={key}>
          <TableRow className="align-top">
            <TableCell className="py-3">
              <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
                {hasKids ? (
                  <button
                    type="button"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                    aria-expanded={isOpen}
                    onClick={() => setOpen((s) => toggle(s, key))}
                    className="rounded p-0.5 hover:bg-accent"
                  >
                    <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
                  </button>
                ) : (
                  <span className="w-4.5" />
                )}
                <span className="font-mono text-sm font-medium">{c.name}</span>
                {c.constraint === 'PRIMARY_KEY' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Key className="size-3.5 text-warning" aria-label="Primary key" />
                    </TooltipTrigger>
                    <TooltipContent>Primary key</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1" style={{ paddingLeft: depth * 16 + 22 }}>
                {partitionCols.has(c.name) && <Badge variant="info">Partition</Badge>}
                {clusterCols.has(c.name) && <Badge variant="secondary">Cluster</Badge>}
              </div>
            </TableCell>
            <TableCell className="py-3">
              <span className="font-mono text-xs text-muted-foreground">{c.dataTypeDisplay ?? c.dataType}</span>
            </TableCell>
            <TableCell className="max-w-md py-3 whitespace-normal">
              <div className="group flex items-start gap-1">
                <Markdown className="min-w-0 flex-1 text-sm" placeholder="No description">
                  {c.description}
                </Markdown>
                {onSave && (
                  <EditButton
                    label={`Edit description of ${c.name}`}
                    onClick={() => setEditing({ path: p, what: 'description' })}
                    icon={<Pencil className="size-3" />}
                  />
                )}
              </div>
            </TableCell>
            <TableCell className="max-w-xs py-3 whitespace-normal">
              <div className="group flex items-start gap-1">
                <TagList tags={c.tags} empty="" className="min-w-0 flex-1" />
                {onSave && (
                  <EditButton
                    label={`Edit tags of ${c.name}`}
                    onClick={() => setEditing({ path: p, what: 'tags' })}
                    icon={<Tag className="size-3" />}
                  />
                )}
              </div>
            </TableCell>
            <TableCell className="py-3 text-right text-xs text-muted-foreground tabular-nums">
              {prof ? formatPercent(prof.nullProportion, prof.nullProportion && prof.nullProportion < 0.01 ? 1 : 0) : '–'}
            </TableCell>
            <TableCell className="py-3 text-right text-xs text-muted-foreground tabular-nums">
              {prof ? formatPercent(prof.distinctProportion, 0) : '–'}
            </TableCell>
          </TableRow>
          {hasKids && isOpen && rows(c.children!, p, depth + 1)}
        </Fragment>
      )
    })

  if (!table.columns.length)
    return <EmptyState title="No columns" description="Run the metadata ingestion for this service to load the schema." />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Filter columns"
            placeholder="Filter columns, descriptions, tags…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{table.columns.length} columns</span>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <T>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Column</TableHead>
              <TableHead className="w-32">Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-64">Tags and terms</TableHead>
              <TableHead className="w-20 text-right">Null</TableHead>
              <TableHead className="w-20 text-right">Distinct</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows(table.columns, [], 0)}</TableBody>
        </T>
      </div>

      <DescriptionDialog
        open={editing?.what === 'description'}
        onOpenChange={(o) => !o && setEditing(null)}
        title={`Description of ${editingColumn?.name ?? ''}`}
        value={editingColumn?.description}
        onSave={async (description) => editing && update(editing.path, { description })}
      />
      <TagPickerDialog
        open={editing?.what === 'tags'}
        onOpenChange={(o) => !o && setEditing(null)}
        title={`Tags and terms on ${editingColumn?.name ?? ''}`}
        value={editingColumn?.tags ?? []}
        onSave={async (tags: TagLabel[]) => editing && update(editing.path, { tags })}
      />
    </div>
  )
}

function EditButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100"
    >
      {icon}
    </button>
  )
}

function toggle(s: Set<string>, k: string) {
  const n = new Set(s)
  if (n.has(k)) n.delete(k)
  else n.add(k)
  return n
}
