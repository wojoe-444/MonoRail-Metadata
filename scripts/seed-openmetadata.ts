/**
 * Load the demo catalog into a real OpenMetadata server, through its REST API.
 *
 *   npm run seed:om            (uses OM_URL and the credentials in .env)
 *
 * Use it on a local or test OpenMetadata to get the same content the demo
 * catalog shows (a BigQuery service with theLook and an analytics layer,
 * lineage, profiles, sample rows, queries, glossary, tags, domains, data
 * products, tests and conversations) without BigQuery credentials. It also
 * checks the app's API shapes against the real server: every request it makes
 * is one the app makes too.
 *
 * Safe to re-run: entities go through PUT (create or update). Time series
 * (profiles, test results) are re-sent for the same timestamps.
 *
 * Don't run it against a production catalog: it creates a service named
 * "bigquery" and sample people (example.com addresses).
 */
import 'dotenv/config'

import { seedAll } from '../server/om/demo/seed/index'
import { store, type Entity } from '../server/om/demo/store'

const OM = (process.env.OM_URL ?? '').replace(/\/+$/, '')
if (!OM) {
  console.error('Set OM_URL (and OM_TOKEN or OM_EMAIL/OM_PASSWORD) in .env first.')
  process.exit(1)
}

let token = process.env.OM_TOKEN ?? ''

async function login() {
  if (token) return
  const res = await fetch(`${OM}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.OM_EMAIL, password: Buffer.from(process.env.OM_PASSWORD ?? '').toString('base64') }),
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`)
  token = ((await res.json()) as { accessToken: string }).accessToken
}

const failures: string[] = []
const counts: Record<string, number> = {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

async function call(method: string, path: string, body?: unknown, contentType = 'application/json'): Promise<Json> {
  const res = await fetch(`${OM}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': contentType } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : undefined
}

/** Run one write; record a failure instead of stopping, so one bad entity doesn't block the rest. */
async function step<T>(kind: string, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const out = await fn()
    counts[kind] = (counts[kind] ?? 0) + 1
    return out
  } catch (e) {
    // A time-series point (test result) that is already there: fine on a re-run.
    if (e instanceof Error && / → 409:/.test(e.message)) {
      counts[`${kind} (existed)`] = (counts[`${kind} (existed)`] ?? 0) + 1
      return undefined
    }
    failures.push(`${kind} ${label}: ${e instanceof Error ? e.message : String(e)}`)
    return undefined
  }
}

const tryGet = async (path: string): Promise<Json | undefined> => {
  try {
    return await call('GET', path)
  } catch {
    return undefined
  }
}

const enc = encodeURIComponent

/** Real ids by demo id, filled as entities are created. */
const idMap = new Map<string, string>()
const realRef = (r: Entity | undefined) => (r && idMap.get(r.id) ? { id: idMap.get(r.id)!, type: r.type } : undefined)
const realRefs = (rs: Entity[] | undefined) => (rs ?? []).map(realRef).filter(Boolean)
const tagLabels = (tags: Entity[] | undefined) =>
  (tags ?? []).map((t) => ({ tagFQN: t.tagFQN, source: t.source, labelType: 'Manual', state: 'Confirmed' }))

async function main() {
  await login()
  const version = await call('GET', '/system/version')
  console.log(`Seeding OpenMetadata ${version.version} at ${OM}`)
  seedAll()

  // ---------- People ----------
  for (const t of store.all('teams')) {
    const real = await step('team', t.name, () =>
      call('PUT', '/teams', { name: t.name, displayName: t.displayName, description: t.description, teamType: 'Group', email: t.email }),
    )
    if (real) idMap.set(t.id, real.id)
  }
  for (const u of store.all('users')) {
    const existing = await tryGet(`/users/name/${enc(u.name)}`)
    if (existing) {
      idMap.set(u.id, existing.id)
      continue
    }
    if (u.isBot) continue
    const real = await step('user', u.name, () =>
      call('PUT', '/users', {
        name: u.name,
        displayName: u.displayName,
        email: u.email,
        isAdmin: false,
        isBot: false,
        teams: (u.teams ?? []).map((t: Entity) => idMap.get(t.id)).filter(Boolean),
      }),
    )
    if (real) idMap.set(u.id, real.id)
  }
  // The demo's "admin" is the real admin.
  const admin = await call('GET', '/users/loggedInUser')
  const demoAdmin = store.byFqn('users', 'admin')
  if (demoAdmin) idMap.set(demoAdmin.id, admin.id)

  // ---------- Classifications and tags (Tier, PII, PersonalData, Certification ship with OpenMetadata) ----------
  for (const c of store.all('classifications')) {
    const existing = await tryGet(`/classifications/name/${enc(c.name)}`)
    if (!existing)
      await step('classification', c.name, () =>
        call('PUT', '/classifications', { name: c.name, description: c.description, mutuallyExclusive: c.mutuallyExclusive }),
      )
  }
  for (const t of store.all('tags')) {
    if (await tryGet(`/tags/name/${enc(t.fullyQualifiedName!)}`)) continue
    await step('tag', t.fullyQualifiedName!, () =>
      call('PUT', '/tags', { name: t.name, description: t.description, classification: t.classification.name }),
    )
  }

  // ---------- Glossary (no reviewers, so terms are Approved and can be applied to assets) ----------
  for (const g of store.all('glossaries')) {
    const real = await step('glossary', g.name, () =>
      call('PUT', '/glossaries', { name: g.name, displayName: g.displayName, description: g.description, owners: realRefs(g.owners) }),
    )
    if (real) idMap.set(g.id, real.id)
  }
  const terms = store
    .all('glossaryTerms')
    .sort((a, b) => (a.fullyQualifiedName ?? '').split('.').length - (b.fullyQualifiedName ?? '').split('.').length)
  for (const t of terms) {
    const real = await step('glossaryTerm', t.fullyQualifiedName!, () =>
      call('PUT', '/glossaryTerms', {
        name: t.name,
        description: t.description,
        glossary: t.glossary.fullyQualifiedName ?? t.glossary.name,
        parent: t.parent?.fullyQualifiedName,
        synonyms: t.synonyms,
        owners: realRefs(t.owners),
      }),
    )
    if (real) idMap.set(t.id, real.id)
  }

  // ---------- Domains ----------
  for (const d of store.all('domains')) {
    const real = await step('domain', d.name, () =>
      call('PUT', '/domains', { name: d.name, description: d.description, domainType: d.domainType, owners: realRefs(d.owners) }),
    )
    if (real) idMap.set(d.id, real.id)
  }

  // ---------- BigQuery service, projects, datasets ----------
  for (const s of store.all('services/databaseServices')) {
    const cfg = s.connection.config
    const real = await step('service', s.name, () =>
      call('PUT', '/services/databaseServices', {
        name: s.name,
        displayName: s.displayName,
        serviceType: 'BigQuery',
        description: s.description,
        owners: realRefs(s.owners),
        connection: {
          config: {
            type: 'BigQuery',
            hostPort: cfg.hostPort,
            credentials: { gcpConfig: { type: 'gcp_adc', projectId: cfg.credentials.gcpConfig.projectId } },
            usageLocation: 'us',
          },
        },
      }),
    )
    if (real) idMap.set(s.id, real.id)
  }
  for (const d of store.all('databases')) {
    const real = await step('database', d.fullyQualifiedName!, () =>
      call('PUT', '/databases', { name: d.name, service: d.service.name, description: d.description, owners: realRefs(d.owners) }),
    )
    if (real) idMap.set(d.id, real.id)
  }
  for (const s of store.all('databaseSchemas')) {
    const real = await step('databaseSchema', s.fullyQualifiedName!, () =>
      call('PUT', '/databaseSchemas', {
        name: s.name,
        database: s.database.fullyQualifiedName,
        description: s.description,
        owners: realRefs(s.owners),
      }),
    )
    if (real) idMap.set(s.id, real.id)
  }

  // ---------- Tables ----------
  const column = (c: Entity): Json => ({
    name: c.name,
    dataType: c.dataType,
    dataTypeDisplay: c.dataTypeDisplay,
    description: c.description || undefined,
    constraint: c.constraint === 'PRIMARY_KEY' ? 'PRIMARY_KEY' : undefined,
    ordinalPosition: c.ordinalPosition,
    tags: tagLabels(c.tags),
    children: c.children?.map(column),
  })
  for (const t of store.all('tables')) {
    const real = await step('table', t.fullyQualifiedName!, () =>
      call('PUT', '/tables', {
        name: t.name,
        databaseSchema: t.databaseSchema.fullyQualifiedName,
        tableType: t.tableType,
        description: t.description || undefined,
        columns: t.columns.map(column),
        owners: realRefs(t.owners),
        tags: tagLabels(t.tags),
        domains: (t.domains ?? []).map((d: Entity) => d.fullyQualifiedName),
        schemaDefinition: t.schemaDefinition,
        tablePartition: t.tablePartition,
        sourceUrl: t.sourceUrl,
      }),
    )
    if (!real) continue
    idMap.set(t.id, real.id)
    // 2.x keeps certification in its own field and drops Certification.* tags sent in `tags`.
    // It's set with a PATCH (the server fills in appliedDate and expiryDate), like OpenMetadata's UI does it.
    const cert = t.certification?.tagLabel?.tagFQN as string | undefined
    if (cert && real.certification?.tagLabel?.tagFQN !== cert) {
      const now = Date.now()
      const tagLabel = { tagFQN: cert, source: 'Classification', labelType: 'Manual', state: 'Confirmed' }
      await step('certification', t.name, () =>
        call(
          'PATCH',
          `/tables/${real.id}`,
          [{ op: 'add', path: '/certification', value: { tagLabel, appliedDate: now, expiryDate: now } }],
          'application/json-patch+json',
        ),
      )
    }
    for (const f of t.followers ?? []) {
      const uid = idMap.get(f.id)
      if (uid) await step('follower', t.name, () => call('PUT', `/tables/${real.id}/followers`, JSON.stringify(uid)))
    }
    const weekly = t.usageSummary?.weeklyStats?.count
    if (weekly) {
      const today = new Date().toISOString().slice(0, 10)
      await step('usage', t.name, () =>
        call('POST', `/usage/table/${real.id}`, { date: today, count: Math.max(1, Math.round(weekly / 7)) }),
      )
    }
    const sample = store.sampleData.get(t.id)
    if (sample) await step('sampleData', t.name, () => call('PUT', `/tables/${real.id}/sampleData`, sample))
    const profiles = store.tableProfiles.get(t.fullyQualifiedName!) ?? []
    for (const p of profiles) {
      const columnProfile = (t.columns as Entity[])
        .map((c) => store.columnProfiles.get(c.fullyQualifiedName!)?.find((x) => x.timestamp === p.timestamp))
        .filter(Boolean)
      await step('profile', `${t.name}@${p.timestamp}`, () =>
        call('PUT', `/tables/${real.id}/tableProfile`, { tableProfile: p, columnProfile }),
      )
    }
  }

  // ---------- Lineage ----------
  for (const e of store.lineage.values()) {
    const from = idMap.get(e.fromEntity.id)
    const to = idMap.get(e.toEntity.id)
    if (!from || !to) continue
    await step('lineage', `${e.fromEntity.fullyQualifiedName} → ${e.toEntity.fullyQualifiedName}`, () =>
      call('PUT', '/lineage', {
        edge: {
          fromEntity: { id: from, type: 'table' },
          toEntity: { id: to, type: 'table' },
          lineageDetails: {
            sqlQuery: e.sqlQuery,
            source: e.source,
            columnsLineage: e.columns?.map((c) => ({ fromColumns: c.fromColumns, toColumn: c.toColumn })),
          },
        },
      }),
    )
  }

  // ---------- Queries ----------
  for (const q of store.all('queries')) {
    await step('query', q.name, () =>
      call('PUT', '/queries', {
        name: q.name,
        query: q.query,
        queryUsedIn: realRefs(q.queryUsedIn),
        users: (q.users ?? []).map((u: Entity) => u.name),
        duration: q.duration,
        queryDate: q.queryDate,
        service: 'bigquery',
      }),
    )
  }

  // ---------- Data products ----------
  for (const p of store.all('dataProducts')) {
    const real = await step('dataProduct', p.name, () =>
      call('PUT', '/dataProducts', {
        name: p.name,
        description: p.description,
        domains: (p.domains ?? []).map((d: Entity) => d.fullyQualifiedName),
        owners: realRefs(p.owners),
      }),
    )
    if (!real) continue
    const assets = realRefs(p.assets)
    if (assets.length)
      await step('dataProductAssets', p.name, () => call('PUT', `/dataProducts/${enc(real.fullyQualifiedName)}/assets/add`, { assets }))
  }

  // ---------- Data quality (test definitions ship with OpenMetadata) ----------
  for (const tc of store.all('dataQuality/testCases')) {
    const def = tc.testDefinition?.fullyQualifiedName ?? tc.testDefinition?.name ?? tc.testDefinition
    const real = await step('testCase', tc.name, () =>
      call('PUT', '/dataQuality/testCases', {
        name: tc.name,
        description: tc.description,
        entityLink: tc.entityLink,
        testDefinition: def,
        parameterValues: tc.parameterValues ?? [],
      }),
    )
    if (!real) continue
    for (const r of store.testResults.get(tc.fullyQualifiedName!) ?? []) {
      await step('testResult', `${tc.name}@${r.timestamp}`, () =>
        call('POST', `/dataQuality/testCases/testCaseResults/${enc(real.fullyQualifiedName)}`, {
          timestamp: r.timestamp,
          testCaseStatus: r.testCaseStatus,
          result: r.result,
          testResultValue: r.testResultValue,
        }),
      )
    }
  }

  // ---------- Ingestion pipelines (created, not deployed: nothing runs against BigQuery) ----------
  for (const p of store.all('services/ingestionPipelines')) {
    const service = idMap.get(p.service.id)
    if (!service) continue
    const real = await step('pipeline', p.name, () =>
      call('PUT', '/services/ingestionPipelines', {
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        pipelineType: p.pipelineType,
        service: { id: service, type: 'databaseService' },
        sourceConfig: p.sourceConfig,
        airflowConfig: { scheduleInterval: p.airflowConfig?.scheduleInterval, pausePipeline: p.airflowConfig?.pausePipeline ?? false },
        loggerLevel: p.loggerLevel ?? 'INFO',
      }),
    )
    if (!real) continue
    for (const run of store.pipelineRuns.get(p.fullyQualifiedName!) ?? []) {
      if (run.pipelineState === 'running' || run.pipelineState === 'queued') continue
      await step('pipelineRun', `${p.name}@${run.timestamp}`, () =>
        call('PUT', `/services/ingestionPipelines/${enc(real.fullyQualifiedName)}/pipelineStatus`, run),
      )
    }
  }

  // ---------- Conversations ----------
  // OpenMetadata takes the author from the token, so these all come from the account the script signs in as.
  const existingThreads = new Set<string>()
  for (const t of store.threads) {
    const current = await tryGet(`/feed?entityLink=${enc(t.about)}`)
    for (const x of current?.data ?? []) existingThreads.add(`${x.about}|${x.message}`)
    if (existingThreads.has(`${t.about}|${t.message}`)) continue
    const real = await step('thread', t.message.slice(0, 30), () =>
      call('POST', '/feed', { message: t.message, about: t.about, type: 'Conversation' }),
    )
    if (!real) continue
    for (const p of t.posts)
      await step('post', p.message.slice(0, 30), () => call('POST', `/feed/${real.id}/posts`, { message: p.message }))
  }

  // Malloy measures as metric entities, with table → metric lineage (server/malloy/publish.ts). It compiles
  // malloy/ against this server's catalog, so it runs last, after the tables exist.
  try {
    const { publishMetrics } = await import('../server/malloy/publish')
    const published = await publishMetrics()
    counts.metric = published.published.filter((p) => p.status !== 'failed').length
    counts['metric lineage'] = published.lineage.added
    for (const p of published.published.filter((x) => x.status === 'failed')) failures.push(`metric ${p.name}: ${p.error}`)
  } catch (e) {
    failures.push(`metrics: ${e instanceof Error ? e.message : String(e)}`)
  }

  console.log('\nCreated or updated:')
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(18)} ${v}`)
  if (failures.length) {
    console.log(`\n${failures.length} failed:`)
    // Group repeated errors (e.g. one profile shape problem repeated for every day).
    const seen = new Map<string, number>()
    for (const f of failures) {
      const key = f.replace(/@\d+/, '').slice(0, 300)
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    for (const [f, n] of seen) console.log(`  ${n > 1 ? `(${n}×) ` : ''}${f}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
