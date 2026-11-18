import { omJson, OmError } from '../om/client'
import { tablePathToFqn } from './connection'
import { metricsCatalog, type Metric } from './semantic'

/**
 * Publish Malloy measures to OpenMetadata as `metric` entities, so they are
 * searchable and governed next to tables:
 *
 * - name `<source>__<measure>` (the metrics page resolves it back), display name from the measure
 * - metricExpression { language: External, code: the Malloy definition }
 * - metricType from the measure's kind (SUM, COUNT, AVERAGE, RATIO, DERIVED, …)
 * - assets: the BigQuery tables the measure reads
 * - tags: the glossary term from its `# Business.<Term>:` annotation (when the term exists)
 * - relatedMetrics: the measures it is built from (published first)
 * - filters: the { where: } of a filtered measure
 *
 * Then one lineage edge per table → metric. Uses PUT (create or update), so
 * publishing again updates in place. Works the same on the demo catalog.
 */

type Ref = { id: string; type: string; name?: string; fullyQualifiedName?: string }

export function metricName(m: Pick<Metric, 'source' | 'name'>) {
  return `${m.source}__${m.name}`
}

const AGG_TYPE: Record<string, string> = {
  sum: 'SUM',
  count: 'COUNT',
  count_distinct: 'COUNT',
  avg: 'AVERAGE',
  min: 'MIN',
  max: 'MAX',
}

function metricType(m: Metric): string {
  if (m.metricKind === 'ratio') return 'RATIO'
  if (m.metricKind === 'derived') return 'DERIVED'
  return AGG_TYPE[m.aggregate ?? ''] ?? 'SIMPLE'
}

function unit(m: Metric): string | undefined {
  if (/rate$|_rate_|_pct$|percent/.test(m.name)) return 'PERCENTAGE'
  if (/revenue|price|margin|value|cost|sales/.test(m.name)) return 'DOLLARS'
  if (m.aggregate === 'count' || m.aggregate === 'count_distinct' || /_count$/.test(m.name)) return 'COUNT'
  return undefined
}

const title = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** Dependencies first, so relatedMetrics always point at metrics that exist. */
function ordered(ms: Metric[]): Metric[] {
  const byKey = new Map(ms.map((m) => [`${m.model}:${m.source}.${m.name}`, m]))
  const out: Metric[] = []
  const done = new Set<string>()
  const visit = (m: Metric) => {
    const key = `${m.model}:${m.source}.${m.name}`
    if (done.has(key)) return
    done.add(key)
    for (const dep of m.usesMeasures ?? []) {
      const d = byKey.get(`${m.model}:${m.source}.${dep}`)
      if (d) visit(d)
    }
    out.push(m)
  }
  ms.forEach(visit)
  return out
}

async function tryJson<T>(path: string): Promise<T | undefined> {
  try {
    return await omJson<T>(path)
  } catch {
    return undefined
  }
}

export interface PublishResult {
  dryRun: boolean
  published: { name: string; fullyQualifiedName?: string; status: 'created' | 'updated' | 'planned' | 'failed'; error?: string }[]
  lineage: { added: number; failed: number; error?: string }
}

export async function publishMetrics({ dryRun = false } = {}): Promise<PublishResult> {
  const metrics = ordered(await metricsCatalog())
  const tableRefs = new Map<string, Ref | undefined>()
  const tableRef = async (tablePath: string) => {
    if (!tableRefs.has(tablePath)) {
      const t = await tryJson<Ref & { name: string; fullyQualifiedName: string }>(
        `/tables/name/${encodeURIComponent(tablePathToFqn(tablePath))}`,
      )
      tableRefs.set(tablePath, t ? { id: t.id, type: 'table', name: t.name, fullyQualifiedName: t.fullyQualifiedName } : undefined)
    }
    return tableRefs.get(tablePath)
  }
  const terms = new Map<string, boolean>()
  const termExists = async (fqn: string) => {
    if (!terms.has(fqn)) terms.set(fqn, Boolean(await tryJson(`/glossaryTerms/name/${encodeURIComponent(fqn)}`)))
    return terms.get(fqn)
  }

  const result: PublishResult = { dryRun, published: [], lineage: { added: 0, failed: 0 } }
  const edges: { from: Ref; to: Ref }[] = []

  for (const m of metrics) {
    const name = metricName(m)
    const assets = (await Promise.all((m.tables ?? []).map((t) => tableRef(t.path)))).filter((r): r is Ref => Boolean(r))
    const where = m.metricKind === 'filtered' ? m.definition?.match(/\{\s*where:\s*([\s\S]*)\}\s*$/)?.[1]?.trim() : undefined
    const related = (m.usesMeasures ?? []).filter((d) => !d.includes('.')).map((d) => `${m.source}__${d}`)
    const body = {
      name,
      displayName: title(m.name),
      description: [
        m.description ?? '',
        `Defined in Malloy as \`${m.source}.${m.name}\` in \`malloy/${m.model}\`${m.line ? ` (line ${m.line})` : ''}.`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      metricExpression: m.definition ? { language: 'External', code: m.definition } : undefined,
      metricType: metricType(m),
      unitOfMeasurement: unit(m),
      assets: assets.length ? assets : undefined,
      relatedMetrics: related.length ? related : undefined,
      filters: where ? [{ where }] : undefined,
      tags:
        m.glossaryTerm && (await termExists(m.glossaryTerm))
          ? [{ tagFQN: m.glossaryTerm, source: 'Glossary', labelType: 'Manual', state: 'Confirmed' }]
          : undefined,
    }
    if (dryRun) {
      result.published.push({ name, status: 'planned' })
      continue
    }
    try {
      const existed = Boolean(await tryJson(`/metrics/name/${encodeURIComponent(name)}`))
      const saved = await omJson<Ref & { fullyQualifiedName: string }>('/metrics', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      result.published.push({ name, fullyQualifiedName: saved.fullyQualifiedName, status: existed ? 'updated' : 'created' })
      for (const a of assets) edges.push({ from: a, to: { id: saved.id, type: 'metric' } })
    } catch (e) {
      result.published.push({ name, status: 'failed', error: e instanceof OmError ? e.body.slice(0, 300) : String(e) })
    }
  }

  for (const { from, to } of edges) {
    try {
      await omJson('/lineage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edge: {
            fromEntity: { id: from.id, type: from.type },
            toEntity: to,
            lineageDetails: { description: 'Malloy measure reads this table', source: 'Manual' },
          },
        }),
      })
      result.lineage.added++
    } catch (e) {
      result.lineage.failed++
      result.lineage.error ??= e instanceof OmError ? e.body.slice(0, 300) : String(e)
    }
  }
  return result
}
