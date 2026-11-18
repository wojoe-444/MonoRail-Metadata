import { qs } from '@/lib/api'
import { enc, entityLink, om } from '@/features/om/api'
import type { Paged } from '@/features/om/types'

import type {
  DataQualityDimension,
  FailureReason,
  IncidentStatusType,
  Severity,
  TestCase,
  TestCaseParameterValue,
  TestCaseResolutionStatus,
  TestCaseResult,
  TestCaseStatus,
  TestDefinition,
  TestSuite,
  TestSummary,
} from './types'

/**
 * OpenMetadata 2.0.8 data quality calls (TestCaseResource, TestSuiteResource,
 * TestDefinitionResource, TestCaseResolutionStatusResource), the same
 * endpoints OpenMetadata's own UI uses in rest/testAPI.ts and rest/incidentManagerAPI.ts.
 */

/** Fields a test case list needs: latest result, definition, suite and open incident. */
export const TEST_CASE_LIST_FIELDS = 'testCaseResult,testDefinition,testSuite,incidentId'
export const TEST_CASE_FIELDS = 'testCaseResult,testDefinition,testSuite,testSuites,incidentId,owners,tags'

export function getExecutionSummary(testSuiteId?: string): Promise<TestSummary> {
  return om(`/dataQuality/testSuites/executionSummary${qs({ testSuiteId })}`)
}

export interface TestCaseSearchParams {
  q?: string
  testCaseStatus?: TestCaseStatus[]
  testCaseType?: 'all' | 'table' | 'column'
  /** Restrict to one table (with includeAllTests, its column tests too). */
  tableFqn?: string
  dataQualityDimension?: DataQualityDimension
  offset?: number
  limit?: number
  sortField?: string
  sortType?: 'asc' | 'desc'
}

/** GET /dataQuality/testCases/search/list: server-side filtered, paged by offset. */
export function searchTestCases(p: TestCaseSearchParams): Promise<Paged<TestCase> & { paging: { offset?: number; limit?: number } }> {
  return om(
    `/dataQuality/testCases/search/list${qs({
      q: p.q?.trim() ? `*${p.q.trim()}*` : undefined,
      testCaseStatus: p.testCaseStatus?.length ? p.testCaseStatus.join(',') : undefined,
      testCaseType: p.testCaseType ?? 'all',
      entityLink: p.tableFqn ? entityLink('table', p.tableFqn) : undefined,
      includeAllTests: p.tableFqn ? true : undefined,
      dataQualityDimension: p.dataQualityDimension,
      offset: p.offset ?? 0,
      limit: p.limit ?? 25,
      sortField: p.sortField ?? 'testCaseResult.timestamp',
      sortType: p.sortType ?? 'desc',
      fields: TEST_CASE_LIST_FIELDS,
    })}`,
  )
}

/** Every test on a table and its columns. */
export function listTableTestCases(tableFqn: string): Promise<Paged<TestCase>> {
  return om(
    `/dataQuality/testCases${qs({ entityLink: entityLink('table', tableFqn), includeAllTests: true, fields: TEST_CASE_LIST_FIELDS, limit: 500 })}`,
  )
}

export function getTestCase(fqn: string): Promise<TestCase> {
  return om(`/dataQuality/testCases/name/${enc(fqn)}${qs({ fields: TEST_CASE_FIELDS })}`)
}

export function getTestCaseResults(fqn: string, startTs: number, endTs = Date.now()): Promise<Paged<TestCaseResult>> {
  return om(`/dataQuality/testCases/testCaseResults/${enc(fqn)}${qs({ startTs, endTs })}`)
}

export interface CreateTestCase {
  name: string
  displayName?: string
  description?: string
  /** FQN of the test definition. */
  testDefinition: string
  entityLink: string
  parameterValues: TestCaseParameterValue[]
  computePassedFailedRowCount?: boolean
}

/** POST /dataQuality/testCases. OpenMetadata adds it to the table's basic test suite (creating that suite if needed). */
export function createTestCase(body: CreateTestCase): Promise<TestCase> {
  return om(`/dataQuality/testCases`, { method: 'POST', json: body })
}

export function deleteTestCase(id: string) {
  return om(`/dataQuality/testCases/${id}${qs({ hardDelete: true, recursive: true })}`, { method: 'DELETE' })
}

export function listTestDefinitions(
  p: { entityType?: 'TABLE' | 'COLUMN'; supportedDataType?: string } = {},
): Promise<Paged<TestDefinition>> {
  return om(
    `/dataQuality/testDefinitions${qs({ entityType: p.entityType, supportedDataType: p.supportedDataType, testPlatform: 'OpenMetadata', limit: 1000 })}`,
  )
}

export function getTestDefinition(fqn: string): Promise<TestDefinition> {
  return om(`/dataQuality/testDefinitions/name/${enc(fqn)}`)
}

/** Basic (table-level) test suites that hold at least one test: one per tested table. */
export function listBasicTestSuites(): Promise<Paged<TestSuite>> {
  return om(`/dataQuality/testSuites${qs({ testSuiteType: 'basic', includeEmptyTestSuites: false, limit: 1000 })}`)
}

// ---------- Incidents ----------

export interface IncidentListParams {
  latest?: boolean
  startTs?: number
  endTs?: number
  testCaseFQN?: string
  testCaseResolutionStatusType?: IncidentStatusType
  limit?: number
  offset?: number
}

export function listIncidents(p: IncidentListParams): Promise<Paged<TestCaseResolutionStatus>> {
  return om(`/dataQuality/testCases/testCaseIncidentStatus${qs({ limit: 100, ...p })}`)
}

export function getIncidentHistory(stateId: string): Promise<Paged<TestCaseResolutionStatus>> {
  return om(`/dataQuality/testCases/testCaseIncidentStatus/stateId/${stateId}`)
}

export interface CreateIncidentStatus {
  /** FQN of the test case. */
  testCaseReference: string
  testCaseResolutionStatusType: IncidentStatusType
  testCaseResolutionStatusDetails?: {
    assignee?: { id: string; type: string; name?: string; fullyQualifiedName?: string }
    testCaseFailureReason?: FailureReason
    testCaseFailureComment?: string
  }
  severity?: Severity
}

export function postIncidentStatus(body: CreateIncidentStatus): Promise<TestCaseResolutionStatus> {
  return om(`/dataQuality/testCases/testCaseIncidentStatus`, { method: 'POST', json: body })
}
