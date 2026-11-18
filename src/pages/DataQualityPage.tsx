import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'

import { StatTile } from '@/components/charts/StatTile'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState, ErrorState, Loaded, LoadingState } from '@/features/om/components/States'
import { formatPercent } from '@/features/om/entity'
import { useQuery } from '@/hooks/useQuery'
import { getExecutionSummary, listBasicTestSuites, listIncidents, searchTestCases } from '@/features/quality/api'
import { IncidentTable } from '@/features/quality/components/IncidentTable'
import { TestCaseTable } from '@/features/quality/components/TestCaseTable'
import { shortTable } from '@/features/quality/format'
import type { DataQualityDimension, TestCaseStatus } from '@/features/quality/types'

const PAGE = 25
const DAY = 86_400_000
const DIMENSIONS: DataQualityDimension[] = ['Accuracy', 'Completeness', 'Consistency', 'Integrity', 'Uniqueness', 'Validity', 'SQL']

type StatusFilter = 'all' | 'problems' | TestCaseStatus

const STATUS_FILTERS: Record<StatusFilter, { label: string; statuses?: TestCaseStatus[] }> = {
  all: { label: 'All statuses' },
  problems: { label: 'Failed or aborted', statuses: ['Failed', 'Aborted'] },
  Failed: { label: 'Failed', statuses: ['Failed'] },
  Aborted: { label: 'Aborted', statuses: ['Aborted'] },
  Success: { label: 'Passed', statuses: ['Success'] },
  Queued: { label: 'Queued', statuses: ['Queued'] },
}

export function DataQualityPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Data quality" description="Test results across the catalog, and the incidents raised when tests fail." />
      <Summary />
      <TestCases />
      <Incidents />
    </div>
  )
}

function Summary() {
  const query = useQuery(['quality', 'summary'], () => getExecutionSummary())
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />
  const s = query.data
  const total = s?.total ?? 0
  const ran = (s?.success ?? 0) + (s?.failed ?? 0) + (s?.aborted ?? 0)
  const v = (n: number | undefined) => (s ? String(n ?? 0) : '–')
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
      <StatTile
        label="Success rate"
        value={s && ran ? formatPercent((s.success ?? 0) / ran, 1) : '–'}
        hint={s ? `of ${ran} latest runs` : undefined}
        hero
        className="col-span-2 sm:col-span-1"
      />
      <StatTile label="Tests" value={v(total)} hint={s?.queued ? `${s.queued} queued` : undefined} />
      <StatTile label="Passed" value={v(s?.success)} />
      <StatTile label="Failed" value={v(s?.failed)} />
      <StatTile label="Aborted" value={v(s?.aborted)} />
    </div>
  )
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function TestCases() {
  const [text, setText] = useState('')
  const q = useDebounced(text)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [table, setTable] = useState('')
  const [level, setLevel] = useState<'all' | 'table' | 'column'>('all')
  const [dimension, setDimension] = useState<DataQualityDimension | ''>('')
  const [offset, setOffset] = useState(0)

  useEffect(() => setOffset(0), [q, status, table, level, dimension])

  const suites = useQuery(['quality', 'basic-suites'], listBasicTestSuites, { staleMs: 5 * 60_000 })
  const tables = useMemo(
    () =>
      (suites.data?.data ?? [])
        .map((s) => s.basicEntityReference?.fullyQualifiedName)
        .filter((f): f is string => Boolean(f))
        .sort((a, b) => shortTable(a).localeCompare(shortTable(b))),
    [suites.data],
  )

  const params = {
    q,
    testCaseStatus: STATUS_FILTERS[status].statuses,
    tableFqn: table || undefined,
    testCaseType: level,
    dataQualityDimension: dimension || undefined,
    offset,
    limit: PAGE,
  }
  const query = useQuery(['quality', 'search', params], () => searchTestCases(params))
  const total = query.data?.paging.total ?? 0
  const filtered = Boolean(q || status !== 'all' || table || level !== 'all' || dimension)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test cases</CardTitle>
        <CardDescription>Latest result of each test, most recently run first.</CardDescription>
        {filtered && (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setText('')
                setStatus('all')
                setTable('')
                setLevel('all')
                setDimension('')
              }}
            >
              Clear filters
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))_auto]">
          <div className="relative">
            <Label htmlFor="dq-search" className="sr-only">
              Search tests
            </Label>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="dq-search" placeholder="Search tests" value={text} onChange={(e) => setText(e.target.value)} className="pl-8" />
          </div>
          <div>
            <Label htmlFor="dq-status" className="sr-only">
              Status
            </Label>
            <NativeSelect id="dq-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              {Object.entries(STATUS_FILTERS).map(([k, f]) => (
                <option key={k} value={k}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="dq-table" className="sr-only">
              Table
            </Label>
            <NativeSelect id="dq-table" value={table} onChange={(e) => setTable(e.target.value)}>
              <option value="">All tables</option>
              {tables.map((t) => (
                <option key={t} value={t}>
                  {shortTable(t)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="dq-dimension" className="sr-only">
              Dimension
            </Label>
            <NativeSelect id="dq-dimension" value={dimension} onChange={(e) => setDimension(e.target.value as DataQualityDimension | '')}>
              <option value="">All dimensions</option>
              {DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Segmented
            aria-label="Test level"
            value={level}
            onChange={setLevel}
            options={[
              { value: 'all', label: 'All' },
              { value: 'table', label: 'Table' },
              { value: 'column', label: 'Column' },
            ]}
          />
        </div>

        {query.error && !query.data ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : !query.data ? (
          <LoadingState />
        ) : query.data.data.length ? (
          <>
            <TestCaseTable cases={query.data.data} />
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous page"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next page"
                  disabled={offset + PAGE >= total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  <ChevronRight aria-hidden />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title={filtered ? 'No tests match these filters' : 'No tests yet'}
            description={filtered ? undefined : 'Add tests from a table’s Data quality tab.'}
          />
        )}
      </CardContent>
    </Card>
  )
}

function Incidents() {
  const [scope, setScope] = useState<'open' | 'all'>('open')
  // The window is fixed per mount so the query key stays stable.
  const [range] = useState(() => ({ startTs: Date.now() - 90 * DAY, endTs: Date.now() + DAY }))
  const query = useQuery(['quality', 'incidents', 'latest'], () => listIncidents({ latest: true, ...range, limit: 200 }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Incidents</CardTitle>
        <CardDescription>Raised when a test fails; acknowledge, assign and resolve them from the test case.</CardDescription>
        <CardAction>
          <Segmented
            aria-label="Incident scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'all', label: 'Last 90 days' },
            ]}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Loaded query={query}>
          {(res) => {
            const rows = res.data
              .filter((i) => scope === 'all' || i.testCaseResolutionStatusType !== 'Resolved')
              .sort((a, b) => b.timestamp - a.timestamp)
            return rows.length ? (
              <IncidentTable incidents={rows} />
            ) : (
              <EmptyState title={scope === 'open' ? 'No open incidents' : 'No incidents in the last 90 days'} />
            )
          }}
        </Loaded>
      </CardContent>
    </Card>
  )
}
