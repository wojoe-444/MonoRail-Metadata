import { randomBytes } from 'node:crypto'

import { requestAuth } from './identity'
import { readJson, type Bucket } from './storage'

/**
 * Requests to the worker (docs/team-backend.md, "Request" and "Reply"): write
 * inbox/{id}.json, then poll outbox/{id}.json until the reply appears.
 */

export interface TeamRequest {
  op: 'om' | 'echo' | 'resync'
  method?: string
  path?: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
}

export interface TeamReply {
  v: 1
  id: string
  ts: number
  ok: boolean
  status: number
  body: unknown
  error: { code: string; message: string } | null
  by?: string
  feedSeq?: number | null
}

export class StillQueued extends Error {
  constructor(readonly id: string) {
    super('The team backend has not answered yet. The change is queued and will apply when the worker picks it up.')
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A ULID: 48-bit time + 80 random bits, Crockford base32, so names sort by creation time. */
export function ulid(now = Date.now()): string {
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time
    t = Math.floor(t / 32)
  }
  const rand = randomBytes(16)
  let r = ''
  for (let i = 0; i < 16; i++) r += CROCKFORD[rand[i]! % 32]
  return time + r
}

export async function send(bucket: Bucket, req: TeamRequest, { timeoutMs = 30_000 } = {}): Promise<TeamReply> {
  const id = ulid()
  const body = {
    v: 1,
    id,
    ts: Date.now(),
    auth: await requestAuth(),
    ...req,
    client: { app: 'monorail-metadata', version: '0.1.0' },
  }
  const created = await bucket.createIfAbsent(`inbox/${id}.json`, JSON.stringify(body))
  if (!created) throw new Error(`Request id collision: ${id}`)

  const deadline = Date.now() + timeoutMs
  let wait = 250
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait))
    const reply = await readJson<TeamReply>(bucket, `outbox/${id}.json`)
    if (reply) return reply
    wait = Math.min(2000, Math.round(wait * 1.5))
  }
  throw new StillQueued(id)
}
