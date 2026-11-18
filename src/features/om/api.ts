import { api, qs } from '@/lib/api'

import type {
  Bucket,
  EntityBase,
  LineageResponse,
  Paged,
  Query,
  SearchResponse,
  SearchSource,
  Table,
  TableProfile,
  ColumnProfile,
  Thread,
} from './types'

/**
 * OpenMetadata REST calls, through the app server (`/api/om` = OM's `/api/v1`).
 * Shapes follow OpenMetadata 2.x. Feature folders add their own calls next
 * to their pages (e.g. src/features/glossary/api.ts) using `om()`.
 */

export const om = <T>(path: string, init?: RequestInit & { json?: unknown }) => api<T>(`/api/om${path}`, init)

/** OpenMetadata encodes FQNs as one path segment. */
export const enc = (fqn: string) => encodeURIComponent(fqn)

/** REST collection for an entity type. */
export const COLLECTION: Record<string, string> = {
  table: 'tables',
  database: 'databases',
  databaseSchema: 'databaseSchemas',
  databaseService: 'services/databaseServices',
  glossary: 'glossaries',
  glossaryTerm: 'glossaryTerms',
  classification: 'classifications',
  tag: 'tags',
  domain: 'domains',
  dataProduct: 'dataProducts',
  user: 'users',
  team: 'teams',
  query: 'queries',
  metric: 'metrics',
  testCase: 'dataQuality/testCases',
  testSuite: 'dataQuality/testSuites',
  ingestionPipeline: 'services/ingestionPipelines',
  dashboard: 'dashboards',
  pipeline: 'pipelines',
  topic: 'topics',
}

export function collectionOf(entityType: string): string {
  const c = COLLECTION[entityType]
  if (!c) throw new Error(`No REST collection known for ${entityType}`)
  return c
}

// ---------- Generic entities ----------

export function getEntity<T extends EntityBase>(entityType: string, fqn: string, fields = '*'): Promise<T> {
  return om<T>(`/${collectionOf(entityType)}/name/${enc(fqn)}${qs({ fields })}`)
}

export function getEntityById<T extends EntityBase>(entityType: string, id: string, fields = '*'): Promise<T> {
  return om<T>(`/${collectionOf(entityType)}/${id}${qs({ fields })}`)
}

export function listEntities<T extends EntityBase>(
  entityType: string,
  params: Record<string, string | number | undefined> = {},
): Promise<Paged<T>> {
  return om<Paged<T>>(`/${collectionOf(entityType)}${qs({ limit: 100, fields: '*', ...params })}`)
}

/** RFC 6902 JSON Patch, as OpenMetadata expects for every entity edit. */
export type PatchOp = { op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'; path: string; value?: unknown; from?: string }

export function patchEntity<T extends EntityBase>(entityType: string, id: string, ops: PatchOp[]): Promise<T> {
  return om<T>(`/${collectionOf(entityType)}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify(ops),
  })
}

export function createEntity<T extends EntityBase>(entityType: string, body: Record<string, unknown>): Promise<T> {
  return om<T>(`/${collectionOf(entityType)}`, { method: 'POST', json: body })
}

export function deleteEntity(entityType: string, id: string, { hardDelete = false, recursive = false } = {}) {
  return om<unknown>(`/${collectionOf(entityType)}/${id}${qs({ hardDelete, recursive })}`, { method: 'DELETE' })
}

export function followEntity(entityType: string, id: string, userId: string) {
  return om<unknown>(`/${collectionOf(entityType)}/${id}/followers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userId),
  })
}

export function unfollowEntity(entityType: string, id: string, userId: string) {
  return om<unknown>(`/${collectionOf(entityType)}/${id}/followers/${userId}`, { method: 'DELETE' })
}

export function getVersions(entityType: string, id: string): Promise<{ versions: string[] }> {
  return om(`/${collectionOf(entityType)}/${id}/versions`)
}

// ---------- Search ----------

export interface SearchParams {
  q?: string
  /** Entity type(s), comma separated, or "all" / "dataAsset". */
  index?: string
  from?: number
  size?: number
  /** An Elasticsearch query, e.g. built with `filterQuery()`. */
  queryFilter?: object
  sortField?: string
  sortOrder?: 'asc' | 'desc'
  deleted?: boolean
}

export function search<T = SearchSource>(p: SearchParams): Promise<SearchResponse<T>> {
  return om<SearchResponse<T>>(
    `/search/query${qs({
      q: p.q?.trim() || '*',
      index: p.index ?? 'dataAsset',
      from: p.from ?? 0,
      size: p.size ?? 15,
      query_filter: p.queryFilter ? JSON.stringify(p.queryFilter) : undefined,
      sort_field: p.sortField,
      sort_order: p.sortOrder,
      deleted: p.deleted ?? false,
      track_total_hits: true,
    })}`,
  )
}

/** Facet values for one keyword field, e.g. 'owners.displayName.keyword'. */
export async function aggregate(
  field: string,
  p: Omit<SearchParams, 'from' | 'size' | 'sortField' | 'sortOrder'> = {},
  size = 25,
): Promise<Bucket[]> {
  const res = await om<SearchResponse>(
    `/search/aggregate${qs({
      index: p.index ?? 'dataAsset',
      field,
      q: p.q?.trim() || '*',
      size,
      deleted: p.deleted ?? false,
      query_filter: p.queryFilter ? JSON.stringify(p.queryFilter) : undefined,
    })}`,
  )
  return bucketsOf(res, field)
}

/**
 * A field's buckets from a search answer. Keys come back prefixed by type (`sterms#...`), and the real
 * server renames some (`owners.displayName.keyword` comes back as `sterms#ownerDisplayName`), so match
 * the field name first and fall back to the only aggregation when there is just one (as from /search/aggregate).
 */
export function bucketsOf(res: SearchResponse, field: string): Bucket[] {
  const aggs = res.aggregations ?? {}
  const keys = Object.keys(aggs)
  const key = keys.find((k) => k === field || k.endsWith(`#${field}`)) ?? (keys.length === 1 ? keys[0] : undefined)
  return key ? (aggs[key]!.buckets ?? []) : []
}

/** An Elasticsearch bool query: every field must match one of its values. */
export function filterQuery(filters: Record<string, string[]>, extra: object[] = []): object | undefined {
  const must = [
    ...Object.entries(filters)
      .filter(([, vals]) => vals.length)
      .map(([field, vals]) => ({ bool: { should: vals.map((v) => ({ term: { [field]: v } })) } })),
    ...extra,
  ]
  return must.length ? { query: { bool: { must } } } : undefined
}

// ---------- Tables ----------

export const TABLE_FIELDS =
  'columns,owners,tags,certification,followers,domains,dataProducts,usageSummary,tableConstraints,schemaDefinition,extension,votes,lifeCycle'

export function getTable(fqn: string): Promise<Table> {
  return getEntity<Table>('table', fqn, TABLE_FIELDS)
}

export function getSampleData(tableId: string): Promise<Table> {
  return om<Table>(`/tables/${tableId}/sampleData`)
}

export function getLatestProfile(fqn: string): Promise<Table> {
  return om<Table>(`/tables/${enc(fqn)}/tableProfile/latest${qs({ includeColumnProfile: true })}`)
}

export function getTableProfiles(fqn: string, startTs: number, endTs = Date.now()): Promise<Paged<TableProfile>> {
  return om(`/tables/${enc(fqn)}/tableProfile${qs({ startTs, endTs })}`)
}

export function getColumnProfiles(columnFqn: string, startTs: number, endTs = Date.now()): Promise<Paged<ColumnProfile>> {
  return om(`/tables/${enc(columnFqn)}/columnProfile${qs({ startTs, endTs })}`)
}

export function getTableQueries(tableId: string): Promise<Paged<Query>> {
  return om(`/queries${qs({ entityId: tableId, fields: 'owners,users,votes,queryUsedIn', limit: 50 })}`)
}

// ---------- Lineage ----------

/**
 * Lineage around an entity, normalized so nodes are keyed by entity id and every edge carries its SQL.
 * OpenMetadata 2.x keys `nodes` by FQN, and an edge may hold only a `sqlQueryKey` into its target
 * node's `lineageSqlQueries` instead of the SQL itself.
 */
export async function getLineage(entityType: string, fqn: string, upstreamDepth = 2, downstreamDepth = 2): Promise<LineageResponse> {
  const raw = await om<LineageResponse>(
    `/lineage/getLineage${qs({ fqn, type: entityType, upstreamDepth, downstreamDepth, includeDeleted: false })}`,
  )
  const nodes: LineageResponse['nodes'] = {}
  for (const [key, n] of Object.entries(raw.nodes ?? {})) nodes[n.entity.id ?? key] = n
  const withSql = (edges: LineageResponse['upstreamEdges'] | undefined) =>
    Object.fromEntries(
      Object.entries(edges ?? {}).map(([k, e]) => [
        k,
        e.sqlQuery || !e.sqlQueryKey ? e : { ...e, sqlQuery: nodes[e.toEntity.id]?.entity.lineageSqlQueries?.[e.sqlQueryKey] },
      ]),
    )
  return { nodes, upstreamEdges: withSql(raw.upstreamEdges), downstreamEdges: withSql(raw.downstreamEdges) }
}

export function addLineage(
  from: { id: string; type: string },
  to: { id: string; type: string },
  details: { sqlQuery?: string; description?: string } = {},
) {
  return om(`/lineage`, {
    method: 'PUT',
    json: { edge: { fromEntity: from, toEntity: to, lineageDetails: { ...details, source: 'Manual' } } },
  })
}

export function deleteLineage(from: { id: string; type: string }, to: { id: string; type: string }) {
  return om(`/lineage/${from.type}/${from.id}/${to.type}/${to.id}`, { method: 'DELETE' })
}

// ---------- Activity ----------

export const entityLink = (entityType: string, fqn: string) => `<#E::${entityType}::${fqn}>`

export function getThreads(entityType: string, fqn: string): Promise<Paged<Thread>> {
  return om(`/feed${qs({ entityLink: entityLink(entityType, fqn), limit: 50 })}`)
}

/** The author is whoever the server is signed in as; OpenMetadata 2.x rejects a `from` field. */
export function createThread(entityType: string, fqn: string, message: string): Promise<Thread> {
  return om(`/feed`, { method: 'POST', json: { message, about: entityLink(entityType, fqn), type: 'Conversation' } })
}

export function replyToThread(threadId: string, message: string): Promise<Thread> {
  return om(`/feed/${threadId}/posts`, { method: 'POST', json: { message } })
}

// ---------- Server ----------

/** Team backend state (APP_BACKEND=team; docs/team-backend.md). */
export interface TeamStatus {
  bucket: string
  auth: 'local' | 'google'
  identity: { kind: 'local' | 'google'; user?: string; signedIn: boolean }
  replica: {
    ready: boolean
    seq: number
    loadedAt: number | null
    profiles?: boolean
    counts: Record<string, number>
    error: string | null
  }
  worker: { online: boolean; lastSeen: number | null; id?: string; version?: string; omVersion?: string; backlog?: number | null }
}

export interface Health {
  mode: 'demo' | 'openmetadata' | 'team'
  openmetadata: { url: string | null; service: string; ok: boolean; version?: string; error?: string }
  team?: TeamStatus | null
  bigquery: { configured: boolean; projectId: string | null; maxBytesBilled: number }
  malloy: { dir: string }
}

export function getHealth(): Promise<Health> {
  return api<Health>('/api/health')
}

/** The OpenMetadata identity the server acts as (the bot or login in its config). */
export function getCurrentUser(): Promise<import('./types').User> {
  return om('/users/loggedInUser?fields=teams,roles,follows,owns')
}
