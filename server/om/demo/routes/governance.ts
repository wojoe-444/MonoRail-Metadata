import type { Context, Hono } from 'hono'

import { fqnPart, ref, store, type Entity } from '../store'

/**
 * Governance endpoints beyond generic CRUD (glossary, tags, domains, data products).
 * Shapes follow OpenMetadata 2.0.8 (GlossaryTermResource, TagResource, DataProductResource).
 */
export function registerGovernanceRoutes(app: Hono) {
  // POST /glossaryTerms (CreateGlossaryTerm): glossary and parent are FQN strings, relatedTerms FQNs.
  // Handled here so the term gets OpenMetadata's server-side defaults (status, counts, typed relations).
  app.post('/glossaryTerms', async (c) => {
    const body = (await c.req.json()) as Entity
    const glossary = findByFqnOrId('glossaries', body.glossary)
    if (!glossary) return c.json({ code: 400, message: `Glossary ${String(body.glossary)} not found` }, 400)
    const parent = body.parent ? findByFqnOrId('glossaryTerms', body.parent) : undefined
    if (body.parent && !parent) return c.json({ code: 400, message: `Parent term ${String(body.parent)} not found` }, 400)
    const fullyQualifiedName = `${parent?.fullyQualifiedName ?? glossary.fullyQualifiedName}.${fqnPart(body.name)}`
    if (store.byFqn('glossaryTerms', fullyQualifiedName))
      return c.json({ code: 409, message: `glossaryTerm ${fullyQualifiedName} already exists` }, 409)
    const reviewers = (body.reviewers as Entity[] | undefined) ?? glossary.reviewers ?? []
    const term = store.add('glossaryTerms', {
      name: body.name,
      displayName: body.displayName || body.name,
      description: body.description ?? '',
      fullyQualifiedName,
      glossary: ref(glossary, 'glossary'),
      parent: parent ? ref(parent, 'glossaryTerm') : undefined,
      synonyms: body.synonyms ?? [],
      relatedTerms: ((body.relatedTerms as string[] | undefined) ?? [])
        .map((f) => store.byFqn('glossaryTerms', f))
        .filter((t): t is Entity => Boolean(t))
        .map((t) => ({ relationType: 'relatedTo', term: ref(t, 'glossaryTerm') })),
      references: body.references ?? [],
      reviewers,
      owners: body.owners ?? [],
      tags: body.tags ?? [],
      // OpenMetadata starts a term in review when someone has to approve it.
      status: reviewers.length ? 'In Review' : 'Approved',
      entityStatus: reviewers.length ? 'In Review' : 'Approved',
      childrenCount: 0,
      updatedAt: Date.now(),
    })
    bump(glossary, 'termCount', 1)
    if (parent) bump(parent, 'childrenCount', 1)
    return c.json(term, 201)
  })

  // POST /glossaryTerms/{id}/relations (TermRelation) and DELETE /glossaryTerms/{id}/relations/{toTermId}.
  app.post('/glossaryTerms/:id/relations', async (c) => {
    const from = store.get(c.req.param('id'))?.entity
    const body = (await c.req.json()) as { relationType?: string; term: { id: string } }
    const to = body.term?.id ? store.get(body.term.id)?.entity : undefined
    if (!from || !to) return c.json({ code: 404, message: 'Glossary term not found' }, 404)
    const relationType = body.relationType ?? 'relatedTo'
    link(from, to, relationType)
    if (relationType === 'relatedTo') link(to, from, relationType)
    return c.json(store.get(from.id)!.entity)
  })

  app.delete('/glossaryTerms/:id/relations/:toId', (c) => {
    const from = store.get(c.req.param('id'))?.entity
    const to = store.get(c.req.param('toId'))?.entity
    if (!from || !to) return c.json({ code: 404, message: 'Glossary term not found' }, 404)
    const relationType = c.req.query('relationType')
    unlink(from, to.id, relationType)
    if (!relationType || relationType === 'relatedTo') unlink(to, from.id, relationType)
    return c.json(store.get(from.id)!.entity)
  })

  // POST /tags (CreateTag): keeps the classification's termCount in step.
  app.post('/tags', async (c) => {
    const body = (await c.req.json()) as Entity
    const classification = findByFqnOrId('classifications', body.classification)
    if (!classification) return c.json({ code: 400, message: `Classification ${String(body.classification)} not found` }, 400)
    const parent = body.parent ? findByFqnOrId('tags', body.parent) : undefined
    const fullyQualifiedName = `${parent?.fullyQualifiedName ?? classification.fullyQualifiedName}.${fqnPart(body.name)}`
    if (store.byFqn('tags', fullyQualifiedName)) return c.json({ code: 409, message: `tag ${fullyQualifiedName} already exists` }, 409)
    const tag = store.add('tags', {
      name: body.name,
      displayName: body.displayName || body.name,
      description: body.description ?? '',
      fullyQualifiedName,
      classification: ref(classification, 'classification'),
      parent: parent ? ref(parent, 'tag') : undefined,
      provider: 'user',
      style: body.style ?? {},
      updatedAt: Date.now(),
    })
    bump(classification, 'termCount', 1)
    return c.json(tag, 201)
  })

  // PUT /dataProducts/{fqn}/assets/add|remove with { assets: EntityReference[] } → BulkOperationResult.
  app.put('/dataProducts/:fqn/assets/add', (c) => dataProductAssets(c, 'add'))
  app.put('/dataProducts/:fqn/assets/remove', (c) => dataProductAssets(c, 'remove'))
}

async function dataProductAssets(c: Context, op: 'add' | 'remove') {
  const fqn = c.req.param('fqn') ?? ''
  const dp = store.byFqn('dataProducts', fqn)
  if (!dp) return c.json({ code: 404, message: `dataProduct instance for ${fqn} not found` }, 404)
  const body = (await c.req.json()) as { assets?: { id: string; type: string }[]; dryRun?: boolean }
  const passed: unknown[] = []
  const failed: unknown[] = []
  let assets: Entity[] = [...(dp.assets ?? [])]
  for (const a of body.assets ?? []) {
    const found = store.get(a.id)
    if (!found) {
      failed.push({ request: a, message: `${a.type} ${a.id} not found` })
      continue
    }
    const asset = found.entity
    const others = (asset.dataProducts ?? []).filter((r: Entity) => r.id !== dp.id)
    if (op === 'add') {
      if (!body.dryRun) store.replace({ ...asset, dataProducts: [...others, ref(dp, 'dataProduct')] })
      if (!assets.some((r) => r.id === asset.id)) assets.push(ref(asset, found.collection.entityType))
    } else {
      if (!body.dryRun) store.replace({ ...asset, dataProducts: others })
      assets = assets.filter((r) => r.id !== asset.id)
    }
    passed.push({ request: a, message: 'Success' })
  }
  if (!body.dryRun) store.replace({ ...store.get(dp.id)!.entity, assets, updatedAt: Date.now() })
  return c.json({
    dryRun: Boolean(body.dryRun),
    status: failed.length ? (passed.length ? 'partialSuccess' : 'failure') : 'success',
    numberOfRowsProcessed: passed.length + failed.length,
    numberOfRowsPassed: passed.length,
    numberOfRowsFailed: failed.length,
    successRequest: passed,
    failedRequest: failed,
  })
}

function findByFqnOrId(path: string, v: unknown): Entity | undefined {
  if (!v) return undefined
  if (typeof v === 'object') {
    const r = v as Entity
    return (r.id && store.get(r.id)?.entity) || (r.fullyQualifiedName ? store.byFqn(path, r.fullyQualifiedName) : undefined)
  }
  return store.byFqn(path, String(v)) ?? store.get(String(v))?.entity
}

function bump(e: Entity, field: string, by: number) {
  const current = store.get(e.id)!.entity
  store.replace({ ...current, [field]: Math.max(0, Number(current[field] ?? 0) + by) })
}

function link(from: Entity, to: Entity, relationType: string) {
  const current = store.get(from.id)!.entity
  const rels: Entity[] = current.relatedTerms ?? []
  if (rels.some((r) => (r.term?.id ?? r.id) === to.id && (r.relationType ?? 'relatedTo') === relationType)) return
  store.replace({ ...current, relatedTerms: [...rels, { relationType, term: ref(to, 'glossaryTerm') }], updatedAt: Date.now() })
}

function unlink(from: Entity, toId: string, relationType?: string) {
  const current = store.get(from.id)!.entity
  const rels: Entity[] = current.relatedTerms ?? []
  store.replace({
    ...current,
    relatedTerms: rels.filter(
      (r) => !((r.term?.id ?? r.id) === toId && (!relationType || (r.relationType ?? 'relatedTo') === relationType)),
    ),
    updatedAt: Date.now(),
  })
}
