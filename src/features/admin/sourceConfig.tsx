import { Badge } from '@/components/ui/badge'

/**
 * sourceConfig.config for each database pipeline type, from OpenMetadata
 * 2.0.8's metadataIngestion/*.json schemas. FIELDS drives both the
 * "Add ingestion" form and the readable view on the pipeline page.
 */

export type FieldKind = 'bool' | 'number' | 'text' | 'list'

export interface FieldSpec {
  /** Path inside sourceConfig.config, dotted for nested (filter patterns). */
  key: string
  label: string
  kind: FieldKind
  default: boolean | number | string
  help?: string
}

/** The `type` constant each pipeline type's config carries. */
export const CONFIG_TYPE: Record<string, string> = {
  metadata: 'DatabaseMetadata',
  usage: 'DatabaseUsage',
  lineage: 'DatabaseLineage',
  profiler: 'Profiler',
  dbt: 'DBT',
  autoClassification: 'AutoClassification',
}

export const DEFAULT_SCHEDULE: Record<string, string> = {
  metadata: '0 2 * * *',
  usage: '0 4 * * *',
  lineage: '30 4 * * *',
  profiler: '0 6 * * *',
  dbt: '15 5 * * *',
  autoClassification: '0 3 * * 0',
}

const projects: FieldSpec = {
  key: 'databaseFilterPattern.includes',
  label: 'Projects to include',
  kind: 'list',
  default: '',
  help: 'Regexes, comma separated. Empty includes every project.',
}
const datasetsIn: FieldSpec = { key: 'schemaFilterPattern.includes', label: 'Datasets to include', kind: 'list', default: '' }
const datasetsOut: FieldSpec = { key: 'schemaFilterPattern.excludes', label: 'Datasets to exclude', kind: 'list', default: '' }
const tablesOut: FieldSpec = { key: 'tableFilterPattern.excludes', label: 'Tables to exclude', kind: 'list', default: '' }

export const FIELDS: Record<string, FieldSpec[]> = {
  metadata: [
    { key: 'includeTables', label: 'Include tables', kind: 'bool', default: true },
    { key: 'includeViews', label: 'Include views', kind: 'bool', default: true },
    { key: 'includeTags', label: 'Include policy tags and labels', kind: 'bool', default: true },
    { key: 'includeDDL', label: 'Store DDL', kind: 'bool', default: false },
    {
      key: 'markDeletedTables',
      label: 'Mark deleted tables',
      kind: 'bool',
      default: true,
      help: 'Soft-delete tables that no longer exist in BigQuery.',
    },
    { key: 'includeStoredProcedures', label: 'Include stored procedures', kind: 'bool', default: true },
    { key: 'threads', label: 'Threads', kind: 'number', default: 1 },
    projects,
    datasetsIn,
    datasetsOut,
    tablesOut,
  ],
  usage: [
    { key: 'queryLogDuration', label: 'Days of query history', kind: 'number', default: 1 },
    { key: 'resultLimit', label: 'Query limit', kind: 'number', default: 1000 },
    {
      key: 'stageFileLocation',
      label: 'Stage file location',
      kind: 'text',
      default: '/tmp/query_log',
      help: 'Scratch folder on the ingestion runner.',
    },
    {
      key: 'filterCondition',
      label: 'Filter condition',
      kind: 'text',
      default: '',
      help: "SQL on the jobs view, e.g. user_email NOT LIKE '%gserviceaccount.com'.",
    },
    { key: 'processQueryCostAnalysis', label: 'Analyse query cost', kind: 'bool', default: true },
  ],
  lineage: [
    { key: 'queryLogDuration', label: 'Days of query history', kind: 'number', default: 1 },
    { key: 'resultLimit', label: 'Query limit', kind: 'number', default: 1000 },
    { key: 'processViewLineage', label: 'Lineage from views', kind: 'bool', default: true },
    { key: 'processQueryLineage', label: 'Lineage from queries', kind: 'bool', default: true },
    { key: 'processStoredProcedureLineage', label: 'Lineage from stored procedures', kind: 'bool', default: true },
    { key: 'overrideViewLineage', label: 'Override view lineage', kind: 'bool', default: false },
    { key: 'threads', label: 'Threads', kind: 'number', default: 1 },
    projects,
  ],
  profiler: [
    {
      key: 'profileSampleConfig.config.profileSample',
      label: 'Sample (% of rows)',
      kind: 'number',
      default: 100,
      help: '100 profiles every row. Lower values scan less and cost less.',
    },
    { key: 'computeTableMetrics', label: 'Table metrics', kind: 'bool', default: true },
    { key: 'computeColumnMetrics', label: 'Column metrics', kind: 'bool', default: true },
    { key: 'includeViews', label: 'Profile views', kind: 'bool', default: false },
    { key: 'useStatistics', label: 'Use table statistics', kind: 'bool', default: false },
    { key: 'threadCount', label: 'Threads', kind: 'number', default: 5 },
    { key: 'timeoutSeconds', label: 'Timeout per table (s)', kind: 'number', default: 43200 },
    projects,
    datasetsIn,
  ],
  dbt: [
    { key: 'dbtUpdateDescriptions', label: 'Overwrite descriptions from dbt', kind: 'bool', default: false },
    { key: 'dbtUpdateOwners', label: 'Overwrite owners from dbt', kind: 'bool', default: false },
    { key: 'includeTags', label: 'Import dbt tags', kind: 'bool', default: true },
    { key: 'dbtClassificationName', label: 'Classification for dbt tags', kind: 'text', default: 'dbtTags' },
  ],
  autoClassification: [
    {
      key: 'confidence',
      label: 'Confidence (%)',
      kind: 'number',
      default: 80,
      help: 'Only tag a column when the classifier is at least this sure.',
    },
    { key: 'sampleDataCount', label: 'Rows to sample', kind: 'number', default: 50 },
    { key: 'storeSampleData', label: 'Store sample rows', kind: 'bool', default: false },
    { key: 'enableAutoClassification', label: 'Apply tags', kind: 'bool', default: true },
    { key: 'includeViews', label: 'Include views', kind: 'bool', default: true },
    projects,
  ],
}

export type FieldValues = Record<string, boolean | number | string>

export function defaultValues(type: string): FieldValues {
  return Object.fromEntries((FIELDS[type] ?? []).map((f) => [f.key, f.default]))
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let cur = obj
  for (const p of parts.slice(0, -1)) {
    cur[p] = (cur[p] as Record<string, unknown>) ?? {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts.at(-1)!] = value
}

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

/** Turn form values into sourceConfig.config. Empty lists and text are left out so the server's defaults apply. */
export function buildConfig(type: string, values: FieldValues, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const config: Record<string, unknown> = { type: CONFIG_TYPE[type] }
  for (const f of FIELDS[type] ?? []) {
    const v = values[f.key]
    if (f.kind === 'list') {
      const xs = list(String(v ?? ''))
      if (xs.length) setPath(config, f.key, xs)
    } else if (f.kind === 'text') {
      if (String(v ?? '').trim()) setPath(config, f.key, String(v).trim())
    } else if (f.kind === 'number') {
      if (f.key.startsWith('profileSampleConfig')) {
        const pct = Number(v)
        if (pct > 0 && pct < 100)
          config.profileSampleConfig = { sampleConfigType: 'STATIC', config: { profileSampleType: 'PERCENTAGE', profileSample: pct } }
      } else if (v !== '' && !Number.isNaN(Number(v))) setPath(config, f.key, Number(v))
    } else setPath(config, f.key, Boolean(v))
  }
  return { ...config, ...extra }
}

// ---------- Reading a config back ----------

const SECRET = /token|password|privateKey|secret/i

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), obj)
}

const humanize = (k: string) =>
  k
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bDdl\b/i, 'DDL')
    .replace(/\bDbt\b/i, 'dbt')

/** Readable rows for a sourceConfig.config: known fields first with their labels, then anything else. */
export function configRows(type: string, config: Record<string, unknown> | undefined): { label: string; value: unknown; key: string }[] {
  if (!config) return []
  const rows: { label: string; value: unknown; key: string }[] = []
  const seen = new Set<string>(['type'])
  for (const f of FIELDS[type] ?? []) {
    const v = getPath(config, f.key)
    seen.add(f.key.split('.')[0]!)
    if (v === undefined) continue
    rows.push({ key: f.key, label: f.label, value: v })
  }
  for (const [k, v] of Object.entries(config)) {
    if (seen.has(k) || v === undefined || v === null) continue
    if (k.endsWith('FilterPattern') && v && typeof v === 'object') {
      const fp = v as { includes?: string[]; excludes?: string[] }
      const what = humanize(k.replace('FilterPattern', ''))
      if (fp.includes?.length) rows.push({ key: `${k}.includes`, label: `${what}s to include`, value: fp.includes })
      if (fp.excludes?.length) rows.push({ key: `${k}.excludes`, label: `${what}s to exclude`, value: fp.excludes })
      continue
    }
    rows.push({ key: k, label: humanize(k), value: v })
  }
  return rows
}

/** Masks anything that looks like a secret in a config before it is shown. */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact)
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET.test(k) && typeof x === 'string' ? '••••••' : redact(x)]),
  )
}

export function ConfigValue({ value }: { value: unknown }) {
  if (typeof value === 'boolean') return <Badge variant={value ? 'success' : 'secondary'}>{value ? 'Yes' : 'No'}</Badge>
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">–</span>
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((x, i) => (
          <code key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {typeof x === 'string' ? x : JSON.stringify(x)}
          </code>
        ))}
      </span>
    )
  }
  if (value && typeof value === 'object') return <code className="font-mono text-xs break-all">{JSON.stringify(redact(value))}</code>
  if (value === '' || value === undefined || value === null) return <span className="text-muted-foreground">–</span>
  return <span className={typeof value === 'number' ? 'tabular-nums' : 'font-mono text-xs break-all'}>{String(value)}</span>
}
