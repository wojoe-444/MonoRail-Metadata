import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { MalloyError, Runtime, type Explore, type Field, type Model } from '@malloydata/malloy'

import { bigQueryConfigured, CONFIG } from '../config'
import { CatalogBigQueryConnection } from './connection'

/**
 * Malloy models live as .malloy files under MALLOY_DIR. This module lists,
 * reads and saves them, compiles them into an outline (sources, dimensions,
 * measures, views, joins), and runs queries on BigQuery.
 */

export const connection = new CatalogBigQueryConnection('bigquery')

const urlReader = {
  readURL: async (url: URL) => {
    const file = fileURLToPath(url)
    if (!isInside(CONFIG.malloyDir, file)) throw new Error(`Imports must stay inside the models folder: ${url}`)
    return fs.readFile(file, 'utf8')
  },
}

export function runtime() {
  return new Runtime({ urlReader, connection })
}

function isInside(dir: string, file: string) {
  const rel = path.relative(dir, file)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function modelFile(rel: string): string {
  const file = path.resolve(CONFIG.malloyDir, rel)
  if (!isInside(CONFIG.malloyDir, file) || !file.endsWith('.malloy')) throw new BadRequest(`Not a model path: ${rel}`)
  return file
}

export class BadRequest extends Error {}

export interface ModelSummary {
  path: string
  name: string
  /** Table paths the model reads, e.g. "bigquery-public-data.thelook_ecommerce.orders". */
  tables: string[]
  sources: string[]
  updatedAt: number
  bytes: number
}

const TABLE_RE = /\b(\w+)\.table\(\s*['"`]([^'"`]+)['"`]\s*\)/g
const SOURCE_RE = /^\s*source:\s*([A-Za-z_][\w]*)\s+is\b/gm

export async function listModels(): Promise<ModelSummary[]> {
  const out: ModelSummary[] = []
  const walk = async (dir: string) => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.name.endsWith('.malloy')) {
        const [content, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)])
        out.push({
          path: path.relative(CONFIG.malloyDir, full).replace(/\\/g, '/'),
          name: e.name.replace(/\.malloy$/, ''),
          tables: [...new Set([...content.matchAll(TABLE_RE)].map((m) => m[2]!))],
          sources: [...content.matchAll(SOURCE_RE)].map((m) => m[1]!),
          updatedAt: stat.mtimeMs,
          bytes: stat.size,
        })
      }
    }
  }
  await walk(CONFIG.malloyDir)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export async function readModel(rel: string) {
  const file = modelFile(rel)
  return { path: rel, content: await fs.readFile(file, 'utf8') }
}

export async function saveModel(rel: string, content: string) {
  const file = modelFile(rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, 'utf8')
  return { path: rel, savedAt: Date.now() }
}

export interface OutlineField {
  name: string
  kind: 'dimension' | 'measure' | 'view' | 'join'
  type?: string
  description?: string
  fields?: OutlineField[]
}

export interface OutlineSource {
  name: string
  tablePath?: string
  primaryKey?: string
  fields: OutlineField[]
}

export interface Problem {
  message: string
  severity: string
  line?: number
  character?: number
}

export function problemsOf(e: unknown): Problem[] {
  if (e instanceof MalloyError) {
    return e.problems.map((p) => ({
      message: p.message,
      severity: p.severity,
      line: p.at?.range.start.line,
      character: p.at?.range.start.character,
    }))
  }
  return [{ message: e instanceof Error ? e.message : String(e), severity: 'error' }]
}

function describe(f: Field): string | undefined {
  try {
    const notes = f.annotations?.texts?.() as string[] | undefined
    const text = notes
      ?.map((t) => t.replace(/^#\s*/, '').trim())
      .filter((t) => t && !t.startsWith('"'))
      .join(' ')
    return text || undefined
  } catch {
    return undefined
  }
}

function outlineFields(explore: Explore, depth = 0): OutlineField[] {
  const out: OutlineField[] = []
  for (const f of explore.allFields) {
    if (f.isExploreField()) {
      out.push({ name: f.name, kind: 'join', fields: depth < 2 ? outlineFields(f, depth + 1) : [] })
    } else if (f.isQueryField()) {
      out.push({ name: f.name, kind: 'view', description: describe(f) })
    } else if (f.isAtomicField()) {
      out.push({ name: f.name, kind: f.isCalculation() ? 'measure' : 'dimension', type: String(f.type), description: describe(f) })
    }
  }
  return out
}

function outline(model: Model): OutlineSource[] {
  return model.exportedExplores.map((ex) => {
    const sd = ex.structDef as { type?: string; tablePath?: string }
    return {
      name: ex.name,
      tablePath: sd.type === 'table' ? sd.tablePath : undefined,
      primaryKey: ex.primaryKey,
      fields: outlineFields(ex),
    }
  })
}

export function baseUrl(rel?: string): URL {
  const file = rel ? modelFile(rel) : path.join(CONFIG.malloyDir, '__scratch__.malloy')
  return pathToFileURL(file)
}

/** The model text to compile: unsaved edits when given, otherwise the saved file. */
async function contentOf(content: string | undefined, rel?: string): Promise<string> {
  if (content !== undefined) return content
  if (!rel) throw new BadRequest('Give the model text or its path.')
  return (await readModel(rel)).content
}

/** Compile a model's text (unsaved edits included, or the saved file) and return its outline, plus SQL for an optional query. */
export async function compile(content: string | undefined, rel?: string, query?: string) {
  const rt = runtime()
  try {
    const mm = rt.loadModel(await contentOf(content, rel), { importBaseURL: baseUrl(rel) })
    const model = await mm.getModel()
    let sql: string | undefined
    if (query?.trim()) sql = await mm.loadQuery(query).getSQL()
    return { ok: true, sources: outline(model), sql, problems: [] as Problem[] }
  } catch (e) {
    return { ok: false, sources: [] as OutlineSource[], problems: problemsOf(e) }
  }
}

/** What a query would cost, from a BigQuery dry run, and the limits that apply to it. */
export interface Estimate {
  /** False when BigQuery credentials are missing: queries compile to SQL but don't run. */
  configured: boolean
  bytes?: number
  maxBytesBilled: number
  overCap?: boolean
  rowLimit: number
  error?: string
}

export async function estimate(sql: string): Promise<Estimate> {
  const base = { maxBytesBilled: Number(CONFIG.bqMaxBytesBilled), rowLimit: CONFIG.malloyRowLimit }
  if (!bigQueryConfigured()) return { configured: false, ...base }
  try {
    const { queryCostBytes } = await connection.estimateQueryCost(sql)
    const bytes = Number(queryCostBytes ?? 0)
    return { configured: true, ...base, bytes, overCap: bytes > base.maxBytesBilled }
  } catch (e) {
    return { configured: true, ...base, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Compile a query and dry-run its SQL: the guardrail shown before a query runs. */
export async function dryRun(content: string | undefined, query: string, rel?: string) {
  try {
    const mm = runtime().loadModel(await contentOf(content, rel), { importBaseURL: baseUrl(rel) })
    const sql = await mm.loadQuery(query).getSQL()
    return { ok: true, sql, estimate: await estimate(sql), problems: [] as Problem[] }
  } catch (e) {
    return { ok: false, problems: problemsOf(e) }
  }
}

const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`)

export async function run(content: string | undefined, query: string, rel?: string) {
  let sql: string
  let mm: ReturnType<Runtime['loadModel']>
  try {
    mm = runtime().loadModel(await contentOf(content, rel), { importBaseURL: baseUrl(rel) })
    sql = await mm.loadQuery(query).getSQL()
  } catch (e) {
    return { ok: false, problems: problemsOf(e) }
  }
  if (!bigQueryConfigured()) {
    return {
      ok: false,
      compileOnly: true,
      sql,
      estimate: await estimate(sql),
      problems: [
        {
          severity: 'warn',
          message:
            'BigQuery credentials are not set up, so the query compiled but did not run. Set BQ_PROJECT_ID and sign in with `gcloud auth application-default login` (or set GOOGLE_APPLICATION_CREDENTIALS), then restart the server.',
        },
      ],
    }
  }
  // Guardrail: dry-run first, and refuse a query that would scan more than the cap.
  const est = await estimate(sql)
  if (est.overCap) {
    return {
      ok: false,
      sql,
      estimate: est,
      problems: [
        {
          severity: 'error',
          message: `This query would scan ${fmtBytes(est.bytes!)}, over the ${fmtBytes(est.maxBytesBilled)} cap (BQ_MAX_BYTES_BILLED). Add a filter or raise the cap.`,
        },
      ],
    }
  }
  try {
    const started = Date.now()
    const result = await mm.loadQuery(query).run({ rowLimit: CONFIG.malloyRowLimit })
    const rows = result.data.toObject()
    const fields = result.resultExplore.allFields.map((f) => ({
      name: f.name,
      type: f.isAtomicField() ? String(f.type) : f.isExploreField() ? 'nested' : 'view',
      isMeasure: f.isAtomicField() ? f.isCalculation() : false,
    }))
    return { ok: true, sql, rows, fields, totalRows: result.totalRows, runStats: result.runStats, estimate: est, ms: Date.now() - started }
  } catch (e) {
    return { ok: false, sql, estimate: est, problems: problemsOf(e) }
  }
}

/** Models and sources that read a BigQuery table, for the table page. */
export async function usageOfTable(tablePath: string) {
  const key = tablePath.replace(/`/g, '').toLowerCase()
  const models = await listModels()
  const hits = models.filter((m) => m.tables.some((t) => t.toLowerCase() === key))
  const results = []
  for (const m of hits) {
    const { content } = await readModel(m.path)
    const compiled = await compile(content, m.path)
    results.push({
      model: m.path,
      sources: compiled.sources.filter((s) => s.tablePath?.replace(/`/g, '').toLowerCase() === key),
      problems: compiled.problems,
    })
  }
  return results
}
