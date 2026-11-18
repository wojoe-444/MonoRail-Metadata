import jsonpatch from 'fast-json-patch'

import { href } from '@/lib/router'

import type { PatchOp } from './api'
import type { AssetCertification, EntityBase, EntityReference, TagLabel } from './types'

/** The name to show for an entity or reference. */
export function displayName(e: { displayName?: string; name?: string; fullyQualifiedName?: string } | undefined): string {
  return e?.displayName || e?.name || e?.fullyQualifiedName?.split('.').pop() || 'Unnamed'
}

/** App route for an entity. Every entity link in the app goes through here. */
export function entityPath(entityType: string, fqn: string): string {
  const q = encodeURIComponent(fqn)
  switch (entityType) {
    case 'table':
      return `/explore/table?fqn=${q}`
    case 'database':
    case 'databaseSchema':
    case 'databaseService':
      return `/services/browse?type=${entityType}&fqn=${q}`
    case 'glossary':
      return `/glossary?fqn=${q}`
    case 'glossaryTerm':
      return `/glossary/term?fqn=${q}`
    case 'tag':
    case 'classification':
      return `/tags?fqn=${q}`
    case 'domain':
      return `/domains?fqn=${q}`
    case 'dataProduct':
      return `/domains/product?fqn=${q}`
    case 'user':
      return `/teams/user?fqn=${q}`
    case 'team':
      return `/teams?fqn=${q}`
    case 'testCase':
      return `/quality/test?fqn=${q}`
    case 'ingestionPipeline':
      return `/services/pipeline?fqn=${q}`
    case 'metric':
      return `/metrics?metric=${q}`
    default:
      return `/explore?q=${q}`
  }
}

export function entityHref(entityType: string, fqn: string): string {
  return href(entityPath(entityType, fqn))
}

export function refHref(r: EntityReference): string {
  return entityHref(r.type, r.fullyQualifiedName ?? r.name ?? r.id)
}

export const ENTITY_LABEL: Record<string, string> = {
  table: 'Table',
  database: 'Project',
  databaseSchema: 'Dataset',
  databaseService: 'Service',
  glossary: 'Glossary',
  glossaryTerm: 'Glossary term',
  classification: 'Classification',
  tag: 'Tag',
  domain: 'Domain',
  dataProduct: 'Data product',
  user: 'User',
  team: 'Team',
  query: 'Query',
  metric: 'Metric',
  testCase: 'Test case',
  testSuite: 'Test suite',
  ingestionPipeline: 'Ingestion pipeline',
  dashboard: 'Dashboard',
  pipeline: 'Pipeline',
  topic: 'Topic',
}

/** "Project" and "Dataset" are BigQuery's names for OpenMetadata's database and schema. */
export function entityLabel(entityType: string): string {
  return ENTITY_LABEL[entityType] ?? entityType.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

export const isTier = (t: TagLabel) => t.tagFQN.startsWith('Tier.')
export const isCertification = (t: TagLabel) => t.tagFQN.startsWith('Certification.')

export function tierOf(tags: TagLabel[] | undefined): TagLabel | undefined {
  return tags?.find(isTier)
}

/** Tags to show as chips: everything except tier and certification, which get their own badges. */
export function plainTags(tags: TagLabel[] | undefined): TagLabel[] {
  return (tags ?? []).filter((t) => !isTier(t) && !isCertification(t))
}

/**
 * An entity's certification. OpenMetadata 2.x keeps it in its own `certification` field; older
 * data (and servers before 1.6) stored it as a `Certification.*` tag, which is the fallback.
 */
export function certificationOf(entity: Pick<EntityBase, 'certification' | 'tags'> | undefined): AssetCertification | undefined {
  if (entity?.certification?.tagLabel) return entity.certification
  const tag = entity?.tags?.find(isCertification)
  return tag ? { tagLabel: tag } : undefined
}

/** Whether a certification has run out (2.x sets `expiryDate` from the certification settings). */
export const isExpired = (c: AssetCertification | undefined, now = Date.now()) => Boolean(c?.expiryDate && c.expiryDate < now)

const CERTIFICATION_DAYS = 90

/**
 * The entity with `tag` as its certification (or none), written to the real field, the way
 * OpenMetadata's own UI does it. A legacy `Certification.*` tag is dropped at the same time, so the
 * PATCH that `diffPatch` builds moves old data onto the field. The dates are placeholders: the
 * server sets them.
 */
export function withCertification<T extends EntityBase>(entity: T, tag: TagLabel | undefined): T {
  const tags = entity.tags?.some(isCertification) ? entity.tags.filter((t) => !isCertification(t)) : entity.tags
  const next: T = { ...entity, tags }
  if (!tag) {
    delete next.certification
    return next
  }
  const now = Date.now()
  return { ...next, certification: { tagLabel: tag, appliedDate: now, expiryDate: now + CERTIFICATION_DAYS * 86_400_000 } }
}

/** JSON Patch ops that turn `before` into `after`, the way OpenMetadata's own UI builds edits. */
export function diffPatch<T extends EntityBase>(before: T, after: T): PatchOp[] {
  return jsonpatch.compare(before, after) as PatchOp[]
}

export function newTagLabel(tagFQN: string, source: TagLabel['source'], extra: Partial<TagLabel> = {}): TagLabel {
  return { tagFQN, source, labelType: 'Manual', state: 'Confirmed', ...extra }
}

// ---------- Formatting ----------

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-US')

export function formatCount(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '–'
  return Math.abs(n) >= 10_000 ? compact.format(n) : whole.format(n)
}

export function formatBytes(n: number | undefined): string {
  if (!n) return '–'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

export function formatPercent(n: number | undefined, digits = 0): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '–'
  return `${(n * 100).toFixed(digits)}%`
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function timeAgo(ts: number | undefined): string {
  if (!ts) return '–'
  const s = (ts - Date.now()) / 1000
  const abs = Math.abs(s)
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86_400 * 30) return rtf.format(Math.round(s / 86_400), 'day')
  if (abs < 86_400 * 365) return rtf.format(Math.round(s / (86_400 * 30)), 'month')
  return rtf.format(Math.round(s / (86_400 * 365)), 'year')
}

export function formatDate(ts: number | undefined): string {
  if (!ts) return '–'
  return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** BigQuery's table path from an OpenMetadata table FQN: service.project.dataset.table → project.dataset.table. */
export function bigQueryPath(fqn: string): string {
  return splitFqn(fqn).slice(1).join('.')
}

/** Split an FQN on dots, honouring OpenMetadata's double-quoted parts. */
export function splitFqn(fqn: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of fqn) {
    if (ch === '"') quoted = !quoted
    else if (ch === '.' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}
