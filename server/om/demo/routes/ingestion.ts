import { randomUUID } from 'node:crypto'

import type { Hono } from 'hono'

import { makeRun } from '../seed/ingestion'
import { ref, store, type Entity, type ResultRow } from '../store'

/**
 * Ingestion pipeline endpoints the generic CRUD doesn't cover, in the shapes
 * of OpenMetadata 2.0.8's IngestionPipelineResource:
 *
 *   POST /services/ingestionPipelines                      create (FQN = service.name, not deployed)
 *   POST /services/ingestionPipelines/deploy/{id}          PipelineServiceClientResponse
 *   POST /services/ingestionPipelines/trigger/{id}         PipelineServiceClientResponse; a run starts
 *   POST /services/ingestionPipelines/kill/{id}            PipelineServiceClientResponse
 *   POST /services/ingestionPipelines/toggleIngestion/{id} the pipeline, enabled flipped
 *   GET  /services/ingestionPipelines/status               the pipeline runner (Airflow) status
 *   GET  /services/ingestionPipelines/{fqn}/pipelineStatus run history, ResultList<PipelineStatus>
 *   GET  /services/ingestionPipelines/logs/{id|fqn}/last   logs of the last run, keyed by task
 */

const PATH = 'services/ingestionPipelines'
const RUNNER = { platform: 'Airflow', version: '2.10.5' }

/** Log key per pipeline type, as IngestionPipelineLogByIdInterface names them. */
const LOG_KEY: Record<string, string> = {
  metadata: 'ingestion_task',
  usage: 'usage_task',
  lineage: 'lineage_task',
  profiler: 'profiler_task',
  dbt: 'dbt_task',
  autoClassification: 'auto_classification_task',
  TestSuite: 'test_suite_task',
  dataInsight: 'data_insight_task',
  application: 'application_task',
}

const TYPICAL_RECORDS: Record<string, [number, number]> = {
  metadata: [44, 44],
  usage: [1800, 36],
  lineage: [1800, 29],
  profiler: [21, 21],
  dbt: [27, 27],
  autoClassification: [44, 11],
}

function pipelineByIdOrFqn(idOrFqn: string): Entity | undefined {
  const decoded = decodeURIComponent(idOrFqn)
  const byId = store.get(decoded)
  if (byId?.collection.path === PATH) return byId.entity
  return store.byFqn(PATH, decoded)
}

function runsOf(p: Entity): ResultRow[] {
  const key = p.fullyQualifiedName ?? p.name
  let runs = store.pipelineRuns.get(key)
  if (!runs) {
    runs = []
    store.pipelineRuns.set(key, runs)
  }
  return runs
}

/** Keep the entity's pipelineStatuses (the latest run) in step with the run history. */
function syncLatest(p: Entity) {
  const latest = runsOf(p).at(-1)
  const current = store.get(p.id)?.entity ?? p
  store.replace({ ...current, pipelineStatuses: latest ? [latest] : [] })
}

const notFound = (id: string) => ({ code: 404, message: `ingestionPipeline instance for ${id} not found` })

export function registerIngestionRoutes(app: Hono) {
  app.get(`/${PATH}/status`, (c) => c.json({ code: 200, reason: 'Pipeline service client is reachable (demo).', ...RUNNER }))

  app.get(`/${PATH}/ip`, (c) => c.json({ ip: '127.0.0.1' }))

  app.post(`/${PATH}`, async (c) => {
    const body = (await c.req.json()) as Entity & { service?: { id?: string; type?: string; fullyQualifiedName?: string; name?: string } }
    if (!body.name || !body.pipelineType || !body.sourceConfig || !body.airflowConfig || !body.service) {
      return c.json({ code: 400, message: 'name, service, pipelineType, sourceConfig and airflowConfig are required' }, 400)
    }
    const svc =
      (body.service.id && store.get(body.service.id)?.entity) ||
      store.findFqn(body.service.fullyQualifiedName ?? body.service.name ?? '')?.entity
    if (!svc) return c.json({ code: 404, message: 'Service not found' }, 404)
    const fqn = `${svc.fullyQualifiedName ?? svc.name}.${body.name}`
    if (store.byFqn(PATH, fqn)) return c.json({ code: 409, message: `Entity already exists: ${fqn}` }, 409)
    const created = store.add(PATH, {
      ...body,
      fullyQualifiedName: fqn,
      service: ref(svc),
      owners: body.owners ?? [],
      loggerLevel: body.loggerLevel ?? 'INFO',
      raiseOnError: body.raiseOnError ?? true,
      deployed: false,
      enabled: true,
      provider: body.provider ?? 'user',
      pipelineStatuses: [],
      updatedAt: Date.now(),
    })
    return c.json(created, 201)
  })

  app.post(`/${PATH}/deploy/:id`, (c) => {
    const p = pipelineByIdOrFqn(c.req.param('id'))
    if (!p) return c.json(notFound(c.req.param('id')), 404)
    store.replace({ ...p, deployed: true, updatedAt: Date.now() })
    return c.json({ code: 200, reason: `Workflow [${p.name}] has been created`, ...RUNNER })
  })

  app.post(`/${PATH}/toggleIngestion/:id`, (c) => {
    const p = pipelineByIdOrFqn(c.req.param('id'))
    if (!p) return c.json(notFound(c.req.param('id')), 404)
    const next = { ...p, enabled: !p.enabled, updatedAt: Date.now() }
    store.replace(next)
    return c.json(next)
  })

  app.post(`/${PATH}/trigger/:id`, (c) => {
    const p = pipelineByIdOrFqn(c.req.param('id'))
    if (!p) return c.json(notFound(c.req.param('id')), 404)
    if (!p.deployed) return c.json({ code: 400, message: `Workflow [${p.name}] is not deployed. Deploy it before running it.` }, 400)
    const runs = runsOf(p)
    if (runs.at(-1)?.pipelineState === 'running')
      return c.json({ code: 400, message: `Workflow [${p.name}] already has a run in progress.` }, 400)
    const id = randomUUID()
    const start = Date.now()
    const records = TYPICAL_RECORDS[p.pipelineType] ?? [10, 10]
    runs.push(makeRun(p.pipelineType, id, start, undefined, 'running', records))
    syncLatest(p)
    // The demo run finishes on its own after a few seconds.
    const timer = setTimeout(
      () => {
        const i = runs.findIndex((x) => x.runId === id)
        if (i < 0 || runs[i]!.pipelineState !== 'running') return
        runs[i] = makeRun(p.pipelineType, id, start, Date.now(), 'success', records)
        syncLatest(p)
      },
      8000 + Math.random() * 6000,
    )
    timer.unref?.()
    return c.json({ code: 200, reason: `Workflow [${p.name}] has been triggered (run ${id})`, ...RUNNER })
  })

  app.post(`/${PATH}/kill/:id`, (c) => {
    const p = pipelineByIdOrFqn(c.req.param('id'))
    if (!p) return c.json(notFound(c.req.param('id')), 404)
    const runs = runsOf(p)
    const last = runs.at(-1)
    if (last?.pipelineState === 'running' || last?.pipelineState === 'queued') {
      runs[runs.length - 1] = {
        ...makeRun(p.pipelineType, String(last.runId), Number(last.startDate), Date.now(), 'stopped', [0, 0]),
        status: [],
      }
      syncLatest(p)
    }
    return c.json({ code: 200, reason: `Workflow [${p.name}] runs have been killed`, ...RUNNER })
  })

  app.get(`/${PATH}/:fqn/pipelineStatus`, (c) => {
    const p = pipelineByIdOrFqn(c.req.param('fqn'))
    if (!p) return c.json(notFound(c.req.param('fqn')), 404)
    const start = Number(c.req.query('startTs') ?? 0)
    const end = Number(c.req.query('endTs') ?? Number.MAX_SAFE_INTEGER)
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
    let data = runsOf(p).filter((r) => r.timestamp >= start && r.timestamp <= end)
    // Newest first, like the real endpoint's time-series listing.
    data = [...data].sort((a, b) => b.timestamp - a.timestamp)
    if (limit !== undefined) data = data.slice(0, limit)
    return c.json({ data, paging: { total: data.length } })
  })

  app.get(`/${PATH}/:fqn/pipelineStatus/:runId`, (c) => {
    const p = pipelineByIdOrFqn(c.req.param('fqn'))
    const run = p && runsOf(p).find((r) => r.runId === c.req.param('runId'))
    return run ? c.json(run) : c.json({ code: 404, message: 'Run not found' }, 404)
  })

  app.get(`/${PATH}/logs/:id/last`, (c) => {
    const p = pipelineByIdOrFqn(c.req.param('id'))
    if (!p) return c.json(notFound(c.req.param('id')), 404)
    const last = runsOf(p).at(-1)
    const text = last ? logText(p, last) : 'No runs yet.'
    return c.json({ [LOG_KEY[p.pipelineType] ?? 'ingestion_task']: text, total: '1' })
  })
}

/** Plausible ingestion framework output for one run. */
function logText(p: Entity, run: ResultRow): string {
  const t = (offsetMs: number) => new Date(Number(run.startDate) + offsetMs).toISOString().replace('T', ' ').slice(0, 19)
  const steps =
    (run.status as {
      name: string
      records: number
      warnings: number
      errors: number
      filtered: number
      failures?: { error: string; stackTrace?: string }[]
    }[]) ?? []
  const svc = p.service?.name ?? 'bigquery'
  const lines = [
    `[${t(0)}] INFO {metadata.Workflow:workflow.py:112} - Starting ${p.pipelineType} workflow ${p.fullyQualifiedName} (run ${run.runId})`,
    `[${t(800)}] INFO {metadata.Workflow:workflow.py:140} - Using service connection from OpenMetadata: ${svc}`,
    `[${t(1900)}] INFO {metadata.Ingestion:bigquery/connection.py:88} - Authenticated to BigQuery with gcp_credentials`,
  ]
  const end = run.endDate ? Number(run.endDate) - Number(run.startDate) : 4000
  if (run.pipelineState === 'running' || run.pipelineState === 'queued') {
    lines.push(`[${t(3200)}] INFO {metadata.Ingestion:topology_runner.py:120} - Processing projects: bigquery-public-data, acme-analytics`)
    lines.push(`[${t(4100)}] INFO {metadata.Ingestion:topology_runner.py:120} - Still running…`)
    return lines.join('\n')
  }
  lines.push(`[${t(3200)}] INFO {metadata.Ingestion:topology_runner.py:120} - Processing projects: bigquery-public-data, acme-analytics`)
  for (const s of steps) {
    for (const f of s.failures ?? [])
      lines.push(
        `[${t(end * 0.8)}] ${run.pipelineState === 'failed' ? 'ERROR' : 'WARNING'} {metadata.Ingestion:status.py:61} - ${f.error}${f.stackTrace ? `\n${f.stackTrace}` : ''}`,
      )
  }
  lines.push(`[${t(end - 500)}] INFO {metadata.Workflow:workflow_output_handler.py:95} - Workflow Summary`)
  for (const s of steps)
    lines.push(`  ${s.name}: processed ${s.records}, filtered ${s.filtered}, warnings ${s.warnings}, errors ${s.errors}`)
  lines.push(`[${t(end)}] INFO {metadata.Workflow:workflow.py:201} - Workflow finished with status ${run.pipelineState}`)
  return lines.join('\n')
}
