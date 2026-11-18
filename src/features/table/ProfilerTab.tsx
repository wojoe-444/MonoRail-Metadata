import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { StatTile } from '@/components/charts/StatTile'
import { axisProps, gridProps } from '@/components/charts/palette'
import { ChartTooltipContent } from '@/components/charts/ChartTooltip'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Table as T, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useQuery } from '@/hooks/useQuery'
import { getColumnProfiles, getTableProfiles } from '@/features/om/api'
import { formatBytes, formatCount, formatDate, formatPercent } from '@/features/om/entity'
import { EmptyState, Loaded } from '@/features/om/components/States'
import type { ColumnProfile, Table } from '@/features/om/types'
import { cn } from '@/lib/utils'

const DAY = 86_400_000
const shortDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Row count and size over time, then per-column statistics with a history chart for the selected column. */
export function ProfilerTab({ table, latest }: { table: Table; latest: Record<string, ColumnProfile | undefined> }) {
  const [days, setDays] = useState<'7' | '30'>('30')
  const start = Date.now() - Number(days) * DAY
  const profiles = useQuery(['table-profile', table.fullyQualifiedName, days], () => getTableProfiles(table.fullyQualifiedName!, start))
  const [col, setCol] = useState<string | undefined>(table.columns[0]?.name)
  const colFqn = table.columns.find((c) => c.name === col)?.fullyQualifiedName
  const history = useQuery(colFqn ? ['column-profile', colFqn, days] : null, () => getColumnProfiles(colFqn!, start))

  return (
    <Loaded query={profiles}>
      {(p) => {
        if (!p.data.length)
          return (
            <EmptyState
              title="No profile yet"
              description="Run the profiler ingestion for this service to collect row counts and column statistics."
            />
          )
        const series = [...p.data].sort((a, b) => a.timestamp - b.timestamp)
        const last = series.at(-1)!
        const first = series[0]!
        const growth = first.rowCount ? (last.rowCount ?? 0) / first.rowCount - 1 : undefined
        return (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">Last profiled {formatDate(last.timestamp)}</span>
              <Segmented
                aria-label="Time range"
                value={days}
                onChange={setDays}
                options={[
                  { value: '7', label: '7 days' },
                  { value: '30', label: '30 days' },
                ]}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile label="Rows" value={formatCount(last.rowCount)} delta={growth} deltaLabel={`over ${days} days`} />
              <StatTile label="Size" value={formatBytes(last.sizeInByte)} />
              <StatTile label="Columns" value={String(last.columnCount ?? table.columns.length)} />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Row count</CardTitle>
                <CardDescription>Daily, from the profiler.</CardDescription>
              </CardHeader>
              <CardContent className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ left: 8, right: 8, top: 4 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="timestamp" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                    <YAxis tickFormatter={(v: number) => formatCount(v)} {...axisProps} width={56} domain={['auto', 'auto']} />
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.[0] ? (
                          <ChartTooltipContent
                            title={formatDate(payload[0].payload.timestamp)}
                            rows={[
                              { key: 'rows', label: 'Rows', value: formatCount(payload[0].value as number), color: 'var(--series-1)' },
                            ]}
                          />
                        ) : null
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="rowCount"
                      stroke="var(--series-1)"
                      fill="var(--series-1)"
                      fillOpacity={0.12}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="overflow-x-auto rounded-xl border">
                <T>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Column</TableHead>
                      <TableHead className="text-right">Null %</TableHead>
                      <TableHead className="text-right">Distinct</TableHead>
                      <TableHead className="text-right">Unique %</TableHead>
                      <TableHead className="text-right">Min</TableHead>
                      <TableHead className="text-right">Max</TableHead>
                      <TableHead className="text-right">Mean</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {table.columns.map((c) => {
                      const pr = latest[c.name]
                      return (
                        <TableRow
                          key={c.name}
                          data-state={c.name === col ? 'selected' : undefined}
                          className={cn('cursor-pointer', c.name === col && 'bg-primary-soft/60')}
                          onClick={() => setCol(c.name)}
                        >
                          <TableCell>
                            <button type="button" className="font-mono text-sm hover:underline" onClick={() => setCol(c.name)}>
                              {c.name}
                            </button>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatPercent(pr?.nullProportion, 1)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCount(pr?.distinctCount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPercent(pr?.uniqueProportion, 0)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(pr?.min)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(pr?.max)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(pr?.mean)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </T>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="font-mono">{col}</CardTitle>
                  <CardDescription>Null and distinct share over time.</CardDescription>
                </CardHeader>
                <CardContent className="h-64">
                  <Loaded query={history}>
                    {(h) => (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={[...h.data].sort((a, b) => a.timestamp - b.timestamp)} margin={{ left: 0, right: 8, top: 4 }}>
                          <CartesianGrid {...gridProps} />
                          <XAxis dataKey="timestamp" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                          <YAxis tickFormatter={(v: number) => formatPercent(v)} {...axisProps} width={44} domain={[0, 1]} />
                          <Tooltip
                            content={({ active, payload }) =>
                              active && payload?.length ? (
                                <ChartTooltipContent
                                  title={formatDate((payload[0]!.payload as ColumnProfile).timestamp)}
                                  rows={payload.map((x) => ({
                                    key: String(x.name),
                                    label: x.name === 'nullProportion' ? 'Null' : 'Distinct',
                                    value: formatPercent(x.value as number, 1),
                                    color: x.color as string,
                                  }))}
                                />
                              ) : null
                            }
                          />
                          <Line type="monotone" dataKey="nullProportion" stroke="var(--series-1)" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="distinctProportion" stroke="var(--series-2)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </Loaded>
                </CardContent>
              </Card>
            </div>
          </div>
        )
      }}
    </Loaded>
  )
}

function fmt(v: number | string | undefined) {
  if (v === undefined || v === null) return '–'
  if (typeof v === 'number') return Number.isInteger(v) ? formatCount(v) : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return v
}
