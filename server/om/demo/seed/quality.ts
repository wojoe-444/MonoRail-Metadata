import { randomUUID } from 'node:crypto'

import { fqn, ref, store, type Entity, type ResultRow } from '../store'
import { userRef } from './governance'
import { DAY, rng, today } from './random'

/**
 * Data quality fixtures in OpenMetadata 2.0.8's shapes:
 *
 * - testDefinitions: the built-in OpenMetadata test types (a subset).
 * - testSuites: one basic (executable) suite per tested table, FQN `<table>.testSuite`,
 *   plus one logical suite.
 * - testCases: FQN `<table>.<name>` or `<table>.<column>.<name>`, entityLink
 *   `<#E::table::FQN>` or `<#E::table::FQN::columns::col>`.
 * - store.testResults: 30 daily results per test case (TestCaseResult).
 * - incidents: TestCaseResolutionStatus records (New → Ack → Assigned → Resolved),
 *   grouped by stateId, for failing tests.
 */

export const SERVICE = 'bigquery'
const PUB = 'bigquery-public-data'
const RAW = 'thelook_ecommerce'
const ACME = 'acme-analytics'

/** A TestCaseResolutionStatus record. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Incident = Record<string, any> & { id: string; stateId: string; timestamp: number }

/** TestCaseResolutionStatus records, oldest first. */
export const incidents: Incident[] = []

// ---------- Test definitions ----------

type Param = [name: string, dataType: string, description: string, required?: boolean, optionValues?: string[]]

interface DefSpec {
  name: string
  displayName: string
  entityType: 'TABLE' | 'COLUMN'
  dimension: string
  description: string
  params: Param[]
  dataTypes?: string[]
  rowLevel?: boolean
}

const NUMERIC = [
  'NUMBER',
  'TINYINT',
  'SMALLINT',
  'INT',
  'BIGINT',
  'BYTEINT',
  'BYTES',
  'FLOAT',
  'DOUBLE',
  'DECIMAL',
  'NUMERIC',
  'BIGNUMERIC',
  'LONG',
]
const TEXT = ['BYTES', 'STRING', 'MEDIUMTEXT', 'TEXT', 'CHAR', 'VARCHAR']
const ANY = [...NUMERIC, ...TEXT, 'BOOLEAN', 'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'ARRAY', 'STRUCT', 'JSON', 'GEOGRAPHY']

const DEFINITIONS: DefSpec[] = [
  {
    name: 'tableRowCountToBeBetween',
    displayName: 'Table Row Count To Be Between',
    entityType: 'TABLE',
    dimension: 'Integrity',
    description: 'This schema defines the test TableRowCountToBeBetween. Test the number of rows to between to two values.',
    params: [
      [
        'minValue',
        'INT',
        'Expected number of rows should be greater than or equal to {minValue}. If minValue is not included, maxValue is treated as upperBound and there will be no minimum',
      ],
      [
        'maxValue',
        'INT',
        'Expected number of rows should be lower than or equal to {maxValue}. If maxValue is not included, minValue is treated as lowerBound and there will be no maximum',
      ],
    ],
  },
  {
    name: 'tableRowCountToEqual',
    displayName: 'Table Row Count To Equal',
    entityType: 'TABLE',
    dimension: 'Integrity',
    description: 'This schema defines the test TableRowCountToEqual. Test the number of rows equal to a value.',
    params: [['value', 'INT', 'Expected number of rows {value}', true]],
  },
  {
    name: 'tableColumnCountToEqual',
    displayName: 'Table Column Count To Equal',
    entityType: 'TABLE',
    dimension: 'Integrity',
    description: 'This test defines the test TableColumnCountToEqual. Test the number of columns equal to a value.',
    params: [['columnCount', 'INT', 'Expected number of columns to equal to a {value}', true]],
  },
  {
    name: 'tableColumnNameToExist',
    displayName: 'Table Column Name To Exist',
    entityType: 'TABLE',
    dimension: 'Integrity',
    description: 'This test defines the test TableColumnNameToExist. Test the table columns exists in the table.',
    params: [['columnName', 'STRING', 'Expected column of the table to exist', true]],
  },
  {
    name: 'tableRowInsertedCountToBeBetween',
    displayName: 'Table Row Inserted Count To be Between',
    entityType: 'TABLE',
    dimension: 'Integrity',
    description: 'This schema defines the test tableRowInsertedCountToBeBetween. Test the number of rows inserted is between x and y.',
    params: [
      ['min', 'INT', 'Lower bound of the number of rows inserted.'],
      ['max', 'INT', 'Upper bound of the number of rows inserted.'],
      ['columnName', 'STRING', 'Name of the column used to filter the rows inserted (a date or timestamp column).', true],
      [
        'rangeType',
        'STRING',
        'One of HOUR, DAY, MONTH, YEAR to specify the range type for the inserted rows.',
        true,
        ['HOUR', 'DAY', 'MONTH', 'YEAR'],
      ],
      ['rangeInterval', 'INT', 'Interval range for the inserted rows.', true],
    ],
  },
  {
    name: 'tableCustomSQLQuery',
    displayName: 'Custom SQL Query',
    entityType: 'TABLE',
    dimension: 'SQL',
    description: 'Test if a custom SQL returns 0 rows or `COUNT(<x>) == 0`.',
    params: [
      ['sqlExpression', 'STRING', 'SQL expression to run against the table', true],
      [
        'strategy',
        'ARRAY',
        'Strategy to use to run the custom SQL query (i.e. `SELECT COUNT(<col>)` or `SELECT <col> (defaults to ROWS)',
        false,
        ['ROWS', 'COUNT'],
      ],
      ['threshold', 'NUMBER', 'Threshold to use to determine if the test passes or fails (defaults to 0).'],
    ],
  },
  {
    name: 'columnValuesToBeNotNull',
    displayName: 'Column Values To Be Not Null',
    entityType: 'COLUMN',
    dimension: 'Completeness',
    rowLevel: true,
    dataTypes: ANY,
    description:
      "This schema defines the test ColumnValuesToBeNotNull. Test the number of values in a column are null. Values must be explicitly null. Empty strings don't count as null.",
    params: [],
  },
  {
    name: 'columnValuesToBeUnique',
    displayName: 'Column Values To Be Unique',
    entityType: 'COLUMN',
    dimension: 'Uniqueness',
    rowLevel: true,
    dataTypes: ANY,
    description: 'This schema defines the test ColumnValuesToBeUnique. Test the values in a column to be unique.',
    params: [],
  },
  {
    name: 'columnValuesToBeBetween',
    displayName: 'Column Values To Be Between',
    entityType: 'COLUMN',
    dimension: 'Accuracy',
    rowLevel: true,
    dataTypes: [...NUMERIC, 'DATE', 'DATETIME', 'TIMESTAMP'],
    description:
      'This schema defines the test ColumnValuesToBeBetween. Test the values in a column to be between minimum and maximum value.',
    params: [
      [
        'minValue',
        'NUMBER',
        'The {minValue} value for the column entry. If minValue is not included, maxValue is treated as upperBound and there will be no minimum',
      ],
      [
        'maxValue',
        'NUMBER',
        'The {maxValue} value for the column entry. if maxValue is not included, minValue is treated as lowerBound and there will be no maximum',
      ],
    ],
  },
  {
    name: 'columnValuesToBeInSet',
    displayName: 'Column Values To Be In Set',
    entityType: 'COLUMN',
    dimension: 'Validity',
    rowLevel: true,
    dataTypes: [...NUMERIC, ...TEXT, 'BOOLEAN'],
    description: 'This schema defines the test ColumnValuesToBeInSet. Test the column values are in the set.',
    params: [
      ['allowedValues', 'ARRAY', 'An Array of values.', true],
      ['matchEnum', 'BOOLEAN', 'If enabled, validate that each value independently matches the enum.'],
    ],
  },
  {
    name: 'columnValuesToBeNotInSet',
    displayName: 'Column Values To Be Not In Set',
    entityType: 'COLUMN',
    dimension: 'Validity',
    rowLevel: true,
    dataTypes: [...NUMERIC, ...TEXT, 'BOOLEAN'],
    description: 'This schema defines the test ColumnValuesToBeNotInSet. Test the column values to not be in the set.',
    params: [['forbiddenValues', 'ARRAY', 'An Array of values.', true]],
  },
  {
    name: 'columnValuesToMatchRegex',
    displayName: 'Column Values To Match Regex Pattern',
    entityType: 'COLUMN',
    dimension: 'Validity',
    rowLevel: true,
    dataTypes: TEXT,
    description: 'This schema defines the test ColumnValuesToMatchRegex. Test the values in a column to match a given regular expression.',
    params: [['regex', 'STRING', 'The regular expression the column entries should match.', true]],
  },
  {
    name: 'columnValuesMissingCount',
    displayName: 'Column Values Missing Count',
    entityType: 'COLUMN',
    dimension: 'Completeness',
    dataTypes: ANY,
    description: 'This schema defines the test ColumnValuesMissingCount. Test the column values missing count to be equal to given number.',
    params: [
      ['missingCountValue', 'INT', 'The number of missing values needs to be equal to this. This includes null values.', true],
      [
        'missingValueMatch',
        'ARRAY',
        'By default match all null and empty values to be missing. This field allows us to configure additional strings such as N/A, NULL as missing strings as well.',
      ],
    ],
  },
  {
    name: 'columnValueMaxToBeBetween',
    displayName: 'Column Value Max. to be Between',
    entityType: 'COLUMN',
    dimension: 'Accuracy',
    dataTypes: NUMERIC,
    description: 'This schema defines the test ColumnValueMaxToBeBetween. Test the maximum value in a col is within a range.',
    params: [
      ['minValueForMaxInCol', 'NUMBER', 'Expected maximum value in the column to be greater or equal than'],
      ['maxValueForMaxInCol', 'NUMBER', 'Expect maximum value in the column to be lower or equal than'],
    ],
  },
  {
    name: 'columnValueMinToBeBetween',
    displayName: 'Column Value Min. to be Between',
    entityType: 'COLUMN',
    dimension: 'Accuracy',
    dataTypes: NUMERIC,
    description: 'This schema defines the test ColumnValueMinToBeBetween. Test the minimum value in a col is within a range.',
    params: [
      ['minValueForMinInCol', 'NUMBER', 'Expected minimum value in the column to be greater or equal than'],
      ['maxValueForMinInCol', 'NUMBER', 'Expected minimum value in the column to be lower or equal than'],
    ],
  },
  {
    name: 'columnValueMeanToBeBetween',
    displayName: 'Column Value Mean To Be Between',
    entityType: 'COLUMN',
    dimension: 'Accuracy',
    dataTypes: NUMERIC,
    description: 'This schema defines the test ColumnValueMeanToBeBetween. Test the mean value in a col is within a range.',
    params: [
      ['minValueForMeanInCol', 'NUMBER', 'Expected mean value for the column to be greater or equal than'],
      ['maxValueForMeanInCol', 'NUMBER', 'Expected mean value for the column to be lower or equal than'],
    ],
  },
  {
    name: 'columnValuesSumToBeBetween',
    displayName: 'Column Values Sum To Be Between',
    entityType: 'COLUMN',
    dimension: 'Accuracy',
    dataTypes: NUMERIC,
    description: 'This schema defines the test ColumnValuesSumToBeBetween. Test the sum of the values of a col is within a range.',
    params: [
      ['minValueForColSum', 'NUMBER', 'Expected sum of values in the column to be greater or equal than'],
      ['maxValueForColSum', 'NUMBER', 'Expected sum values in the column to be lower or equal than'],
    ],
  },
  {
    name: 'columnValueLengthsToBeBetween',
    displayName: 'Column Value Lengths To Be Between',
    entityType: 'COLUMN',
    dimension: 'Accuracy',
    rowLevel: true,
    dataTypes: TEXT,
    description:
      'This schema defines the test ColumnValueLengthsToBeBetween. Test the value lengths in a column to be between minimum and maximum value.',
    params: [
      [
        'minLength',
        'INT',
        'The {minLength} for the column value. If minLength is not included, maxLength is treated as upperBound and there will be no minimum value length',
      ],
      [
        'maxLength',
        'INT',
        'The {maxLength} for the column value. if maxLength is not included, minLength is treated as lowerBound and there will be no maximum value length',
      ],
    ],
  },
]

// ---------- Test cases ----------

type Status = 'Success' | 'Failed' | 'Aborted'

interface CaseSpec {
  /** "dataset.table" or "dataset.table.column". */
  target: string
  def: string
  name?: string
  description?: string
  params?: Record<string, string>
  /** Observed value around which daily results vary. */
  base: number
  /** Status per day, index 0 = today. Anything not listed is Success. */
  failDays?: number[]
  abortDays?: number[]
  /** Value used on failing days. */
  failValue?: number
  owner?: string
  computeRows?: boolean
}

const SET_TRAFFIC = JSON.stringify(['Search', 'Organic', 'Email', 'Facebook', 'Display'])

const CASES: CaseSpec[] = [
  // Raw: thelook_ecommerce
  {
    target: `${RAW}.users`,
    def: 'tableRowCountToBeBetween',
    params: { minValue: '90000', maxValue: '150000' },
    base: 100_000,
    description: 'The users export should hold 90k–150k accounts.',
  },
  { target: `${RAW}.users.id`, def: 'columnValuesToBeUnique', base: 100_000 },
  { target: `${RAW}.users.email`, def: 'columnValuesToBeNotNull', base: 0, computeRows: true },
  { target: `${RAW}.users.age`, def: 'columnValuesToBeBetween', params: { minValue: '12', maxValue: '100' }, base: 70 },
  { target: `${RAW}.users.gender`, def: 'columnValuesToBeInSet', params: { allowedValues: JSON.stringify(['M', 'F']) }, base: 100_000 },
  {
    target: `${RAW}.users.traffic_source`,
    def: 'columnValuesToBeInSet',
    params: { allowedValues: SET_TRAFFIC },
    base: 100_000,
    failDays: [0, 1, 2],
    failValue: 412,
    computeRows: true,
    description: 'Traffic source must be one of the five known channels. Downstream attribution maps only these.',
  },
  { target: `${RAW}.orders.order_id`, def: 'columnValuesToBeUnique', base: 125_000 },
  {
    target: `${RAW}.orders.status`,
    def: 'columnValuesToBeInSet',
    params: { allowedValues: JSON.stringify(['Processing', 'Shipped', 'Complete', 'Cancelled', 'Returned']) },
    base: 125_000,
  },
  { target: `${RAW}.orders.user_id`, def: 'columnValuesToBeNotNull', base: 0 },
  { target: `${RAW}.orders.num_of_item`, def: 'columnValuesToBeBetween', params: { minValue: '1', maxValue: '4' }, base: 4 },
  { target: `${RAW}.order_items`, def: 'tableRowCountToBeBetween', params: { minValue: '150000', maxValue: '250000' }, base: 181_000 },
  { target: `${RAW}.order_items.sale_price`, def: 'columnValuesToBeBetween', params: { minValue: '0', maxValue: '1000' }, base: 999 },
  {
    target: `${RAW}.events`,
    def: 'tableRowCountToBeBetween',
    params: { minValue: '2000000', maxValue: '3000000' },
    base: 2_430_000,
    abortDays: [0, 9],
    description: 'Scans the full events table; may time out on busy days.',
  },
  { target: `${RAW}.events.session_id`, def: 'columnValuesToBeNotNull', base: 0 },
  {
    target: `${RAW}.events.event_type`,
    def: 'columnValuesToBeInSet',
    params: { allowedValues: JSON.stringify(['home', 'department', 'product', 'cart', 'purchase', 'cancel']) },
    base: 2_430_000,
  },
  { target: `${RAW}.distribution_centers`, def: 'tableRowCountToEqual', params: { value: '10' }, base: 10 },

  // Staging
  {
    target: 'staging.stg_users.email_hash',
    def: 'columnValuesToMatchRegex',
    params: { regex: '^[0-9a-f]{64}$' },
    base: 100_000,
    description: 'Hashes are lowercase hex SHA-256.',
  },
  { target: 'staging.stg_orders', def: 'tableColumnCountToEqual', params: { columnCount: '10' }, base: 10 },

  // Marts
  { target: 'marts.fct_order_items.order_item_id', def: 'columnValuesToBeUnique', base: 181_000, owner: 'lena.ruiz' },
  { target: 'marts.fct_order_items.gross_revenue', def: 'columnValuesToBeNotNull', base: 0, owner: 'lena.ruiz', computeRows: true },
  {
    target: 'marts.fct_order_items.gross_margin',
    def: 'columnValueMinToBeBetween',
    params: { minValueForMinInCol: '-50', maxValueForMinInCol: '100' },
    base: 0.02,
    owner: 'lena.ruiz',
    failDays: [17],
    failValue: -212.4,
  },
  {
    target: 'marts.fct_order_items.net_revenue',
    def: 'columnValuesSumToBeBetween',
    params: { minValueForColSum: '7000000', maxValueForColSum: '12000000' },
    base: 9_800_000,
    owner: 'lena.ruiz',
  },
  {
    target: 'marts.fct_order_items',
    def: 'tableCustomSQLQuery',
    name: 'net_revenue_not_above_gross',
    owner: 'lena.ruiz',
    description: 'Net revenue can never exceed gross revenue on a line.',
    params: {
      sqlExpression: 'SELECT * FROM `acme-analytics.marts.fct_order_items` WHERE net_revenue > gross_revenue',
      strategy: 'ROWS',
      threshold: '0',
    },
    base: 0,
  },
  {
    target: 'marts.fct_orders.order_id',
    def: 'columnValuesToBeUnique',
    base: 118_000,
    failDays: [0, 1, 2, 3, 4, 5],
    failValue: 117_640,
    owner: 'lena.ruiz',
    computeRows: true,
    description: 'One row per order. Duplicates mean the roll-up from fct_order_items fanned out.',
  },
  { target: 'marts.dim_customers.user_id', def: 'columnValuesToBeUnique', base: 100_000, owner: 'sam.okafor' },
  {
    target: 'marts.dim_customers.lifetime_net_revenue',
    def: 'columnValueMaxToBeBetween',
    params: { minValueForMaxInCol: '0', maxValueForMaxInCol: '20000' },
    base: 4_870,
    owner: 'sam.okafor',
  },
  { target: 'marts.dim_customers.is_active', def: 'columnValuesToBeNotNull', base: 0, owner: 'sam.okafor' },
  { target: 'marts.fct_sessions.session_id', def: 'columnValuesToBeUnique', base: 680_000, owner: 'ravi.menon' },
  {
    target: 'marts.fct_sessions.traffic_source',
    def: 'columnValuesToBeInSet',
    params: { allowedValues: SET_TRAFFIC },
    base: 680_000,
    failDays: [0, 1],
    failValue: 2_904,
    owner: 'ravi.menon',
    computeRows: true,
  },

  // Reporting
  {
    target: 'reporting.daily_revenue',
    def: 'tableRowInsertedCountToBeBetween',
    name: 'daily_revenue_loaded_daily',
    params: { min: '1', max: '1', columnName: 'order_date', rangeType: 'DAY', rangeInterval: '1' },
    base: 1,
    failDays: [12, 13],
    failValue: 0,
    owner: 'june.kim',
    description: 'Exactly one new row lands per day.',
  },
  {
    target: 'reporting.daily_revenue.net_revenue',
    def: 'columnValueMeanToBeBetween',
    params: { minValueForMeanInCol: '2000', maxValueForMeanInCol: '8000' },
    base: 4_100,
    owner: 'june.kim',
  },
  {
    target: 'reporting.daily_revenue.return_rate',
    def: 'columnValuesToBeBetween',
    params: { minValue: '0', maxValue: '0.3' },
    base: 0.11,
    owner: 'june.kim',
  },
]

/** Incidents: test case key → sequence of [status, daysAgo, by, extra]. The last cycle stays open unless it ends in Resolved. */
const INCIDENTS: {
  target: string
  severity: string
  steps: [type: string, hoursAgo: number, by: string, assignee?: string, resolution?: [string, string]][]
}[] = [
  { target: `${RAW}.users.traffic_source`, severity: 'Severity3', steps: [['New', 70, 'ingestion-bot']] },
  {
    target: 'marts.fct_orders.order_id',
    severity: 'Severity1',
    steps: [
      ['New', 142, 'ingestion-bot'],
      ['Ack', 130, 'lena.ruiz'],
      ['Assigned', 129, 'lena.ruiz', 'lena.ruiz'],
    ],
  },
  {
    target: 'marts.fct_sessions.traffic_source',
    severity: 'Severity2',
    steps: [
      ['New', 46, 'ingestion-bot'],
      ['Ack', 30, 'ravi.menon'],
    ],
  },
  {
    target: 'reporting.daily_revenue',
    severity: 'Severity2',
    steps: [
      ['New', 13 * 24 - 2, 'ingestion-bot'],
      ['Assigned', 13 * 24 - 4, 'june.kim', 'ada.park'],
      ['Resolved', 11 * 24, 'ada.park', undefined, ['MissingData', 'Upstream orders export landed late two days in a row; backfilled.']],
    ],
  },
  {
    target: 'marts.fct_order_items.gross_margin',
    severity: 'Severity4',
    steps: [
      ['New', 17 * 24 - 2, 'ingestion-bot'],
      [
        'Resolved',
        16 * 24,
        'lena.ruiz',
        undefined,
        ['FalsePositive', 'A refund line with negative cost; the product cost was corrected at source.'],
      ],
    ],
  },
]

export function seedQuality() {
  const r = rng(7)
  const t0 = today()

  for (const d of DEFINITIONS) {
    store.add('dataQuality/testDefinitions', {
      name: d.name,
      displayName: d.displayName,
      fullyQualifiedName: d.name,
      description: d.description,
      entityType: d.entityType,
      testPlatforms: ['OpenMetadata'],
      supportedDataTypes: d.dataTypes ?? [],
      parameterDefinition: d.params.map(([name, dataType, description, required, optionValues]) => ({
        name,
        displayName: name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
        dataType,
        description,
        required: Boolean(required),
        optionValues: optionValues ?? [],
      })),
      dataQualityDimension: d.dimension,
      provider: 'system',
      supportsRowLevelPassedFailed: Boolean(d.rowLevel),
      supportsDynamicAssertion: d.entityType === 'COLUMN' || d.name.startsWith('tableRowCount'),
      enabled: true,
      owners: undefined,
      tags: undefined,
      followers: undefined,
      domains: undefined,
    })
  }

  const cases = new Map<string, Entity>()
  for (const spec of CASES) {
    const [dataset, table, column] = spec.target.split('.')
    const project = dataset === RAW ? PUB : ACME
    const tableFqn = fqn(SERVICE, project, dataset!, table!)
    const tableEntity = store.byFqn('tables', tableFqn)
    if (!tableEntity) throw new Error(`Demo quality seed: no table ${tableFqn}`)
    const def = store.byFqn('dataQuality/testDefinitions', spec.def)!
    const name = spec.name ?? `${table}_${column ? `${column}_` : ''}${toSnake(spec.def)}`
    const tc = createTestCase({
      name,
      description: spec.description ?? '',
      testDefinition: def.fullyQualifiedName!,
      entityLink: column ? `<#E::table::${tableFqn}::columns::${column}>` : `<#E::table::${tableFqn}>`,
      parameterValues: Object.entries(spec.params ?? {}).map(([n, value]) => ({ name: n, value })),
      computePassedFailedRowCount: Boolean(spec.computeRows),
      owners: spec.owner ? [userRef(spec.owner)] : [],
      createdBy: spec.owner ?? 'admin',
      updatedAt: t0 - 45 * DAY,
      updatedBy: spec.owner ?? 'admin',
    })
    if ('error' in tc) throw new Error(tc.error)
    cases.set(spec.target, tc)

    const rows: ResultRow[] = []
    for (let day = 29; day >= 0; day--) {
      const status: Status = spec.abortDays?.includes(day) ? 'Aborted' : spec.failDays?.includes(day) ? 'Failed' : 'Success'
      const ts = t0 - day * DAY + 2 * 3_600_000 + r.int(0, 25) * 60_000
      const value = status === 'Failed' ? (spec.failValue ?? spec.base) : jitter(spec, day, r)
      rows.push(resultRow(tc, def, status, value, ts, tableEntity))
    }
    store.testResults.set(tc.fullyQualifiedName!, rows)
    applyLatest(tc)
  }

  // Incidents
  for (const inc of INCIDENTS) {
    const tc = cases.get(inc.target)
    if (!tc) continue
    const stateId = randomUUID()
    for (const [type, hoursAgo, by, assignee, resolution] of inc.steps) {
      const ts = Date.now() - hoursAgo * 3_600_000
      incidents.push({
        id: randomUUID(),
        stateId,
        timestamp: ts,
        updatedAt: ts,
        testCaseResolutionStatusType: type,
        testCaseResolutionStatusDetails:
          type === 'Assigned' && assignee
            ? { assignee: userRef(assignee) }
            : type === 'Resolved' && resolution
              ? { testCaseFailureReason: resolution[0], testCaseFailureComment: resolution[1], resolvedBy: userRef(by) }
              : undefined,
        updatedBy: userRef(by),
        testCaseReference: ref(tc, 'testCase'),
        severity: inc.severity,
      })
    }
    const last = inc.steps.at(-1)![0]
    // Results inside an incident's window carry its stateId.
    const opened = Date.now() - inc.steps[0]![1] * 3_600_000
    for (const row of store.testResults.get(tc.fullyQualifiedName!) ?? []) {
      if (row.testCaseStatus === 'Failed' && row.timestamp >= opened - DAY) row.incidentId = stateId
    }
    if (last !== 'Resolved') replaceTestCase({ ...store.get(tc.id)!.entity, incidentId: stateId })
  }

  // A logical suite gathering the tests on Tier 1 tables.
  const tier1 = [...cases.values()].filter((tc) => {
    const table = store.byFqn('tables', tc.entityFQN)
    return (table?.tags ?? []).some((t: Entity) => t.tagFQN === 'Tier.Tier1')
  })
  const logical = store.add('dataQuality/testSuites', {
    name: 'Tier 1 critical checks',
    fullyQualifiedName: 'Tier 1 critical checks',
    description: 'Every test on a Tier 1 table. Failures here page the owning team.',
    basic: false,
    executable: false,
    tests: tier1.map((tc) => ref(tc, 'testCase')),
    owners: [userRef('ada.park')],
    updatedAt: t0 - 20 * DAY,
  })
  for (const tc of tier1) {
    const cur = store.get(tc.id)!.entity
    replaceTestCase({ ...cur, testSuites: [...(cur.testSuites ?? []), { ...ref(logical, 'testSuite'), basic: false }] })
  }
}

// ---------- Shared with the routes ----------

export interface CreateTestCaseBody {
  name: string
  displayName?: string
  description?: string
  testDefinition: string
  entityLink: string
  parameterValues?: { name: string; value: string }[]
  owners?: Entity[]
  computePassedFailedRowCount?: boolean
  useDynamicAssertion?: boolean
  [k: string]: unknown
}

/** Parse `<#E::table::FQN>` / `<#E::table::FQN::columns::col>`. */
export function parseEntityLink(link: string): { entityType: string; entityFQN: string; column?: string } | undefined {
  const m = /^<#E::([^:]+)::(.+?)(?:::columns::(.+))?>$/.exec(link)
  if (!m) return undefined
  return { entityType: m[1]!, entityFQN: m[2]!, column: m[3] }
}

/** Create a test case the way OpenMetadata does: resolve the definition, find or make the table's basic suite, compute the FQN. */
export function createTestCase(body: CreateTestCaseBody): Entity | { error: string; status: number } {
  if (!body.name) return { error: 'name must not be empty', status: 400 }
  if (/::|"|>/.test(body.name)) return { error: `name "${body.name}" may not contain "::", ">" or quotes`, status: 400 }
  const link = parseEntityLink(body.entityLink ?? '')
  if (!link || link.entityType !== 'table') return { error: `Invalid entityLink ${body.entityLink}`, status: 400 }
  const table = store.byFqn('tables', link.entityFQN)
  if (!table) return { error: `table instance for ${link.entityFQN} not found`, status: 404 }
  if (link.column && !(table.columns ?? []).some((c: Entity) => c.name === link.column))
    return { error: `Column ${link.column} not found in ${link.entityFQN}`, status: 400 }
  const def = store.byFqn('dataQuality/testDefinitions', body.testDefinition)
  if (!def) return { error: `testDefinition instance for ${body.testDefinition} not found`, status: 404 }
  if ((def.entityType === 'COLUMN') !== Boolean(link.column))
    return {
      error: `Test definition ${def.name} applies to ${def.entityType.toLowerCase()}s; the entityLink points at a ${link.column ? 'column' : 'table'}`,
      status: 400,
    }
  for (const p of def.parameterDefinition ?? []) {
    if (p.required && !(body.parameterValues ?? []).some((v) => v.name === p.name && v.value !== ''))
      return { error: `Required parameter ${p.name} is not passed in parameterValues`, status: 400 }
  }
  const entityFQN = link.column ? `${link.entityFQN}.${fqnPartQuoted(link.column)}` : link.entityFQN
  const testCaseFqn = `${entityFQN}.${fqnPartQuoted(body.name)}`
  if (store.byFqn('dataQuality/testCases', testCaseFqn)) return { error: `testCase ${testCaseFqn} already exists`, status: 409 }

  const suite = basicSuiteFor(table)
  const { testDefinition: _def, ...rest } = body
  const tc = store.add('dataQuality/testCases', {
    displayName: body.name,
    computePassedFailedRowCount: false,
    useDynamicAssertion: false,
    autoCloseIncident: false,
    dimensionColumns: [],
    entityStatus: 'Approved',
    ...rest,
    fullyQualifiedName: testCaseFqn,
    testDefinition: { ...ref(def, 'testDefinition'), fullyQualifiedName: def.fullyQualifiedName },
    entityLink: body.entityLink,
    entityFQN: link.entityFQN,
    parameterValues: body.parameterValues ?? [],
    testSuite: ref(suite, 'testSuite'),
    testSuites: [{ ...ref(suite, 'testSuite'), basic: true }],
    tags: table.tags ?? [],
    domains: table.domains ?? [],
    createdBy: (body.createdBy as string | undefined) ?? 'admin',
    updatedAt: (body.updatedAt as number | undefined) ?? Date.now(),
  })
  store.replace({ ...suite, tests: [...(suite.tests ?? []), ref(tc, 'testCase')] })
  return tc
}

function basicSuiteFor(table: Entity): Entity {
  const name = `${table.fullyQualifiedName}.testSuite`
  const existing = store.byFqn('dataQuality/testSuites', name)
  if (existing) return existing
  return store.add('dataQuality/testSuites', {
    name,
    fullyQualifiedName: name,
    displayName: name,
    description: '',
    basic: true,
    executable: true,
    basicEntityReference: ref(table, 'table'),
    executableEntityReference: ref(table, 'table'),
    tests: [],
    owners: table.owners ?? [],
    domains: table.domains ?? [],
    updatedAt: table.updatedAt,
  })
}

/** Put the newest result on the test case as `testCaseResult` / `testCaseStatus`, the way OpenMetadata keeps it. */
export function applyLatest(tc: Entity) {
  const rows = store.testResults.get(tc.fullyQualifiedName!) ?? []
  const latest = rows.reduce<ResultRow | undefined>((a, b) => (!a || b.timestamp > a.timestamp ? b : a), undefined)
  const cur = store.get(tc.id)?.entity ?? tc
  replaceTestCase({ ...cur, testCaseResult: latest, testCaseStatus: latest?.testCaseStatus })
}

export function replaceTestCase(tc: Entity) {
  store.replace(tc)
}

function fqnPartQuoted(name: string) {
  return name.includes('.') ? `"${name}"` : name
}

function toSnake(s: string) {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase()
}

function jitter(spec: CaseSpec, day: number, r: ReturnType<typeof rng>): number {
  const { def, base } = spec
  if (
    def === 'columnValuesToBeNotNull' ||
    def === 'tableCustomSQLQuery' ||
    def === 'tableColumnCountToEqual' ||
    def === 'tableRowCountToEqual' ||
    def === 'tableRowInsertedCountToBeBetween'
  )
    return base
  if (
    def === 'tableRowCountToBeBetween' ||
    def === 'columnValuesToBeUnique' ||
    def === 'columnValuesToBeInSet' ||
    def === 'columnValuesToMatchRegex'
  ) {
    // Row-count-like values grow slowly toward today.
    return Math.round(base * (1 - day * 0.0012) * (1 + r.normal(0, 0.0008)))
  }
  const v = base * (1 + r.normal(0, 0.04))
  return Math.abs(base) < 10 ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100
}

function paramNum(tc: Entity, name: string): number | undefined {
  const v = (tc.parameterValues ?? []).find((p: Entity) => p.name === name)?.value
  return v === undefined || v === '' ? undefined : Number(v)
}

/** A TestCaseResult with the values OpenMetadata's validators report for each definition. */
export function resultRow(tc: Entity, def: Entity, status: Status, value: number, timestamp: number, table?: Entity): ResultRow {
  const rows = (table?.profile?.rowCount as number | undefined) ?? 100_000
  const failed = status === 'Failed'
  const base: ResultRow = {
    id: randomUUID(),
    testCaseFQN: tc.fullyQualifiedName,
    timestamp,
    testCaseStatus: status,
    testCase: ref(tc, 'testCase'),
    testDefinition: ref(def, 'testDefinition'),
  }
  if (status === 'Aborted')
    return {
      ...base,
      result: 'Error computing tableRowCountToBeBetween: 403 Query exceeded resource limits. Try again later or reduce the scanned bytes.',
      testResultValue: [],
    }
  const vals = (pairs: [string, number][]) => pairs.map(([name, v]) => ({ name, value: String(v) }))
  const rowsOf = (failedRows: number) =>
    tc.computePassedFailedRowCount
      ? {
          passedRows: rows - failedRows,
          failedRows,
          passedRowsPercentage: ((rows - failedRows) / rows) * 100,
          failedRowsPercentage: (failedRows / rows) * 100,
        }
      : {}
  switch (def.name) {
    case 'tableRowCountToBeBetween': {
      const min = paramNum(tc, 'minValue')
      const max = paramNum(tc, 'maxValue')
      return {
        ...base,
        result: `Found ${value} rows vs. the expected range [${min ?? '-inf'}, ${max ?? 'inf'}].`,
        testResultValue: vals([['rowCount', value]]),
        minBound: min,
        maxBound: max,
      }
    }
    case 'tableRowCountToEqual':
      return {
        ...base,
        result: `Found ${value} rows vs. the expected ${paramNum(tc, 'value')}`,
        testResultValue: vals([['rowCount', value]]),
      }
    case 'tableColumnCountToEqual':
      return {
        ...base,
        result: `Found ${value} columns vs. the expected ${paramNum(tc, 'columnCount')}`,
        testResultValue: vals([['columnCount', value]]),
      }
    case 'tableRowInsertedCountToBeBetween':
      return {
        ...base,
        result: `Found ${value} rows inserted in the last 1 DAY vs. the expected range [${paramNum(tc, 'min')}, ${paramNum(tc, 'max')}].`,
        testResultValue: vals([['rowCount', value]]),
        minBound: paramNum(tc, 'min'),
        maxBound: paramNum(tc, 'max'),
      }
    case 'tableCustomSQLQuery':
      return {
        ...base,
        result: `Found ${value} row(s). Test query is expected to return 0 row(s).`,
        testResultValue: vals([['resultRowCount', value]]),
      }
    case 'columnValuesToBeNotNull': {
      const nulls = failed ? value : 0
      return {
        ...base,
        result: `Found nullCount=${nulls}. It should be 0`,
        testResultValue: vals([['nullCount', nulls]]),
        ...rowsOf(nulls),
      }
    }
    case 'columnValuesToBeUnique': {
      const valueCount = failed ? rows : value
      const uniqueCount = value
      return {
        ...base,
        result: `Found valuesCount=${valueCount} vs. uniqueCount=${uniqueCount}. Both counts should be equal for column values to be unique.`,
        testResultValue: vals([
          ['valueCount', valueCount],
          ['uniqueCount', uniqueCount],
        ]),
        ...rowsOf(valueCount - uniqueCount),
      }
    }
    case 'columnValuesToBeBetween': {
      const min = paramNum(tc, 'minValue') ?? 0
      const lo = Math.max(min, Math.round(min + (value - min) * 0.01 * 1000) / 1000)
      return {
        ...base,
        result: `Found min=${lo}, max=${value} vs. the expected min=${min}, max=${paramNum(tc, 'maxValue')}.`,
        testResultValue: vals([
          ['min', lo],
          ['max', value],
        ]),
        minBound: min,
        maxBound: paramNum(tc, 'maxValue'),
      }
    }
    case 'columnValuesToBeInSet': {
      const bad = failed ? value : 0
      return {
        ...base,
        result: `Found countInSet=${rows - bad}.${bad ? ` ${bad} value(s) are not in the allowed set.` : ''}`,
        testResultValue: vals([['allowedValueCount', rows - bad]]),
        ...rowsOf(bad),
      }
    }
    case 'columnValuesToBeNotInSet':
      return {
        ...base,
        result: `Found countInSet=${failed ? value : 0}.`,
        testResultValue: vals([['countForbiddenValues', failed ? value : 0]]),
      }
    case 'columnValuesToMatchRegex':
      return {
        ...base,
        result: `Found ${value} value(s) matching regex pattern vs ${value} value(s) in the column.`,
        testResultValue: vals([['likeCount', value]]),
      }
    case 'columnValuesMissingCount':
      return { ...base, result: `Found missingCount=${value}.`, testResultValue: vals([['missingCount', value]]) }
    case 'columnValueMaxToBeBetween':
      return {
        ...base,
        result: `Found max=${value} vs. the expected min=${paramNum(tc, 'minValueForMaxInCol')}, max=${paramNum(tc, 'maxValueForMaxInCol')}.`,
        testResultValue: vals([['max', value]]),
        minBound: paramNum(tc, 'minValueForMaxInCol'),
        maxBound: paramNum(tc, 'maxValueForMaxInCol'),
      }
    case 'columnValueMinToBeBetween':
      return {
        ...base,
        result: `Found min=${value} vs. the expected min=${paramNum(tc, 'minValueForMinInCol')}, max=${paramNum(tc, 'maxValueForMinInCol')}.`,
        testResultValue: vals([['min', value]]),
        minBound: paramNum(tc, 'minValueForMinInCol'),
        maxBound: paramNum(tc, 'maxValueForMinInCol'),
      }
    case 'columnValueMeanToBeBetween':
      return {
        ...base,
        result: `Found mean=${value} vs. the expected min=${paramNum(tc, 'minValueForMeanInCol')}, max=${paramNum(tc, 'maxValueForMeanInCol')}.`,
        testResultValue: vals([['mean', value]]),
        minBound: paramNum(tc, 'minValueForMeanInCol'),
        maxBound: paramNum(tc, 'maxValueForMeanInCol'),
      }
    case 'columnValuesSumToBeBetween':
      return {
        ...base,
        result: `Found sum=${value} vs. the expected min=${paramNum(tc, 'minValueForColSum')}, max=${paramNum(tc, 'maxValueForColSum')}.`,
        testResultValue: vals([['sum', value]]),
        minBound: paramNum(tc, 'minValueForColSum'),
        maxBound: paramNum(tc, 'maxValueForColSum'),
      }
    case 'columnValueLengthsToBeBetween':
      return {
        ...base,
        result: `Found minLength=1, maxLength=${value} vs. the expected minLength=${paramNum(tc, 'minLength')}, maxLength=${paramNum(tc, 'maxLength')}.`,
        testResultValue: vals([
          ['minValueLength', 1],
          ['maxValueLength', value],
        ]),
      }
    default:
      return { ...base, result: `Found ${value}.`, testResultValue: vals([['value', value]]) }
  }
}
