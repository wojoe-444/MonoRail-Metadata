import { useEffect, useMemo, useState } from 'react'
import { CircleAlert, FileCode2, Info, Network, Play, Save, SlidersHorizontal } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { useSearchParams } from '@/lib/router'
import { ResultView } from '@/features/malloy/ResultView'
import { dryRunQuery, getSemantic, runSavedModelQuery, saveView, type GuardedRunResult } from '@/features/semantic/api'
import { FilterEditor, GroupByEditor, MeasurePicker, SaveViewDialog } from '@/features/semantic/components/BuilderControls'
import { CodeBlock, CopyButton, GuardrailBar, Overline } from '@/features/semantic/components/Parts'
import { allFields, dimensionsOf, fanOut, findSource, measuresOf, sourceHref, workbenchHref } from '@/features/semantic/model'
import {
  orderable,
  outputs,
  parseState,
  queryMalloy,
  stageMalloy,
  suggestName,
  toSearch,
  type Compare,
  type QueryState,
} from '@/features/semantic/query'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'

/** Replace the route without adding a history entry, so every builder edit doesn't become a Back step. */
function replaceRoute(path: string) {
  const url = `${window.location.pathname}${window.location.search}#${path}`
  window.history.replaceState(window.history.state, '', url)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * A no-code query builder over a Malloy source: pick measures, group by
 * dimensions (through joins, with a time grain), filter, order, limit, and
 * optionally compare to the previous period or keep a running total. It
 * writes Malloy, shows the SQL Malloy compiles, dry-runs it for cost, and runs
 * it. State lives in the URL; a query can be saved as a view in the model.
 */
export function QueryBuilderPage() {
  const params = useSearchParams()
  const state = parseState(params)
  const semantic = useQuery(['malloy', 'semantic'], getSemantic)

  // Start on the first source when the URL names none.
  const firstSource = semantic.data?.flatMap((m) => m.sources)[0]
  useEffect(() => {
    if (!state.source && firstSource) replaceRoute(`/query?${toSearch({ ...state, model: firstSource.model, source: firstSource.name })}`)
  }, [state, firstSource])

  const source = findSource(semantic.data, state.model || null, state.source || null)
  const set = (patch: Partial<QueryState>) => replaceRoute(`/query?${toSearch({ ...state, ...patch })}`)

  const fields = useMemo(() => (source ? allFields(source) : []), [source])
  const dims = useMemo(() => (source ? dimensionsOf(source) : []), [source])
  const measures = useMemo(() => (source ? measuresOf(source) : []), [source])
  const typeOf = (path: string) => fields.find((f) => f.path === path)?.field

  const hasQuery = state.measures.length > 0 || state.groupBy.length > 0
  const malloy = source && hasQuery ? queryMalloy(state, typeOf) : ''
  const debounced = useDebounced(malloy, 300)
  const compiled = useQuery(debounced && source ? ['malloy-dryrun', source.model, debounced] : null, () =>
    dryRunQuery(source!.model, debounced),
  )
  const [result, setResult] = useState<GuardedRunResult & { query: string }>()
  const [running, setRunning] = useState(false)
  const [tab, setTab] = useState<'results' | 'malloy' | 'sql'>('malloy')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string>()

  if (!semantic.data) return semantic.error ? <ErrorState error={semantic.error} onRetry={semantic.refetch} /> : <LoadingState />
  const allSources = semantic.data.flatMap((m) => m.sources)
  if (!allSources.length) return <EmptyState title="No Malloy sources" description="Add a source to a model in malloy/ first." />
  if (!source)
    return state.source ? <EmptyState title={`No source named ${state.source}`} description="Pick another source." /> : <LoadingState />

  const timeOut = outputs(state).dims.find((d) => d.grain)
  const stale = result && result.query !== malloy
  const problems = compiled.data && !compiled.data.ok ? compiled.data.problems : []
  const run = async () => {
    if (!malloy) return
    setRunning(true)
    try {
      const r = await runSavedModelQuery(source.model, malloy)
      setResult({ ...r, query: malloy })
      setTab(r.rows ? 'results' : r.compileOnly ? 'sql' : 'results')
    } catch (e) {
      setResult({ ok: false, query: malloy, problems: [{ severity: 'error', message: e instanceof Error ? e.message : String(e) }] })
      setTab('results')
    } finally {
      setRunning(false)
    }
  }

  // Fan-out notes: which selected measures repeat under the chosen group-bys (Malloy handles it; say so).
  const notes = state.measures.flatMap((mp) => {
    const m = measures.find((x) => x.path === mp)
    if (!m) return []
    const ds = state.groupBy.map((g) => dims.find((d) => d.path === g.field)).filter((d) => d !== undefined)
    const causes = (ds.length ? ds : [undefined]).flatMap((d) => fanOut(source, m, d).causes)
    const unique = [...new Map(causes.map((c) => [c.node.path.join('.'), c])).values()]
    return unique.length ? [{ measure: mp, causes: unique }] : []
  })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Query builder"
        description="Pick measures and dimensions from a Malloy source. The builder writes the Malloy; Malloy writes the SQL, with joins and symmetric aggregates handled."
      />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qb-source">Source</Label>
              <NativeSelect
                id="qb-source"
                value={`${source.model}::${source.name}`}
                onChange={(e) => {
                  const [model, name] = e.target.value.split('::')
                  replaceRoute(
                    `/query?${toSearch({ model: model!, source: name!, measures: [], groupBy: [], filters: [], compare: 'none' })}`,
                  )
                  setResult(undefined)
                }}
                className="font-mono"
              >
                {semantic.data.map((m) => (
                  <optgroup key={m.path} label={m.path}>
                    {m.sources.map((s) => (
                      <option key={s.name} value={`${m.path}::${s.name}`}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
              <a href={sourceHref(source.model, source.name)} className="text-xs text-muted-foreground hover:underline">
                About {source.name} and its joins
              </a>
            </div>
            <div>
              <Overline>Measures</Overline>
              <MeasurePicker
                measures={measures}
                selected={state.measures}
                onChange={(m) => set({ measures: m })}
                sourceName={source.name}
              />
            </div>
            <div>
              <Overline>Group by</Overline>
              <GroupByEditor
                dims={dims}
                value={state.groupBy}
                onChange={(g) => set({ groupBy: g, compare: g.some((x) => x.grain) ? state.compare : 'none' })}
                sourceName={source.name}
              />
            </div>
            <div>
              <Overline>Filters</Overline>
              <FilterEditor dims={dims} value={state.filters} onChange={(f) => set({ filters: f })} sourceName={source.name} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Compare</span>
              <Segmented<Compare>
                aria-label="Compare"
                value={state.compare}
                onChange={(c) => set({ compare: c })}
                options={[
                  { value: 'none', label: 'None' },
                  {
                    value: 'previous',
                    label: 'Prior period',
                    disabled: !timeOut,
                    title: timeOut
                      ? 'lag(): each measure against the previous row in time'
                      : 'Group by a date or timestamp with a grain first',
                  },
                  {
                    value: 'running',
                    label: 'Running total',
                    disabled: !timeOut,
                    title: timeOut ? 'sum_cumulative(): a running total over time' : 'Group by a date or timestamp with a grain first',
                  },
                ]}
              />
              {state.compare !== 'none' && (
                <p className="text-xs text-muted-foreground">
                  Uses Malloy&apos;s <span className="font-mono">calculate:</span>, which runs after aggregation over rows ordered by{' '}
                  {timeOut?.name}
                  {outputs(state).dims.length > 1 ? ', separately for each value of the other group-bys' : ''}.
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qb-order">Order by</Label>
                <div className="flex gap-1.5">
                  <NativeSelect
                    id="qb-order"
                    value={state.order?.field ?? ''}
                    onChange={(e) =>
                      set({ order: e.target.value ? { field: e.target.value, dir: state.order?.dir ?? 'desc' } : undefined })
                    }
                    className="min-w-0 flex-1 font-mono text-xs"
                  >
                    <option value="">Malloy default</option>
                    {orderable(state).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </NativeSelect>
                  {state.order && (
                    <NativeSelect
                      aria-label="Order direction"
                      value={state.order.dir}
                      onChange={(e) => set({ order: { ...state.order!, dir: e.target.value as 'asc' | 'desc' } })}
                      className="w-20 text-xs"
                    >
                      <option value="desc">desc</option>
                      <option value="asc">asc</option>
                    </NativeSelect>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qb-limit">Limit</Label>
                <Input
                  id="qb-limit"
                  type="number"
                  min={1}
                  value={state.limit ?? ''}
                  onChange={(e) => set({ limit: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })}
                  placeholder="No limit"
                  className="h-9 tabular-nums"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={run} disabled={!malloy || running || problems.length > 0 || Boolean(compiled.data?.estimate?.overCap)}>
              <Play />
              {running ? 'Running…' : 'Run'}
            </Button>
            <Button variant="outline" disabled={!malloy || problems.length > 0} onClick={() => setSaving(true)}>
              <Save />
              Save as view
            </Button>
            <Button variant="outline" asChild disabled={!malloy}>
              <a href={workbenchHref(source.model, source.name, malloy || undefined)} aria-disabled={!malloy}>
                <FileCode2 />
                Open in workbench
              </a>
            </Button>
            {malloy && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <CopyButton text={malloy} label="Copy Malloy" />
                Copy Malloy
              </span>
            )}
            {saved && (
              <a href={`${sourceHref(source.model, source.name)}&tab=views`} className="ml-auto text-sm text-primary hover:underline">
                Saved view {saved}
              </a>
            )}
          </div>

          {!hasQuery ? (
            <EmptyState
              icon={<SlidersHorizontal className="size-5" />}
              title="Pick a measure to start"
              description="Then group it by dimensions, from this source or through its joins."
            />
          ) : (
            <>
              <GuardrailBar estimate={compiled.data?.estimate} limit={state.limit} />
              {problems.length > 0 && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <div className="flex flex-col gap-1">
                    {problems.map((p, i) => (
                      <span key={i} className="font-mono text-xs">
                        {p.message}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {notes.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm text-info-soft-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <div className="flex flex-col gap-1">
                    {notes.map((n) => (
                      <span key={n.measure}>
                        <span className="font-mono">{n.measure}</span>: {n.causes[0]!.reason} Malloy uses symmetric aggregates, so it still
                        counts each row once.
                      </span>
                    ))}
                    <a href={`${sourceHref(source.model, source.name)}&tab=graph`} className="flex items-center gap-1 underline">
                      <Network className="size-3.5" aria-hidden />
                      See it in the join graph
                    </a>
                  </div>
                </div>
              )}
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Segmented
                      aria-label="Show"
                      value={tab}
                      onChange={setTab}
                      options={[
                        { value: 'results', label: 'Results' },
                        { value: 'malloy', label: 'Malloy' },
                        { value: 'sql', label: 'SQL' },
                      ]}
                    />
                  </CardTitle>
                  {stale && tab === 'results' && <CardDescription>The query changed since this run. Run again to refresh.</CardDescription>}
                </CardHeader>
                <CardContent>
                  {tab === 'malloy' && <CodeBlock code={malloy} label="Copy Malloy" />}
                  {tab === 'sql' &&
                    (compiled.data?.sql ? (
                      <CodeBlock code={compiled.data.sql} label="Copy SQL" />
                    ) : compiled.loading || debounced !== malloy ? (
                      <LoadingState label="Compiling…" />
                    ) : (
                      <p className="text-sm text-muted-foreground">No SQL: the query doesn&apos;t compile.</p>
                    ))}
                  {tab === 'results' && <Results result={result} running={running} />}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
      <SaveViewDialog
        open={saving}
        onOpenChange={setSaving}
        source={source.name}
        model={source.model}
        suggested={suggestName(state)}
        body={stageMalloy(state, typeOf)}
        onSave={async ({ name, description }) => {
          const r = await saveView({
            model: source.model,
            source: source.name,
            name,
            description,
            body: stageMalloy(state, typeOf),
            builder: toSearch(state),
          })
          if (r.ok) {
            setSaved(name)
            invalidate('malloy')
          }
          return r
        }}
      />
    </div>
  )
}

function Results({ result, running }: { result?: GuardedRunResult; running: boolean }) {
  if (running) return <LoadingState label="Running on BigQuery…" />
  if (!result)
    return <p className="text-sm text-muted-foreground">Run the query to see results. The Malloy and SQL tabs work without running.</p>
  if (result.rows && result.fields) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground tabular-nums">
          {result.rows.length.toLocaleString()} rows{result.ms ? ` in ${(result.ms / 1000).toFixed(1)} s` : ''}
        </p>
        <ResultView rows={result.rows} fields={result.fields} />
      </div>
    )
  }
  if (result.compileOnly) {
    return (
      <EmptyState
        title="Compiled, not run"
        description="BigQuery credentials aren’t set up on the server, so there are no rows. The SQL tab has the query Malloy would run. Set BQ_PROJECT_ID and sign in with gcloud to run it."
      />
    )
  }
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 font-mono text-xs text-destructive-soft-foreground"
    >
      {result.problems?.map((p) => p.message).join('\n') ?? 'The query failed.'}
    </div>
  )
}
