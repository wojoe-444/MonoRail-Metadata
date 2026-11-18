import { BigQueryConnection } from '@malloydata/db-bigquery'

import { bigQueryConfigured, CONFIG } from '../config'
import { omJson } from '../om/client'

interface OmColumn {
  name: string
  dataType: string
  dataTypeDisplay?: string
  arrayDataType?: string
  description?: string
  children?: OmColumn[]
}

interface BqField {
  name: string
  type: string
  mode?: 'NULLABLE' | 'REPEATED'
  description?: string
  fields?: BqField[]
}

/** OpenMetadata column types back to BigQuery's, for columns whose display type isn't a BigQuery type. */
const OM_TO_BQ: Record<string, string> = {
  BIGINT: 'INT64',
  INT: 'INT64',
  SMALLINT: 'INT64',
  TINYINT: 'INT64',
  LONG: 'INT64',
  FLOAT: 'FLOAT64',
  DOUBLE: 'FLOAT64',
  DECIMAL: 'NUMERIC',
  NUMERIC: 'NUMERIC',
  BIGNUMERIC: 'BIGNUMERIC',
  STRING: 'STRING',
  VARCHAR: 'STRING',
  CHAR: 'STRING',
  TEXT: 'STRING',
  BOOLEAN: 'BOOL',
  DATE: 'DATE',
  DATETIME: 'DATETIME',
  TIMESTAMP: 'TIMESTAMP',
  TIME: 'TIME',
  GEOGRAPHY: 'GEOGRAPHY',
  JSON: 'JSON',
  BYTES: 'BYTES',
  BINARY: 'BYTES',
  STRUCT: 'RECORD',
  RECORD: 'RECORD',
  INTERVAL: 'INTERVAL',
}

const BQ_SCALARS = new Set([
  'INT64',
  'INTEGER',
  'FLOAT64',
  'FLOAT',
  'NUMERIC',
  'BIGNUMERIC',
  'STRING',
  'BOOL',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'TIME',
  'GEOGRAPHY',
  'JSON',
  'BYTES',
  'INTERVAL',
])

function toBqField(col: OmColumn): BqField {
  const display = (col.dataTypeDisplay ?? '').toUpperCase()
  if (col.dataType === 'ARRAY') {
    const inner = col.children?.length ? 'RECORD' : (OM_TO_BQ[col.arrayDataType ?? ''] ?? display.match(/^ARRAY<(\w+)>$/)?.[1] ?? 'STRING')
    return { name: col.name, type: inner, mode: 'REPEATED', description: col.description, fields: col.children?.map(toBqField) }
  }
  if (col.dataType === 'STRUCT' || col.children?.length) {
    return { name: col.name, type: 'RECORD', mode: 'NULLABLE', description: col.description, fields: (col.children ?? []).map(toBqField) }
  }
  const type = BQ_SCALARS.has(display) ? display : (OM_TO_BQ[col.dataType] ?? 'STRING')
  return { name: col.name, type, mode: 'NULLABLE', description: col.description }
}

/** "project.dataset.table" (with or without backticks) to the OpenMetadata table FQN under the BigQuery service. */
export function tablePathToFqn(tablePath: string): string {
  const parts = tablePath.replace(/`/g, '').split('.')
  const [project, dataset, table] = parts.length === 2 ? [CONFIG.bqProjectId, ...parts] : parts
  const q = (s: string | undefined) => (s && s.includes('.') ? `"${s}"` : (s ?? ''))
  return [CONFIG.omBigQueryService, project, dataset, table].map(q).join('.')
}

export async function omTableSchema(tablePath: string): Promise<{ fields: BqField[]; description?: string } | undefined> {
  try {
    const table = await omJson<{ columns: OmColumn[]; description?: string }>(
      `/tables/name/${encodeURIComponent(tablePathToFqn(tablePath))}?fields=columns`,
    )
    return { fields: table.columns.map(toBqField), description: table.description }
  } catch {
    return undefined
  }
}

/**
 * Malloy's BigQuery connection, with one change: table schemas come from the
 * OpenMetadata catalog first, and from BigQuery only when the catalog doesn't
 * have the table. So models compile (and the workbench can show fields and SQL)
 * without BigQuery credentials, and the schema Malloy sees is the one people
 * document in the catalog. Running queries still needs credentials.
 */
export class CatalogBigQueryConnection extends BigQueryConnection {
  constructor(name = 'bigquery') {
    super({
      name,
      projectId: CONFIG.bqProjectId || 'unset-project',
      billingProjectId: CONFIG.bqBillingProjectId || undefined,
      location: CONFIG.bqLocation || undefined,
      maximumBytesBilled: CONFIG.bqMaxBytesBilled,
    })
  }

  override async getTableFieldSchema(tablePath: string) {
    const fromCatalog = await omTableSchema(tablePath)
    if (fromCatalog) {
      return {
        schema: { fields: fromCatalog.fields },
        description: fromCatalog.description,
        needsTableSuffixPseudoColumn: tablePath.endsWith('*'),
        needsPartitionTimePseudoColumn: false,
        needsPartitionDatePseudoColumn: false,
      }
    }
    if (!bigQueryConfigured()) {
      throw new Error(`${tablePath} is not in the catalog, and BigQuery credentials are not set up to read its schema.`)
    }
    return super.getTableFieldSchema(tablePath)
  }
}
