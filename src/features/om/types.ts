/**
 * OpenMetadata entity shapes, the subset this app reads. Field names match
 * OpenMetadata 2.x JSON (generated from openmetadata-spec), so responses from
 * the real server and the demo catalog both fit. Add fields as pages need them.
 */

export interface EntityReference {
  id: string
  type: string
  name?: string
  fullyQualifiedName?: string
  displayName?: string
  description?: string
  deleted?: boolean
  href?: string
}

export type TagSource = 'Classification' | 'Glossary'

export interface TagLabel {
  tagFQN: string
  name?: string
  displayName?: string
  description?: string
  source: TagSource
  labelType: 'Manual' | 'Propagated' | 'Automated' | 'Derived'
  state: 'Suggested' | 'Confirmed'
  style?: { color?: string; iconURL?: string }
}

/**
 * OpenMetadata 2.x's `certification` field (type/assetCertification.json). The server sets both
 * dates on PATCH: `appliedDate` to now and `expiryDate` from the certification settings' validity
 * period, whatever the client sends.
 */
export interface AssetCertification {
  tagLabel: TagLabel
  appliedDate?: number
  expiryDate?: number
}

export interface ChangeDescription {
  previousVersion?: number
  fieldsAdded?: FieldChange[]
  fieldsUpdated?: FieldChange[]
  fieldsDeleted?: FieldChange[]
}

export interface FieldChange {
  name: string
  oldValue?: string
  newValue?: string
}

/** Fields every OpenMetadata entity has. */
export interface EntityBase {
  id: string
  name: string
  fullyQualifiedName?: string
  displayName?: string
  description?: string
  version?: number
  updatedAt?: number
  updatedBy?: string
  href?: string
  deleted?: boolean
  owners?: EntityReference[]
  tags?: TagLabel[]
  /** Tables, databases, datasets, metrics, data products, domains and stored procedures in 2.0.8. */
  certification?: AssetCertification | null
  followers?: EntityReference[]
  domains?: EntityReference[]
  dataProducts?: EntityReference[]
  extension?: Record<string, unknown>
  changeDescription?: ChangeDescription
  /** Present on search hits. */
  entityType?: string
}

export interface ColumnProfile {
  name: string
  timestamp: number
  valuesCount?: number
  nullCount?: number
  nullProportion?: number
  uniqueCount?: number
  uniqueProportion?: number
  distinctCount?: number
  distinctProportion?: number
  min?: number | string
  max?: number | string
  mean?: number
  median?: number
  stddev?: number
  minLength?: number
  maxLength?: number
  histogram?: { boundaries: string[]; frequencies: number[] }
}

export interface Column {
  name: string
  displayName?: string
  fullyQualifiedName?: string
  dataType: string
  dataTypeDisplay?: string
  arrayDataType?: string
  description?: string
  ordinalPosition?: number
  constraint?: 'NULL' | 'NOT_NULL' | 'UNIQUE' | 'PRIMARY_KEY'
  tags?: TagLabel[]
  children?: Column[]
  profile?: ColumnProfile
}

export interface TableProfile {
  timestamp: number
  rowCount?: number
  columnCount?: number
  sizeInByte?: number
  createDateTime?: string
}

export interface UsageStats {
  count: number
  percentileRank?: number
}

export interface Table extends EntityBase {
  tableType?:
    | 'Regular'
    | 'External'
    | 'View'
    | 'SecureView'
    | 'MaterializedView'
    | 'Iceberg'
    | 'Local'
    | 'Partitioned'
    | 'Foreign'
    | 'Transient'
    | 'Dynamic'
    | 'Stream'
  columns: Column[]
  service?: EntityReference
  serviceType?: string
  database?: EntityReference
  databaseSchema?: EntityReference
  schemaDefinition?: string
  tablePartition?: { columns?: { columnName: string; intervalType?: string; interval?: string }[] }
  tableConstraints?: { constraintType: string; columns: string[]; referredColumns?: string[] }[]
  profile?: TableProfile
  usageSummary?: { date?: string; dailyStats?: UsageStats; weeklyStats?: UsageStats; monthlyStats?: UsageStats }
  sourceUrl?: string
  sampleData?: { columns: string[]; rows: unknown[][] }
  lifeCycle?: { created?: { timestamp: number }; updated?: { timestamp: number }; accessed?: { timestamp: number } }
}

export interface Database extends EntityBase {
  service?: EntityReference
  serviceType?: string
}

export interface DatabaseSchema extends EntityBase {
  service?: EntityReference
  serviceType?: string
  database?: EntityReference
}

export interface DatabaseService extends EntityBase {
  serviceType: string
  connection?: { config?: Record<string, unknown> }
}

export interface User extends EntityBase {
  email: string
  isAdmin?: boolean
  isBot?: boolean
  teams?: EntityReference[]
  roles?: EntityReference[]
  profile?: { images?: { image?: string } }
}

export interface Team extends EntityBase {
  teamType?: 'Organization' | 'BusinessUnit' | 'Division' | 'Department' | 'Group'
  email?: string
  users?: EntityReference[]
  userCount?: number
  parents?: EntityReference[]
  children?: EntityReference[]
}

export interface Classification extends EntityBase {
  mutuallyExclusive?: boolean
  provider?: 'system' | 'user'
  termCount?: number
}

export interface Tag extends EntityBase {
  classification?: EntityReference
  parent?: EntityReference
  provider?: 'system' | 'user'
  style?: { color?: string; iconURL?: string }
  usageCount?: number
}

export interface Glossary extends EntityBase {
  reviewers?: EntityReference[]
  mutuallyExclusive?: boolean
  termCount?: number
}

export interface GlossaryTerm extends EntityBase {
  glossary: EntityReference
  parent?: EntityReference
  synonyms?: string[]
  /** 2.x sends `{ relationType, term }`; older servers sent plain references. */
  relatedTerms?: (EntityReference | { relationType?: string; term: EntityReference })[]
  references?: { name: string; endpoint: string }[]
  reviewers?: EntityReference[]
  /** Before 2.x. Read `entityStatus` first. */
  status?: 'Draft' | 'Approved' | 'Deprecated' | 'Rejected' | 'In Review'
  entityStatus?: 'Draft' | 'Approved' | 'Deprecated' | 'Rejected' | 'In Review' | 'Unprocessed'
  childrenCount?: number
}

export interface Domain extends EntityBase {
  domainType?: 'Source-aligned' | 'Consumer-aligned' | 'Aggregate'
  experts?: EntityReference[]
  parent?: EntityReference
  children?: EntityReference[]
}

export interface DataProduct extends EntityBase {
  experts?: EntityReference[]
  assets?: EntityReference[]
}

export interface Query extends EntityBase {
  query: string
  queryUsedIn?: EntityReference[]
  users?: EntityReference[]
  duration?: number
  queryDate?: number
  votes?: { upVotes?: number; downVotes?: number }
}

export interface Post {
  id: string
  message: string
  from: string
  postTs: number
}

export interface Thread {
  id: string
  type: 'Conversation' | 'Task' | 'Announcement'
  about: string
  entityRef?: EntityReference
  message: string
  createdBy: string
  threadTs: number
  updatedAt: number
  posts: Post[]
  postsCount: number
  resolved?: boolean
}

export interface Paged<T> {
  data: T[]
  paging: { total: number; after?: string; before?: string }
}

// ---------- Search ----------

export interface SearchHit<T = SearchSource> {
  _index: string
  _id: string
  _score?: number
  _source: T
}

/** A search document: the entity plus index-only fields. */
export interface SearchSource extends EntityBase {
  entityType: string
  tier?: TagLabel
  service?: EntityReference
  serviceType?: string
  database?: EntityReference
  databaseSchema?: EntityReference
  tableType?: string
  columns?: Column[]
  usageSummary?: Table['usageSummary']
}

export interface Bucket {
  key: string
  doc_count: number
}

export interface SearchResponse<T = SearchSource> {
  hits: { total: { value: number }; hits: SearchHit<T>[] }
  aggregations?: Record<string, { buckets: Bucket[] }>
}

// ---------- Lineage ----------

export interface LineageNode {
  entity: EntityReference & {
    entityType?: string
    service?: EntityReference
    columns?: Pick<Column, 'name' | 'fullyQualifiedName' | 'dataType'>[]
    /** SQL of the edges into this node, by `sqlQueryKey` (2.x). */
    lineageSqlQueries?: Record<string, string>
  }
  paging?: { entityUpstreamCount?: number; entityDownstreamCount?: number }
  nodeDepth?: number
}

export interface LineageEdge {
  fromEntity: { id: string; type: string; fullyQualifiedName?: string }
  toEntity: { id: string; type: string; fullyQualifiedName?: string }
  sqlQuery?: string
  /** 2.x: key into the target node's `entity.lineageSqlQueries` when `sqlQuery` is absent. */
  sqlQueryKey?: string
  source?: string
  description?: string
  pipeline?: EntityReference
  columns?: { fromColumns?: string[]; toColumn?: string }[]
  docId?: string
}

export interface LineageResponse {
  nodes: Record<string, LineageNode>
  upstreamEdges: Record<string, LineageEdge>
  downstreamEdges: Record<string, LineageEdge>
}
