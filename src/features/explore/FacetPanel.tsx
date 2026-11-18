import { useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useQuery } from '@/hooks/useQuery'
import { aggregate, filterQuery } from '@/features/om/api'
import { entityLabel, formatCount } from '@/features/om/entity'

/** The search facets, in panel order. `field` is the OpenMetadata search keyword field; `param` its URL name. */
export const FACETS: { param: string; field: string; label: string; format?: (v: string) => string }[] = [
  { param: 'type', field: 'entityType', label: 'Type', format: entityLabel },
  { param: 'project', field: 'database.displayName.keyword', label: 'Project' },
  { param: 'dataset', field: 'databaseSchema.displayName.keyword', label: 'Dataset' },
  { param: 'owner', field: 'owners.displayName.keyword', label: 'Owner' },
  { param: 'domain', field: 'domains.displayName.keyword', label: 'Domain' },
  { param: 'tier', field: 'tier.tagFQN', label: 'Tier', format: (v) => v.replace('Tier.Tier', 'Tier ') },
  { param: 'tag', field: 'tags.tagFQN', label: 'Tag or term' },
  { param: 'service', field: 'service.displayName.keyword', label: 'Service' },
]

/**
 * Facet counts for the current search. Each facet's counts apply every other
 * active filter but not its own, so picking a value doesn't hide its siblings.
 */
export function FacetPanel({
  q,
  scope,
  filters,
  onChange,
}: {
  q: string
  scope: string
  filters: Record<string, string[]>
  onChange: (param: string, values: string[]) => void
}) {
  return (
    <Card className="h-fit gap-0 py-0">
      <CardContent className="flex flex-col divide-y px-0">
        {FACETS.map((f) => (
          <Facet key={f.param} facet={f} q={q} scope={scope} filters={filters} onChange={(v) => onChange(f.param, v)} />
        ))}
      </CardContent>
    </Card>
  )
}

function Facet({
  facet,
  q,
  scope,
  filters,
  onChange,
}: {
  facet: (typeof FACETS)[number]
  q: string
  scope: string
  filters: Record<string, string[]>
  onChange: (values: string[]) => void
}) {
  const [more, setMore] = useState(false)
  const others = { ...filters, [facet.field]: [] }
  const buckets = useQuery(['search', 'facet', facet.field, q, scope, others], () =>
    aggregate(facet.field, { q, index: scope, queryFilter: filterQuery(others) }, 50),
  )
  const selected = filters[facet.field] ?? []
  const all = buckets.data ?? []
  // Keep selected values visible even when the current search has none.
  const list = [...all, ...selected.filter((s) => !all.some((b) => b.key === s)).map((key) => ({ key, doc_count: 0 }))]
  if (!list.length) return null
  const shown = more ? list : list.slice(0, 6)
  return (
    <fieldset className="flex flex-col gap-2 px-4 py-3">
      <legend className="float-left mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{facet.label}</legend>
      <div className="clear-left flex flex-col gap-1.5">
        {shown.map((b) => {
          const id = `facet-${facet.param}-${b.key}`
          const on = selected.includes(b.key)
          return (
            <div key={b.key} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={on}
                onCheckedChange={(c) => onChange(c ? [...selected, b.key] : selected.filter((s) => s !== b.key))}
              />
              <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate text-sm font-normal">
                {facet.format?.(b.key) ?? b.key}
              </Label>
              <span className="text-xs text-muted-foreground tabular-nums">{formatCount(b.doc_count)}</span>
            </div>
          )
        })}
      </div>
      {list.length > 6 && (
        <button type="button" onClick={() => setMore(!more)} className="w-fit text-xs text-primary hover:underline">
          {more ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
    </fieldset>
  )
}
