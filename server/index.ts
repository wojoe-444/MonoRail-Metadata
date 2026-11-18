import { existsSync } from 'node:fs'
import path from 'node:path'

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

import { bigQueryConfigured, CONFIG, DEMO_MODE } from './config'
import { semanticRoutes } from './malloy/routes'
import { BadRequest, compile, listModels, readModel, run, saveModel, usageOfTable } from './malloy/service'
import { omFetch, omJson } from './om/client'

/**
 * The app's server. The browser only talks to this, never to OpenMetadata or
 * BigQuery directly, so credentials stay here.
 *
 *   /api/health        what the server is connected to
 *   /api/om/...        OpenMetadata's REST API (/api/v1/...), passed through with the server's credentials
 *   /api/malloy/...    Malloy models: list, read, save, compile, run; the semantic catalog (malloy/routes.ts)
 *
 * In production it also serves the built UI from dist/.
 */
const app = new Hono()

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ message: err.message }, 400)
  console.error(err)
  return c.json({ message: err.message }, 500)
})

app.get('/api/health', async (c) => {
  let om: { ok: boolean; version?: string; error?: string }
  try {
    const v = await omJson<{ version: string }>('/system/version')
    om = { ok: true, version: v.version }
  } catch (e) {
    om = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return c.json({
    mode: DEMO_MODE ? 'demo' : 'openmetadata',
    openmetadata: { url: DEMO_MODE ? null : CONFIG.omUrl, service: CONFIG.omBigQueryService, ...om },
    bigquery: { configured: bigQueryConfigured(), projectId: CONFIG.bqProjectId || null, maxBytesBilled: Number(CONFIG.bqMaxBytesBilled) },
    malloy: { dir: path.relative(CONFIG.root, CONFIG.malloyDir) },
  })
})

// ---------- OpenMetadata pass-through ----------

const HOP_BY_HOP = ['host', 'connection', 'content-length', 'authorization', 'cookie', 'accept-encoding']

app.all('/api/om/*', async (c) => {
  const url = new URL(c.req.url)
  const rest = url.pathname.replace(/^\/api\/om/, '') + url.search
  const headers = new Headers()
  c.req.raw.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.includes(k.toLowerCase())) headers.set(k, v)
  })
  const body = ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer()
  const res = await omFetch(rest, { method: c.req.method, headers, body })
  const out = new Headers()
  const type = res.headers.get('content-type')
  if (type) out.set('content-type', type)
  return new Response(res.body, { status: res.status, headers: out })
})

// ---------- Malloy ----------

app.get('/api/malloy/models', async (c) => c.json(await listModels()))

app.get('/api/malloy/model', async (c) => c.json(await readModel(c.req.query('path') ?? '')))

app.put('/api/malloy/model', async (c) => {
  const { path: rel, content } = (await c.req.json()) as { path: string; content: string }
  return c.json(await saveModel(rel, content))
})

app.post('/api/malloy/compile', async (c) => {
  const { content, path: rel, query } = (await c.req.json()) as { content: string; path?: string; query?: string }
  return c.json(await compile(content, rel, query))
})

app.post('/api/malloy/run', async (c) => {
  const { content, path: rel, query } = (await c.req.json()) as { content: string; path?: string; query: string }
  return c.json(await run(content, query, rel))
})

app.get('/api/malloy/usage', async (c) => c.json(await usageOfTable(c.req.query('table') ?? '')))

app.route('/api/malloy', semanticRoutes)

// ---------- Built UI ----------

const dist = path.join(CONFIG.root, 'dist')
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), dist) || '.' }))
}

serve({ fetch: app.fetch, port: CONFIG.port }, (info) => {
  console.log(`MonoRail Metadata server on http://localhost:${info.port}`)
  console.log(DEMO_MODE ? '  OpenMetadata: demo catalog (set OM_URL to use a real server)' : `  OpenMetadata: ${CONFIG.omUrl}`)
  console.log(
    `  BigQuery: ${bigQueryConfigured() ? `configured (${CONFIG.bqProjectId || 'ADC project'})` : 'not configured: Malloy compiles but does not run'}`,
  )
})
