import { qs } from '@/lib/api'
import { aggregate, enc, getEntity, listEntities, om } from '@/features/om/api'
import type { Classification, DataProduct, Domain, EntityReference, Glossary, GlossaryTerm, Tag } from '@/features/om/types'

/**
 * Governance calls (OpenMetadata 2.0.8): glossaries and terms, classifications
 * and tags, domains and data products. Built on `om()`; shapes follow the
 * Create* request schemas in openmetadata-spec.
 */

// ---------- Field lists (each must be valid for the resource, or OpenMetadata answers 400) ----------

export const GLOSSARY_FIELDS = 'owners,tags,reviewers,termCount,domains'
export const TERM_FIELDS = 'children,relatedTerms,reviewers,owners,tags,domains,childrenCount'
export const CLASSIFICATION_FIELDS = 'owners,termCount'
export const TAG_FIELDS = 'owners,children'
export const DOMAIN_FIELDS = 'tags,children,childrenCount,owners,experts'
export const DATA_PRODUCT_FIELDS = 'domains,owners,reviewers,experts,tags,followers'

// ---------- Types the shared om/types.ts doesn't carry yet ----------

/** OpenMetadata 2.x stores related terms as typed relations. Older servers (and some payloads) send bare references. */
export interface TermRelation {
  relationType?: string
  term: EntityReference
}

export type GlossaryTermV2 = Omit<GlossaryTerm, 'relatedTerms' | 'status'> & {
  relatedTerms?: (TermRelation | EntityReference)[]
  status?: string
  entityStatus?: string
  children?: EntityReference[]
  usageCount?: number
}

export const TERM_STATUSES = ['Draft', 'In Review', 'Approved', 'Deprecated', 'Rejected'] as const

/** `entityStatus` in 2.x; `status` before. */
export function termStatus(t: { entityStatus?: string; status?: string }): string | undefined {
  return t.entityStatus ?? t.status
}

export function relatedTermRefs(t: GlossaryTermV2): EntityReference[] {
  return (t.relatedTerms ?? []).map((r) => ('term' in r ? r.term : r))
}

export const DOMAIN_TYPES = ['Aggregate', 'Consumer-aligned', 'Source-aligned'] as const

// ---------- Glossaries ----------

export const listGlossaries = () => listEntities<Glossary>('glossary', { fields: GLOSSARY_FIELDS, limit: 1000 })

export const getGlossary = (fqn: string) => getEntity<Glossary>('glossary', fqn, GLOSSARY_FIELDS)

/** Every term of a glossary (OpenMetadata filters by glossary id). */
export const listGlossaryTerms = (glossaryId: string) =>
  listEntities<GlossaryTermV2>('glossaryTerm', { glossary: glossaryId, fields: 'owners,reviewers,childrenCount', limit: 1000 })

export const getGlossaryTerm = (fqn: string) => getEntity<GlossaryTermV2>('glossaryTerm', fqn, TERM_FIELDS)

export interface CreateGlossaryBody {
  name: string
  displayName?: string
  description: string
  owners?: EntityReference[]
  reviewers?: EntityReference[]
  mutuallyExclusive?: boolean
}

export const createGlossary = (body: CreateGlossaryBody) => om<Glossary>('/glossaries', { method: 'POST', json: body })

export interface CreateGlossaryTermBody {
  /** Glossary FQN. */
  glossary: string
  /** Parent term FQN, for a child term. */
  parent?: string
  name: string
  displayName?: string
  description: string
  synonyms?: string[]
  /** Related term FQNs. */
  relatedTerms?: string[]
  owners?: EntityReference[]
  reviewers?: EntityReference[]
}

export const createGlossaryTerm = (body: CreateGlossaryTermBody) => om<GlossaryTermV2>('/glossaryTerms', { method: 'POST', json: body })

export const addTermRelation = (termId: string, to: EntityReference, relationType = 'relatedTo') =>
  om<GlossaryTermV2>(`/glossaryTerms/${termId}/relations`, {
    method: 'POST',
    json: { relationType, term: { id: to.id, type: 'glossaryTerm' } },
  })

export const removeTermRelation = (termId: string, toTermId: string, relationType = 'relatedTo') =>
  om<GlossaryTermV2>(`/glossaryTerms/${termId}/relations/${toTermId}${qs({ relationType })}`, { method: 'DELETE' })

// ---------- Classifications and tags ----------

export const listClassifications = () => listEntities<Classification>('classification', { fields: CLASSIFICATION_FIELDS, limit: 1000 })

/** Tags of one classification (`parent` is the classification name). */
export const listTags = (classification: string) => listEntities<Tag>('tag', { parent: classification, fields: TAG_FIELDS, limit: 1000 })

export const createClassification = (body: { name: string; displayName?: string; description: string; mutuallyExclusive?: boolean }) =>
  om<Classification>('/classifications', { method: 'POST', json: body })

export const createTag = (body: { classification: string; parent?: string; name: string; displayName?: string; description: string }) =>
  om<Tag>('/tags', { method: 'POST', json: body })

// ---------- Domains and data products ----------

export const listDomains = () => listEntities<Domain>('domain', { fields: DOMAIN_FIELDS, limit: 1000 })

export const listDataProducts = (domainFqn: string) =>
  listEntities<DataProduct>('dataProduct', { domain: domainFqn, fields: 'domains,owners,experts', limit: 1000 })

export const createDomain = (body: {
  name: string
  displayName?: string
  description: string
  domainType: string
  owners?: EntityReference[]
  experts?: string[]
  parent?: string
}) => om<Domain>('/domains', { method: 'POST', json: body })

/** CreateDataProduct: `domains` are FQN strings. */
export const createDataProduct = (body: {
  name: string
  displayName?: string
  description: string
  domains: string[]
  owners?: EntityReference[]
}) => om<DataProduct>('/dataProducts', { method: 'POST', json: body })

export interface BulkOperationResult {
  status?: 'success' | 'partialSuccess' | 'failure' | 'aborted'
  numberOfRowsProcessed?: number
  numberOfRowsPassed?: number
  numberOfRowsFailed?: number
  failedRequest?: { request?: unknown; message?: string }[]
}

export const addDataProductAssets = (fqn: string, assets: { id: string; type: string }[]) =>
  om<BulkOperationResult>(`/dataProducts/${enc(fqn)}/assets/add`, { method: 'PUT', json: { assets } })

export const removeDataProductAssets = (fqn: string, assets: { id: string; type: string }[]) =>
  om<BulkOperationResult>(`/dataProducts/${enc(fqn)}/assets/remove`, { method: 'PUT', json: { assets } })

// ---------- Asset filters (the same ES filters OpenMetadata's own AssetsTabs builds) ----------

const term = (field: string, value: string) => ({ term: { [field]: value } })

/** Assets labeled with a classification tag or glossary term. Column tags count: the search doc merges them into `tags`. */
export function tagAssetsFilter(tagFqn: string): object {
  if (tagFqn.startsWith('Tier.')) return { query: { bool: { must: [term('tier.tagFQN', tagFqn)] } } }
  // 2.x keeps certification in its own field; tags.tagFQN covers servers (and the demo) that store it as a tag.
  if (tagFqn.startsWith('Certification.'))
    return {
      query: { bool: { should: [term('certification.tagLabel.tagFQN', tagFqn), term('tags.tagFQN', tagFqn)], minimum_should_match: 1 } },
    }
  return { query: { bool: { must: [term('tags.tagFQN', tagFqn)] } } }
}

export function domainAssetsFilter(domainFqn: string): object {
  return { query: { bool: { must: [term('domains.fullyQualifiedName', domainFqn)], must_not: [term('entityType', 'dataProduct')] } } }
}

export function dataProductAssetsFilter(fqn: string): object {
  return { query: { bool: { must: [term('dataProducts.fullyQualifiedName', fqn)] } } }
}

// ---------- Usage counts ----------

/** Asset counts per tag/term FQN across data assets, from search aggregations. */
export async function tagUsageCounts(): Promise<Map<string, number>> {
  const [tags, tiers, certs] = await Promise.all([
    aggregate('tags.tagFQN', { index: 'dataAsset' }, 1000),
    aggregate('tier.tagFQN', { index: 'dataAsset' }, 100),
    aggregate('certification.tagLabel.tagFQN', { index: 'dataAsset' }, 100).catch(() => []),
  ])
  const counts = new Map<string, number>()
  for (const b of [...tags, ...tiers, ...certs]) counts.set(b.key, Math.max(counts.get(b.key) ?? 0, b.doc_count))
  return counts
}

/** Asset counts per domain FQN. */
export async function domainAssetCounts(): Promise<Map<string, number>> {
  const buckets = await aggregate(
    'domains.fullyQualifiedName',
    { index: 'dataAsset', queryFilter: { query: { bool: { must_not: [term('entityType', 'dataProduct')] } } } },
    1000,
  )
  return new Map(buckets.map((b) => [b.key, b.doc_count]))
}
