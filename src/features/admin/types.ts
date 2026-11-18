import type { EntityBase, EntityReference } from '@/features/om/types'

/**
 * Ingestion pipeline shapes from OpenMetadata 2.0.8
 * (entity/services/ingestionPipelines/ingestionPipeline.json and status.json).
 */

export type PipelineType =
  | 'metadata'
  | 'usage'
  | 'lineage'
  | 'profiler'
  | 'autoClassification'
  | 'dbt'
  | 'TestSuite'
  | 'dataInsight'
  | 'elasticSearchReindex'
  | 'application'
  | 'policyAgent'

export type PipelineState = 'queued' | 'success' | 'failed' | 'running' | 'partialSuccess' | 'stopped'

export interface StepSummary {
  name: string
  records?: number
  updated_records?: number
  warnings?: number
  errors?: number
  filtered?: number
  failures?: { name: string; error: string; stackTrace?: string }[]
}

export interface PipelineStatus {
  runId?: string
  pipelineState?: PipelineState
  startDate?: number
  timestamp?: number
  endDate?: number
  status?: StepSummary[]
  config?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface AirflowConfig {
  pausePipeline?: boolean
  concurrency?: number
  startDate?: string
  endDate?: string
  pipelineTimezone?: string
  retries?: number
  retryDelay?: number
  pipelineCatchup?: boolean
  scheduleInterval?: string
  maxActiveRuns?: number
  workflowTimeout?: number
}

export interface IngestionPipeline extends EntityBase {
  pipelineType: PipelineType
  sourceConfig: { config?: Record<string, unknown> }
  airflowConfig: AirflowConfig
  service?: EntityReference
  /** OpenMetadata 2.x returns an array (the latest run); older servers returned one object. */
  pipelineStatuses?: PipelineStatus[] | PipelineStatus
  loggerLevel?: 'NOTSET' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  raiseOnError?: boolean
  deployed?: boolean
  enabled?: boolean
  provider?: string
}

/** The pipeline runner's answer to deploy / trigger / kill / status. */
export interface PipelineServiceClientResponse {
  code: number
  reason?: string
  platform?: string
  version?: string
}

/** GET /services/ingestionPipelines/logs/{id}/last: the log text sits under a per-type task key. */
export type PipelineLogs = Partial<
  Record<
    | 'logs'
    | 'ingestion_task'
    | 'usage_task'
    | 'lineage_task'
    | 'profiler_task'
    | 'dbt_task'
    | 'auto_classification_task'
    | 'test_suite_task'
    | 'data_insight_task'
    | 'application_task'
    | 'elasticsearch_reindex_task',
    string
  >
> & {
  total?: string
  after?: string
  error?: string
}
