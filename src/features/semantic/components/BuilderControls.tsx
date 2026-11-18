import { useId, useState } from 'react'
import { Code, Plus, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { Problem } from '@/features/malloy/api'

import type { FieldRef } from '../model'
import { isTime } from '../model'
import { GRAINS, OPS_FOR, opNeedsValue, typeGroup, type Filter, type FilterOp, type Grain, type GroupBy } from '../query'
import { MetricKindBadge } from './Parts'

/** Fields grouped by the join they come from: the source first, then each join path. */
function byNode(fields: FieldRef[]) {
  const groups = new Map<string, FieldRef[]>()
  for (const f of fields) {
    const k = f.node.path.join('.')
    groups.set(k, [...(groups.get(k) ?? []), f])
  }
  return [...groups.entries()]
}

function FieldOptions({ fields, sourceName }: { fields: FieldRef[]; sourceName: string }) {
  return (
    <>
      {byNode(fields).map(([node, fs]) => (
        <optgroup key={node} label={node ? `${node} (join_${fs[0]!.node.edge})` : sourceName}>
          {fs.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
              {f.field.type && f.field.kind === 'dimension' ? `  · ${f.field.type}` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

export function MeasurePicker({
  measures,
  selected,
  onChange,
  sourceName,
}: {
  measures: FieldRef[]
  selected: string[]
  onChange: (next: string[]) => void
  sourceName: string
}) {
  const id = useId()
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = measures.filter(
    (m) => !needle || m.path.toLowerCase().includes(needle) || (m.field.description ?? '').toLowerCase().includes(needle),
  )
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          aria-label="Search measures"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${measures.length} measures`}
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1">
        {byNode(shown).map(([node, fs]) => (
          <fieldset key={node} className="flex flex-col gap-0.5">
            <legend className="mb-1 font-mono text-xs font-medium text-muted-foreground">
              {node ? `${node} · join_${fs[0]!.node.edge}` : sourceName}
            </legend>
            {fs.map((m) => {
              const inputId = `${id}-${m.path}`
              const checked = selected.includes(m.path)
              return (
                <div key={m.path} className="flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-accent" title={m.field.description}>
                  <Checkbox
                    id={inputId}
                    checked={checked}
                    onCheckedChange={(v) => onChange(v ? [...selected, m.path] : selected.filter((x) => x !== m.path))}
                    className="mt-0.5"
                  />
                  <label htmlFor={inputId} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <span className="truncate font-mono text-xs">{m.field.name}</span>
                    <span className="ml-auto shrink-0">
                      <MetricKindBadge kind={m.field.metricKind} />
                    </span>
                  </label>
                </div>
              )
            })}
          </fieldset>
        ))}
        {!shown.length && <p className="px-1.5 text-sm text-muted-foreground">No measure matches “{q}”.</p>}
      </div>
    </div>
  )
}

export function GroupByEditor({
  dims,
  value,
  onChange,
  sourceName,
}: {
  dims: FieldRef[]
  value: GroupBy[]
  onChange: (next: GroupBy[]) => void
  sourceName: string
}) {
  const byPath = new Map(dims.map((d) => [d.path, d]))
  const add = (path: string) => {
    if (!path) return
    onChange([...value, { field: path, grain: isTime(byPath.get(path)?.field) ? 'month' : undefined }])
  }
  return (
    <div className="flex flex-col gap-2">
      {value.map((g, i) => {
        const f = byPath.get(g.field)
        return (
          <div key={`${g.field}-${i}`} className="flex items-center gap-1.5">
            <NativeSelect
              aria-label={`Group by ${i + 1}`}
              value={g.field}
              onChange={(e) =>
                onChange(
                  value.map((x, j) =>
                    j === i
                      ? { field: e.target.value, grain: isTime(byPath.get(e.target.value)?.field) ? (x.grain ?? 'month') : undefined }
                      : x,
                  ),
                )
              }
              className="min-w-0 flex-1 font-mono text-xs"
            >
              {!f && <option value={g.field}>{g.field} (not in this source)</option>}
              <FieldOptions fields={dims} sourceName={sourceName} />
            </NativeSelect>
            {isTime(f?.field) && (
              <NativeSelect
                aria-label={`Time grain for ${g.field}`}
                value={g.grain ?? ''}
                onChange={(e) =>
                  onChange(value.map((x, j) => (j === i ? { ...x, grain: (e.target.value || undefined) as Grain | undefined } : x)))
                }
                className="w-28 text-xs"
              >
                <option value="">exact</option>
                {GRAINS.filter((gr) => f?.field.type === 'timestamp' || gr !== 'hour').map((gr) => (
                  <option key={gr} value={gr}>
                    {gr}
                  </option>
                ))}
              </NativeSelect>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={`Remove ${g.field}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </div>
        )
      })}
      <NativeSelect aria-label="Add a group-by" value="" onChange={(e) => add(e.target.value)} className="font-mono text-xs">
        <option value="">+ Group by a dimension</option>
        <FieldOptions fields={dims.filter((d) => !value.some((v) => v.field === d.path))} sourceName={sourceName} />
      </NativeSelect>
    </div>
  )
}

const PLACEHOLDER: Record<string, string> = {
  string: 'Value',
  number: '0',
  time: '2024-01-01',
  boolean: '',
  other: '',
}

export function FilterEditor({
  dims,
  value,
  onChange,
  sourceName,
}: {
  dims: FieldRef[]
  value: Filter[]
  onChange: (next: Filter[]) => void
  sourceName: string
}) {
  const byPath = new Map(dims.map((d) => [d.path, d]))
  const set = (i: number, patch: Partial<Filter>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const add = (path: string) => {
    if (!path) return
    const g = typeGroup(byPath.get(path)?.field.type)
    onChange([...value, { field: path, op: OPS_FOR[g][0]!.value, value: '' }])
  }
  return (
    <div className="flex flex-col gap-2">
      {value.map((f, i) => {
        if (f.op === 'malloy') {
          return (
            <div key={i} className="flex items-start gap-1.5">
              <Textarea
                aria-label={`Malloy filter ${i + 1}`}
                value={f.value}
                onChange={(e) => set(i, { value: e.target.value })}
                rows={2}
                placeholder="users.age > 30 and status != 'Cancelled'"
                className="min-h-0 flex-1 font-mono text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Remove filter"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
          )
        }
        const type = byPath.get(f.field)?.field.type
        const g = typeGroup(type)
        const ops = OPS_FOR[g]
        return (
          <div key={i} className="flex flex-col gap-1.5 rounded-lg border p-2">
            <div className="flex items-center gap-1.5">
              <NativeSelect
                aria-label={`Filter ${i + 1} field`}
                value={f.field}
                onChange={(e) => {
                  const ng = typeGroup(byPath.get(e.target.value)?.field.type)
                  set(i, { field: e.target.value, op: OPS_FOR[ng].some((o) => o.value === f.op) ? f.op : OPS_FOR[ng][0]!.value })
                }}
                className="min-w-0 flex-1 font-mono text-xs"
              >
                {!byPath.has(f.field) && <option value={f.field}>{f.field}</option>}
                <FieldOptions fields={dims} sourceName={sourceName} />
              </NativeSelect>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Remove filter"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <NativeSelect
                aria-label={`Filter ${i + 1} operator`}
                value={f.op}
                onChange={(e) => set(i, { op: e.target.value as FilterOp })}
                className="w-36 text-xs"
              >
                {ops.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
              {opNeedsValue(f.op) && (
                <Input
                  aria-label={`Filter ${i + 1} value`}
                  value={f.value}
                  onChange={(e) => set(i, { value: e.target.value })}
                  placeholder={f.op === 'in' ? 'a, b, c' : f.op === 'last_days' ? '30' : PLACEHOLDER[g]}
                  className={cn('h-8 min-w-0 flex-1 text-xs', g !== 'string' && 'font-mono')}
                  inputMode={g === 'number' || f.op === 'last_days' ? 'decimal' : undefined}
                />
              )}
            </div>
          </div>
        )
      })}
      <div className="flex items-center gap-1.5">
        <NativeSelect aria-label="Add a filter" value="" onChange={(e) => add(e.target.value)} className="min-w-0 flex-1 font-mono text-xs">
          <option value="">+ Filter on a dimension</option>
          <FieldOptions fields={dims} sourceName={sourceName} />
        </NativeSelect>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, { field: '', op: 'malloy', value: '' }])}
          title="Write a where: clause in Malloy"
        >
          <Code />
          Malloy
        </Button>
      </div>
    </div>
  )
}

export function SaveViewDialog({
  open,
  onOpenChange,
  source,
  model,
  suggested,
  body,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  source: string
  model: string
  suggested: string
  body: string
  onSave: (input: { name: string; description: string }) => Promise<{ ok: boolean; problems?: Problem[] }>
}) {
  const id = useId()
  const [name, setName] = useState(suggested)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (o) (setName(suggested), setError(undefined))
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Save as a view</DialogTitle>
          <DialogDescription>
            Adds <span className="font-mono">view: {name || '…'}</span> to <span className="font-mono">{source}</span> in{' '}
            <span className="font-mono">malloy/{model}</span>, so it shows in the catalog, the workbench and git. The builder state is kept
            as an annotation so you can edit it here again.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            setBusy(true)
            setError(undefined)
            try {
              const r = await onSave({ name: name.trim(), description: description.trim() })
              if (r.ok) onOpenChange(false)
              else setError(r.problems?.[0]?.message ?? 'The model did not compile with this view.')
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="font-mono"
              required
              autoFocus
              pattern="[A-Za-z_][A-Za-z0-9_]*"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-desc`}>Description</Label>
            <Textarea
              id={`${id}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What question does this answer?"
            />
          </div>
          <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{`view: ${name || '…'} is ${body}`}</pre>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              <Plus />
              {busy ? 'Saving…' : 'Save view'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
