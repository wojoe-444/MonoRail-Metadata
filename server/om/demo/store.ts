import { randomUUID } from 'node:crypto'

/**
 * In-memory store behind the demo catalog. Entities keep OpenMetadata's JSON
 * shape, so the same UI code reads them and the real server's responses.
 * Edits live until the server restarts.
 */

// Entities are OpenMetadata JSON documents; their shape varies by type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Entity = Record<string, any> & { id: string; name: string; fullyQualifiedName?: string }

export interface Collection {
  /** OpenMetadata entity type, e.g. "table", "glossaryTerm". Also its search index name. */
  entityType: string
  /** REST path under /api/v1, e.g. "tables", "services/databaseServices". */
  path: string
  searchable: boolean
  items: Map<string, Entity>
}

export interface ResultRow {
  timestamp: number
  [key: string]: unknown
}

class Store {
  readonly collections = new Map<string, Collection>()
  private readonly byId = new Map<string, { entity: Entity; collection: Collection }>()
  /** Previous versions, newest last, by entity id. */
  readonly history = new Map<string, Entity[]>()
  /** Lineage edges, keyed `${fromId}->${toId}`. */
  readonly lineage = new Map<string, LineageEdge>()
  /** Table profiles over time, by table FQN. */
  readonly tableProfiles = new Map<string, ResultRow[]>()
  /** Column profiles over time, by column FQN. */
  readonly columnProfiles = new Map<string, ResultRow[]>()
  /** Sample rows, by table id. */
  readonly sampleData = new Map<string, { columns: string[]; rows: unknown[][] }>()
  /** Test case results over time, by test case FQN. */
  readonly testResults = new Map<string, ResultRow[]>()
  /** Ingestion pipeline runs, by pipeline FQN. */
  readonly pipelineRuns = new Map<string, ResultRow[]>()
  /** Activity threads (conversations, tasks, announcements). */
  readonly threads: Entity[] = []

  define(path: string, entityType: string, searchable = true): Collection {
    let c = this.collections.get(path)
    if (!c) {
      c = { path, entityType, searchable, items: new Map() }
      this.collections.set(path, c)
    }
    return c
  }

  collectionFor(entityType: string): Collection | undefined {
    for (const c of this.collections.values()) if (c.entityType === entityType) return c
    return undefined
  }

  /** Add an entity, filling the fields every OpenMetadata entity has. */
  add(path: string, entity: Partial<Entity> & { name: string }): Entity {
    const c = this.collections.get(path)
    if (!c) throw new Error(`Unknown demo collection ${path}`)
    const e: Entity = {
      id: entity.id ?? randomUUID(),
      displayName: entity.displayName ?? entity.name,
      fullyQualifiedName: entity.fullyQualifiedName ?? entity.name,
      description: '',
      version: 0.1,
      updatedAt: Date.now() - 86_400_000 * 3,
      updatedBy: 'admin',
      deleted: false,
      owners: [],
      tags: [],
      followers: [],
      domains: [],
      ...entity,
    } as Entity
    e.href = `/api/v1/${path}/${e.id}`
    c.items.set(e.id, e)
    this.byId.set(e.id, { entity: e, collection: c })
    return e
  }

  replace(entity: Entity): void {
    const found = this.byId.get(entity.id)
    if (!found) return
    found.collection.items.set(entity.id, entity)
    this.byId.set(entity.id, { entity, collection: found.collection })
  }

  remove(id: string): void {
    const found = this.byId.get(id)
    if (!found) return
    found.collection.items.delete(id)
    this.byId.delete(id)
  }

  get(id: string): { entity: Entity; collection: Collection } | undefined {
    return this.byId.get(id)
  }

  byFqn(path: string, fqn: string): Entity | undefined {
    const c = this.collections.get(path)
    if (!c) return undefined
    for (const e of c.items.values()) if (e.fullyQualifiedName === fqn || e.name === fqn) return e
    return undefined
  }

  /** Any entity by FQN, optionally limited to one entity type. */
  findFqn(fqn: string, entityType?: string): { entity: Entity; collection: Collection } | undefined {
    for (const c of this.collections.values()) {
      if (entityType && c.entityType !== entityType) continue
      for (const e of c.items.values()) if (e.fullyQualifiedName === fqn) return { entity: e, collection: c }
    }
    return undefined
  }

  all(path: string): Entity[] {
    return [...(this.collections.get(path)?.items.values() ?? [])]
  }

  searchable(): { entity: Entity; collection: Collection }[] {
    const out: { entity: Entity; collection: Collection }[] = []
    for (const c of this.collections.values()) {
      if (!c.searchable) continue
      for (const e of c.items.values()) out.push({ entity: e, collection: c })
    }
    return out
  }
}

export interface LineageEdge {
  fromEntity: { id: string; type: string; fullyQualifiedName?: string }
  toEntity: { id: string; type: string; fullyQualifiedName?: string }
  sqlQuery?: string
  source?: string
  description?: string
  pipeline?: EntityRef
  columns?: { fromColumns: string[]; toColumn: string }[]
}

export interface EntityRef {
  id: string
  type: string
  name: string
  fullyQualifiedName?: string
  displayName?: string
  description?: string
  deleted?: boolean
  href?: string
}

export const store = new Store()

/** An OpenMetadata EntityReference for an entity in the store. */
export function ref(e: Entity, type?: string): EntityRef {
  const t = type ?? store.get(e.id)?.collection.entityType ?? 'unknown'
  return {
    id: e.id,
    type: t,
    name: e.name,
    fullyQualifiedName: e.fullyQualifiedName,
    displayName: e.displayName,
    description: e.description || undefined,
    deleted: false,
    href: e.href,
  }
}

/** An OpenMetadata TagLabel for a classification tag or glossary term FQN. */
export function tagLabel(fqn: string, source: 'Classification' | 'Glossary' = 'Classification') {
  const entity = store.findFqn(fqn, source === 'Glossary' ? 'glossaryTerm' : 'tag')?.entity
  return {
    tagFQN: fqn,
    name: entity?.name ?? fqn.split('.').pop(),
    displayName: entity?.displayName ?? fqn.split('.').pop(),
    description: entity?.description,
    source,
    labelType: 'Manual',
    state: 'Confirmed',
  }
}

/** Quote one FQN part the way OpenMetadata does (parts holding a dot get double quotes). */
export function fqnPart(name: string): string {
  return name.includes('.') ? `"${name}"` : name
}

export function fqn(...parts: string[]): string {
  return parts.map(fqnPart).join('.')
}
