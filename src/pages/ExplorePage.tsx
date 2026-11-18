import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { useQuery } from '@/hooks/useQuery'
import { navigate, useSearchParams } from '@/lib/router'
import { FacetPanel, FACETS } from '@/features/explore/FacetPanel'
import { SearchResult } from '@/features/explore/SearchResult'
import { filterQuery, search } from '@/features/om/api'
import { formatCount } from '@/features/om/entity'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'

const SCOPES = [
  { value: 'dataAsset', label: 'Data assets' },
  { value: 'table', label: 'Tables' },
  { value: 'glossaryTerm', label: 'Terms' },
  { value: 'tag', label: 'Tags' },
  { value: 'all', label: 'Everything' },
] as const

type Scope = (typeof SCOPES)[number]['value']

const SORTS = [
  { value: '_score', label: 'Relevance' },
  { value: 'updatedAt', label: 'Last updated' },
  { value: 'usageSummary.weeklyStats.count', label: 'Most used' },
  { value: 'name.keyword', label: 'Name' },
]

const PAGE = 15

/** Search the whole catalog, with facets. All state is in the URL, so any view is a link. */
export function ExplorePage() {
  const params = useSearchParams()
  const q = params.get('q') ?? ''
  const scope = (params.get('scope') as Scope) || 'dataAsset'
  const sort = params.get('sort') ?? '_score'
  const page = Math.max(1, Number(params.get('page') ?? 1))
  const filters = Object.fromEntries(FACETS.map((f) => [f.field, params.getAll(f.param)]))

  const [draft, setDraft] = useState(q)
  useEffect(() => setDraft(q), [q])

  const update = (changes: Record<string, string | string[] | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      next.delete(k)
      if (Array.isArray(v)) v.forEach((x) => next.append(k, x))
      else if (v) next.set(k, v)
    }
    if (resetPage) next.delete('page')
    const s = next.toString()
    navigate(`/explore${s ? `?${s}` : ''}`)
  }

  const queryFilter = filterQuery(filters)
  const results = useQuery(['search', 'explore', q, scope, sort, page, filters], () =>
    search({
      q,
      index: scope,
      from: (page - 1) * PAGE,
      size: PAGE,
      queryFilter,
      sortField: sort === '_score' ? undefined : sort,
      sortOrder: sort === 'name.keyword' ? 'asc' : 'desc',
    }),
  )
  const total = results.data?.hits.total.value ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const active = FACETS.flatMap((f) => params.getAll(f.param).map((v) => ({ facet: f, value: v })))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Explore" description="Search tables, glossary terms and tags across the BigQuery catalog." />

      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault()
          update({ q: draft.trim() || undefined })
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Label htmlFor="explore-q" className="sr-only">
            Search
          </Label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="explore-q"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by name, column, description or tag…"
            className="h-10 pl-9"
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label="What to search"
          value={scope}
          onChange={(v) => update({ scope: v === 'dataAsset' ? undefined : v })}
          options={SCOPES.map((s) => ({ value: s.value, label: s.label }))}
        />
        <div className="flex items-center gap-2">
          <Label htmlFor="explore-sort" className="text-xs text-muted-foreground">
            Sort
          </Label>
          <NativeSelect
            id="explore-sort"
            value={sort}
            onChange={(e) => update({ sort: e.target.value === '_score' ? undefined : e.target.value })}
            className="w-40"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <FacetPanel q={q} scope={scope} filters={filters} onChange={(param, values) => update({ [param]: values })} />

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="tabular-nums">
              {results.data ? `${formatCount(total)} result${total === 1 ? '' : 's'}` : ' '}
              {q && results.data ? ` for “${q}”` : ''}
            </span>
            {active.map(({ facet, value }) => (
              <Button
                key={`${facet.param}:${value}`}
                variant="secondary"
                size="sm"
                className="h-7"
                onClick={() => update({ [facet.param]: params.getAll(facet.param).filter((v) => v !== value) })}
              >
                {facet.label}: {facet.format?.(value) ?? value}
                <X />
              </Button>
            ))}
            {active.length > 0 && (
              <Button
                variant="link"
                size="sm"
                className="h-7"
                onClick={() => update(Object.fromEntries(FACETS.map((f) => [f.param, undefined])))}
              >
                Clear filters
              </Button>
            )}
          </div>

          {results.error ? (
            <ErrorState error={results.error} onRetry={results.refetch} />
          ) : !results.data ? (
            <LoadingState />
          ) : total === 0 ? (
            <EmptyState title="Nothing matches" description="Try fewer words, another scope, or clear the filters." />
          ) : (
            <Card className="gap-0 py-0">
              <CardContent className="divide-y px-0">
                {results.data.hits.hits.map((h) => (
                  <SearchResult key={h._id} hit={h._source} />
                ))}
              </CardContent>
            </Card>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground tabular-nums">
                Page {page} of {pages}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) }, false)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next page"
                disabled={page >= pages}
                onClick={() => update({ page: String(page + 1) }, false)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
