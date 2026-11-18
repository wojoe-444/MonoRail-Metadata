import { store, type Collection, type Entity } from './store'

/**
 * Emulates OpenMetadata's `/search/query` and `/search/aggregate` (an
 * Elasticsearch response) over the demo store. It understands the parts the
 * app uses: a free-text `q`, the `index` (entity type, `all` or `dataAsset`),
 * paging, sorting, and a `query_filter` made of bool / term / terms / match /
 * prefix / exists / wildcard clauses.
 */

/** Entity types that count as data assets (the Explore page's default scope). */
const DATA_ASSETS = new Set([
  'table',
  'dashboard',
  'pipeline',
  'topic',
  'mlmodel',
  'container',
  'searchIndex',
  'storedProcedure',
  'dashboardDataModel',
  'dataProduct',
  'metric',
  'apiEndpoint',
  'database',
  'databaseSchema',
])

type Query = Record<string, string | undefined>

interface Doc {
  entity: Entity
  collection: Collection
  source: Entity
}

function toDoc({ entity, collection }: { entity: Entity; collection: Collection }): Doc {
  const tier = (entity.tags ?? []).find((t: Entity) => String(t.tagFQN).startsWith('Tier.'))
  // Like OpenMetadata's TaggableIndex.mergeChildTags: column tags are merged (deduped) into the doc's `tags`.
  const merged = new Map<string, Entity>()
  for (const t of [...(entity.tags ?? []), ...flatColumns(entity.columns).flatMap((col) => col.tags ?? [])])
    if (!merged.has(t.tagFQN)) merged.set(t.tagFQN, t)
  const source: Entity = {
    ...entity,
    entityType: collection.entityType,
    tier,
    tags: [...merged.values()].filter((t: Entity) => !String(t.tagFQN).startsWith('Tier.')),
    // Search docs carry the tags of columns too, so a column tag finds its table.
    columnNames: entity.columns?.map((col: Entity) => col.name),
    // Index-only fields OpenMetadata's SearchIndex adds (Insights reads them).
    descriptionStatus: String(entity.description ?? '').trim() ? 'COMPLETE' : 'INCOMPLETE',
    ownerDisplayName: (entity.owners ?? []).map((o: Entity) => o.displayName ?? o.name),
    certification: entity.certification ?? certificationOf(entity.tags),
  }
  return { entity, collection, source }
}

/** OpenMetadata 2.x keeps certification in its own field; the demo keeps it as a Certification.* tag. */
function certificationOf(tags: Entity[] | undefined) {
  const tag = (tags ?? []).find((t: Entity) => String(t.tagFQN).startsWith('Certification.'))
  return tag ? { tagLabel: tag } : undefined
}

function flatColumns(cols: Entity[] | undefined): Entity[] {
  return (cols ?? []).flatMap((col) => [col, ...flatColumns(col.children)])
}

function docsFor(index: string | undefined, deleted: boolean): Doc[] {
  const indexes = (index ?? 'all').split(',').map((s) => s.trim().replace(/_search_index$/, ''))
  const wanted = (type: string) =>
    indexes.some((i) => i === 'all' || i === type || (i === 'dataAsset' && DATA_ASSETS.has(type)) || i.toLowerCase() === type.toLowerCase())
  return store
    .searchable()
    .filter(({ collection }) => wanted(collection.entityType))
    .filter(({ entity }) => Boolean(entity.deleted) === deleted)
    .map(toDoc)
}

/** Values at a dotted path, flattening arrays: values(doc, 'owners.displayName'). */
function values(obj: unknown, path: string): unknown[] {
  const parts = path.replace(/\.keyword$/, '').split('.')
  let current: unknown[] = [obj]
  for (const p of parts) {
    const next: unknown[] = []
    for (const v of current) {
      if (v == null) continue
      const child = (v as Record<string, unknown>)[p]
      if (Array.isArray(child)) next.push(...child)
      else if (child !== undefined) next.push(child)
    }
    current = next
  }
  return current.flatMap((v) => (Array.isArray(v) ? v : [v]))
}

type Clause = Record<string, unknown>

function matches(source: Entity, clause: Clause | undefined): boolean {
  if (!clause) return true
  if ('query' in clause) return matches(source, clause.query as Clause)
  if ('bool' in clause) {
    const b = clause.bool as Record<string, Clause | Clause[]>
    const list = (x: Clause | Clause[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x])
    const must = [...list(b.must), ...list(b.filter)]
    const should = list(b.should)
    const mustNot = list(b.must_not)
    if (!must.every((c) => matches(source, c))) return false
    if (mustNot.some((c) => matches(source, c))) return false
    if (should.length && !should.some((c) => matches(source, c))) return false
    return true
  }
  const [kind, body] = Object.entries(clause)[0] ?? []
  if (!kind) return true
  const [field, raw] = Object.entries(body as Record<string, unknown>)[0] ?? []
  if (!field) return true
  const vals = values(source, field).map((v) => String(v).toLowerCase())
  const val = (raw && typeof raw === 'object' && 'value' in (raw as object) ? (raw as { value: unknown }).value : raw) as unknown
  switch (kind) {
    case 'term':
      return vals.includes(String(val).toLowerCase())
    case 'terms':
      return (val as unknown[]).some((x) => vals.includes(String(x).toLowerCase()))
    case 'match':
    case 'match_phrase':
      return vals.some((v) => v.includes(String((val as { query?: unknown })?.query ?? val).toLowerCase()))
    case 'prefix':
      return vals.some((v) => v.startsWith(String(val).toLowerCase()))
    case 'wildcard': {
      const re = new RegExp(
        `^${String(val)
          .toLowerCase()
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
      )
      return vals.some((v) => re.test(v))
    }
    case 'exists':
      return values(source, String((body as { field: string }).field)).length > 0
    default:
      return true
  }
}

function score(doc: Doc, q: string): number {
  const terms = q
    .toLowerCase()
    .replace(/[*"\\]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !['and', 'or', 'not'].includes(t))
  if (!terms.length) return 1
  const e = doc.entity
  let total = 0
  for (const t of terms) {
    const name = String(e.name).toLowerCase()
    const display = String(e.displayName ?? '').toLowerCase()
    let s = 0
    if (name === t || display === t) s = 10
    else if (name.startsWith(t) || display.startsWith(t)) s = 6
    else if (name.includes(t) || display.includes(t)) s = 4
    else if (
      String(e.fullyQualifiedName ?? '')
        .toLowerCase()
        .includes(t)
    )
      s = 2
    else if ((e.columns ?? []).some((col: Entity) => String(col.name).toLowerCase().includes(t))) s = 1.5
    else if (
      String(e.description ?? '')
        .toLowerCase()
        .includes(t)
    )
      s = 1
    else if ((e.tags ?? []).some((tag: Entity) => String(tag.tagFQN).toLowerCase().includes(t))) s = 1
    if (!s) return 0
    total += s
  }
  return total
}

function filtered(q: Query): { doc: Doc; score: number }[] {
  const docs = docsFor(q.index, q.deleted === 'true')
  const filter = q.query_filter ? (JSON.parse(q.query_filter) as Clause) : undefined
  const postFilter = q.post_filter ? (JSON.parse(q.post_filter) as Clause) : undefined
  return docs
    .map((doc) => ({ doc, score: score(doc, q.q ?? '') }))
    .filter((x) => x.score > 0 && matches(x.doc.source, filter) && matches(x.doc.source, postFilter))
}

export function search(q: Query) {
  const hits = filtered(q)
  const sortField = (q.sort_field ?? '_score').replace(/\.keyword$/, '')
  const dir = q.sort_order === 'asc' ? 1 : -1
  hits.sort((a, b) => {
    if (sortField === '_score')
      return (b.score - a.score) * (dir === -1 ? 1 : -1) || String(a.doc.entity.name).localeCompare(String(b.doc.entity.name))
    const av = values(a.doc.source, sortField)[0] as string | number | undefined
    const bv = values(b.doc.source, sortField)[0] as string | number | undefined
    if (av === bv) return 0
    if (av === undefined) return 1
    if (bv === undefined) return -1
    return (av < bv ? -1 : 1) * dir
  })
  const from = Number(q.from ?? 0)
  const size = Number(q.size ?? 10)
  return {
    took: 1,
    timed_out: false,
    hits: {
      total: { value: hits.length, relation: 'eq' },
      max_score: hits[0]?.score ?? 0,
      hits: hits.slice(from, from + size).map((h) => ({
        _index: `${h.doc.collection.entityType}_search_index`,
        _id: h.doc.entity.id,
        _score: h.score,
        _source: h.doc.source,
      })),
    },
    aggregations: Object.fromEntries(
      [
        'entityType',
        'serviceType',
        'service.displayName.keyword',
        'owners.displayName.keyword',
        'tags.tagFQN',
        'tier.tagFQN',
        'domains.displayName.keyword',
      ].map((f) => [
        `sterms#${f}`,
        {
          buckets: buckets(
            hits.map((h) => h.doc),
            f,
            50,
          ),
        },
      ]),
    ),
  }
}

export function aggregate(q: Query) {
  const field = q.field ?? 'entityType'
  const pattern = q.value && q.value !== '.*' ? new RegExp(`^${q.value}$`, 'i') : undefined
  const docs = filtered(q).map((h) => h.doc)
  const all = buckets(docs, field, Number(q.size ?? 50))
  return {
    hits: { total: { value: docs.length, relation: 'eq' }, hits: [] },
    aggregations: { [`sterms#${field}`]: { buckets: pattern ? all.filter((b) => pattern.test(b.key)) : all } },
  }
}

function buckets(docs: Doc[], field: string, size: number) {
  const counts = new Map<string, number>()
  for (const d of docs) {
    for (const v of new Set(values(d.source, field).map(String))) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, size)
    .map(([key, doc_count]) => ({ key, doc_count }))
}
