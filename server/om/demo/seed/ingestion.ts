import { ref, store, type Entity, type ResultRow } from '../store'
import { ownerRef } from './governance'
import { DAY, rng, today } from './random'

/**
 * Ingestion pipeline fixtures for the "bigquery" service, as OpenMetadata
 * 2.0.8 stores them (entity/services/ingestionPipelines/ingestionPipeline.json):
 * one pipeline per type with a realistic sourceConfig and Airflow schedule, and
 * two weeks of run history (PipelineStatus records) in store.pipelineRuns.
 */

const SERVICE = 'bigquery'

interface PipelineDef {
  type: 'metadata' | 'usage' | 'lineage' | 'profiler' | 'dbt' | 'autoClassification'
  name: string
  displayName: string
  description: string
  /** Cron, as Airflow takes it. */
  schedule: string
  enabled: boolean
  config: Record<string, unknown>
  /** Typical run length, minutes. */
  minutes: number
  /** Days ago (0 = today) whose run failed, or only partly succeeded. */
  failed?: number[]
  partial?: number[]
  failure?: string
  /** Records per run: [source step, sink step]. */
  records: [number, number]
}

const DEFS: PipelineDef[] = [
  {
    type: 'metadata',
    name: 'bigquery_metadata',
    displayName: 'BigQuery metadata',
    description: 'Projects, datasets, tables, views, columns and policy tags. Runs nightly.',
    schedule: '0 2 * * *',
    enabled: true,
    minutes: 6,
    records: [44, 44],
    config: {
      type: 'DatabaseMetadata',
      markDeletedTables: true,
      markDeletedStoredProcedures: true,
      includeTables: true,
      includeViews: true,
      includeTags: true,
      includeOwners: false,
      includeStoredProcedures: true,
      includeDDL: true,
      overrideMetadata: false,
      queryLogDuration: 1,
      queryParsingTimeoutLimit: 300,
      useFqnForFiltering: false,
      threads: 4,
      incremental: { enabled: false, lookbackDays: 7, safetyMarginDays: 1 },
      databaseFilterPattern: { includes: ['bigquery-public-data', 'acme-analytics'] },
      schemaFilterPattern: { includes: ['thelook_ecommerce', 'staging', 'marts', 'reporting'], excludes: ['^_.*', '.*_scratch$'] },
      tableFilterPattern: { excludes: ['.*_tmp$'] },
    },
  },
  {
    type: 'usage',
    name: 'bigquery_usage',
    displayName: 'BigQuery usage',
    description: 'Query counts from INFORMATION_SCHEMA.JOBS_BY_PROJECT in the US multi-region.',
    schedule: '0 4 * * *',
    enabled: true,
    minutes: 4,
    partial: [9],
    failure: 'Skipped 12 queries that could not be parsed',
    records: [1840, 37],
    config: {
      type: 'DatabaseUsage',
      queryLogDuration: 1,
      stageFileLocation: '/tmp/query_log',
      resultLimit: 5000,
      processQueryCostAnalysis: true,
      filterCondition: "user_email NOT LIKE '%gserviceaccount.com'",
    },
  },
  {
    type: 'lineage',
    name: 'bigquery_lineage',
    displayName: 'BigQuery lineage',
    description: 'Table and column lineage parsed from view definitions and query history.',
    schedule: '30 4 * * *',
    enabled: true,
    minutes: 7,
    failed: [3],
    failure:
      'google.api_core.exceptions.Forbidden: 403 Access Denied: Project acme-analytics: User does not have bigquery.jobs.listAll permission in project acme-analytics.',
    records: [1840, 29],
    config: {
      type: 'DatabaseLineage',
      queryLogDuration: 1,
      resultLimit: 5000,
      parsingTimeoutLimit: 300,
      processViewLineage: true,
      processQueryLineage: true,
      processStoredProcedureLineage: true,
      overrideViewLineage: false,
      processCrossDatabaseLineage: false,
      enableTempTableLineage: false,
      incrementalLineageProcessing: true,
      threads: 2,
      databaseFilterPattern: { includes: ['acme-analytics', 'bigquery-public-data'] },
    },
  },
  {
    type: 'profiler',
    name: 'bigquery_profiler',
    displayName: 'BigQuery profiler',
    description: 'Row counts and column statistics on a 10% sample. Marts and reporting only.',
    schedule: '0 6 * * *',
    enabled: true,
    minutes: 18,
    failed: [0, 8],
    failure:
      'google.api_core.exceptions.BadRequest: 400 Query exceeded limit for bytes billed: 10737418240. 21474836480 or higher required.',
    records: [21, 21],
    config: {
      type: 'Profiler',
      processingEngine: { type: 'Native' },
      includeViews: false,
      useFqnForFiltering: false,
      computeTableMetrics: true,
      computeColumnMetrics: true,
      useStatistics: false,
      randomizedSample: true,
      threadCount: 5,
      timeoutSeconds: 43200,
      profileSampleConfig: { sampleConfigType: 'STATIC', config: { profileSampleType: 'PERCENTAGE', profileSample: 10 } },
      databaseFilterPattern: { includes: ['acme-analytics'] },
      schemaFilterPattern: { includes: ['marts', 'reporting'] },
    },
  },
  {
    type: 'dbt',
    name: 'bigquery_dbt',
    displayName: 'dbt artifacts',
    description: 'Models, tests, descriptions and lineage from the acme-analytics dbt project (manifest.json in GCS).',
    schedule: '15 5 * * *',
    enabled: true,
    minutes: 3,
    records: [27, 27],
    config: {
      type: 'DBT',
      dbtConfigSource: {
        dbtConfigType: 'gcs',
        dbtSecurityConfig: { gcpConfig: { type: 'gcp_adc', projectId: 'acme-analytics' } },
        dbtPrefixConfig: { dbtBucketName: 'acme-dbt-artifacts', dbtObjectPrefix: 'prod/target' },
      },
      searchAcrossDatabases: false,
      dbtUpdateDescriptions: true,
      dbtUpdateOwners: false,
      includeTags: true,
      overrideLineage: false,
      dbtClassificationName: 'dbtTags',
      parsingTimeoutLimit: 300,
      includeMetrics: false,
    },
  },
  {
    type: 'autoClassification',
    name: 'bigquery_auto_classification',
    displayName: 'PII auto-classification',
    description: 'Tags columns that look like personal data (PII.Sensitive) from a 50-row sample. Paused while thresholds are reviewed.',
    schedule: '0 3 * * 0',
    enabled: false,
    minutes: 9,
    records: [44, 11],
    config: {
      type: 'AutoClassification',
      includeViews: true,
      useFqnForFiltering: false,
      storeSampleData: false,
      enableAutoClassification: true,
      confidence: 85,
      sampleDataCount: 50,
      classificationLanguage: 'en',
      databaseFilterPattern: { includes: ['bigquery-public-data', 'acme-analytics'] },
    },
  },
]

/** A deterministic UUID-shaped run id. */
function runId(r: ReturnType<typeof rng>): string {
  const hex = () => Math.floor(r.next() * 16).toString(16)
  const part = (n: number) => Array.from({ length: n }, hex).join('')
  return `${part(8)}-${part(4)}-4${part(3)}-a${part(3)}-${part(12)}`
}

/** Source and sink step names as the ingestion framework reports them. */
export function stepNames(type: string): [string, string] {
  switch (type) {
    case 'usage':
      return ['Query Log Usage', 'Table Usage']
    case 'lineage':
      return ['Lineage Source', 'OpenMetadata']
    case 'profiler':
      return ['OpenMetadata Profiler Source', 'Profiler']
    case 'dbt':
      return ['DBT', 'OpenMetadata']
    case 'autoClassification':
      return ['OpenMetadata Source', 'PII Processor']
    default:
      return ['BigQuery', 'OpenMetadata']
  }
}

/** A PipelineStatus record (ingestionPipeline.json#/definitions/pipelineStatus). */
export function makeRun(
  type: string,
  id: string,
  startDate: number,
  endDate: number | undefined,
  pipelineState: 'queued' | 'success' | 'failed' | 'running' | 'partialSuccess' | 'stopped',
  records: [number, number],
  failure?: string,
): ResultRow {
  const [source, sink] = stepNames(type)
  const failed = pipelineState === 'failed'
  const partial = pipelineState === 'partialSuccess'
  const status =
    pipelineState === 'running' || pipelineState === 'queued'
      ? []
      : [
          {
            name: source,
            records: failed ? Math.round(records[0] / 3) : records[0],
            updated_records: 0,
            warnings: partial ? 12 : 0,
            errors: failed ? 1 : 0,
            filtered: type === 'metadata' ? 6 : 0,
            failures:
              failed || partial
                ? [
                    {
                      name: failed ? source : 'Query parser',
                      error: failure ?? 'Run failed',
                      stackTrace: failed
                        ? `Traceback (most recent call last):\n  File "/home/airflow/.local/lib/python3.10/site-packages/metadata/ingestion/api/topology_runner.py", line 214, in process_nodes\n    yield from self._iter(node)\n${failure}`
                        : undefined,
                    },
                  ]
                : [],
          },
          {
            name: sink,
            records: failed ? 0 : records[1],
            updated_records: failed ? 0 : Math.round(records[1] * 0.2),
            warnings: 0,
            errors: 0,
            filtered: 0,
            failures: [],
          },
        ]
  return { runId: id, pipelineState, startDate, timestamp: startDate, endDate, status }
}

export function seedIngestion() {
  const service = store.byFqn('services/databaseServices', SERVICE)
  if (!service) return
  const svcRef = ref(service, 'databaseService')
  const r = rng(7)
  const t0 = today()

  for (const def of DEFS) {
    const [min, hour, , , dow] = def.schedule.split(' ')
    const runs: ResultRow[] = []
    for (let daysAgo = 14; daysAgo >= 0; daysAgo--) {
      const day = t0 - daysAgo * DAY
      if (dow !== '*' && new Date(day).getUTCDay() !== Number(dow)) continue
      if (!def.enabled && daysAgo < 7) continue // paused a week ago
      const start = day + Number(hour) * 3_600_000 + Number(min) * 60_000 + r.int(2, 40) * 1000
      if (start > Date.now()) continue
      const state = def.failed?.includes(daysAgo) ? 'failed' : def.partial?.includes(daysAgo) ? 'partialSuccess' : 'success'
      const minutes = Math.max(1, def.minutes * (0.75 + r.next() * 0.5)) * (state === 'failed' ? 0.4 : 1)
      const jitter = (n: number) => Math.round(n * (0.9 + r.next() * 0.2))
      runs.push(
        makeRun(
          def.type,
          runId(r),
          start,
          start + Math.round(minutes * 60_000),
          state,
          [jitter(def.records[0]), jitter(def.records[1])],
          def.failure,
        ),
      )
    }
    const pipelineFqn = `${SERVICE}.${def.name}`
    store.pipelineRuns.set(pipelineFqn, runs)
    const pipeline: Partial<Entity> & { name: string } = {
      name: def.name,
      displayName: def.displayName,
      fullyQualifiedName: pipelineFqn,
      description: def.description,
      pipelineType: def.type,
      service: svcRef,
      sourceConfig: { config: def.config },
      airflowConfig: {
        pausePipeline: false,
        concurrency: 1,
        startDate: new Date(t0 - 120 * DAY).toISOString(),
        pipelineTimezone: 'UTC',
        retries: def.type === 'metadata' ? 2 : 0,
        retryDelay: 300,
        pipelineCatchup: false,
        scheduleInterval: def.schedule,
        maxActiveRuns: 1,
        workflowDefaultView: 'tree',
        workflowDefaultViewOrientation: 'LR',
      },
      loggerLevel: 'INFO',
      raiseOnError: true,
      deployed: true,
      enabled: def.enabled,
      enableStreamableLogs: false,
      provider: 'user',
      owners: [ownerRef('Data Platform')],
      pipelineStatuses: runs.length ? [runs.at(-1)] : [],
      updatedAt: t0 - 20 * DAY,
      updatedBy: 'ada.park',
    }
    store.add('services/ingestionPipelines', pipeline)
  }
}
