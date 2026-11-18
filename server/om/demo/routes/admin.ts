import type { Hono } from 'hono'

import { ref, store, type Entity } from '../store'

/**
 * Admin endpoints beyond generic CRUD, in OpenMetadata 2.0.8's shapes:
 *
 *   POST   /services/databaseServices       create; secrets are masked as the real server masks them
 *   POST   /teams                           create; `parents` / `users` are UUIDs in the request
 *   PUT    /teams/{id}/users                replace the team's members (List<EntityReference>)
 *   DELETE /teams/{id}/users/{userId}       remove one member
 *
 * Team membership is kept on both sides (team.users and user.teams), as the real server does.
 */

const MASK = '*********'
/** Connection fields OpenMetadata stores encrypted and returns masked. */
const SECRET_KEYS = new Set([
  'privateKey',
  'privateKeyId',
  'password',
  'token',
  'dbtCloudAuthToken',
  'secretKey',
  'awsSecretAccessKey',
  'clientSecret',
])

function maskSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(maskSecrets)
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => [
      k,
      SECRET_KEYS.has(k) && typeof x === 'string' && x ? MASK : maskSecrets(x),
    ]),
  )
}

function setTeamUsers(team: Entity, userIds: string[]) {
  const users = userIds.map((id) => store.get(id)?.entity).filter((u): u is Entity => Boolean(u))
  const ids = new Set(users.map((u) => u.id))
  // Drop the team from users who left, add it to users who joined.
  for (const u of store.all('users')) {
    const has = (u.teams ?? []).some((t: Entity) => t.id === team.id)
    if (has && !ids.has(u.id)) store.replace({ ...u, teams: u.teams.filter((t: Entity) => t.id !== team.id) })
    if (!has && ids.has(u.id)) store.replace({ ...u, teams: [...(u.teams ?? []), ref(team, 'team')] })
  }
  const next = { ...team, users: users.map((u) => ref(u, 'user')), userCount: users.length, updatedAt: Date.now() }
  store.replace(next)
  return next
}

export function registerAdminRoutes(app: Hono) {
  app.post('/services/databaseServices', async (c) => {
    const body = (await c.req.json()) as Entity
    if (!body.name || !body.serviceType) return c.json({ code: 400, message: 'name and serviceType are required' }, 400)
    if (store.byFqn('services/databaseServices', body.name))
      return c.json({ code: 409, message: `Entity already exists: ${body.name}` }, 409)
    const created = store.add('services/databaseServices', {
      ...body,
      fullyQualifiedName: body.name,
      connection: maskSecrets(body.connection),
      owners: body.owners ?? [],
      updatedAt: Date.now(),
    })
    return c.json(created, 201)
  })

  app.post('/teams', async (c) => {
    const body = (await c.req.json()) as Entity & { parents?: string[]; users?: string[]; children?: string[] }
    if (!body.name) return c.json({ code: 400, message: 'name is required' }, 400)
    if (store.byFqn('teams', body.name)) return c.json({ code: 409, message: `Entity already exists: ${body.name}` }, 409)
    const parents = (body.parents ?? []).map((id) => store.get(id)?.entity).filter((t): t is Entity => Boolean(t))
    const team = store.add('teams', {
      ...body,
      fullyQualifiedName: body.name,
      teamType: body.teamType ?? 'Group',
      parents: parents.map((p) => ref(p, 'team')),
      children: [],
      users: [],
      userCount: 0,
      isJoinable: body.isJoinable ?? true,
      updatedAt: Date.now(),
    })
    for (const p of parents) store.replace({ ...p, children: [...(p.children ?? []), ref(team, 'team')] })
    return c.json(setTeamUsers(team, body.users ?? []), 201)
  })

  app.put('/teams/:id/users', async (c) => {
    const team = store.get(c.req.param('id'))?.entity
    if (!team) return c.json({ code: 404, message: 'Team not found' }, 404)
    const users = (await c.req.json()) as { id: string }[]
    return c.json(
      setTeamUsers(
        team,
        users.map((u) => u.id),
      ),
    )
  })

  app.delete('/teams/:id/users/:userId', (c) => {
    const team = store.get(c.req.param('id'))?.entity
    if (!team) return c.json({ code: 404, message: 'Team not found' }, 404)
    const remaining = (team.users ?? []).map((u: Entity) => u.id).filter((id: string) => id !== c.req.param('userId'))
    const next = setTeamUsers(team, remaining)
    return c.json({ entityType: 'team', entityId: team.id, entity: next })
  })
}
