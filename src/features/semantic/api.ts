import { api } from '@/lib/api'
import type { Problem, RunResult } from '@/features/malloy/api'

/** The semantic-layer endpoints (server/malloy/routes.ts). Shapes mirror server/malloy/semantic.ts. */

export type MetricKind = 'simple' | 'filtered' | 'ratio' | 'derived'

export interface SemanticField {
  name: string
  kind: 'dimension' | 'measure' | 'view'
  type?: string
  column?: boolean
  description?: string
  glossaryTerm?: string
  definition?: string
  line?: number
  metricKind?: MetricKind
  aggregate?: string
  uses?: string[]
  usesMeasures?: string[]
  joins?: string[]
  tables?: { path: string; fqn: string }[]
  window?: boolean
  nests?: boolean
  builder?: string
}

export interface SemanticJoin {
  name: string
  join: 'one' | 'many' | 'cross'
  relationship?: string
  on?: string
  definition?: string
  line?: number
  sourceName?: string
  tablePath?: string
  tableFqn?: string
  primaryKey?: string
  fields: SemanticField[]
  joins: SemanticJoin[]
}

export interface SemanticSource {
  name: string
  model: string
  line?: number
  description?: string
  tablePath?: string
  tableFqn?: string
  primaryKey?: string
  fields: SemanticField[]
  joins: SemanticJoin[]
}

export interface SemanticModel {
  path: string
  ok: boolean
  problems: Problem[]
  sources: SemanticSource[]
}

export interface Metric extends SemanticField {
  model: string
  source: string
  sourceTablePath?: string
  sourceTableFqn?: string
}

export interface Estimate {
  configured: boolean
  bytes?: number
  maxBytesBilled: number
  overCap?: boolean
  rowLimit: number
  error?: string
}

export interface DryRunResult {
  ok: boolean
  sql?: string
  estimate?: Estimate
  problems: Problem[]
}

export type GuardedRunResult = RunResult

export interface PublishResult {
  dryRun: boolean
  published: { name: string; fullyQualifiedName?: string; status: 'created' | 'updated' | 'planned' | 'failed'; error?: string }[]
  lineage: { added: number; failed: number; error?: string }
}

export const getSemantic = () => api<SemanticModel[]>('/api/malloy/semantic')
export const getMetrics = () => api<Metric[]>('/api/malloy/metrics')
export const dryRunQuery = (path: string, query: string) =>
  api<DryRunResult>('/api/malloy/dryrun', { method: 'POST', json: { path, query } })
export const runSavedModelQuery = (path: string, query: string) =>
  api<GuardedRunResult>('/api/malloy/run', { method: 'POST', json: { path, query } })
export const saveView = (input: { model: string; source: string; name: string; description?: string; body: string; builder?: string }) =>
  api<{ ok: boolean; problems?: Problem[]; line?: number }>('/api/malloy/views', { method: 'POST', json: input })
export const publishMetrics = (dryRun = false) => api<PublishResult>('/api/malloy/publish-metrics', { method: 'POST', json: { dryRun } })

/** The OpenMetadata metric name a published measure gets (server/malloy/publish.ts). */
export const metricEntityName = (source: string, measure: string) => `${source}__${measure}`
