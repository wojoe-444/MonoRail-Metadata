import { Hono } from 'hono'

import { publishMetrics } from './publish'
import { metricsCatalog, saveView, semanticCatalog, semanticModel } from './semantic'
import { dryRun } from './service'

/**
 * The semantic-layer endpoints, mounted at /api/malloy next to the model
 * endpoints in server/index.ts:
 *
 *   GET  /semantic[?path=]     every model (or one) as semantic sources: joins, fields, definitions
 *   GET  /metrics              every measure across models, with glossary term and tables read
 *   POST /dryrun               { path | content, query } → SQL and a BigQuery dry-run estimate
 *   POST /views                { model, source, name, description?, body, builder? } → saves a view into the model
 *   POST /publish-metrics      { dryRun? } → creates or updates OpenMetadata metric entities for every measure
 */
export const semanticRoutes = new Hono()

semanticRoutes.get('/semantic', async (c) => {
  const rel = c.req.query('path')
  return c.json(rel ? [await semanticModel(rel)] : await semanticCatalog())
})

semanticRoutes.get('/metrics', async (c) => c.json(await metricsCatalog()))

semanticRoutes.post('/dryrun', async (c) => {
  const { content, path: rel, query } = (await c.req.json()) as { content?: string; path?: string; query: string }
  return c.json(await dryRun(content, query, rel))
})

semanticRoutes.post('/views', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof saveView>[0]
  return c.json(await saveView(body))
})

semanticRoutes.post('/publish-metrics', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { dryRun?: boolean }
  return c.json(await publishMetrics({ dryRun: Boolean(body.dryRun) }))
})
