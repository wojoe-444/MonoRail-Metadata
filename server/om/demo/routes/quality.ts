import { randomUUID } from 'node:crypto'

import type { Context, Hono } from 'hono'

import { ref, store, type Entity, type ResultRow } from '../store'
import {
  applyLatest,
  createTestCase,
  incidents,
  parseEntityLink,
  replaceTestCase,
  type CreateTestCaseBody,
  type Incident,
} from '../seed/quality'

/**
 * Data quality endpoints beyond generic CRUD, shaped like OpenMetadata 2.0.8's
 * TestCaseResource, TestSuiteResource, TestDefinitionResource and
 * TestCaseResolutionStatusResource:
 *
 *   GET  /dataQuality/testDefinitions                     ?entityType=TABLE|COLUMN&testPlatform&supportedDataType
 *   GET  /dataQuality/testCases                           ?entityLink&includeAllTests&testCaseStatus&testCaseType&testSuiteId
 *   POST /dataQuality/testCases                           CreateTestCase
 *   GET  /dataQuality/testCases/search/list               ?q&testCaseStatus&testCaseType&entityLink&dataQualityDimension&offset&limit
 *   GET  /dataQuality/testCases/testCaseResults/{fqn}     ?startTs&endTs
 *   POST /dataQuality/testCases/testCaseResults/{fqn}     CreateTestCaseResult
 *   GET  /dataQuality/testCases/testCaseIncidentStatus    ?latest&startTs&endTs&testCaseResolutionStatusType&testCaseFQN&assignee
 *   GET  /dataQuality/testCases/testCaseIncidentStatus/stateId/{stateId}
 *   POST /dataQuality/testCases/testCaseIncidentStatus    CreateTestCaseResolutionStatus
 *   GET  /dataQuality/testSuites                          ?testSuiteType=basic|logical&fields=summary
 *   GET  /dataQuality/testSuites/executionSummary         ?testSuiteId
 */
export function registerQualityRoutes(app: Hono) {
  // ---------- Test definitions ----------

  app.get('/dataQuality/testDefinitions', (c) => {
    const q = c.req.query()
    let defs = store.all('dataQuality/testDefinitions').filter((d) => !d.deleted)
    if (q.entityType) defs = defs.filter((d) => d.entityType === q.entityType)
    if (q.testPlatform) defs = defs.filter((d) => (d.testPlatforms ?? []).includes(q.testPlatform))
    if (q.supportedDataType)
      defs = defs.filter((d) => !d.supportedDataTypes?.length || d.supportedDataTypes.includes(q.supportedDataType!.toUpperCase()))
    if (q.enabled) defs = defs.filter((d) => String(d.enabled !== false) === q.enabled)
    defs.sort((a, b) => a.name.localeCompare(b.name))
    return c.json(page(defs, q))
  })

  // ---------- Test cases ----------

  app.get('/dataQuality/testCases', (c) => {
    const q = c.req.query()
    let cases = liveCases(q.include)
    if (q.entityLink) cases = cases.filter(byEntityLink(q.entityLink, q.includeAllTests === 'true'))
    if (q.entityFQN)
      cases = cases.filter(
        (tc) => tc.entityFQN === q.entityFQN || (q.includeAllTests === 'true' && tc.entityFQN?.startsWith(`${q.entityFQN}.`)),
      )
    if (q.testSuiteId)
      cases = cases.filter((tc) => tc.testSuite?.id === q.testSuiteId || (tc.testSuites ?? []).some((s: Entity) => s.id === q.testSuiteId))
    if (q.testCaseStatus) cases = cases.filter((tc) => tc.testCaseResult?.testCaseStatus === q.testCaseStatus)
    if (q.testCaseType && q.testCaseType !== 'all') cases = cases.filter((tc) => caseType(tc) === q.testCaseType)
    cases.sort((a, b) => a.name.localeCompare(b.name))
    return c.json(page(cases, q))
  })

  app.post('/dataQuality/testCases', async (c) => {
    const body = (await c.req.json()) as CreateTestCaseBody
    const created = createTestCase(body)
    if ('error' in created) return c.json({ code: created.status, message: created.error }, created.status as 400)
    return c.json(created, 201)
  })

  app.get('/dataQuality/testCases/search/list', (c) => {
    const q = c.req.query()
    let cases = liveCases(q.include)
    const text = (q.q ?? '').replace(/\*/g, '').trim().toLowerCase()
    if (text)
      cases = cases.filter((tc) =>
        [tc.name, tc.displayName, tc.fullyQualifiedName, tc.description, tc.testDefinition?.name].some((s) =>
          String(s ?? '')
            .toLowerCase()
            .includes(text),
        ),
      )
    if (q.entityLink) cases = cases.filter(byEntityLink(q.entityLink, q.includeAllTests === 'true'))
    if (q.testCaseStatus) {
      const wanted = q.testCaseStatus.split(',')
      cases = cases.filter((tc) => wanted.includes(tc.testCaseResult?.testCaseStatus))
    }
    if (q.testCaseType && q.testCaseType !== 'all') cases = cases.filter((tc) => caseType(tc) === q.testCaseType)
    if (q.testSuiteId)
      cases = cases.filter((tc) => tc.testSuite?.id === q.testSuiteId || (tc.testSuites ?? []).some((s: Entity) => s.id === q.testSuiteId))
    if (q.dataQualityDimension) cases = cases.filter((tc) => definitionOf(tc)?.dataQualityDimension === q.dataQualityDimension)
    if (q.testPlatforms)
      cases = cases.filter((tc) => (definitionOf(tc)?.testPlatforms ?? []).some((p: string) => q.testPlatforms!.split(',').includes(p)))
    if (q.startTimestamp && q.endTimestamp) {
      const [s, e] = [Number(q.startTimestamp), Number(q.endTimestamp)]
      cases = cases.filter((tc) => tc.testCaseResult && tc.testCaseResult.timestamp >= s && tc.testCaseResult.timestamp <= e)
    }
    const dir = q.sortType === 'asc' ? 1 : -1
    const sortField = q.sortField ?? 'testCaseResult.timestamp'
    const key = (tc: Entity): string | number =>
      sortField === 'name' || sortField === 'name.keyword'
        ? tc.name
        : sortField.startsWith('testCaseResult')
          ? (tc.testCaseResult?.timestamp ?? 0)
          : String(tc[sortField] ?? '')
    cases.sort((a, b) => {
      const [ka, kb] = [key(a), key(b)]
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir || a.name.localeCompare(b.name)
    })
    const offset = Number(q.offset ?? 0)
    const limit = Number(q.limit ?? 10)
    return c.json({ data: cases.slice(offset, offset + limit), paging: { offset, limit, total: cases.length } })
  })

  // ---------- Results ----------

  app.get('/dataQuality/testCases/testCaseResults/:fqn', (c) => {
    const fqn = decodeURIComponent(c.req.param('fqn'))
    if (!store.byFqn('dataQuality/testCases', fqn)) return c.json({ code: 404, message: `testCase instance for ${fqn} not found` }, 404)
    const start = Number(c.req.query('startTs') ?? 0)
    const end = Number(c.req.query('endTs') ?? Number.MAX_SAFE_INTEGER)
    const data = (store.testResults.get(fqn) ?? [])
      .filter((r) => r.timestamp >= start && r.timestamp <= end)
      .sort((a, b) => b.timestamp - a.timestamp)
    return c.json({ data, paging: { total: data.length } })
  })

  app.post('/dataQuality/testCases/testCaseResults/:fqn', async (c) => {
    const fqn = decodeURIComponent(c.req.param('fqn'))
    const tc = store.byFqn('dataQuality/testCases', fqn)
    if (!tc) return c.json({ code: 404, message: `testCase instance for ${fqn} not found` }, 404)
    const body = (await c.req.json()) as ResultRow
    const def = definitionOf(tc)
    let open = tc.incidentId as string | undefined
    if (body.testCaseStatus === 'Failed' && !open) {
      open = randomUUID()
      addIncident(tc, { stateId: open, testCaseResolutionStatusType: 'New', severity: undefined })
    }
    const row: ResultRow = {
      ...body,
      id: randomUUID(),
      testCaseFQN: fqn,
      timestamp: body.timestamp ?? Date.now(),
      testCase: ref(tc, 'testCase'),
      testDefinition: def ? ref(def, 'testDefinition') : undefined,
      incidentId: body.testCaseStatus === 'Failed' ? open : undefined,
    }
    store.testResults.set(fqn, [...(store.testResults.get(fqn) ?? []), row])
    applyLatest(tc)
    return c.json(row, 201)
  })

  // ---------- Incidents (TestCaseResolutionStatus) ----------

  app.get('/dataQuality/testCases/testCaseIncidentStatus', (c) => c.json(listIncidents(c)))
  app.get('/dataQuality/testCases/testCaseIncidentStatus/search/list', (c) => c.json(listIncidents(c)))

  app.get('/dataQuality/testCases/testCaseIncidentStatus/stateId/:stateId', (c) => {
    const data = incidents
      .filter((i) => i.stateId === c.req.param('stateId'))
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(withCurrentRef)
    return c.json({ data, paging: { total: data.length } })
  })

  app.post('/dataQuality/testCases/testCaseIncidentStatus', async (c) => {
    const body = (await c.req.json()) as Entity
    const tc = store.byFqn('dataQuality/testCases', String(body.testCaseReference ?? ''))
    if (!tc) return c.json({ code: 404, message: `testCase instance for ${String(body.testCaseReference)} not found` }, 404)
    const type = String(body.testCaseResolutionStatusType ?? '')
    if (!['New', 'Ack', 'Assigned', 'Resolved'].includes(type))
      return c.json({ code: 400, message: `Invalid testCaseResolutionStatusType ${type}` }, 400)
    let stateId = tc.incidentId as string | undefined
    if (!stateId) {
      if (type === 'Resolved') return c.json({ code: 400, message: 'Cannot resolve: the test case has no open incident' }, 400)
      stateId = randomUUID()
    }
    const last = incidents.filter((i) => i.stateId === stateId).at(-1)
    if (type === 'Assigned' && !body.testCaseResolutionStatusDetails?.assignee)
      return c.json({ code: 400, message: 'Assigned status needs testCaseResolutionStatusDetails.assignee' }, 400)
    if (type === 'Resolved' && !body.testCaseResolutionStatusDetails?.testCaseFailureReason)
      return c.json({ code: 400, message: 'Resolved status needs testCaseResolutionStatusDetails.testCaseFailureReason' }, 400)
    const record = addIncident(tc, {
      stateId,
      testCaseResolutionStatusType: type,
      testCaseResolutionStatusDetails: expandDetails(body.testCaseResolutionStatusDetails),
      severity: body.severity ?? last?.severity,
    })
    return c.json(withCurrentRef(record), 201)
  })

  // PATCH an incident record (OpenMetadata uses this to change severity).
  app.patch('/dataQuality/testCases/testCaseIncidentStatus/:id', async (c) => {
    const rec = incidents.find((i) => i.id === c.req.param('id'))
    if (!rec) return c.json({ code: 404, message: 'Not found' }, 404)
    const ops = (await c.req.json()) as { op: string; path: string; value?: unknown }[]
    for (const op of ops) {
      const key = op.path.replace(/^\//, '')
      if (op.op === 'remove') delete rec[key]
      else rec[key] = op.value
    }
    // Severity applies to the whole incident.
    if (ops.some((o) => o.path === '/severity')) for (const i of incidents) if (i.stateId === rec.stateId) i.severity = rec.severity
    return c.json(withCurrentRef(rec))
  })

  // ---------- Test suites ----------

  app.get('/dataQuality/testSuites/executionSummary', (c) => {
    const id = c.req.query('testSuiteId')
    const cases = liveCases().filter((tc) => !id || tc.testSuite?.id === id || (tc.testSuites ?? []).some((s: Entity) => s.id === id))
    return c.json(summarize(cases))
  })

  app.get('/dataQuality/testSuites', (c) => {
    const q = c.req.query()
    const fields = (q.fields ?? '').split(',')
    let suites = store.all('dataQuality/testSuites').filter((s) => !s.deleted || q.include === 'all')
    if (q.testSuiteType === 'basic') suites = suites.filter((s) => s.basic)
    if (q.testSuiteType === 'logical') suites = suites.filter((s) => !s.basic)
    const cases = liveCases()
    const out = suites
      .map((s) => {
        const mine = cases.filter((tc) => tc.testSuite?.id === s.id || (tc.testSuites ?? []).some((x: Entity) => x.id === s.id))
        return {
          ...s,
          tests: fields.includes('tests') || fields.includes('*') ? mine.map((tc) => ref(tc, 'testCase')) : undefined,
          summary: fields.includes('summary') || fields.includes('*') ? summarize(mine) : undefined,
        }
      })
      .filter((s) => q.includeEmptyTestSuites !== 'false' || (s.tests?.length ?? 1) > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
    return c.json(page(out, q))
  })
}

// ---------- Helpers ----------

function liveCases(include?: string): Entity[] {
  return store.all('dataQuality/testCases').filter((tc) => !tc.deleted || include === 'all' || include === 'deleted')
}

function caseType(tc: Entity): 'table' | 'column' {
  return parseEntityLink(tc.entityLink ?? '')?.column ? 'column' : 'table'
}

function byEntityLink(link: string, includeAll: boolean) {
  const parsed = parseEntityLink(link)
  return (tc: Entity) => {
    if (tc.entityLink === link) return true
    if (!parsed || parsed.column) return false
    return includeAll && tc.entityFQN === parsed.entityFQN
  }
}

function definitionOf(tc: Entity): Entity | undefined {
  return tc.testDefinition?.id ? store.get(tc.testDefinition.id)?.entity : undefined
}

function summarize(cases: Entity[]) {
  const count = (s: string) => cases.filter((tc) => tc.testCaseResult?.testCaseStatus === s).length
  return { success: count('Success'), failed: count('Failed'), aborted: count('Aborted'), queued: count('Queued'), total: cases.length }
}

function page<T>(items: T[], q: Record<string, string | undefined>) {
  const limit = q.limit === undefined ? 10 : Number(q.limit)
  const offset = q.after ? Number(Buffer.from(q.after, 'base64').toString()) : 0
  const data = items.slice(offset, offset + limit)
  const after = offset + limit < items.length ? Buffer.from(String(offset + limit)).toString('base64') : undefined
  return { data, paging: { total: items.length, after } }
}

function addIncident(
  tc: Entity,
  fields: { stateId: string; testCaseResolutionStatusType: string; testCaseResolutionStatusDetails?: unknown; severity?: string },
): Incident {
  const admin = store.byFqn('users', 'admin')
  const now = Date.now()
  const record: Incident = {
    id: randomUUID(),
    timestamp: now,
    updatedAt: now,
    updatedBy: admin ? ref(admin, 'user') : undefined,
    testCaseReference: ref(tc, 'testCase'),
    ...fields,
  }
  if (fields.testCaseResolutionStatusType === 'Resolved' && record.testCaseResolutionStatusDetails && admin) {
    ;(record.testCaseResolutionStatusDetails as Entity).resolvedBy ??= ref(admin, 'user')
  }
  incidents.push(record)
  const cur = store.get(tc.id)!.entity
  if (fields.testCaseResolutionStatusType === 'Resolved') {
    const { incidentId: _closed, ...rest } = cur
    replaceTestCase(rest as Entity)
  } else replaceTestCase({ ...cur, incidentId: fields.stateId })
  return record
}

/** Assignee comes as a reference or a user name; store a full reference. */
function expandDetails(details: Entity | undefined) {
  if (!details) return undefined
  const a = details.assignee
  if (a) {
    const user = (a.id && store.get(a.id)?.entity) || store.byFqn('users', a.name ?? a.fullyQualifiedName ?? String(a))
    return { ...details, assignee: user ? ref(user, 'user') : a }
  }
  return details
}

function withCurrentRef(i: Incident): Incident {
  const tc = store.get(i.testCaseReference?.id)?.entity
  return tc ? { ...i, testCaseReference: ref(tc, 'testCase') } : i
}

function listIncidents(c: Context) {
  const q = c.req.query()
  const start = Number(q.startTs ?? 0)
  const end = Number(q.endTs ?? Number.MAX_SAFE_INTEGER)
  let rows = [...incidents]
  if (q.latest === 'true') {
    const latest = new Map<string, Incident>()
    for (const r of rows) {
      const cur = latest.get(r.stateId)
      if (!cur || r.timestamp >= cur.timestamp) latest.set(r.stateId, r)
    }
    rows = [...latest.values()]
  }
  rows = rows.filter((r) => r.timestamp >= start && r.timestamp <= end)
  if (q.testCaseResolutionStatusType) rows = rows.filter((r) => r.testCaseResolutionStatusType === q.testCaseResolutionStatusType)
  if (q.testCaseFQN) rows = rows.filter((r) => r.testCaseReference?.fullyQualifiedName === q.testCaseFQN)
  if (q.originEntityFQN)
    rows = rows.filter((r) => String(r.testCaseReference?.fullyQualifiedName ?? '').startsWith(`${q.originEntityFQN}.`))
  if (q.assignee) rows = rows.filter((r) => r.testCaseResolutionStatusDetails?.assignee?.name === q.assignee)
  rows.sort((a, b) => b.timestamp - a.timestamp)
  const offset = Number(q.offset ?? 0)
  const limit = Number(q.limit ?? 10)
  return { data: rows.slice(offset, offset + limit).map(withCurrentRef), paging: { total: rows.length, offset, limit } }
}
