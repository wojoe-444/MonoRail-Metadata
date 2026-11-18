import { store, type Entity, type LineageEdge, type ResultRow } from '../om/demo/store'
import { readJson, type Bucket } from './storage'

/**
 * The app's copy of the shared catalog (docs/team-backend.md, "Snapshot" and
 * "Feed event"). It loads the worker's snapshot into the same in-memory store the
 * demo catalog uses, so search, facets, lineage and entity reads are answered
 * locally with the demo code, then follows the change feed to stay current.
 */

interface Manifest {
  v: 1
  seq: number
  ts: number
  omVersion?: string
  files: {
    entities: { entityType: string; path: string; file: string; count: number }[]
    lineage?: { file: string; count: number }
    /** Each table's latest profile (an older worker leaves this out). */
    profiles?: { file: string; count: number }
  }
}

/** A table's latest profile, as the worker exports it (docs/team-backend.md, "Snapshot"). */
export interface ProfileRecord {
  id: string
  fullyQualifiedName?: string
  profile: ResultRow | null
  columns: { fullyQualifiedName: string; profile: ResultRow }[]
}

interface FeedEvent {
  seq: number
  ts: number
  by?: string
  byUser?: { id: string; name: string } | null
  requestId?: string | null
  source: 'request' | 'om-events' | 'resync'
  changes: Change[]
}

type Change =
  | { op: 'upsert'; entityType: string; entity: Entity }
  | { op: 'delete'; entityType: string; id: string }
  | { op: 'lineage.upsert'; edge: LineageEdge }
  | { op: 'lineage.delete'; fromId: string; toId: string }
  | { op: 'profile.upsert'; profile: ProfileRecord }
  | { op: 'profile.delete'; tableId: string }
  | { op: 'resync' }

export interface Heartbeat {
  worker: string
  ts: number
  startedAt?: number
  seq?: number
  omUrl?: string
  omVersion?: string
  version?: string
  inboxBacklog?: number
}

/** Entity types that the search index leaves out, as the real server does. */
const NOT_SEARCHABLE = new Set(['testDefinition'])
/** The worker is "offline" when its heartbeat is older than this. */
export const OFFLINE_AFTER_MS = 60_000

const pad = (n: number) => String(n).padStart(12, '0')

export class Replica {
  seq = -1
  loadedAt = 0
  omVersion?: string
  lastError?: string
  heartbeat?: Heartbeat
  /** Whether the snapshot carries latest profiles, so `/tables/{fqn}/tableProfile/latest` is answered locally. */
  hasProfiles = false
  private pathOf = new Map<string, string>()
  /** Latest profile records by table id, to drop a table's column profiles when its record changes. */
  private profiles = new Map<string, ProfileRecord>()
  private waiters: { seq: number; resolve: () => void }[] = []
  private timer?: NodeJS.Timeout
  private polling = false

  constructor(
    private readonly bucket: Bucket,
    private readonly pollMs: number,
  ) {}

  get ready() {
    return this.seq >= 0
  }

  get workerOnline() {
    return Boolean(this.heartbeat && Date.now() - this.heartbeat.ts < OFFLINE_AFTER_MS)
  }

  start() {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.pollMs)
    this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  /** Resolve once the replica has applied feed event `seq` (read-your-writes after a queued change). */
  waitFor(seq: number | null | undefined, timeoutMs = 15_000): Promise<void> {
    if (seq === null || seq === undefined || this.seq >= seq) return Promise.resolve()
    return new Promise((resolve) => {
      const entry = { seq, resolve }
      this.waiters.push(entry)
      void this.tick()
      setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== entry)
        resolve()
      }, timeoutMs).unref()
    })
  }

  /** One poll: heartbeat, then load the snapshot if needed, then apply new feed events. */
  async tick() {
    if (this.polling) return
    this.polling = true
    try {
      this.heartbeat = await readJson<Heartbeat>(this.bucket, 'system/heartbeat.json')
      if (!this.ready) await this.loadSnapshot()
      if (this.ready) await this.catchUp()
      this.lastError = undefined
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
    } finally {
      this.polling = false
      const done = this.waiters.filter((w) => this.seq >= w.seq)
      this.waiters = this.waiters.filter((w) => this.seq < w.seq)
      done.forEach((w) => w.resolve())
    }
  }

  async loadSnapshot() {
    const manifest = await readJson<Manifest>(this.bucket, 'state/catalog/manifest.json')
    if (!manifest) {
      this.lastError = 'No catalog snapshot in the bucket yet. Start the worker (npm run worker).'
      return
    }
    const files = await Promise.all(
      manifest.files.entities.map(async (f) => ({ f, items: (await readJson<Entity[]>(this.bucket, `state/catalog/${f.file}`)) ?? [] })),
    )
    const edges = manifest.files.lineage
      ? ((await readJson<LineageEdge[]>(this.bucket, `state/catalog/${manifest.files.lineage.file}`)) ?? [])
      : []
    const profiles = manifest.files.profiles
      ? ((await readJson<ProfileRecord[]>(this.bucket, `state/catalog/${manifest.files.profiles.file}`)) ?? [])
      : []

    // Swap in the new contents in one go, so readers never see a half-loaded catalog.
    store.reset()
    this.pathOf.clear()
    this.profiles.clear()
    for (const { f, items } of files) {
      store.define(f.path, f.entityType, !NOT_SEARCHABLE.has(f.entityType))
      this.pathOf.set(f.entityType, f.path)
      for (const e of items) store.put(f.path, e)
    }
    for (const e of edges) store.lineage.set(`${e.fromEntity.id}->${e.toEntity.id}`, e)
    for (const r of profiles) this.putProfile(r)
    this.hasProfiles = Boolean(manifest.files.profiles)
    this.seq = manifest.seq
    this.omVersion = manifest.omVersion
    this.loadedAt = Date.now()
  }

  private async catchUp() {
    const head = await readJson<{ seq: number }>(this.bucket, 'feed/head.json')
    if (!head || head.seq <= this.seq) return
    for (let s = this.seq + 1; s <= head.seq; s++) {
      const event = await readJson<FeedEvent>(this.bucket, `feed/${pad(s)}.json`)
      if (!event) {
        // A gap (cleaned up, or still being written): start again from the snapshot.
        this.seq = -1
        await this.loadSnapshot()
        return
      }
      if (event.changes.some((c) => c.op === 'resync')) {
        // The worker wrote a new snapshot before this event; reload it and carry on from its seq next tick.
        await this.loadSnapshot()
        if (this.seq < s) this.seq = s
        return
      }
      for (const c of event.changes) this.apply(c)
      this.seq = s
    }
  }

  private apply(c: Change) {
    switch (c.op) {
      case 'upsert': {
        const path = this.pathOf.get(c.entityType)
        if (!path) return // a type the snapshot doesn't carry
        store.put(path, c.entity)
        return
      }
      case 'delete':
        store.remove(c.id)
        this.dropProfile(c.id)
        return
      case 'lineage.upsert':
        store.lineage.set(`${c.edge.fromEntity.id}->${c.edge.toEntity.id}`, c.edge)
        return
      case 'lineage.delete':
        store.lineage.delete(`${c.fromId}->${c.toId}`)
        return
      case 'profile.upsert':
        this.putProfile(c.profile)
        return
      case 'profile.delete':
        this.dropProfile(c.tableId)
        return
    }
  }

  /**
   * Latest profiles go into the demo store's profile maps (one row each), so the demo's
   * `/tables/{fqn}/tableProfile/latest` handler answers from them, as it does in demo mode.
   */
  private putProfile(r: ProfileRecord) {
    this.dropProfile(r.id)
    this.profiles.set(r.id, r)
    if (r.fullyQualifiedName && r.profile) store.tableProfiles.set(r.fullyQualifiedName, [r.profile])
    for (const c of r.columns) store.columnProfiles.set(c.fullyQualifiedName, [c.profile])
  }

  private dropProfile(tableId: string) {
    const old = this.profiles.get(tableId)
    if (!old) return
    this.profiles.delete(tableId)
    if (old.fullyQualifiedName) store.tableProfiles.delete(old.fullyQualifiedName)
    for (const c of old.columns) store.columnProfiles.delete(c.fullyQualifiedName)
  }

  counts(): Record<string, number> {
    return Object.fromEntries([...store.collections.values()].map((c) => [c.entityType, c.items.size]))
  }
}
