import { qs } from '@/lib/api'
import { createEntity, enc, getEntity, listEntities, om, search } from '@/features/om/api'
import type { DatabaseService, EntityReference, Paged, SearchSource, Team } from '@/features/om/types'

import type { IngestionPipeline, PipelineLogs, PipelineServiceClientResponse, PipelineStatus } from './types'

/**
 * Admin calls: services, ingestion pipelines, teams and users. Paths follow
 * OpenMetadata 2.0.8's own UI client (rest/serviceAPI.ts,
 * ingestionPipelineAPI.ts, teamsAPI.ts, userAPI.ts).
 */

// ---------- Services ----------

export function listDatabaseServices(): Promise<Paged<DatabaseService>> {
  return listEntities<DatabaseService>('databaseService', { fields: 'owners,tags,domains', limit: 100 })
}

export function createDatabaseService(body: Record<string, unknown>): Promise<DatabaseService> {
  return createEntity<DatabaseService>('databaseService', body)
}

/** A search filter for everything under one service. Search docs index `service.name` as a keyword; match with or without the `.keyword` suffix. */
export function serviceFilter(serviceName: string): object {
  return { query: { bool: { should: [{ term: { 'service.name.keyword': serviceName } }, { term: { 'service.name': serviceName } }] } } }
}

/** How many projects (databases), datasets (schemas) and tables a service holds. */
export async function serviceCounts(serviceName: string): Promise<{ projects: number; datasets: number; tables: number }> {
  const count = (index: string) => search({ index, size: 0, queryFilter: serviceFilter(serviceName) }).then((r) => r.hits.total.value)
  const [projects, datasets, tables] = await Promise.all([count('database'), count('databaseSchema'), count('table')])
  return { projects, datasets, tables }
}

// ---------- Ingestion pipelines ----------

const PIPELINES = '/services/ingestionPipelines'

export function listIngestionPipelines(serviceFqn: string): Promise<Paged<IngestionPipeline>> {
  return listEntities<IngestionPipeline>('ingestionPipeline', {
    service: serviceFqn,
    serviceType: 'databaseService',
    fields: 'owners,pipelineStatuses',
    limit: 100,
  })
}

export function getIngestionPipeline(fqn: string): Promise<IngestionPipeline> {
  return getEntity<IngestionPipeline>('ingestionPipeline', fqn, 'owners,pipelineStatuses,followers')
}

export function createIngestionPipeline(body: Record<string, unknown>): Promise<IngestionPipeline> {
  return om<IngestionPipeline>(PIPELINES, { method: 'POST', json: body })
}

export function deployIngestionPipeline(id: string): Promise<PipelineServiceClientResponse> {
  return om(`${PIPELINES}/deploy/${id}`, { method: 'POST' })
}

export function triggerIngestionPipeline(id: string): Promise<PipelineServiceClientResponse> {
  return om(`${PIPELINES}/trigger/${id}`, { method: 'POST' })
}

export function killIngestionPipeline(id: string): Promise<PipelineServiceClientResponse> {
  return om(`${PIPELINES}/kill/${id}`, { method: 'POST' })
}

/** Enable or disable (pause) a pipeline; answers with the updated pipeline. */
export function toggleIngestionPipeline(id: string): Promise<IngestionPipeline> {
  return om(`${PIPELINES}/toggleIngestion/${id}`, { method: 'POST' })
}

export function getRunHistory(
  fqn: string,
  params: { startTs?: number; endTs?: number; limit?: number } = {},
): Promise<Paged<PipelineStatus>> {
  return om(`${PIPELINES}/${enc(fqn)}/pipelineStatus${qs(params)}`)
}

export function getLastRunLogs(idOrFqn: string): Promise<PipelineLogs> {
  return om(`${PIPELINES}/logs/${enc(idOrFqn)}/last`)
}

/** Whether OpenMetadata can reach its pipeline runner (Airflow). */
export function getRunnerStatus(): Promise<PipelineServiceClientResponse> {
  return om(`${PIPELINES}/status`)
}

/** The latest run: `pipelineStatuses` is an array in 2.x, a single object on older servers. */
export function latestStatus(p: IngestionPipeline): PipelineStatus | undefined {
  const s = p.pipelineStatuses
  if (!s) return undefined
  if (!Array.isArray(s)) return s
  return [...s].sort((a, b) => (b.timestamp ?? b.startDate ?? 0) - (a.timestamp ?? a.startDate ?? 0))[0]
}

/** The log text of a logs response, whichever task key it came under. */
export function logTextOf(logs: PipelineLogs | undefined): string | undefined {
  if (!logs) return undefined
  if (logs.logs) return logs.logs
  const key = Object.keys(logs).find((k) => k.endsWith('_task') && typeof logs[k as keyof PipelineLogs] === 'string')
  return key ? (logs[key as keyof PipelineLogs] as string) : undefined
}

// ---------- Teams and users ----------

export function createTeam(body: {
  name: string
  displayName?: string
  description?: string
  email?: string
  teamType: string
  parents?: string[]
  users?: string[]
}): Promise<Team> {
  return createEntity<Team>('team', body)
}

/** Replace a team's members (PUT /teams/{id}/users takes the full list). */
export function setTeamUsers(teamId: string, users: EntityReference[]): Promise<Team> {
  return om<Team>(`/teams/${teamId}/users`, { method: 'PUT', json: users.map((u) => ({ id: u.id, type: 'user' })) })
}

export function removeTeamUser(teamId: string, userId: string): Promise<unknown> {
  return om(`/teams/${teamId}/users/${userId}`, { method: 'DELETE' })
}

/** Assets an owner (user or team) owns. */
export function searchOwnedBy(ownerId: string, size = 25) {
  return search<SearchSource>({
    index: 'all',
    size,
    sortField: 'updatedAt',
    sortOrder: 'desc',
    queryFilter: { query: { bool: { must: [{ term: { 'owners.id': ownerId } }] } } },
  })
}

/** Assets a user follows. Real search docs keep followers as user ids; the demo keeps references. Match either. */
export function searchFollowedBy(userId: string, size = 25) {
  return search<SearchSource>({
    index: 'all',
    size,
    sortField: 'updatedAt',
    sortOrder: 'desc',
    queryFilter: { query: { bool: { should: [{ term: { followers: userId } }, { term: { 'followers.id': userId } }] } } },
  })
}
