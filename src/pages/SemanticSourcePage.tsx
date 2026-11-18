import { useState } from 'react'
import { FileCode2, KeyRound, Play, SlidersHorizontal } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useQuery } from '@/hooks/useQuery'
import { href, useSearchParams } from '@/lib/router'
import { getSemantic, type SemanticField, type SemanticSource } from '@/features/semantic/api'
import { JoinGraph } from '@/features/semantic/components/JoinGraph'
import { CodeBlock, MetricKindBadge, Overline, TableLink, TermLink } from '@/features/semantic/components/Parts'
import { findSource, joinTree, sourceHref, workbenchHref } from '@/features/semantic/model'
import { toSearch } from '@/features/semantic/query'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'

const TABS = ['measures', 'dimensions', 'views', 'joins', 'graph'] as const
type Tab = (typeof TABS)[number]

/** One Malloy source as a semantic model: its table, key, joins, and every field with its description and definition. */
export function SemanticSourcePage() {
  const params = useSearchParams()
  const model = params.get('model')
  const name = params.get('source')
  const semantic = useQuery(['malloy', 'semantic'], getSemantic)
  const initial = params.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(initial && TABS.includes(initial) ? initial : 'measures')

  if (!name) return <EmptyState title="No source selected" description="Open a source from Semantic models." />
  if (!semantic.data) return semantic.error ? <ErrorState error={semantic.error} onRetry={semantic.refetch} /> : <LoadingState />
  const source = findSource(semantic.data, model, name)
  if (!source) return <EmptyState title={`No source named ${name}`} description={model ? `It isn't in ${model}.` : undefined} />

  const own = source.fields.filter((f) => !f.column)
  const measures = own.filter((f) => f.kind === 'measure')
  const dims = own.filter((f) => f.kind === 'dimension')
  const columns = source.fields.filter((f) => f.column)
  const views = own.filter((f) => f.kind === 'view')
  const joins = joinTree(source).filter((n) => n.path.length)
  const builder = (extra: Record<string, string> = {}) =>
    href(
      `/query?${toSearch({ model: source.model, source: source.name, measures: [], groupBy: [], filters: [], compare: 'none' })}${Object.entries(
        extra,
      )
        .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
        .join('')}`,
    )

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Semantic model"
        title={source.name}
        description={source.description}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={workbenchHref(source.model, source.name)}>
                <FileCode2 />
                Open in workbench
              </a>
            </Button>
            <Button asChild>
              <a href={builder()}>
                <SlidersHorizontal />
                Query
              </a>
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0">
            <Overline>Table</Overline>
            <TableLink path={source.tablePath} fqn={source.tableFqn} />
          </div>
          <div>
            <Overline>Primary key</Overline>
            <span className="flex items-center gap-1 font-mono text-sm">
              <KeyRound className="size-3.5 text-muted-foreground" aria-hidden />
              {source.primaryKey ?? (
                <span className="text-muted-foreground">None: joins into this source can&apos;t use symmetric aggregates</span>
              )}
            </span>
          </div>
          <div>
            <Overline>Defined in</Overline>
            <a href={workbenchHref(source.model, source.name)} className="font-mono text-sm hover:underline">
              malloy/{source.model}
              {source.line ? `:${source.line}` : ''}
            </a>
          </div>
          <div>
            <Overline>Fields</Overline>
            <span className="text-sm tabular-nums">
              {measures.length} measures · {dims.length} dimensions · {columns.length} columns · {views.length} views
            </span>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="measures">Measures ({measures.length})</TabsTrigger>
          <TabsTrigger value="dimensions">Dimensions ({dims.length + columns.length})</TabsTrigger>
          <TabsTrigger value="views">Views ({views.length})</TabsTrigger>
          <TabsTrigger value="joins">Joins ({joins.length})</TabsTrigger>
          <TabsTrigger value="graph">Join graph</TabsTrigger>
        </TabsList>

        <TabsContent value="measures">
          <FieldList
            source={source}
            fields={measures}
            empty="No measures. Add one with measure: name is expr."
            action={(f) => (
              <Button variant="ghost" size="sm" asChild>
                <a href={builder({ m: f.name })}>
                  <SlidersHorizontal />
                  Query
                </a>
              </Button>
            )}
          />
        </TabsContent>

        <TabsContent value="dimensions" className="flex flex-col gap-4">
          <FieldList source={source} fields={dims} empty="No defined dimensions. Every column below is a dimension too." />
          <Card>
            <CardHeader>
              <CardTitle>Columns</CardTitle>
              <CardDescription>Every column of the table is a dimension. Their descriptions live on the table page.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Column</TableHead>
                      <TableHead>Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {columns.map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="font-mono text-xs">
                          {c.name}
                          {c.name === source.primaryKey && (
                            <Badge variant="secondary" className="ml-2">
                              primary key
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{c.type}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="views">
          <FieldList
            source={source}
            fields={views}
            empty="No views. Save one from the query builder."
            action={(f) => (
              <>
                {f.builder && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={href(`/query?${f.builder}`)}>
                      <SlidersHorizontal />
                      Edit in builder
                    </a>
                  </Button>
                )}
                <Button variant="ghost" size="sm" asChild>
                  <a href={workbenchHref(source.model, source.name, `run: ${source.name} -> ${f.name}`)}>
                    <Play />
                    Run in workbench
                  </a>
                </Button>
              </>
            )}
          />
        </TabsContent>

        <TabsContent value="joins">
          {!joins.length ? (
            <EmptyState title="No joins" description="Add join_one: or join_many: to bring in related sources." />
          ) : (
            <Card>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Join</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>On</TableHead>
                        <TableHead>Table</TableHead>
                        <TableHead>Primary key</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {joins.map((j) => (
                        <TableRow key={j.path.join('.')}>
                          <TableCell className="font-mono text-xs">
                            <span style={{ paddingLeft: `${(j.path.length - 1) * 16}px` }}>
                              {j.sourceName && j.sourceName !== source.name ? (
                                <a href={sourceHref(source.model, j.sourceName)} className="hover:underline">
                                  {j.path.join('.')}
                                </a>
                              ) : (
                                j.path.join('.')
                              )}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={j.edge === 'many' ? 'primary' : 'secondary'} className="font-mono">
                              join_{j.edge}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{j.join?.on ?? j.join?.definition}</TableCell>
                          <TableCell>
                            <TableLink path={j.tablePath} fqn={j.tableFqn} />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{j.primaryKey ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="graph">
          <JoinGraph key={`${source.model}:${source.name}`} source={source} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FieldList({
  source,
  fields,
  empty,
  action,
}: {
  source: SemanticSource
  fields: SemanticField[]
  empty: string
  action?: (f: SemanticField) => React.ReactNode
}) {
  if (!fields.length) return <EmptyState title={empty} />
  return (
    <Card>
      <CardContent className="flex flex-col divide-y">
        {fields.map((f) => (
          <div key={f.name} id={`field-${f.name}`} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium">{f.name}</span>
              {f.kind === 'dimension' && f.type && (
                <Badge variant="outline" className="font-mono">
                  {f.type}
                </Badge>
              )}
              <MetricKindBadge kind={f.metricKind} aggregate={f.aggregate} />
              {f.window && <Badge variant="primary">calculate: window</Badge>}
              {f.nests && <Badge variant="secondary">nest</Badge>}
              <TermLink fqn={f.glossaryTerm} />
              <div className="ml-auto flex items-center gap-1">
                {action?.(f)}
                {f.line && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={workbenchHref(source.model, source.name)} title="Open the model in the workbench">
                      line {f.line}
                    </a>
                  </Button>
                )}
              </div>
            </div>
            {f.description && <p className="text-sm text-muted-foreground">{f.description}</p>}
            {f.definition && <CodeBlock code={f.definition} label="Copy definition" />}
            {(f.usesMeasures?.length || f.tables?.length) && (
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                {f.usesMeasures?.length ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground">Built from</span>
                    {f.usesMeasures.map((u) => (
                      <a
                        key={u}
                        href={`#field-${u}`}
                        onClick={(e) => (e.preventDefault(), document.getElementById(`field-${u}`)?.scrollIntoView({ behavior: 'smooth' }))}
                        className="font-mono hover:underline"
                      >
                        {u}
                      </a>
                    ))}
                  </div>
                ) : null}
                {f.tables?.length ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground">Reads</span>
                    {f.tables.map((t) => (
                      <TableLink key={t.path} path={t.path} fqn={t.fqn} />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
