import { randomUUID } from 'node:crypto'

import jsonpatch, { type Operation } from 'fast-json-patch'
import { Hono, type Context } from 'hono'

import { registerExtraRoutes } from './routes'
import { aggregate, search } from './search'
import { seedAll } from './seed'
import { ref, store, type Entity } from './store'

/**
 * A stand-in for the OpenMetadata REST API (`/api/v1`), used when OM_URL is
 * not set. It answers the endpoints this app calls with the same JSON shapes,
 * over a small BigQuery catalog (bigquery-public-data.thelook_ecommerce plus
 * an analytics layer built on it). Writes are kept in memory.
 *
 * Generic entity CRUD covers every collection the seed registers. Feature
 * endpoints (search, lineage, profiles, tests, pipelines) are added below or
 * in ./routes.
 */
export const demoApp = new Hono().basePath('/api/v1')

let seeded = false
/** Fill the store with the demo fixtures, once. Demo mode only: in team mode the store holds a replica instead. */
export function ensureDemoSeeded() {
  if (seeded) return
  seeded = true
  seedAll()
}

const DEMO_USER = 'admin'

demoApp.get('/system/version', (c) => c.json({ version: '2.0.8', revision: 'demo', timestamp: Date.now() }))

demoApp.get('/users/loggedInUser', (c) => c.json(store.byFqn('users', DEMO_USER)))

// ---------- Search ----------

demoApp.get('/search/query', (c) => c.json(search(c.req.query())))
demoApp.get('/search/aggregate', (c) => c.json(aggregate(c.req.query())))

// ---------- Lineage ----------

demoApp.get('/lineage/getLineage', (c) => {
  const q = c.req.query()
  const root = store.findFqn(q.fqn ?? '', q.type)?.entity
  if (!root) return c.json({ message: `No ${q.type} named ${q.fqn}` }, 404)
  const up = Number(q.upstreamDepth ?? 1)
  const down = Number(q.downstreamDepth ?? 1)
  const nodes: Record<string, unknown> = {}
  const upstreamEdges: Record<string, unknown> = {}
  const downstreamEdges: Record<string, unknown> = {}
  const edges = [...store.lineage.values()]
  const addNode = (id: string, depth: number) => {
    const found = store.get(id)
    if (!found || nodes[id]) return
    const e = found.entity
    nodes[id] = {
      entity: {
        ...ref(e),
        entityType: found.collection.entityType,
        service: e.service,
        columns: e.columns?.map((col: Entity) => ({ name: col.name, fullyQualifiedName: col.fullyQualifiedName, dataType: col.dataType })),
      },
      paging: {
        entityUpstreamCount: edges.filter((x) => x.toEntity.id === id).length,
        entityDownstreamCount: edges.filter((x) => x.fromEntity.id === id).length,
      },
      nodeDepth: depth,
    }
  }
  addNode(root.id, 0)
  const walk = (start: string, depthLimit: number, dir: 'up' | 'down') => {
    let frontier = [start]
    for (let depth = 1; depth <= depthLimit && frontier.length; depth++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const e of edges) {
          const match = dir === 'up' ? e.toEntity.id === id : e.fromEntity.id === id
          if (!match) continue
          const other = dir === 'up' ? e.fromEntity.id : e.toEntity.id
          const key = `${e.fromEntity.id}-->${e.toEntity.id}`
          ;(dir === 'up' ? upstreamEdges : downstreamEdges)[key] = { ...e, docId: key }
          if (!nodes[other]) next.push(other)
          addNode(other, dir === 'up' ? -depth : depth)
        }
      }
      frontier = next
    }
  }
  walk(root.id, up, 'up')
  walk(root.id, down, 'down')
  // Like OpenMetadata 2.x, key nodes by FQN (the walk above keys them by id).
  const byFqn = Object.fromEntries(Object.entries(nodes).map(([id, n]) => [(n as { entity: Entity }).entity.fullyQualifiedName ?? id, n]))
  return c.json({ nodes: byFqn, upstreamEdges, downstreamEdges })
})

demoApp.put('/lineage', async (c) => {
  const body = (await c.req.json()) as {
    edge: { fromEntity: { id: string; type: string }; toEntity: { id: string; type: string }; lineageDetails?: Record<string, unknown> }
  }
  const { fromEntity, toEntity, lineageDetails } = body.edge
  const from = store.get(fromEntity.id)?.entity
  const to = store.get(toEntity.id)?.entity
  if (!from || !to) return c.json({ message: 'Unknown entity in edge' }, 404)
  store.lineage.set(`${from.id}->${to.id}`, {
    fromEntity: { ...fromEntity, fullyQualifiedName: from.fullyQualifiedName },
    toEntity: { ...toEntity, fullyQualifiedName: to.fullyQualifiedName },
    source: 'Manual',
    ...(lineageDetails ?? {}),
  })
  return c.json(body)
})

demoApp.delete('/lineage/:fromType/:fromId/:toType/:toId', (c) => {
  store.lineage.delete(`${c.req.param('fromId')}->${c.req.param('toId')}`)
  return c.body(null, 200)
})

// ---------- Table profiles and sample data ----------

demoApp.get('/tables/:id/sampleData', (c) => {
  const t = store.get(c.req.param('id'))?.entity
  if (!t) return c.json({ message: 'Not found' }, 404)
  return c.json({ ...t, sampleData: store.sampleData.get(t.id) ?? { columns: [], rows: [] } })
})

demoApp.get('/tables/:fqn/tableProfile/latest', (c) => {
  const fqn = decodeURIComponent(c.req.param('fqn'))
  const t = store.byFqn('tables', fqn)
  if (!t) return c.json({ message: 'Not found' }, 404)
  const latest = store.tableProfiles.get(fqn)?.at(-1)
  const includeColumns = c.req.query('includeColumnProfile') !== 'false'
  return c.json({
    ...t,
    profile: latest,
    columns: t.columns?.map((col: Entity) => ({
      ...col,
      profile: includeColumns ? store.columnProfiles.get(col.fullyQualifiedName ?? '')?.at(-1) : undefined,
    })),
  })
})

demoApp.get('/tables/:fqn/tableProfile', (c) => {
  const rows = store.tableProfiles.get(decodeURIComponent(c.req.param('fqn'))) ?? []
  return c.json(timeWindow(rows, c))
})

demoApp.get('/tables/:fqn/columnProfile', (c) => {
  const rows = store.columnProfiles.get(decodeURIComponent(c.req.param('fqn'))) ?? []
  return c.json(timeWindow(rows, c))
})

demoApp.get('/tables/:fqn/systemProfile', (c) => c.json({ data: [], paging: { total: 0 } }))

// ---------- Activity feed ----------

demoApp.get('/feed', (c) => {
  const link = c.req.query('entityLink')
  const type = c.req.query('type')
  const data = store.threads
    .filter((t) => (!link || t.about === link || t.about.startsWith(link.replace(/>$/, '::'))) && (!type || t.type === type))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return c.json({ data, paging: { total: data.length } })
})

demoApp.post('/feed', async (c) => {
  const body = (await c.req.json()) as { message: string; about: string; from?: string; type?: string }
  const now = Date.now()
  const thread: Entity = {
    id: randomUUID(),
    name: body.message.slice(0, 40),
    type: body.type ?? 'Conversation',
    about: body.about,
    entityRef: undefined,
    message: body.message,
    createdBy: body.from ?? DEMO_USER,
    threadTs: now,
    updatedAt: now,
    updatedBy: body.from ?? DEMO_USER,
    posts: [],
    postsCount: 0,
    reactions: [],
    resolved: false,
  }
  store.threads.push(thread)
  return c.json(thread, 201)
})

demoApp.post('/feed/:id/posts', async (c) => {
  const thread = store.threads.find((t) => t.id === c.req.param('id'))
  if (!thread) return c.json({ message: 'Not found' }, 404)
  const body = (await c.req.json()) as { message: string; from?: string }
  const now = Date.now()
  thread.posts.push({ id: randomUUID(), message: body.message, from: body.from ?? DEMO_USER, postTs: now, reactions: [] })
  thread.postsCount = thread.posts.length
  thread.updatedAt = now
  return c.json(thread)
})

registerExtraRoutes(demoApp)

// ---------- Generic entity CRUD ----------

/** Query parameters that filter a list by a reference field, e.g. ?service=bigquery. */
const LIST_FILTERS: Record<string, (e: Entity, v: string) => boolean> = {
  service: (e, v) => refMatches(e.service, v),
  database: (e, v) => refMatches(e.database, v),
  databaseSchema: (e, v) => refMatches(e.databaseSchema, v),
  glossary: (e, v) => refMatches(e.glossary, v),
  parent: (e, v) => refMatches(e.parent, v) || refMatches(e.classification, v),
  classification: (e, v) => refMatches(e.classification, v),
  domain: (e, v) => (e.domains ?? []).some((d: Entity) => refMatches(d, v)),
  team: (e, v) => (e.teams ?? []).some((d: Entity) => refMatches(d, v)),
  entityLink: (e, v) => e.entityLink === v || (e.entityLink ?? '').startsWith(v.replace(/>$/, '::')),
  testSuiteId: (e, v) => (e.testSuites ?? []).some((s: Entity) => s.id === v) || e.testSuite?.id === v,
  pipelineType: (e, v) => e.pipelineType === v,
  isBot: (e, v) => Boolean(e.isBot) === (v === 'true'),
  entityId: (e, v) => (e.queryUsedIn ?? []).some((r: Entity) => r.id === v),
}

function refMatches(r: Entity | undefined, v: string): boolean {
  return Boolean(r && (r.id === v || r.name === v || r.fullyQualifiedName === v))
}

demoApp.all('/*', async (c) => {
  const rest = decodeURIComponent(c.req.path.replace(/^\/api\/v1\//, ''))
  // Longest collection path that prefixes the request, e.g. "services/databaseServices".
  const collection = [...store.collections.values()]
    .filter((col) => rest === col.path || rest.startsWith(`${col.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (!collection) return c.json({ code: 404, message: `Demo catalog has no endpoint for /${rest}` }, 404)
  const tail = rest.slice(collection.path.length).replace(/^\//, '')
  const method = c.req.method

  if (!tail) {
    if (method === 'GET') {
      const q = c.req.query()
      let items = [...collection.items.values()].filter((e) => !e.deleted || q.include === 'all' || q.include === 'deleted')
      for (const [k, test] of Object.entries(LIST_FILTERS)) if (q[k]) items = items.filter((e) => test(e, q[k]!))
      items.sort((a, b) => String(a.name).localeCompare(String(b.name)))
      const total = items.length
      const limit = q.limit === undefined ? 10 : Number(q.limit)
      const offset = q.after ? Number(Buffer.from(q.after, 'base64').toString()) : 0
      const page = items.slice(offset, offset + limit)
      const after = offset + limit < total ? Buffer.from(String(offset + limit)).toString('base64') : undefined
      return c.json({ data: page, paging: { total, after } })
    }
    if (method === 'POST' || method === 'PUT') {
      const body = (await c.req.json()) as Entity
      const existing = body.name ? [...collection.items.values()].find((e) => e.name === body.name && sameParent(e, body)) : undefined
      if (existing && method === 'PUT') return c.json(update(existing, { ...existing, ...expandRefs(body) }))
      if (existing) return c.json({ code: 409, message: `${collection.entityType} ${body.name} already exists` }, 409)
      return c.json(store.add(collection.path, createFrom(collection.entityType, body)), 201)
    }
  }

  const byName = tail.startsWith('name/')
  const [idOrFqn, sub, subId] = byName
    ? [
        tail.slice(5).replace(/\/(followers|versions)(\/.*)?$/, ''),
        tail.match(/\/(followers|versions)/)?.[1],
        tail.match(/\/(?:followers|versions)\/(.+)$/)?.[1],
      ]
    : tail.split('/')
  const entity = byName ? store.byFqn(collection.path, idOrFqn!) : collection.items.get(idOrFqn!)
  if (!entity) return c.json({ code: 404, message: `${collection.entityType} instance for ${idOrFqn} not found` }, 404)

  if (sub === 'versions') {
    const versions = [...(store.history.get(entity.id) ?? []), entity].reverse()
    if (subId) {
      const v = versions.find((x) => String(x.version) === subId)
      return v ? c.json(v) : c.json({ message: 'No such version' }, 404)
    }
    return c.json({ entityType: collection.entityType, versions: versions.map((v) => JSON.stringify(v)) })
  }
  if (sub === 'followers') {
    if (method === 'PUT') {
      const userId = (await c.req.text()).replace(/"/g, '')
      const user = store.get(userId)?.entity
      if (user && !entity.followers.some((f: Entity) => f.id === userId))
        update(entity, { ...entity, followers: [...entity.followers, ref(user, 'user')] })
      return c.json({ changeDescription: {}, entity: store.get(entity.id)?.entity })
    }
    if (method === 'DELETE' && subId) {
      update(entity, { ...entity, followers: entity.followers.filter((f: Entity) => f.id !== subId) })
      return c.json({ changeDescription: {} })
    }
  }

  if (method === 'GET') return c.json(entity)
  if (method === 'PATCH') {
    const ops = (await c.req.json()) as Operation[]
    const next = jsonpatch.applyPatch(structuredClone(entity), ops, false, false).newDocument as Entity
    return c.json(update(entity, expandRefs(next)))
  }
  if (method === 'DELETE') {
    if (c.req.query('hardDelete') === 'true') store.remove(entity.id)
    else update(entity, { ...entity, deleted: true })
    return c.json(entity)
  }
  return c.json({ message: `${method} not supported on /${rest} in the demo catalog` }, 405)
})

function update(prev: Entity, next: Entity): Entity {
  const history = store.history.get(prev.id) ?? []
  history.push(prev)
  store.history.set(prev.id, history)
  const updated: Entity = {
    ...next,
    id: prev.id,
    version: Math.round((prev.version + 0.1) * 10) / 10,
    updatedAt: Date.now(),
    updatedBy: DEMO_USER,
    changeDescription: { previousVersion: prev.version, fieldsUpdated: changedFields(prev, next) },
  }
  store.replace(updated)
  return updated
}

function changedFields(a: Entity, b: Entity) {
  return Object.keys(b)
    .filter((k) => !['version', 'updatedAt', 'updatedBy', 'changeDescription'].includes(k))
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((name) => ({ name, oldValue: JSON.stringify(a[name]), newValue: JSON.stringify(b[name]) }))
}

function sameParent(a: Entity, b: Entity) {
  const parent = (e: Entity) => e.glossary ?? e.classification ?? e.parent ?? e.databaseSchema ?? e.database ?? e.service
  const pa = parent(a)
  const pb = parent(b)
  if (!pa || !pb) return true
  const key = (p: unknown) => (typeof p === 'string' ? p : ((p as Entity).fullyQualifiedName ?? (p as Entity).name ?? (p as Entity).id))
  return key(pa) === key(pb) || (pa as Entity).id === pb
}

/** Create requests name related entities by FQN strings; store them as references. */
function expandRefs(e: Entity): Entity {
  const out = { ...e }
  const asRef = (v: unknown, type?: string) => {
    if (!v) return v
    if (typeof v !== 'string') return v
    const found = store.findFqn(v, type) ?? store.get(v)
    return found ? ref(found.entity, found.collection.entityType) : v
  }
  for (const [k, type] of [
    ['glossary', 'glossary'],
    ['parent', undefined],
    ['classification', 'classification'],
    ['service', undefined],
    ['database', 'database'],
    ['databaseSchema', 'databaseSchema'],
  ] as const) {
    if (k in out) out[k] = asRef(out[k], type)
  }
  if (Array.isArray(out.domains)) out.domains = out.domains.map((d: unknown) => asRef(d, 'domain'))
  if (Array.isArray(out.owners)) out.owners = out.owners.map((o: unknown) => (typeof o === 'string' ? asRef(o) : o))
  if (Array.isArray(out.reviewers)) out.reviewers = out.reviewers.map((o: unknown) => (typeof o === 'string' ? asRef(o) : o))
  return out
}

function createFrom(entityType: string, body: Entity): Entity {
  const e = expandRefs(body)
  const parent = e.glossary ?? e.classification ?? e.parent
  const parentFqn = e.parent?.fullyQualifiedName ?? parent?.fullyQualifiedName
  const fullyQualifiedName = body.fullyQualifiedName ?? (parentFqn && entityType !== 'domain' ? `${parentFqn}.${body.name}` : body.name)
  return { ...e, fullyQualifiedName, updatedAt: Date.now() }
}

function timeWindow(rows: { timestamp: number }[], c: Context) {
  const start = Number(c.req.query('startTs') ?? 0)
  const end = Number(c.req.query('endTs') ?? Number.MAX_SAFE_INTEGER)
  const data = rows.filter((r) => r.timestamp >= start && r.timestamp <= end)
  return { data, paging: { total: data.length } }
}
