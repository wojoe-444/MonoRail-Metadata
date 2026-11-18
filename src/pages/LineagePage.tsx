import { useEffect, useState } from 'react'
import { Plus, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { navigate, useSearchParams } from '@/lib/router'
import { LineageGraph } from '@/features/lineage/LineageGraph'
import { addLineage, getLineage, getTable, search } from '@/features/om/api'
import { displayName } from '@/features/om/entity'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import type { SearchSource } from '@/features/om/types'
import { cn } from '@/lib/utils'

/** Full-screen lineage for one table, with depth controls and manual edges. */
export function LineagePage() {
  const params = useSearchParams()
  const fqn = params.get('fqn')
  const up = Number(params.get('up') ?? 3)
  const down = Number(params.get('down') ?? 3)
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) next.set(k, v)
    navigate(`/lineage?${next.toString()}`)
  }
  const table = useQuery(fqn ? ['entity', 'table', fqn] : null, () => getTable(fqn!))
  const lineage = useQuery(fqn ? ['lineage', 'table', fqn, up, down] : null, () => getLineage('table', fqn!, up, down))
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 lg:px-6">
        <TablePicker value={fqn} onPick={(f) => set({ fqn: f })} />
        {fqn && (
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor="lineage-up" className="text-xs text-muted-foreground">
                Upstream
              </Label>
              <NativeSelect id="lineage-up" value={String(up)} onChange={(e) => set({ up: e.target.value })} className="w-20">
                {[0, 1, 2, 3, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </NativeSelect>
              <Label htmlFor="lineage-down" className="text-xs text-muted-foreground">
                Downstream
              </Label>
              <NativeSelect id="lineage-down" value={String(down)} onChange={(e) => set({ down: e.target.value })} className="w-20">
                {[0, 1, 2, 3, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </NativeSelect>
            </div>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setAdding(true)}>
              <Plus />
              Add edge
            </Button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-muted/30">
        {!fqn ? (
          <div className="p-6">
            <EmptyState title="Pick a table" description="Search for a table above to see where its data comes from and where it goes." />
          </div>
        ) : lineage.error ? (
          <div className="p-6">
            <ErrorState error={lineage.error} onRetry={lineage.refetch} />
          </div>
        ) : !lineage.data || !table.data ? (
          <LoadingState />
        ) : (
          <LineageGraph data={lineage.data} rootId={table.data.id} />
        )}
      </div>
      {table.data && (
        <AddEdgeDialog open={adding} onOpenChange={setAdding} table={{ id: table.data.id, name: displayName(table.data), fqn: fqn! }} />
      )}
    </div>
  )
}

function useHits(q: string, enabled: boolean) {
  const [debounced, setDebounced] = useState(q)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200)
    return () => clearTimeout(t)
  }, [q])
  return useQuery(enabled ? ['search', 'table-picker', debounced] : null, () =>
    search<SearchSource>({ q: debounced, index: 'table', size: 8 }),
  )
}

/** A search box that picks a table. */
function TablePicker({
  value,
  onPick,
  id = 'lineage-table',
  label = 'Table',
}: {
  value?: string | null
  onPick: (fqn: string, hit: SearchSource) => void
  id?: string
  label?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const hits = useHits(q, open)
  return (
    <div className="relative w-full max-w-md">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id={id}
        value={open ? q : (value ?? '')}
        placeholder="Search tables…"
        className="pl-8 font-mono text-xs"
        onFocus={() => {
          setOpen(true)
          setQ('')
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        autoComplete="off"
      />
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 shadow-elevation-2"
        >
          {(hits.data?.hits.hits ?? []).map(({ _source: h }) => (
            <li key={h.id} role="option" aria-selected={h.fullyQualifiedName === value}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(h.fullyQualifiedName!, h)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent',
                  h.fullyQualifiedName === value && 'bg-primary-soft',
                )}
              >
                <EntityIcon type="table" tableType={h.tableType} bare />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{displayName(h)}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{h.fullyQualifiedName}</span>
                </span>
              </button>
            </li>
          ))}
          {hits.data && !hits.data.hits.hits.length && (
            <li className="px-2 py-3 text-center text-sm text-muted-foreground">No tables match.</li>
          )}
        </ul>
      )}
    </div>
  )
}

function AddEdgeDialog({
  open,
  onOpenChange,
  table,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  table: { id: string; name: string; fqn: string }
}) {
  const [direction, setDirection] = useState<'upstream' | 'downstream'>('upstream')
  const [other, setOther] = useState<SearchSource>()
  const [sql, setSql] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setOther(undefined)
      setSql('')
      setError(undefined)
    }
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a lineage edge</DialogTitle>
          <DialogDescription>For flows the ingestion can't see, like a scheduled export or a notebook.</DialogDescription>
        </DialogHeader>
        <Segmented
          aria-label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'upstream', label: `Feeds ${table.name}` },
            { value: 'downstream', label: `Fed by ${table.name}` },
          ]}
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="edge-other">{direction === 'upstream' ? 'Source table' : 'Target table'}</Label>
          <TablePicker id="edge-other" label="Other table" value={other?.fullyQualifiedName} onPick={(_, h) => setOther(h)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edge-sql">SQL or note (optional)</Label>
          <Textarea id="edge-sql" rows={4} value={sql} onChange={(e) => setSql(e.target.value)} className="font-mono text-xs" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!other || other.id === table.id || saving}
            onClick={async () => {
              if (!other) return
              setSaving(true)
              try {
                const me = { id: table.id, type: 'table' }
                const them = { id: other.id, type: 'table' }
                await addLineage(direction === 'upstream' ? them : me, direction === 'upstream' ? me : them, { sqlQuery: sql || undefined })
                invalidate('lineage')
                onOpenChange(false)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setSaving(false)
              }
            }}
          >
            Add edge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
