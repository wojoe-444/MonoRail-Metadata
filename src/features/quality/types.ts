import type { EntityBase, EntityReference, TagLabel } from '@/features/om/types'

/** OpenMetadata 2.0.8 data quality shapes (openmetadata-spec tests/*.json), the parts this app reads. */

export type TestCaseStatus = 'Success' | 'Failed' | 'Aborted' | 'Queued'

export type DataQualityDimension =
  | 'Completeness'
  | 'Accuracy'
  | 'Consistency'
  | 'Validity'
  | 'Uniqueness'
  | 'Integrity'
  | 'SQL'
  | 'NoDimension'

export interface TestCaseParameterDefinition {
  name: string
  displayName?: string
  dataType?:
    | 'NUMBER'
    | 'INT'
    | 'FLOAT'
    | 'DOUBLE'
    | 'DECIMAL'
    | 'TIMESTAMP'
    | 'TIME'
    | 'DATE'
    | 'DATETIME'
    | 'ARRAY'
    | 'MAP'
    | 'SET'
    | 'STRING'
    | 'BOOLEAN'
  description?: string
  required?: boolean
  optionValues?: string[]
}

export interface TestDefinition extends EntityBase {
  entityType: 'TABLE' | 'COLUMN'
  testPlatforms?: string[]
  supportedDataTypes?: string[]
  parameterDefinition?: TestCaseParameterDefinition[]
  dataQualityDimension?: DataQualityDimension
  provider?: 'system' | 'user'
  supportsRowLevelPassedFailed?: boolean
  enabled?: boolean
}

export interface TestResultValue {
  name?: string
  value?: string
  predictedValue?: string
}

export interface TestCaseResult {
  id?: string
  testCaseFQN?: string
  timestamp: number
  testCaseStatus?: TestCaseStatus
  result?: string
  sampleData?: string
  testResultValue?: TestResultValue[]
  passedRows?: number
  failedRows?: number
  passedRowsPercentage?: number
  failedRowsPercentage?: number
  incidentId?: string
  minBound?: number
  maxBound?: number
}

export interface TestCaseParameterValue {
  name: string
  value: string
}

export interface TestCase extends EntityBase {
  testDefinition: EntityReference
  entityLink: string
  entityFQN?: string
  testSuite?: EntityReference
  testSuites?: (EntityReference & { basic?: boolean })[]
  parameterValues?: TestCaseParameterValue[]
  testCaseResult?: TestCaseResult
  testCaseStatus?: TestCaseStatus
  computePassedFailedRowCount?: boolean
  incidentId?: string
  createdBy?: string
  tags?: TagLabel[]
  inspectionQuery?: string
}

export interface TestSummary {
  success?: number
  failed?: number
  aborted?: number
  queued?: number
  total?: number
}

export interface TestSuite extends EntityBase {
  basic?: boolean
  executable?: boolean
  basicEntityReference?: EntityReference
  tests?: EntityReference[]
  summary?: TestSummary
}

export type IncidentStatusType = 'New' | 'Ack' | 'Assigned' | 'Resolved'
export type Severity = 'Severity1' | 'Severity2' | 'Severity3' | 'Severity4' | 'Severity5'
export type FailureReason = 'FalsePositive' | 'MissingData' | 'Duplicates' | 'OutOfBounds' | 'Other'

/** TestCaseResolutionStatus: one step of an incident. Steps of one incident share a stateId. */
export interface TestCaseResolutionStatus {
  id: string
  stateId: string
  timestamp: number
  testCaseResolutionStatusType: IncidentStatusType
  testCaseResolutionStatusDetails?: {
    assignee?: EntityReference
    testCaseFailureReason?: FailureReason
    testCaseFailureComment?: string
    resolvedBy?: EntityReference
  }
  updatedBy?: EntityReference
  updatedAt?: number
  testCaseReference?: EntityReference
  severity?: Severity
}
