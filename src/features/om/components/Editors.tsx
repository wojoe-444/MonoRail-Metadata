import { useEffect, useState } from 'react'
import { BookOpen, Check, Search, Tag as TagIcon, User, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { useQuery } from '@/hooks/useQuery'
import { cn } from '@/lib/utils'

import { search } from '../api'
import { displayName, newTagLabel } from '../entity'
import type { EntityReference, SearchSource, TagLabel } from '../types'
import { Markdown } from './Markdown'

/**
 * Edit dialogs shared by every entity page. Each returns the new value through
 * `onSave`; the page turns it into a JSON Patch (see `diffPatch`).
 */

export function DescriptionDialog({
  open,
  onOpenChange,
  title,
  value,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  value: string | undefined
  onSave: (v: string) => Promise<unknown>
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) {
      setDraft(value ?? '')
      setTab('write')
      setError(undefined)
    }
  }, [open, value])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Markdown is supported.</DialogDescription>
        </DialogHeader>
        <Segmented
          aria-label="Editor mode"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
        {tab === 'write' ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="description-editor" className="sr-only">
              Description
            </Label>
            <Textarea
              id="description-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              autoFocus
            />
          </div>
        ) : (
          <div className="min-h-48 rounded-lg border p-3">
            <Markdown>{draft}</Markdown>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await onSave(draft)
                onOpenChange(false)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

interface PickerProps<T> {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  value: T[]
  onSave: (v: T[]) => Promise<unknown>
}

/** Pick classification tags and/or glossary terms. `kind` limits it to one of the two. Tier and certification have their own pickers. */
export function TagPickerDialog({ kind = 'both', ...p }: PickerProps<TagLabel> & { kind?: 'both' | 'Classification' | 'Glossary' }) {
  const [source, setSource] = useState<'Classification' | 'Glossary'>(kind === 'Glossary' ? 'Glossary' : 'Classification')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [selected, setSelected] = useState<TagLabel[]>(p.value)
  useEffect(() => {
    if (p.open) {
      setSelected(p.value)
      setQ('')
    }
  }, [p.open, p.value])
  const index = source === 'Glossary' ? 'glossaryTerm' : 'tag'
  const results = useQuery(p.open ? ['tag-picker', index, dq] : null, () =>
    search<SearchSource>({
      q: dq,
      index,
      size: 30,
      queryFilter:
        index === 'tag'
          ? {
              query: {
                bool: { must_not: [{ prefix: { fullyQualifiedName: 'Tier.' } }, { prefix: { fullyQualifiedName: 'Certification.' } }] },
              },
            }
          : undefined,
    }),
  )
  const isOn = (fqn: string) => selected.some((t) => t.tagFQN === fqn)
  const toggle = (hit: SearchSource) => {
    const fqn = hit.fullyQualifiedName!
    setSelected((s) =>
      isOn(fqn)
        ? s.filter((t) => t.tagFQN !== fqn)
        : [...s, newTagLabel(fqn, source, { name: hit.name, displayName: hit.displayName, description: hit.description })],
    )
  }
  return (
    <PickerShell
      {...p}
      onSave={() => p.onSave(selected)}
      q={q}
      setQ={setQ}
      selectedCount={selected.length}
      toggleSource={
        kind === 'both' ? (
          <Segmented
            aria-label="Label type"
            value={source}
            onChange={setSource}
            options={[
              { value: 'Classification', label: 'Tags' },
              { value: 'Glossary', label: 'Glossary terms' },
            ]}
          />
        ) : null
      }
    >
      {(results.data?.hits.hits ?? []).map(({ _source: hit }) => (
        <PickerRow
          key={hit.id}
          on={isOn(hit.fullyQualifiedName!)}
          onClick={() => toggle(hit)}
          icon={source === 'Glossary' ? <BookOpen className="size-4" /> : <TagIcon className="size-4" />}
          title={source === 'Glossary' ? displayName(hit) : hit.fullyQualifiedName!}
          subtitle={source === 'Glossary' ? hit.fullyQualifiedName : hit.description}
        />
      ))}
      {results.data && !results.data.hits.hits.length && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</p>}
    </PickerShell>
  )
}

/** Pick owners: users and teams. */
export function OwnerPickerDialog(p: PickerProps<EntityReference>) {
  const [kind, setKind] = useState<'user' | 'team'>('user')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [selected, setSelected] = useState<EntityReference[]>(p.value)
  useEffect(() => {
    if (p.open) {
      setSelected(p.value)
      setQ('')
    }
  }, [p.open, p.value])
  const results = useQuery(p.open ? ['owner-picker', kind, dq] : null, () =>
    search<SearchSource & { isBot?: boolean; email?: string }>({ q: dq, index: kind, size: 30 }),
  )
  const isOn = (id: string) => selected.some((o) => o.id === id)
  return (
    <PickerShell
      {...p}
      onSave={() => p.onSave(selected)}
      q={q}
      setQ={setQ}
      selectedCount={selected.length}
      toggleSource={
        <Segmented
          aria-label="Owner type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'user', label: 'Users' },
            { value: 'team', label: 'Teams' },
          ]}
        />
      }
    >
      {(results.data?.hits.hits ?? [])
        .filter(({ _source }) => !_source.isBot)
        .map(({ _source: hit }) => (
          <PickerRow
            key={hit.id}
            on={isOn(hit.id)}
            onClick={() =>
              setSelected((s) =>
                isOn(hit.id)
                  ? s.filter((o) => o.id !== hit.id)
                  : [
                      ...s,
                      { id: hit.id, type: kind, name: hit.name, displayName: hit.displayName, fullyQualifiedName: hit.fullyQualifiedName },
                    ],
              )
            }
            icon={kind === 'team' ? <Users className="size-4" /> : <User className="size-4" />}
            title={displayName(hit)}
            subtitle={hit.email ?? hit.description}
          />
        ))}
    </PickerShell>
  )
}

/** Pick from a fixed list of tags in one classification (tier, certification): one or none. */
export function SingleTagDialog({
  open,
  onOpenChange,
  title,
  classification,
  value,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  classification: string
  value: TagLabel | undefined
  onSave: (t: TagLabel | undefined) => Promise<unknown>
}) {
  const [selected, setSelected] = useState<string | undefined>(value?.tagFQN)
  useEffect(() => {
    if (open) setSelected(value?.tagFQN)
  }, [open, value])
  const tags = useQuery(open ? ['single-tag', classification] : null, () =>
    search<SearchSource>({
      index: 'tag',
      size: 20,
      queryFilter: { query: { bool: { must: [{ prefix: { fullyQualifiedName: `${classification}.` } }] } } },
      sortField: 'name.keyword',
      sortOrder: 'asc',
    }),
  )
  const hits = (tags.data?.hits.hits ?? []).map((h) => h._source)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {hits.map((h) => (
            <PickerRow
              key={h.id}
              on={selected === h.fullyQualifiedName}
              onClick={() => setSelected(selected === h.fullyQualifiedName ? undefined : h.fullyQualifiedName)}
              title={displayName(h)}
              subtitle={h.description}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              const h = hits.find((x) => x.fullyQualifiedName === selected)
              await onSave(
                h
                  ? newTagLabel(h.fullyQualifiedName!, 'Classification', {
                      name: h.name,
                      displayName: h.displayName,
                      description: h.description,
                    })
                  : undefined,
              )
              onOpenChange(false)
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PickerShell({
  open,
  onOpenChange,
  title,
  description,
  onSave,
  q,
  setQ,
  selectedCount,
  toggleSource,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  onSave: () => Promise<unknown>
  q: string
  setQ: (s: string) => void
  selectedCount: number
  toggleSource: React.ReactNode
  children: React.ReactNode
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {toggleSource}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" autoFocus />
        </div>
        <div className="-mx-2 flex max-h-80 flex-col gap-0.5 overflow-y-auto px-2">{children}</div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                setError(undefined)
                try {
                  await onSave()
                  onOpenChange(false)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setSaving(false)
                }
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PickerRow({
  on,
  onClick,
  icon,
  title,
  subtitle,
}: {
  on: boolean
  onClick: () => void
  icon?: React.ReactNode
  title: string
  subtitle?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        on && 'bg-primary-soft hover:bg-primary-soft',
      )}
    >
      {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      <Check className={cn('mt-0.5 size-4 text-primary', !on && 'invisible')} aria-hidden />
    </button>
  )
}
