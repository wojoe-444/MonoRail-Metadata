import { useState } from 'react'
import { Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DescriptionDialog } from '@/features/om/components/Editors'
import { EntityHeader } from '@/features/om/components/EntityHeader'
import { Markdown } from '@/features/om/components/Markdown'
import { EmptyState, Loaded } from '@/features/om/components/States'
import { displayName, entityHref, formatCount } from '@/features/om/entity'
import { useEntity } from '@/features/om/useEntity'
import { invalidate, useQuery } from '@/hooks/useQuery'
import { useSearchParams } from '@/lib/router'
import { getTestCase, getTestCaseResults, getTestDefinition } from '@/features/quality/api'
import { TestStatusBadge } from '@/features/quality/components/Badges'
import { IncidentPanel } from '@/features/quality/components/IncidentPanel'
import { ResultHistoryChart } from '@/features/quality/components/ResultHistoryChart'
import { formatDateTime, formatParamValue, formatValue, humanize, parseEntityLink, shortTable, statusOf } from '@/features/quality/format'
import type { TestCase, TestCaseResult } from '@/features/quality/types'

const DAY = 86_400_000
type Range = '7' | '30' | '90'

export function TestCasePage() {
  const fqn = useSearchParams().get('fqn')
  const { entity, query, save } = useEntity<TestCase>('testCase', fqn, getTestCase)
  if (!fqn)
    return <EmptyState title="No test case selected" description="Open a test case from Data quality or a table's Data quality tab." />
  return <Loaded query={{ ...query, data: entity }}>{(tc) => <TestCaseView tc={tc} save={save} refetch={query.refetch} />}</Loaded>
}

function TestCaseView({ tc, save, refetch }: { tc: TestCase; save: (next: TestCase) => Promise<unknown>; refetch: () => void }) {
  const fqn = tc.fullyQualifiedName ?? tc.name
  const link = parseEntityLink(tc.entityLink)
  const tableFqn = link?.entityFQN ?? tc.entityFQN ?? ''
  const defFqn = tc.testDefinition.fullyQualifiedName ?? tc.testDefinition.name ?? ''
  const def = useQuery(defFqn ? ['quality', 'testDefinition', defFqn] : null, () => getTestDefinition(defFqn), { staleMs: 10 * 60_000 })
  const [editingDescription, setEditingDescription] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <EntityHeader
        entity={tc}
        entityType="testCase"
        parents={
          tableFqn
            ? [{ id: tableFqn, type: 'table', name: shortTable(tableFqn), fullyQualifiedName: tableFqn, displayName: shortTable(tableFqn) }]
            : []
        }
        badges={<TestStatusBadge status={statusOf(tc)} />}
        onSave={save}
        onFollowChange={refetch}
        fields={['owners', 'domains']}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Results fqn={fqn} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Definition</CardTitle>
              <CardDescription>{def.data?.description ?? ' '}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Test type</dt>
                <dd className="truncate">{displayName(tc.testDefinition)}</dd>
                <dt className="text-muted-foreground">Dimension</dt>
                <dd>{def.data?.dataQualityDimension ?? '–'}</dd>
                <dt className="text-muted-foreground">Tests</dt>
                <dd className="min-w-0">
                  <a href={entityHref('table', tableFqn)} className="block truncate hover:underline">
                    {shortTable(tableFqn)}
                  </a>
                  {link?.column && <span className="block truncate font-mono text-xs text-muted-foreground">column {link.column}</span>}
                </dd>
                <dt className="text-muted-foreground">Suite</dt>
                <dd className="truncate">
                  {tc.testSuites
                    ?.filter((s) => !s.basic)
                    .map((s) => displayName(s))
                    .join(', ') || 'Table suite'}
                </dd>
                {tc.computePassedFailedRowCount && (
                  <>
                    <dt className="text-muted-foreground">Row counts</dt>
                    <dd>Passed / failed rows computed</dd>
                  </>
                )}
                {tc.createdBy && (
                  <>
                    <dt className="text-muted-foreground">Created by</dt>
                    <dd className="truncate">{tc.createdBy}</dd>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Parameters</CardTitle>
            </CardHeader>
            <CardContent>
              {tc.parameterValues?.length ? (
                <dl className="flex flex-col gap-3 text-sm">
                  {tc.parameterValues.map((p) => {
                    const pd = def.data?.parameterDefinition?.find((d) => d.name === p.name)
                    return (
                      <div key={p.name} className="flex flex-col gap-0.5">
                        <dt className="text-xs text-muted-foreground">{pd?.displayName ?? humanize(p.name)}</dt>
                        <dd
                          className={
                            /sql/i.test(p.name)
                              ? 'rounded-md bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap'
                              : 'font-mono break-all'
                          }
                        >
                          {formatParamValue(p.value)}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">This test takes no parameters.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
              <CardAction>
                <Button variant="ghost" size="icon" aria-label="Edit description" onClick={() => setEditingDescription(true)}>
                  <Pencil aria-hidden />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {tc.description ? <Markdown>{tc.description}</Markdown> : <p className="text-sm text-muted-foreground">No description.</p>}
            </CardContent>
          </Card>

          <IncidentPanel
            testCase={tc}
            onChange={() => {
              invalidate('entity', 'testCase', fqn)
              refetch()
            }}
          />
        </div>
      </div>

      <DescriptionDialog
        open={editingDescription}
        onOpenChange={setEditingDescription}
        title="Edit description"
        value={tc.description}
        onSave={(description) => save({ ...tc, description })}
      />
    </div>
  )
}

function Results({ fqn }: { fqn: string }) {
  const [range, setRange] = useState<Range>('30')
  // Round to the hour so the query key stays stable between renders.
  const startTs = Math.floor((Date.now() - Number(range) * DAY) / 3_600_000) * 3_600_000
  const query = useQuery(['quality', 'results', fqn, range], () => getTestCaseResults(fqn, startTs, Date.now() + DAY))
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Result history</CardTitle>
          <CardDescription>The value each run measured, colored by outcome.</CardDescription>
          <CardAction>
            <Segmented
              aria-label="Time range"
              value={range}
              onChange={setRange}
              options={[
                { value: '7', label: '7d' },
                { value: '30', label: '30d' },
                { value: '90', label: '90d' },
              ]}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <Loaded query={query}>
            {(res) =>
              res.data.length ? (
                <ResultHistoryChart results={res.data} />
              ) : (
                <EmptyState title="No runs in this range" description="Results appear after the table's test suite pipeline runs." />
              )
            }
          </Loaded>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <CardDescription>Newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <Loaded query={query}>
            {(res) =>
              res.data.length ? (
                <ResultsTable results={res.data} />
              ) : (
                <p className="text-sm text-muted-foreground">No runs in this range.</p>
              )
            }
          </Loaded>
        </CardContent>
      </Card>
    </>
  )
}

function ResultsTable({ results }: { results: TestCaseResult[] }) {
  const sorted = [...results].sort((a, b) => b.timestamp - a.timestamp)
  const rows = sorted.some((r) => r.failedRows !== undefined)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Result</TableHead>
          {rows && <TableHead className="hidden text-right sm:table-cell">Failed rows</TableHead>}
          <TableHead className="hidden text-right md:table-cell">Values</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={r.id ?? r.timestamp}>
            <TableCell className="text-xs whitespace-nowrap tabular-nums">{formatDateTime(r.timestamp)}</TableCell>
            <TableCell>
              <TestStatusBadge status={r.testCaseStatus} />
            </TableCell>
            <TableCell className="max-w-96 min-w-48 text-xs whitespace-normal text-muted-foreground">{r.result ?? '–'}</TableCell>
            {rows && (
              <TableCell className="hidden text-right text-xs tabular-nums sm:table-cell">
                {r.failedRows !== undefined
                  ? `${formatCount(r.failedRows)}${r.failedRowsPercentage !== undefined ? ` (${r.failedRowsPercentage.toFixed(2)}%)` : ''}`
                  : '–'}
              </TableCell>
            )}
            <TableCell className="hidden text-right text-xs md:table-cell">
              <div className="flex flex-col items-end gap-0.5">
                {(r.testResultValue ?? []).map((v) => (
                  <span key={v.name} className="whitespace-nowrap">
                    <span className="text-muted-foreground">{humanize(v.name ?? '')}</span>{' '}
                    <span className="tabular-nums">
                      {v.value !== undefined && !Number.isNaN(Number(v.value)) ? formatValue(Number(v.value)) : v.value}
                    </span>
                  </span>
                ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
