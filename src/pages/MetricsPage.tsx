import { useState } from 'react'
import { ArrowRight, CloudUpload, Search, Sigma, SlidersHorizontal } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { href, useSearchParams } from '@/lib/router'
import { cn } from '@/lib/utils'
import { getMetrics, metricEntityName, publishMetrics, type Metric, type MetricKind, type PublishResult } from '@/features/semantic/api'
import { CodeBlock, MetricKindBadge, Overline, TableLink, TermLink } from '@/features/semantic/components/Parts'
import { METRIC_KIND_HELP, sourceHref, workbenchHref } from '@/features/semantic/model'
import { toSearch } from '@/features/semantic/query'
import { EmptyState, Loaded } from '@/features/om/components/States'

type KindFilter = 'all' | MetricKind

/**
 * Every Malloy measure across every model, as a metric: searchable, with its
 * kind, definition, glossary term and the tables it reads. `?metric=` selects
 * one, either `source.measure` or the OpenMetadata name `source__measure`.
 */
export function MetricsPage() {
  const params = useSearchParams()
  const metrics = useQuery(['malloy', 'metrics'], getMetrics)
  const [q, setQ] = useState(params.get('q') ?? '')
  const [kind, setKind] = useState<KindFilter>('all')
  const [source, setSource] = useState('')
  const [publishing, setPublishing] = useState(false)
  const selectedKey = params.get('metric')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Metrics"
        description="Every measure in the semantic layer, defined once in Malloy. Search them, see how each is computed, and what it reads."
        actions={
          <Button variant="outline" onClick={() => setPublishing(true)}>
            <CloudUpload />
            Publish to catalog
          </Button>
        }
      />
      <Loaded query={metrics}>
        {(all) => {
          const needle = q.trim().toLowerCase()
          const shown = all.filter(
            (m) =>
              (kind === 'all' || m.metricKind === kind) &&
              (!source || `${m.model}:${m.source}` === source) &&
              (!needle ||
                [m.name, m.source, m.description, m.glossaryTerm, m.definition].some((x) => (x ?? '').toLowerCase().includes(needle))),
          )
          const sources = [...new Map(all.map((m) => [`${m.model}:${m.source}`, m])).values()]
          const selected =
            all.find((m) => `${m.source}.${m.name}` === selectedKey || metricEntityName(m.source, m.name) === selectedKey) ?? shown[0]
          const counts = (k: MetricKind) => all.filter((m) => m.metricKind === k).length
          return (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="relative w-full max-w-xs">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    aria-label="Search metrics"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Search ${all.length} metrics`}
                    className="pl-8"
                  />
                </div>
                <Segmented<KindFilter>
                  aria-label="Metric kind"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'simple', label: `Simple ${counts('simple')}`, title: METRIC_KIND_HELP.simple },
                    { value: 'filtered', label: `Filtered ${counts('filtered')}`, title: METRIC_KIND_HELP.filtered },
                    { value: 'ratio', label: `Ratio ${counts('ratio')}`, title: METRIC_KIND_HELP.ratio },
                    { value: 'derived', label: `Derived ${counts('derived')}`, title: METRIC_KIND_HELP.derived },
                  ]}
                />
                <div className="flex flex-col gap-1">
                  <Label htmlFor="metric-source" className="sr-only">
                    Source
                  </Label>
                  <NativeSelect id="metric-source" value={source} onChange={(e) => setSource(e.target.value)} className="w-48 font-mono">
                    <option value="">All sources</option>
                    {sources.map((m) => (
                      <option key={`${m.model}:${m.source}`} value={`${m.model}:${m.source}`}>
                        {m.source}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              {!shown.length ? (
                <EmptyState
                  icon={<Sigma className="size-5" />}
                  title={all.length ? 'No metric matches' : 'No measures yet'}
                  description={all.length ? undefined : 'Add measure: definitions to a Malloy source.'}
                />
              ) : (
                <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-5">
                  <Card className="xl:col-span-2">
                    <CardContent className="flex flex-col gap-0.5 px-2">
                      {shown.map((m) => {
                        const key = `${m.source}.${m.name}`
                        const active = selected && `${selected.source}.${selected.name}` === key
                        return (
                          <a
                            key={`${m.model}:${key}`}
                            href={href(`/metrics?metric=${encodeURIComponent(key)}`)}
                            className={cn(
                              'flex flex-col gap-1 rounded-md px-3 py-2 hover:bg-accent hover:text-accent-foreground',
                              active && 'bg-muted',
                            )}
                            aria-current={active ? 'true' : undefined}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-mono text-sm font-medium">{m.name}</span>
                              <span className="truncate font-mono text-xs text-muted-foreground">{m.source}</span>
                              <span className="ml-auto">
                                <MetricKindBadge kind={m.metricKind} />
                              </span>
                            </div>
                            {m.description && <span className="line-clamp-1 text-xs text-muted-foreground">{m.description}</span>}
                          </a>
                        )
                      })}
                    </CardContent>
                  </Card>
                  {selected && <MetricDetail metric={selected} all={all} className="xl:sticky xl:top-4 xl:col-span-3" />}
                </div>
              )}
            </>
          )
        }}
      </Loaded>
      <PublishDialog open={publishing} onOpenChange={setPublishing} />
    </div>
  )
}

function MetricDetail({ metric: m, all, className }: { metric: Metric; all: Metric[]; className?: string }) {
  const sameTerm = m.glossaryTerm ? all.filter((x) => x.glossaryTerm === m.glossaryTerm && x !== m) : []
  const usedBy = all.filter((x) => x.model === m.model && x.source === m.source && x.usesMeasures?.includes(m.name))
  const query = href(
    `/query?${toSearch({ model: m.model, source: m.source, measures: [m.name], groupBy: [], filters: [], compare: 'none' })}`,
  )
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="font-mono">{m.name}</CardTitle>
        <CardDescription>
          on{' '}
          <a href={sourceHref(m.model, m.source)} className="font-mono hover:underline">
            {m.source}
          </a>{' '}
          in <span className="font-mono">malloy/{m.model}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <MetricKindBadge kind={m.metricKind} aggregate={m.aggregate} />
          <TermLink fqn={m.glossaryTerm} />
        </div>
        {m.description && <p className="text-sm">{m.description}</p>}
        <div>
          <Overline>Definition</Overline>
          {m.definition ? (
            <CodeBlock code={m.definition} label="Copy definition" />
          ) : (
            <p className="text-sm text-muted-foreground">No definition text.</p>
          )}
          {m.metricKind && <p className="mt-2 text-xs text-muted-foreground">{METRIC_KIND_HELP[m.metricKind]}</p>}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Overline>Reads</Overline>
            <ul className="flex flex-col gap-1">
              {(m.tables ?? []).map((t) => (
                <li key={t.path}>
                  <TableLink path={t.path} fqn={t.fqn} />
                </li>
              ))}
              {!m.tables?.length && <li className="text-sm text-muted-foreground">No tables</li>}
            </ul>
          </div>
          <div>
            <Overline>Built from</Overline>
            {m.usesMeasures?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {m.usesMeasures.map((u) => (
                  <a key={u} href={href(`/metrics?metric=${encodeURIComponent(`${m.source}.${u}`)}`)}>
                    <Badge variant="outline" className="font-mono hover:bg-accent">
                      {u}
                    </Badge>
                  </a>
                ))}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Columns only</span>
            )}
            {m.joins?.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Through {m.joins.map((j) => `${j}`).join(', ')}: measures across joins use symmetric aggregates.
              </p>
            ) : null}
          </div>
        </div>
        {usedBy.length > 0 && (
          <div>
            <Overline>Used by</Overline>
            <div className="flex flex-wrap gap-1.5">
              {usedBy.map((u) => (
                <a key={u.name} href={href(`/metrics?metric=${encodeURIComponent(`${u.source}.${u.name}`)}`)}>
                  <Badge variant="outline" className="font-mono hover:bg-accent">
                    {u.name}
                  </Badge>
                </a>
              ))}
            </div>
          </div>
        )}
        {sameTerm.length > 0 && (
          <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
            {sameTerm.length === 1 ? 'Another measure implements' : `${sameTerm.length} other measures implement`} this glossary term:{' '}
            {sameTerm.map((x) => `${x.source}.${x.name}`).join(', ')}. Check they agree.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={query}>
              <SlidersHorizontal />
              Query this metric
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={workbenchHref(m.model, m.source, `run: ${m.source} -> { aggregate: ${m.name} }`)}>
              Open in workbench
              <ArrowRight />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function PublishDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PublishResult>()
  const [error, setError] = useState<string>()
  const counts = result
    ? {
        created: result.published.filter((p) => p.status === 'created').length,
        updated: result.published.filter((p) => p.status === 'updated').length,
        failed: result.published.filter((p) => p.status === 'failed'),
      }
    : undefined
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) (setResult(undefined), setError(undefined))
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish metrics to the catalog</DialogTitle>
          <DialogDescription>
            Creates or updates an OpenMetadata metric for every Malloy measure: its definition, type, the tables it reads (as assets and
            lineage), the measures it&apos;s built from, and its glossary term. Publishing again updates them in place.
          </DialogDescription>
        </DialogHeader>
        {counts && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              <span className="font-medium">{counts.created}</span> created, <span className="font-medium">{counts.updated}</span> updated
              {counts.failed.length ? (
                <>
                  , <span className="font-medium text-destructive">{counts.failed.length} failed</span>
                </>
              ) : null}
              . {result!.lineage.added} lineage edges added{result!.lineage.failed ? `, ${result!.lineage.failed} failed` : ''}.
            </p>
            {counts.failed.slice(0, 3).map((f) => (
              <p key={f.name} className="font-mono text-xs text-destructive">
                {f.name}: {f.error}
              </p>
            ))}
            {result!.lineage.error && <p className="font-mono text-xs text-destructive">Lineage: {result!.lineage.error}</p>}
            <a className="text-primary hover:underline" href={href('/explore?type=metric')} onClick={() => onOpenChange(false)}>
              Find them in Explore
            </a>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError(undefined)
                try {
                  setResult(await publishMetrics())
                  invalidate('search')
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              <CloudUpload />
              {busy ? 'Publishing…' : 'Publish'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
