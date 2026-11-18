import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { ChartTooltipContent } from '@/components/charts/ChartTooltip'
import { axisProps, gridProps, SERIES_COLORS } from '@/components/charts/palette'
import { Table as T, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCount } from '@/features/om/entity'

type Field = { name: string; type: string; isMeasure: boolean }

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'number') return Number.isInteger(v) ? formatCount(v) : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * A Malloy result: a chart when the shape suggests one (one dimension and
 * some measures; a line when the dimension is a date), then the table. Nested
 * results show as small inner tables.
 */
export function ResultView({ rows, fields }: { rows: Record<string, unknown>[]; fields: Field[] }) {
  const dims = fields.filter((f) => !f.isMeasure && f.type !== 'nested' && f.type !== 'view')
  const measures = fields.filter((f) => f.isMeasure && f.type === 'number')
  const chartable = dims.length === 1 && measures.length >= 1 && rows.length > 1 && rows.length <= 200
  const timeDim = chartable && /date|timestamp/.test(dims[0]!.type)
  const data = chartable ? rows.map((r) => ({ ...r, [dims[0]!.name]: fmt(r[dims[0]!.name]) })) : []
  const shown = measures.slice(0, timeDim ? 3 : 1)

  return (
    <div className="flex flex-col gap-4">
      {chartable && (
        <div className="h-56 rounded-xl border bg-card p-3">
          <ResponsiveContainer width="100%" height="100%">
            {timeDim ? (
              <LineChart data={data} margin={{ left: 8, right: 8, top: 4 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey={dims[0]!.name} {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} tickFormatter={(v: number) => formatCount(v)} width={56} />
                <Tooltip content={<Tip measures={shown} dim={dims[0]!.name} />} />
                {shown.map((m, i) => (
                  <Line key={m.name} dataKey={m.name} stroke={SERIES_COLORS[i]} strokeWidth={2} dot={false} type="monotone" />
                ))}
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ left: 8, right: 8, top: 4 }}>
                <CartesianGrid {...gridProps} />
                <XAxis
                  dataKey={dims[0]!.name}
                  {...axisProps}
                  interval={0}
                  angle={rows.length > 8 ? -30 : 0}
                  textAnchor={rows.length > 8 ? 'end' : 'middle'}
                  height={rows.length > 8 ? 60 : 30}
                />
                <YAxis {...axisProps} tickFormatter={(v: number) => formatCount(v)} width={56} />
                <Tooltip cursor={{ fill: 'var(--muted)' }} content={<Tip measures={shown} dim={dims[0]!.name} />} />
                <Bar dataKey={shown[0]!.name} fill={SERIES_COLORS[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      <DataTable rows={rows} />
    </div>
  )
}

function Tip({
  active,
  payload,
  measures,
  dim,
}: {
  active?: boolean
  payload?: { payload: Record<string, unknown>; dataKey?: unknown; color?: string }[]
  measures: Field[]
  dim: string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0]!.payload
  return (
    <ChartTooltipContent
      title={String(row[dim])}
      rows={measures.map((m, i) => ({ key: m.name, label: m.name, value: fmt(row[m.name]), color: SERIES_COLORS[i] }))}
    />
  )
}

function DataTable({ rows, nested }: { rows: Record<string, unknown>[]; nested?: boolean }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No rows.</p>
  const cols = Object.keys(rows[0]!)
  const shown = nested ? rows.slice(0, 10) : rows
  return (
    <div className={nested ? 'rounded-md border' : 'overflow-x-auto rounded-xl border'}>
      <T>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c} className="font-mono text-xs">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r, i) => (
            <TableRow key={i} className="align-top">
              {cols.map((c) => {
                const v = r[c]
                return (
                  <TableCell key={c} className={typeof v === 'number' ? 'text-right font-mono text-xs tabular-nums' : 'font-mono text-xs'}>
                    {Array.isArray(v) && v.length && typeof v[0] === 'object' ? (
                      <DataTable rows={v as Record<string, unknown>[]} nested />
                    ) : (
                      fmt(v)
                    )}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </T>
      {nested && rows.length > 10 && <p className="px-2 py-1 text-[11px] text-muted-foreground">+{rows.length - 10} more</p>}
    </div>
  )
}
