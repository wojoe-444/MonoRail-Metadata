import { api, qs } from '@/lib/api'
import type { Estimate } from '@/features/semantic/api'

/** Calls to the server's Malloy endpoints (server/malloy/service.ts). */

export interface ModelSummary {
  path: string
  name: string
  tables: string[]
  sources: string[]
  updatedAt: number
  bytes: number
}

export interface OutlineField {
  name: string
  kind: 'dimension' | 'measure' | 'view' | 'join'
  type?: string
  description?: string
  fields?: OutlineField[]
}

export interface OutlineSource {
  name: string
  tablePath?: string
  primaryKey?: string
  fields: OutlineField[]
}

export interface Problem {
  message: string
  severity: string
  line?: number
  character?: number
}

export interface CompileResult {
  ok: boolean
  sources: OutlineSource[]
  sql?: string
  problems: Problem[]
}

export interface RunResult {
  ok: boolean
  sql?: string
  rows?: Record<string, unknown>[]
  fields?: { name: string; type: string; isMeasure: boolean }[]
  totalRows?: number
  runStats?: Record<string, unknown>
  ms?: number
  problems?: Problem[]
  /** True when BigQuery credentials are missing: the query compiled but did not run. */
  compileOnly?: boolean
  /** The BigQuery dry run the server does before running (bytes against BQ_MAX_BYTES_BILLED, row limit). */
  estimate?: Estimate
}

export const listModels = () => api<ModelSummary[]>('/api/malloy/models')
export const readModel = (path: string) => api<{ path: string; content: string }>(`/api/malloy/model${qs({ path })}`)
export const saveModel = (path: string, content: string) =>
  api<{ path: string; savedAt: number }>('/api/malloy/model', { method: 'PUT', json: { path, content } })
export const compileModel = (content: string, path?: string, query?: string) =>
  api<CompileResult>('/api/malloy/compile', { method: 'POST', json: { content, path, query } })
export const runQuery = (content: string, query: string, path?: string) =>
  api<RunResult>('/api/malloy/run', { method: 'POST', json: { content, path, query } })
export const tableUsage = (tablePath: string) =>
  api<{ model: string; sources: OutlineSource[]; problems: Problem[] }[]>(`/api/malloy/usage${qs({ table: tablePath })}`)

/** A starter Malloy source for a table: every column is already a dimension, so it adds a count and sums of numeric measures. */
export function scaffoldSource(
  sourceName: string,
  tablePath: string,
  columns: { name: string; dataType: string; dataTypeDisplay?: string; constraint?: string }[],
): string {
  const pk = columns.find((c) => c.constraint === 'PRIMARY_KEY')?.name
  const numeric = columns.filter(
    (c) =>
      /^(INT64|FLOAT64|NUMERIC|BIGNUMERIC|BIGINT|FLOAT|DOUBLE|DECIMAL|INT)$/.test((c.dataTypeDisplay ?? c.dataType).toUpperCase()) &&
      c.name !== pk &&
      !/_id$|^id$/.test(c.name),
  )
  const measures = [`${sourceName}_count is count()`, ...numeric.map((c) => `total_${c.name} is ${c.name}.sum()`)]
  const lines = [
    `source: ${sourceName} is bigquery.table('${tablePath}') extend {`,
    ...(pk ? [`  primary_key: ${pk}`] : []),
    `  measure:`,
    ...measures.map((m) => `    ${m}`),
    `}`,
    ``,
    `run: ${sourceName} -> { aggregate: ${sourceName}_count }`,
    ``,
  ]
  return lines.join('\n')
}

/** A Malloy identifier from a table name. */
export function malloyName(s: string): string {
  const n = s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1')
  return n || 'source'
}
