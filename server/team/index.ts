import { CONFIG } from '../config'
import { demoApp } from '../om/demo/app'
import { store } from '../om/demo/store'
import { check as allowed, PASS_HEADERS } from './allowlist'
import { accessToken, currentIdentity, googleMode, NotSignedIn } from './identity'
import { send, StillQueued } from './queue'
import { Replica } from './replica'
import { openBucket } from './storage'

/**
 * OpenMetadata calls in team mode (docs/team-backend.md, "App rules"):
 * reads the replica holds are answered locally; every write, and every read it
 * doesn't hold, goes to the worker as a request file.
 */

export const bucket = openBucket(CONFIG.teamBucket, googleMode() ? accessToken : undefined)
export const replica = new Replica(bucket, CONFIG.teamFeedPollMs)

let started = false
export function startTeam() {
  if (started) return
  started = true
  replica.start()
}

/** REST collections the replica holds. Filled from the snapshot; this is the fallback before it loads. */
function collectionPaths(): string[] {
  return [...store.collections.keys()].sort((a, b) => b.length - a.length)
}

/**
 * Whether a GET can be answered from the replica: entity lists and lookups (without
 * sub-resources such as /versions), search, facets and lineage. Profiles, sample data,
 * versions, test results and activity go to the worker.
 */
function servedLocally(pathname: string): boolean {
  if (/^\/search\/(query|aggregate)$/.test(pathname)) return true
  if (pathname === '/lineage/getLineage') return true
  for (const c of collectionPaths()) {
    if (pathname === `/${c}`) return true
    if (pathname.startsWith(`/${c}/name/`) && !/\/(versions|followers|votes)(\/|$)/.test(pathname.slice(c.length + 7))) return true
    const rest = pathname.slice(c.length + 2)
    if (pathname.startsWith(`/${c}/`) && /^[0-9a-f-]{36}$/i.test(rest)) return true
  }
  return false
}

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export async function teamFetch(path: string, init: RequestInit = {}): Promise<Response> {
  startTeam()
  const url = new URL(path, 'http://x')
  const method = (init.method ?? 'GET').toUpperCase()

  if (method === 'GET') {
    if (url.pathname === '/users/loggedInUser') return json(200, loggedInUser())
    if (url.pathname === '/system/version')
      return json(200, { version: replica.omVersion ?? replica.heartbeat?.omVersion ?? 'unknown', revision: 'team' })
    if (replica.loadedAt && servedLocally(url.pathname)) {
      // Lists default to 10 per page on the real server too; the demo handler emulates paging and filters.
      return demoApp.request(`/api/v1${url.pathname}${url.search}`, { method: 'GET' })
    }
  }

  // Everything else goes to the worker. Refuse what it would refuse before queueing, with its status and message.
  const [ok, why] = allowed(method, url.pathname)
  if (!ok) return json(403, { code: 403, message: why, error: 'forbidden' })
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((v, k) => {
    if (PASS_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase() === 'content-type' ? 'Content-Type' : k] = v
  })
  let body: unknown = undefined
  if (init.body !== undefined && init.body !== null) {
    const text = typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      body = text
    }
  }
  try {
    const reply = await send(bucket, {
      op: 'om',
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body,
    })
    if (reply.error && !reply.status) return json(500, { code: 500, message: reply.error.message })
    // Read-your-writes: wait until the change is in the replica before the page refetches.
    if (method !== 'GET') await replica.waitFor(reply.feedSeq)
    return json(
      reply.status || (reply.ok ? 200 : 500),
      reply.error ? { code: reply.status, message: reply.error.message, error: reply.error.code } : reply.body,
    )
  } catch (e) {
    if (e instanceof StillQueued) return json(202, { code: 202, message: e.message, queued: e.id })
    if (e instanceof NotSignedIn) return json(401, { code: 401, message: e.message })
    throw e
  }
}

/** The OpenMetadata user matching TEAM_USER (or the Google email), from the replica. */
function loggedInUser() {
  const who = currentIdentity().user
  const users = store.collections.get('users')
  if (who && users) {
    for (const u of users.items.values()) {
      if (u.name === who || u.email === who || u.fullyQualifiedName === who) return u
    }
  }
  return { id: 'unknown-user', name: who ?? 'unknown', displayName: who ?? 'Not signed in', email: who ?? '', isAdmin: false }
}

export function teamStatus() {
  const identity = currentIdentity()
  return {
    bucket: bucket.label,
    auth: CONFIG.teamAuth,
    identity,
    replica: {
      ready: replica.loadedAt > 0,
      seq: replica.seq,
      loadedAt: replica.loadedAt || null,
      counts: replica.counts(),
      error: replica.lastError ?? null,
    },
    worker: replica.heartbeat
      ? {
          online: replica.workerOnline,
          lastSeen: replica.heartbeat.ts,
          id: replica.heartbeat.worker,
          version: replica.heartbeat.version,
          omVersion: replica.heartbeat.omVersion,
          backlog: replica.heartbeat.inboxBacklog ?? null,
        }
      : { online: false, lastSeen: null },
  }
}
