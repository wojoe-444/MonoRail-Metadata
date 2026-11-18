import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { ChartTooltipContent } from '@/components/charts/ChartTooltip'
import { Legend } from '@/components/charts/Legend'
import { axisProps, gridProps } from '@/components/charts/palette'
import { formatCount } from '@/features/om/entity'

import { formatDateTime, formatValue, humanize, primaryValue, STATUS_COLOR, STATUS_LABEL } from '../format'
import type { TestCaseResult, TestCaseStatus } from '../types'

interface Point {
  timestamp: number
  value: number | null
  status: TestCaseStatus
  result?: string
}

const shortDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * The value each run measured (row count, null count, max, …) over time, one
 * dot per run colored by its status, with the expected range shaded when the
 * test has bounds. Aborted runs have no value; the strip below shows every run.
 */
export function ResultHistoryChart({ results }: { results: TestCaseResult[] }) {
  const sorted = [...results].sort((a, b) => a.timestamp - b.timestamp)
  const metric = sorted.map(primaryValue).find(Boolean)?.name
  const points: Point[] = sorted.map((r) => {
    const raw = metric ? r.testResultValue?.find((v) => v.name === metric)?.value : undefined
    return {
      timestamp: r.timestamp,
      value: raw !== undefined && raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : null,
      status: r.testCaseStatus ?? 'Queued',
      result: r.result,
    }
  })
  const latest = sorted.at(-1)
  const min = latest?.minBound
  const max = latest?.maxBound
  const values = points.map((p) => p.value).filter((v): v is number => v !== null)
  const lo = Math.min(...values, ...(min !== undefined ? [min] : []))
  const hi = Math.max(...values, ...(max !== undefined ? [max] : []))
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.1
  const statuses = [...new Set(points.map((p) => p.status))]

  return (
    <div className="flex flex-col gap-3">
      {metric && values.length > 0 ? (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid {...gridProps} />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={shortDate}
                {...axisProps}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v: number) => formatCount(v)}
                {...axisProps}
                width={64}
                domain={[lo - pad, hi + pad]}
                allowDataOverflow
              />
              {min !== undefined && max !== undefined && (
                <ReferenceArea y1={min} y2={max} fill="var(--success)" fillOpacity={0.06} stroke="none" ifOverflow="extendDomain" />
              )}
              {min !== undefined && <ReferenceLine y={min} stroke="var(--chart-axis)" strokeDasharray="4 4" />}
              {max !== undefined && <ReferenceLine y={max} stroke="var(--chart-axis)" strokeDasharray="4 4" />}
              <Tooltip
                content={({ active, payload }) => {
                  const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined
                  if (!p) return null
                  return (
                    <ChartTooltipContent
                      title={formatDateTime(p.timestamp)}
                      rows={[
                        { key: 'status', label: 'status', value: STATUS_LABEL[p.status], color: STATUS_COLOR[p.status] },
                        ...(p.value !== null
                          ? [{ key: 'v', label: humanize(metric), value: formatValue(p.value), color: 'var(--series-1)' }]
                          : []),
                      ]}
                      footer={p.result ? <span className="line-clamp-3">{p.result}</span> : undefined}
                    />
                  )
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--series-1)"
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
                dot={(props: { cx?: number; cy?: number; payload?: Point; index?: number }) => {
                  const { cx, cy, payload, index } = props
                  if (cx === undefined || cy === undefined || !payload || payload.value === null) return <g key={index} />
                  const failed = payload.status !== 'Success'
                  return (
                    <circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={failed ? 4.5 : 3}
                      fill={STATUS_COLOR[payload.status]}
                      stroke="var(--card)"
                      strokeWidth={1.5}
                    />
                  )
                }}
                activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2, fill: 'var(--series-1)' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">These results carry no numeric value to chart.</p>
      )}
      <div className="flex flex-col gap-1.5">
        <StatusStrip results={sorted} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Legend items={statuses.map((s) => ({ key: s, label: STATUS_LABEL[s], color: STATUS_COLOR[s] }))} />
          {min !== undefined && max !== undefined && (
            <span className="text-xs text-muted-foreground">
              Shaded: expected range {formatValue(min)} – {formatValue(max)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** One cell per run, oldest left, colored by status. */
export function StatusStrip({ results, className }: { results: TestCaseResult[]; className?: string }) {
  const sorted = [...results].sort((a, b) => a.timestamp - b.timestamp)
  return (
    <div
      className={className ?? 'flex h-4 gap-0.5'}
      role="img"
      aria-label={`${sorted.filter((r) => r.testCaseStatus === 'Success').length} of ${sorted.length} runs passed`}
    >
      {sorted.map((r) => (
        <span
          key={r.id ?? r.timestamp}
          title={`${formatDateTime(r.timestamp)}: ${STATUS_LABEL[r.testCaseStatus ?? 'Queued']}`}
          className="min-w-0 flex-1 rounded-sm"
          style={{ background: STATUS_COLOR[r.testCaseStatus ?? 'Queued'], opacity: r.testCaseStatus === 'Success' ? 0.55 : 1 }}
        />
      ))}
    </div>
  )
}
