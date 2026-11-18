import type { SemanticField } from './api'

/**
 * Query-builder state, its URL form, and the Malloy it generates.
 *
 * URL: /query?model=ecommerce.malloy&source=order_items&m=net_revenue,users.user_count
 *        &g=products.category,created_at:month&w=status|=|Complete&o=net_revenue:desc&limit=100&cmp=previous
 */

export type Grain = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour'
export const GRAINS: Grain[] = ['year', 'quarter', 'month', 'week', 'day', 'hour']

export type FilterOp =
  | '='
  | '!='
  | 'in'
  | 'contains'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'last_days'
  | 'true'
  | 'false'
  | 'null'
  | 'not_null'
  | 'malloy'

export interface Filter {
  field: string
  op: FilterOp
  value: string
}

export interface GroupBy {
  field: string
  grain?: Grain
}

export type Compare = 'none' | 'previous' | 'running'

export interface QueryState {
  model: string
  source: string
  measures: string[]
  groupBy: GroupBy[]
  filters: Filter[]
  order?: { field: string; dir: 'asc' | 'desc' }
  limit?: number
  compare: Compare
}

export const OPS_FOR: Record<'string' | 'number' | 'time' | 'boolean' | 'other', { value: FilterOp; label: string }[]> = {
  string: [
    { value: '=', label: 'is' },
    { value: '!=', label: 'is not' },
    { value: 'in', label: 'is any of' },
    { value: 'contains', label: 'contains' },
    { value: 'null', label: 'is empty' },
    { value: 'not_null', label: 'is not empty' },
  ],
  number: [
    { value: '=', label: '=' },
    { value: '!=', label: '≠' },
    { value: '>', label: '>' },
    { value: '>=', label: '≥' },
    { value: '<', label: '<' },
    { value: '<=', label: '≤' },
    { value: 'null', label: 'is empty' },
  ],
  time: [
    { value: '>=', label: 'on or after' },
    { value: '<', label: 'before' },
    { value: 'last_days', label: 'in the last N days' },
    { value: 'null', label: 'is empty' },
    { value: 'not_null', label: 'is not empty' },
  ],
  boolean: [
    { value: 'true', label: 'is true' },
    { value: 'false', label: 'is false' },
  ],
  other: [
    { value: 'null', label: 'is empty' },
    { value: 'not_null', label: 'is not empty' },
  ],
}

export function typeGroup(t: string | undefined): keyof typeof OPS_FOR {
  if (t === 'string') return 'string'
  if (t === 'number') return 'number'
  if (t === 'date' || t === 'timestamp') return 'time'
  if (t === 'boolean') return 'boolean'
  return 'other'
}

export const opNeedsValue = (op: FilterOp) => !['true', 'false', 'null', 'not_null'].includes(op)

// ---------- URL ----------

export function parseState(p: URLSearchParams): QueryState {
  const list = (k: string) =>
    (p.get(k) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  const order = p.get('o')?.split(':')
  const limit = Number(p.get('limit'))
  const cmp = p.get('cmp')
  return {
    model: p.get('model') ?? '',
    source: p.get('source') ?? '',
    measures: list('m'),
    groupBy: list('g').map((g) => {
      const [field, grain] = g.split(':')
      return { field: field!, grain: GRAINS.includes(grain as Grain) ? (grain as Grain) : undefined }
    }),
    filters: p.getAll('w').flatMap((w) => {
      const [field, op, ...rest] = w.split('|')
      return field !== undefined && op ? [{ field, op: op as FilterOp, value: rest.join('|') }] : []
    }),
    order: order?.[0] ? { field: order[0], dir: order[1] === 'asc' ? 'asc' : 'desc' } : undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    compare: cmp === 'previous' || cmp === 'running' ? cmp : 'none',
  }
}

export function toSearch(s: QueryState): string {
  const p = new URLSearchParams()
  if (s.model) p.set('model', s.model)
  if (s.source) p.set('source', s.source)
  if (s.measures.length) p.set('m', s.measures.join(','))
  if (s.groupBy.length) p.set('g', s.groupBy.map((g) => (g.grain ? `${g.field}:${g.grain}` : g.field)).join(','))
  for (const f of s.filters) p.append('w', `${f.field}|${f.op}|${f.value}`)
  if (s.order) p.set('o', `${s.order.field}:${s.order.dir}`)
  if (s.limit) p.set('limit', String(s.limit))
  if (s.compare !== 'none') p.set('cmp', s.compare)
  return p.toString()
}

// ---------- Malloy ----------

const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const num = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : quote(v))
const leaf = (path: string) => path.split('.').pop()!
const dateLit = (v: string) => (/^\d{4}(-\d{2}(-\d{2}( \d{2}:\d{2}(:\d{2})?)?)?)?$/.test(v.trim()) ? `@${v.trim()}` : quote(v))

export function filterToMalloy(f: Filter, type: string | undefined): string | undefined {
  if (f.op === 'malloy') return f.value.trim() || undefined
  const g = typeGroup(type)
  const v = f.value
  if (opNeedsValue(f.op) && !v.trim()) return undefined
  switch (f.op) {
    case 'null':
      return `${f.field} is null`
    case 'not_null':
      return `${f.field} is not null`
    case 'true':
      return `${f.field} = true`
    case 'false':
      return `${f.field} = false`
    case 'in': {
      const vals = v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      return vals.length ? `${f.field} ? ${vals.map((x) => (g === 'number' ? num(x) : quote(x))).join(' | ')}` : undefined
    }
    case 'contains':
      return `${f.field} ~ ${quote(`%${v}%`)}`
    case 'last_days': {
      const n = Math.max(1, Math.round(Number(v) || 0))
      return `${f.field} >= now - ${n} days`
    }
    default: {
      const lit = g === 'number' ? num(v) : g === 'time' ? dateLit(v) : g === 'boolean' ? v : quote(v)
      return `${f.field} ${f.op} ${lit}`
    }
  }
}

export interface Output {
  /** Column name in the result. */
  name: string
  /** The Malloy that produces it ("name is expr", or just the field path when the name is implied). */
  malloy: string
}

/** Output names for group-bys and measures. A name is spelled out when it differs from the field's own name. */
export function outputs(s: QueryState) {
  const taken = new Set<string>()
  const pick = (want: string, alt: string) => {
    const n = taken.has(want) ? alt : want
    taken.add(n)
    return n
  }
  const dims = s.groupBy.map((g) => {
    const base = g.grain ? `${leaf(g.field)}_${g.grain}` : leaf(g.field)
    const name = pick(base, g.grain ? `${g.field.replace(/\./g, '_')}_${g.grain}` : g.field.replace(/\./g, '_'))
    const expr = g.grain ? `${g.field}.${g.grain}` : g.field
    return { ...g, name, malloy: name === leaf(g.field) && !g.grain ? g.field : `${name} is ${expr}` }
  })
  const measures = s.measures.map((m) => {
    const name = pick(leaf(m), m.replace(/\./g, '_'))
    return { field: m, name, malloy: name === leaf(m) ? m : `${name} is ${m}` }
  })
  return { dims, measures }
}

/** The query stage, `{ … }`: what a saved view holds. */
export function stageMalloy(s: QueryState, fieldType: (path: string) => SemanticField | undefined): string {
  const { dims, measures } = outputs(s)
  const lines: string[] = []
  const where = s.filters.map((f) => filterToMalloy(f, fieldType(f.field)?.type)).filter((w): w is string => Boolean(w))
  if (where.length) lines.push(where.length === 1 ? `where: ${where[0]}` : `where:\n${where.map((w) => `  ${w}`).join(',\n')}`)
  if (dims.length)
    lines.push(dims.length === 1 ? `group_by: ${dims[0]!.malloy}` : `group_by:\n${dims.map((d) => `  ${d.malloy}`).join('\n')}`)
  if (measures.length)
    lines.push(
      measures.length === 1 ? `aggregate: ${measures[0]!.malloy}` : `aggregate:\n${measures.map((m) => `  ${m.malloy}`).join('\n')}`,
    )

  // calculate: runs over the aggregated rows, ordered by the time group-by and split by the other group-bys.
  const time = dims.find((d) => d.grain)
  let order = s.order
  if (s.compare !== 'none' && time && measures.length) {
    const others = dims.filter((d) => d !== time).map((d) => d.name)
    const opts = others.length ? ` { partition_by: ${others.join(', ')} order_by: ${time.name} }` : ''
    const calcs = measures.flatMap((m) =>
      s.compare === 'previous'
        ? [
            `${m.name}_previous is lag(${m.name})${opts}`,
            `${m.name}_change is (${m.name} - lag(${m.name})${opts}) / nullif(lag(${m.name})${opts}, 0)`,
          ]
        : [`${m.name}_running_total is sum_cumulative(${m.name})${opts}`],
    )
    lines.push(`calculate:\n${calcs.map((c) => `  ${c}`).join('\n')}`)
    if (!opts) order = { field: time.name, dir: 'asc' }
  }
  if (order) lines.push(`order_by: ${order.field} ${order.dir}`)
  if (s.limit) lines.push(`limit: ${s.limit}`)
  if (!lines.length) return '{}'
  return `{\n${lines
    .join('\n')
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n')}\n}`
}

export function queryMalloy(s: QueryState, fieldType: (path: string) => SemanticField | undefined): string {
  return `run: ${s.source} -> ${stageMalloy(s, fieldType)}`
}

/** Names a query can be ordered by: its group-by and measure outputs. */
export function orderable(s: QueryState): string[] {
  const { dims, measures } = outputs(s)
  return [...dims.map((d) => d.name), ...measures.map((m) => m.name)]
}

/** A Malloy name suggestion for saving the query as a view. */
export function suggestName(s: QueryState): string {
  const { dims, measures } = outputs(s)
  const m = measures[0]?.name ?? 'query'
  return dims.length ? `${m}_by_${dims.map((d) => d.name).join('_and_')}` : m
}
