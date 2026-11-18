import { splitFqn } from '@/features/om/entity'

import type { IncidentStatusType, Severity, TestCase, TestCaseResult, TestCaseStatus } from './types'

/** Badge variant for a test status: green passed, red failed, amber aborted, blue queued. */
export const STATUS_VARIANT: Record<TestCaseStatus, 'success' | 'destructive' | 'warning' | 'info'> = {
  Success: 'success',
  Failed: 'destructive',
  Aborted: 'warning',
  Queued: 'info',
}

export const STATUS_LABEL: Record<TestCaseStatus, string> = { Success: 'Passed', Failed: 'Failed', Aborted: 'Aborted', Queued: 'Queued' }

/** Chart color for a status (status tokens). */
export const STATUS_COLOR: Record<TestCaseStatus, string> = {
  Success: 'var(--success)',
  Failed: 'var(--destructive)',
  Aborted: 'var(--warning)',
  Queued: 'var(--info)',
}

export const INCIDENT_LABEL: Record<IncidentStatusType, string> = {
  New: 'New',
  Ack: 'Acknowledged',
  Assigned: 'Assigned',
  Resolved: 'Resolved',
}
export const INCIDENT_VARIANT: Record<IncidentStatusType, 'destructive' | 'warning' | 'info' | 'success'> = {
  New: 'destructive',
  Ack: 'warning',
  Assigned: 'info',
  Resolved: 'success',
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  Severity1: 'Sev 1 · Critical',
  Severity2: 'Sev 2 · High',
  Severity3: 'Sev 3 · Medium',
  Severity4: 'Sev 4 · Low',
  Severity5: 'Sev 5 · Trivial',
}

export const FAILURE_REASON_LABEL = {
  FalsePositive: 'False positive',
  MissingData: 'Missing data',
  Duplicates: 'Duplicates',
  OutOfBounds: 'Out of bounds',
  Other: 'Other',
} as const

export interface ParsedLink {
  entityType: string
  /** FQN of the table. */
  entityFQN: string
  column?: string
}

/** `<#E::table::FQN>` or `<#E::table::FQN::columns::col>`. */
export function parseEntityLink(link: string | undefined): ParsedLink | undefined {
  const m = /^<#E::([^:]+)::(.+?)(?:::columns::(.+))?>$/.exec(link ?? '')
  if (!m) return undefined
  return { entityType: m[1]!, entityFQN: m[2]!, column: m[3]?.replace(/^"|"$/g, '') }
}

export function columnLink(tableFqn: string, column?: string): string {
  return column ? `<#E::table::${tableFqn}::columns::${column}>` : `<#E::table::${tableFqn}>`
}

/** Table name from a table FQN (the last part). */
export function tableNameOf(tableFqn: string): string {
  return splitFqn(tableFqn).pop() ?? tableFqn
}

/** dataset.table, the short label for a BigQuery table FQN (service.project.dataset.table). */
export function shortTable(tableFqn: string): string {
  return splitFqn(tableFqn).slice(-2).join('.')
}

export function statusOf(tc: TestCase): TestCaseStatus | undefined {
  return tc.testCaseResult?.testCaseStatus ?? tc.testCaseStatus
}

/** Validators report several values; this is the one worth charting for each. */
const PRIMARY = [
  'rowCount',
  'nullCount',
  'uniqueCount',
  'max',
  'min',
  'mean',
  'sum',
  'resultRowCount',
  'columnCount',
  'allowedValueCount',
  'likeCount',
  'missingCount',
  'countForbiddenValues',
  'maxValueLength',
]

export function primaryValue(r: TestCaseResult): { name: string; value: number } | undefined {
  const vals = (r.testResultValue ?? []).filter((v) => v.value !== undefined && v.value !== '' && !Number.isNaN(Number(v.value)))
  if (!vals.length) return undefined
  const best = [...vals].sort((a, b) => rank(a.name) - rank(b.name))[0]!
  return { name: best.name ?? 'value', value: Number(best.value) }
}

function rank(name: string | undefined) {
  const i = PRIMARY.indexOf(name ?? '')
  return i === -1 ? PRIMARY.length : i
}

/** "rowCount" → "Row count". */
export function humanize(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())
}

/** Parameter values as OpenMetadata stores them: arrays are JSON strings. Show them readably. */
export function formatParamValue(value: string): string {
  if (value.startsWith('[')) {
    try {
      const arr = JSON.parse(value) as unknown[]
      if (Array.isArray(arr)) return arr.map(String).join(', ')
    } catch {
      /* not JSON */
    }
  }
  return value
}

export function formatValue(n: number): string {
  if (Math.abs(n) >= 1000) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n)
}

export function formatDateTime(ts: number | undefined): string {
  if (!ts) return '–'
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
