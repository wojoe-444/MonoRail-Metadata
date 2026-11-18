import { useState } from 'react'
import { Plus } from 'lucide-react'

import { StatTile } from '@/components/charts/StatTile'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { EmptyState, Loaded } from '@/features/om/components/States'
import { formatPercent } from '@/features/om/entity'
import type { Table } from '@/features/om/types'
import { useQuery } from '@/hooks/useQuery'

import { listTableTestCases } from './api'
import { AddTestDialog } from './components/AddTestDialog'
import { TestCaseTable } from './components/TestCaseTable'
import { statusOf } from './format'
import type { TestCase } from './types'

const ORDER = { Failed: 0, Aborted: 1, Queued: 2, Success: 3 } as const

/**
 * Data quality for one table: a pass/fail summary, every test on the table and
 * its columns with its latest result, and an "Add test" dialog.
 */
export function TableQualityTab({ table }: { table: Table }) {
  const fqn = table.fullyQualifiedName ?? table.name
  const query = useQuery(['quality', 'table-tests', fqn], () => listTableTestCases(fqn))
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <Loaded query={query}>
        {(res) => {
          const cases = [...res.data].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
          const count = (s: string) => cases.filter((tc) => statusOf(tc) === s).length
          const ran = cases.filter((tc) => statusOf(tc)).length
          const passed = count('Success')
          const tableLevel = cases.filter((tc) => !tc.entityLink.includes('::columns::')).length
          return (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatTile label="Tests" value={String(cases.length)} hint={`${tableLevel} table · ${cases.length - tableLevel} column`} />
                <StatTile label="Passed" value={String(passed)} hint={ran ? `${formatPercent(passed / ran)} of runs` : undefined} />
                <StatTile
                  label="Failed"
                  value={String(count('Failed'))}
                  hint={cases.some((tc) => tc.incidentId) ? `${cases.filter((tc) => tc.incidentId).length} open incident(s)` : undefined}
                />
                <StatTile
                  label="Aborted"
                  value={String(count('Aborted'))}
                  hint={cases.length - ran ? `${cases.length - ran} not run yet` : undefined}
                />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Tests</CardTitle>
                  <CardDescription>Latest result of every test on this table and its columns.</CardDescription>
                  <CardAction>
                    <Button size="sm" onClick={() => setAdding(true)}>
                      <Plus aria-hidden />
                      Add test
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {ran > 0 && (
                    <div className="flex items-center gap-3">
                      <Progress
                        value={(passed / ran) * 100}
                        className="h-2"
                        indicatorClassName="bg-success"
                        aria-label="Share of tests passing"
                      />
                      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {passed} of {ran} passing
                      </span>
                    </div>
                  )}
                  {cases.length ? (
                    <TestCaseTable cases={cases} showTable={false} />
                  ) : (
                    <EmptyState
                      title="No tests yet"
                      description="Add a row count check on the table or a not-null, unique or range check on a column."
                      action={
                        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                          <Plus aria-hidden />
                          Add test
                        </Button>
                      }
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )
        }}
      </Loaded>
      <AddTestDialog table={table} open={adding} onOpenChange={setAdding} />
    </div>
  )
}

function rank(tc: TestCase) {
  const s = statusOf(tc)
  return s ? ORDER[s] : 2.5
}
