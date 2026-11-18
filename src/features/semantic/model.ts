import { href } from '@/lib/router'

import type { SemanticField, SemanticJoin, SemanticModel, SemanticSource } from './api'

/** Helpers over the semantic catalog: field paths through joins, the join tree, and fan-out. */

/** A node in a source's join tree: the source itself (path []) or a join (path ['order_items', 'products']). */
export interface JoinNode {
  path: string[]
  name: string
  join?: SemanticJoin
  /** join_one / join_many of the edge from the parent, undefined for the root. */
  edge?: 'one' | 'many' | 'cross'
  primaryKey?: string
  tablePath?: string
  tableFqn?: string
  sourceName?: string
  fields: SemanticField[]
}

export interface FieldRef {
  /** Path from the root source, e.g. "products.category". */
  path: string
  field: SemanticField
  node: JoinNode
}

export function joinTree(source: SemanticSource): JoinNode[] {
  const out: JoinNode[] = [
    {
      path: [],
      name: source.name,
      primaryKey: source.primaryKey,
      tablePath: source.tablePath,
      tableFqn: source.tableFqn,
      sourceName: source.name,
      fields: source.fields,
    },
  ]
  const add = (joins: SemanticJoin[], prefix: string[]) => {
    for (const j of joins) {
      const path = [...prefix, j.name]
      out.push({
        path,
        name: j.name,
        join: j,
        edge: j.join,
        primaryKey: j.primaryKey,
        tablePath: j.tablePath,
        tableFqn: j.tableFqn,
        sourceName: j.sourceName,
        fields: j.fields,
      })
      add(j.joins, path)
    }
  }
  add(source.joins, [])
  return out
}

const UNGROUPABLE = /sql native|json|unsupported|error/

/** Every field reachable from the source, through joins, with its path. */
export function allFields(source: SemanticSource): FieldRef[] {
  return joinTree(source).flatMap((node) => node.fields.map((field) => ({ path: [...node.path, field.name].join('.'), field, node })))
}

export const dimensionsOf = (source: SemanticSource) =>
  allFields(source).filter((f) => f.field.kind === 'dimension' && !UNGROUPABLE.test(f.field.type ?? ''))
export const measuresOf = (source: SemanticSource) => allFields(source).filter((f) => f.field.kind === 'measure')

export const isTime = (f: SemanticField | undefined) => f?.type === 'date' || f?.type === 'timestamp'

export function findSource(models: SemanticModel[] | undefined, model: string | null, source: string | null) {
  if (!models || !source) return undefined
  return models.find((m) => !model || m.path === model)?.sources.find((s) => s.name === source)
}

export const sourceHref = (model: string, source: string) =>
  href(`/semantic/source?model=${encodeURIComponent(model)}&source=${encodeURIComponent(source)}`)

export const workbenchHref = (model: string, source?: string, query?: string) =>
  href(
    `/malloy/workbench?path=${encodeURIComponent(model)}${source ? `&source=${encodeURIComponent(source)}` : ''}${query ? `&query=${encodeURIComponent(query)}` : ''}`,
  )

export const METRIC_KIND_LABEL: Record<string, string> = {
  simple: 'Simple',
  filtered: 'Filtered',
  ratio: 'Ratio',
  derived: 'Derived',
}

export const METRIC_KIND_HELP: Record<string, string> = {
  simple: 'One aggregate over a column: sum, count, count distinct, average, min or max.',
  filtered: 'An aggregate with { where: }. The filter lives in the definition, so every query gets it.',
  ratio: 'One aggregate over another, divided at the query’s grain: a ratio of sums, never an average of ratios.',
  derived: 'Arithmetic over other measures, computed after they aggregate.',
}

// ---------- Fan-out ----------

const isPrefix = (a: string[], b: string[]) => a.length <= b.length && a.every((x, i) => x === b[i])

export interface FanOut {
  /** Nodes the query joins: every node on the way to the measure and the dimension. */
  joined: string[][]
  /** The node whose rows the measure aggregates: its grain. */
  grain: JoinNode
  /** Joins that repeat the grain's rows, with why. */
  causes: { node: JoinNode; reason: string }[]
}

/**
 * Whether a measure's rows repeat when a query groups by a dimension. The
 * query joins every node on the path to either field. Walking from the
 * measure's node to each joined node, an edge fans out when it goes down a
 * join_many, or up a join_one (many rows on the parent side can point at one
 * row of the child: many order items per user). Malloy corrects both with
 * symmetric aggregates; this only explains where the repetition comes from.
 */
export function fanOut(source: SemanticSource, measure: FieldRef, dimension?: FieldRef): FanOut {
  const tree = joinTree(source)
  const byPath = new Map(tree.map((n) => [n.path.join('.'), n]))
  // A simple measure that aggregates through a join (users.count()) has that join's grain.
  let grainPath = measure.node.path
  const viaJoin =
    measure.field.metricKind === 'simple' && measure.field.joins?.length === 1 ? measure.field.joins[0]!.split('.') : undefined
  if (viaJoin) grainPath = [...measure.node.path, ...viaJoin]
  const grain = byPath.get(grainPath.join('.')) ?? measure.node

  const ends = [grainPath, ...(measure.field.joins ?? []).map((j) => [...measure.node.path, ...j.split('.')]), dimension?.node.path ?? []]
  const joined = new Map<string, string[]>()
  for (const end of ends) for (let i = 1; i <= end.length; i++) joined.set(end.slice(0, i).join('.'), end.slice(0, i))

  const causes: FanOut['causes'] = []
  for (const p of joined.values()) {
    const node = byPath.get(p.join('.'))
    if (!node?.edge) continue
    const parent = byPath.get(p.slice(0, -1).join('.'))
    const parentName = parent?.name ?? source.name
    const upward = isPrefix(p, grain.path)
    if (upward && node.edge === 'one') {
      causes.push({
        node,
        reason: `${parentName} joins ${node.name} with join_one, so many ${parentName} rows can point at one ${node.name} row: each ${grain.name} row repeats once per ${parentName} row.`,
      })
    } else if (!upward && node.edge === 'many') {
      causes.push({
        node,
        reason: `${parentName} joins ${node.name} with join_many, so each ${parentName} row repeats once per matching ${node.name} row.`,
      })
    }
  }
  return { joined: [...joined.values()], grain, causes }
}
