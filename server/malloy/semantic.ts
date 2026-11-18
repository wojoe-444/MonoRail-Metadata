import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Explore, Field } from '@malloydata/malloy'

import { tablePathToFqn } from './connection'
import { BadRequest, baseUrl, listModels, problemsOf, readModel, runtime, saveModel, type Problem } from './service'

/**
 * The semantic layer as a catalog: every Malloy source as a semantic model
 * (table, primary key, joins, dimensions, measures, views), each field with
 * its description, glossary term and Malloy definition, and every measure as a
 * metric with the tables it reads.
 *
 * Definitions are the field's own text, cut from the model at the field's
 * source location. Descriptions and glossary terms come from `#` annotations:
 *
 *   # Some text                    description
 *   # Business.<Term>: some text   glossary term FQN, then the description
 *   # builder: <query string>      (views) the query-builder state the view was saved from
 */

export type MetricKind = 'simple' | 'filtered' | 'ratio' | 'derived'

export interface SemanticField {
  name: string
  kind: 'dimension' | 'measure' | 'view'
  /** Malloy type: string, number, date, timestamp, boolean, … */
  type?: string
  /** True for a table column (no definition of its own). */
  column?: boolean
  description?: string
  glossaryTerm?: string
  definition?: string
  /** 1-based line in the model where the field is defined. */
  line?: number
  // Measures
  metricKind?: MetricKind
  /** Aggregate function at the root of a simple or filtered measure: sum, count, count_distinct, avg, min, max. */
  aggregate?: string
  /** Fields the expression refers to, as paths from the source (e.g. "products.cost", "net_revenue"). */
  uses?: string[]
  /** Measures among `uses`: what a derived or ratio measure is built from. */
  usesMeasures?: string[]
  /** Joins the expression goes through. */
  joins?: string[]
  /** BigQuery tables the expression reads (path and catalog FQN), following referenced measures and joins. */
  tables?: { path: string; fqn: string }[]
  // Views
  /** View uses calculate: (window functions: lag, sum_cumulative, avg_moving, …). */
  window?: boolean
  nests?: boolean
  /** Query-builder state, when the view was saved from the builder. */
  builder?: string
}

export interface SemanticJoin {
  name: string
  /** one = join_one, many = join_many, cross = join_cross. */
  join: 'one' | 'many' | 'cross'
  relationship?: string
  /** The join condition, e.g. "users.id = user_id". */
  on?: string
  /** The join as written, e.g. "join_one: users with user_id". */
  definition?: string
  line?: number
  /** The named source it joins, when it joins one unchanged. */
  sourceName?: string
  tablePath?: string
  tableFqn?: string
  primaryKey?: string
  fields: SemanticField[]
  joins: SemanticJoin[]
}

export interface SemanticSource {
  name: string
  model: string
  line?: number
  description?: string
  tablePath?: string
  tableFqn?: string
  primaryKey?: string
  fields: SemanticField[]
  joins: SemanticJoin[]
}

export interface SemanticModel {
  path: string
  ok: boolean
  problems: Problem[]
  sources: SemanticSource[]
}

export interface Metric extends SemanticField {
  model: string
  source: string
  sourceTablePath?: string
  sourceTableFqn?: string
}

// ---------- Annotations and definitions ----------

const TERM_RE = /^([A-Z][\w-]*(?:\.[^:]+)+):\s*(.*)$/

function notesOf(texts: string[]) {
  let glossaryTerm: string | undefined
  let builder: string | undefined
  const desc: string[] = []
  for (const raw of texts) {
    const s = raw.replace(/^#"?\s?/, '').trim()
    if (!s) continue
    const b = /^builder:\s*(.*)$/.exec(s)
    if (b) {
      builder = b[1]
      continue
    }
    const m = TERM_RE.exec(s)
    if (m && !glossaryTerm) {
      glossaryTerm = m[1]!.trim()
      if (m[2]) desc.push(m[2])
    } else desc.push(s)
  }
  const description = desc.join(' ')
  return { glossaryTerm, builder, description: description ? description[0]!.toUpperCase() + description.slice(1) : undefined }
}

function annotationTexts(x: { annotations: { texts(): string[] } }): string[] {
  try {
    return x.annotations.texts()
  } catch {
    return []
  }
}

interface Loc {
  url: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
}

/** Reads the text of model documents by location URL: the model being compiled, or files it imports. */
class Documents {
  private files = new Map<string, string[]>()
  constructor(private main: string[]) {}

  async lines(url: string): Promise<string[] | undefined> {
    if (url.startsWith('internal://')) return this.main
    if (!url.startsWith('file:')) return undefined
    if (!this.files.has(url)) {
      try {
        this.files.set(url, (await fs.readFile(fileURLToPath(url), 'utf8')).split(/\r?\n/))
      } catch {
        return undefined
      }
    }
    return this.files.get(url)
  }

  /** The text at a location, without the annotation and comment lines Malloy includes in a field's range. */
  async text(loc: Loc | undefined): Promise<string | undefined> {
    if (!loc) return undefined
    const lines = await this.lines(loc.url)
    if (!lines) return undefined
    const { start, end } = loc.range
    const out: string[] = []
    for (let i = start.line; i <= end.line && i < lines.length; i++) {
      let l = lines[i]!
      if (i === end.line) l = l.slice(0, end.character)
      if (i === start.line) l = l.slice(start.character)
      out.push(l)
    }
    while (out.length && /^\s*(#|\/\/|--|$)/.test(out[0]!)) out.shift()
    // Dedent continuation lines to the indent of the least-indented one.
    const rest = out.slice(1).filter((l) => l.trim())
    const indent = rest.length ? Math.min(...rest.map((l) => l.match(/^\s*/)![0].length)) : 0
    return out
      .map((l, i) => (i === 0 ? l.trim() : l.slice(indent)))
      .join('\n')
      .trim()
  }

  /** 1-based line of a location's first non-annotation line. */
  async line(loc: Loc | undefined): Promise<number | undefined> {
    if (!loc) return undefined
    const lines = await this.lines(loc.url)
    let i = loc.range.start.line
    while (
      lines &&
      i < loc.range.end.line &&
      /^\s*(#|\/\/|--|$)/.test(lines[i]!.slice(i === loc.range.start.line ? loc.range.start.character : 0))
    )
      i++
    return i + 1
  }
}

// ---------- Expressions ----------

type Expr = { node?: string; path?: string[]; structPath?: string[]; function?: string; e?: Expr; kids?: unknown } & Record<string, unknown>

/** Walks a Malloy expression tree, calling `visit` on every node. */
function walk(e: unknown, visit: (n: Expr) => void, seen = new Set<unknown>()) {
  if (!e || typeof e !== 'object' || seen.has(e)) return
  seen.add(e)
  if (Array.isArray(e)) return e.forEach((x) => walk(x, visit, seen))
  const n = e as Expr
  if (typeof n.node === 'string') visit(n)
  for (const [k, v] of Object.entries(n)) if (k !== 'at' && k !== 'overload' && v && typeof v === 'object') walk(v, visit, seen)
}

function unwrap(e: Expr | undefined): Expr | undefined {
  let x = e
  while (x && x.node === '()' && x.e) x = x.e
  return x
}

function printExpr(e: Expr | undefined): string | undefined {
  const x = unwrap(e)
  if (!x) return undefined
  if (x.node === 'field' && x.path) return x.path.join('.')
  const kids = x.kids as { left?: Expr; right?: Expr } | undefined
  if (kids?.left && kids.right && ['=', 'and', '!=', '<', '>', '<=', '>='].includes(x.node!)) {
    const l = printExpr(kids.left)
    const r = printExpr(kids.right)
    return l && r ? `${l} ${x.node} ${r}` : undefined
  }
  return undefined
}

const AGG_NAMES: Record<string, string> = { distinct: 'count_distinct' }

function classify(e: Expr | undefined, isMeasure: (path: string[]) => boolean): { kind: MetricKind; aggregate?: string } {
  const top = unwrap(e)
  if (!top) return { kind: 'derived' }
  if (top.node === 'aggregate') return { kind: 'simple', aggregate: AGG_NAMES[top.function!] ?? top.function }
  if (top.node === 'filteredExpr') {
    const inner = unwrap((top.kids as { e?: Expr } | undefined)?.e)
    return { kind: 'filtered', aggregate: inner?.node === 'aggregate' ? (AGG_NAMES[inner.function!] ?? inner.function) : undefined }
  }
  if (top.node === '/') return { kind: 'ratio' }
  // A measure that only renames another measure is that measure's kind; everything else is derived.
  if (top.node === 'field' && top.path && isMeasure(top.path)) return { kind: 'derived' }
  return { kind: 'derived' }
}

// ---------- Building the catalog ----------

type FieldDef = { name: string; as?: string; e?: Expr; type?: string }

function fieldDefs(ex: Explore): Map<string, FieldDef> {
  const sd = ex.structDef as unknown as { fields: FieldDef[] }
  return new Map(sd.fields.map((f) => [f.as ?? f.name, f]))
}

function tableOf(ex: Explore): string | undefined {
  const sd = ex.structDef as { type?: string; tablePath?: string }
  return sd.type === 'table' ? sd.tablePath?.replace(/`/g, '') : undefined
}

/** The explore a path's prefix leads to, and the field name at its end. */
function resolve(root: Explore, path: string[]): { explore: Explore; field?: Field } {
  let ex = root
  for (let i = 0; i < path.length - 1; i++) {
    const f = ex.getFieldByNameIfExists(path[i]!)
    if (!f || !f.isExploreField()) return { explore: ex }
    ex = f
  }
  return { explore: ex, field: ex.getFieldByNameIfExists(path[path.length - 1]!) }
}

/** Tables, joins and fields an expression reads, following referenced measures and dimensions into their own definitions. */
function analyze(root: Explore, e: Expr | undefined) {
  const tables = new Set<string>()
  const joins = new Set<string>()
  const uses = new Set<string>()
  const usesMeasures = new Set<string>()
  const visited = new Set<string>()

  const go = (ex: Explore, prefix: string[], expr: Expr | undefined, top: boolean) => {
    if (!expr) return
    walk(expr, (n) => {
      if (n.node === 'aggregate') {
        const sp = n.structPath ?? []
        const target = sp.length ? resolve(ex, [...sp, '_']).explore : ex
        const t = tableOf(target)
        if (t) tables.add(t)
        if (sp.length) joins.add([...prefix, ...sp].join('.'))
      }
      if (n.node === 'field' && n.path) {
        const full = [...prefix, ...n.path]
        if (n.path.length > 1) joins.add([...prefix, ...n.path.slice(0, -1)].join('.'))
        const { explore, field } = resolve(ex, n.path)
        if (top) {
          uses.add(n.path.join('.'))
          if (field?.isAtomicField() && field.isCalculation()) usesMeasures.add(n.path.join('.'))
        }
        const key = full.join('.')
        if (visited.has(key)) return
        visited.add(key)
        if (field?.isAtomicField()) {
          const def = fieldDefs(explore).get(field.name)
          if (def?.e) go(explore, full.slice(0, -1), def.e, false)
          else {
            const t = tableOf(explore)
            if (t) tables.add(t)
          }
        }
      }
    })
  }
  go(root, [], e, true)
  return {
    tables: [...tables].map((t) => ({ path: t, fqn: tablePathToFqn(t) })),
    joins: [...joins],
    uses: [...uses],
    usesMeasures: [...usesMeasures],
  }
}

async function fieldsOf(ex: Explore, docs: Documents, own: boolean): Promise<SemanticField[]> {
  const defs = fieldDefs(ex)
  const out: SemanticField[] = []
  for (const f of ex.allFields) {
    if (f.isExploreField()) continue
    const notes = notesOf(annotationTexts(f as unknown as { annotations: { texts(): string[] } }))
    const loc = (f as unknown as { location?: Loc }).location
    if (f.isQueryField()) {
      const definition = own ? await docs.text(loc) : undefined
      out.push({
        name: f.name,
        kind: 'view',
        description: notes.description,
        definition,
        line: own ? await docs.line(loc) : undefined,
        window: definition ? /\bcalculate\s*:/.test(definition) : undefined,
        nests: definition ? /\bnest\s*:/.test(definition) : undefined,
        builder: notes.builder,
      })
      continue
    }
    if (!f.isAtomicField()) continue
    const def = defs.get(f.name)
    const column = !def?.e
    const base: SemanticField = {
      name: f.name,
      kind: f.isCalculation() ? 'measure' : 'dimension',
      type: String(f.type),
      column: column || undefined,
      description: notes.description,
      glossaryTerm: notes.glossaryTerm,
    }
    if (!column && own) {
      base.definition = await docs.text(loc)
      base.line = await docs.line(loc)
    }
    if (base.kind === 'measure' && def?.e) {
      const a = analyze(ex, def.e)
      const c = classify(def.e, (p) => {
        const r = resolve(ex, p).field
        return Boolean(r?.isAtomicField() && r.isCalculation())
      })
      Object.assign(base, { metricKind: c.kind, aggregate: c.aggregate, ...a })
    }
    out.push(base)
  }
  return out
}

async function joinsOf(ex: Explore, docs: Documents, depth: number): Promise<SemanticJoin[]> {
  const out: SemanticJoin[] = []
  for (const f of ex.allFields) {
    if (!f.isExploreField()) continue
    const sd = f.structDef as unknown as { type: string; join?: 'one' | 'many' | 'cross'; onExpression?: Expr }
    // Nested records and arrays (STRUCT / ARRAY columns) are columns, not joins.
    if (sd.type === 'record' || sd.type === 'array') continue
    const join = sd.join ?? 'one'
    const loc = (f as unknown as { location?: Loc }).location
    const text = await docs.text(loc)
    const tablePath = tableOf(f)
    let sourceName: string | undefined
    try {
      sourceName = f.referencedSource()?.name
    } catch {
      sourceName = undefined
    }
    out.push({
      name: f.name,
      join,
      relationship: f.joinRelationship,
      on: printExpr(sd.onExpression),
      definition: text ? `join_${join}: ${text}` : undefined,
      line: await docs.line(loc),
      sourceName: sourceName ?? text?.match(/^(\w+)\s+(?:with|on)\b/)?.[1],
      tablePath,
      tableFqn: tablePath ? tablePathToFqn(tablePath) : undefined,
      primaryKey: f.primaryKey,
      fields: await fieldsOf(f, docs, false),
      joins: depth < 3 ? await joinsOf(f, docs, depth + 1) : [],
    })
  }
  return out
}

// ---------- Public API ----------

const cache = new Map<string, { at: number; content: string; model: SemanticModel }>()
const TTL_MS = 60_000

/** One model as semantic sources. Cached for a minute per file content (schemas come from the catalog). */
export async function semanticModel(rel: string, content?: string): Promise<SemanticModel> {
  const text = content ?? (await readModel(rel)).content
  const hit = cache.get(rel)
  if (hit && hit.content === text && Date.now() - hit.at < TTL_MS) return hit.model
  let model: SemanticModel
  try {
    const compiled = await runtime()
      .loadModel(text, { importBaseURL: baseUrl(rel) })
      .getModel()
    const docs = new Documents(text.split(/\r?\n/))
    const sources: SemanticSource[] = []
    for (const ex of compiled.exportedExplores) {
      const loc = (ex as unknown as { location?: Loc }).location
      // Imported sources are cataloged by the model that defines them.
      if (loc && !loc.url.startsWith('internal://')) continue
      const tablePath = tableOf(ex)
      sources.push({
        name: ex.name,
        model: rel,
        line: await docs.line(loc),
        description: notesOf(annotationTexts(ex)).description,
        tablePath,
        tableFqn: tablePath ? tablePathToFqn(tablePath) : undefined,
        primaryKey: ex.primaryKey,
        fields: await fieldsOf(ex, docs, true),
        joins: await joinsOf(ex, docs, 1),
      })
    }
    model = { path: rel, ok: true, problems: [], sources }
  } catch (e) {
    model = { path: rel, ok: false, problems: problemsOf(e), sources: [] }
  }
  cache.set(rel, { at: Date.now(), content: text, model })
  return model
}

export async function semanticCatalog(): Promise<SemanticModel[]> {
  const models = await listModels()
  return Promise.all(models.map((m) => semanticModel(m.path)))
}

/** Every measure across every model, flattened, for the metrics catalog. */
export async function metricsCatalog(): Promise<Metric[]> {
  const out: Metric[] = []
  for (const m of await semanticCatalog()) {
    for (const s of m.sources) {
      for (const f of s.fields) {
        if (f.kind !== 'measure') continue
        out.push({ ...f, model: m.path, source: s.name, sourceTablePath: s.tablePath, sourceTableFqn: s.tableFqn })
      }
    }
  }
  return out
}

// ---------- Saving a view ----------

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Save a query as a named view on its source, in the model file: the text is
 * inserted before the closing brace of `source: <name> is … extend { … }`,
 * with the description and the builder state as annotations. The model is
 * compiled with the view first; if it doesn't compile, nothing is written.
 */
export async function saveView(input: {
  model: string
  source: string
  name: string
  description?: string
  body: string
  builder?: string
}) {
  const { model: rel, source, name } = input
  if (!IDENT.test(name)) throw new BadRequest(`"${name}" isn't a Malloy name: use letters, digits and underscores.`)
  const body = input.body.trim()
  if (!body.startsWith('{') || !body.endsWith('}'))
    throw new BadRequest('The view body must be a Malloy query stage in braces: { group_by: … }')
  const { content } = await readModel(rel)
  const current = await semanticModel(rel, content)
  if (!current.ok) return { ok: false, problems: current.problems }
  const src = current.sources.find((s) => s.name === source)
  if (!src) throw new BadRequest(`No source named ${source} in ${rel}.`)
  if (src.fields.some((f) => f.name === name) || src.joins.some((j) => j.name === name))
    throw new BadRequest(`${source} already has a field named ${name}.`)

  // Find the source's extend block end from the compiled location.
  const compiled = await runtime()
    .loadModel(content, { importBaseURL: baseUrl(rel) })
    .getModel()
  const ex = compiled.exportedExplores.find((e) => e.name === source)
  const loc = (ex as unknown as { location?: Loc } | undefined)?.location
  if (!loc || !loc.url.startsWith('internal://')) throw new BadRequest(`${source} isn't defined in ${rel}.`)
  const lines = content.split(/\r?\n/)
  const endLine = lines[loc.range.end.line] ?? ''
  const closeAt = endLine.lastIndexOf('}', loc.range.end.character)
  if (closeAt < 0) throw new BadRequest(`${source} has no extend { … } block to add a view to.`)

  const indented = body
    .split('\n')
    .map((l, i) => (i === 0 ? l : `  ${l}`))
    .join('\n')
  const notes = [
    ...(input.description?.trim() ? [`  # ${input.description.trim().replace(/\s+/g, ' ')}`] : []),
    ...(input.builder ? [`  # builder: ${input.builder}`] : []),
  ]
  const block = ['', ...notes, `  view: ${name} is ${indented}`].join('\n')
  const before = [...lines.slice(0, loc.range.end.line), endLine.slice(0, closeAt)].join('\n').replace(/\s*$/, '')
  const after = [endLine.slice(closeAt), ...lines.slice(loc.range.end.line + 1)].join('\n')
  const next = `${before}\n${block}\n${after}`

  const check = await semanticModel(rel, next)
  if (!check.ok) return { ok: false, problems: check.problems }
  await saveModel(rel, next)
  return {
    ok: true,
    model: rel,
    source,
    view: name,
    line: check.sources.find((s) => s.name === source)?.fields.find((f) => f.name === name)?.line,
  }
}
