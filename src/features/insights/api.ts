import { aggregate, listEntities, search } from '@/features/om/api'
import type { Bucket, SearchSource, Team, User } from '@/features/om/types'

/**
 * Catalog health from OpenMetadata's search index (`/search/query` and
 * `/search/aggregate`). Field names are the 2.0.8 index mapping's:
 *
 * - `descriptionStatus`: COMPLETE / INCOMPLETE, set by SearchIndex for every entity.
 * - `ownerDisplayName`: a flat keyword copy of the owners (`owners` itself is nested).
 * - `tier.tagFQN`, `certification.tagLabel.tagFQN`, `tags.tagFQN` (column tags are merged in).
 * - `domains.fullyQualifiedName` (exact case) and `owners.displayName.keyword` (lowercased) for breakdowns.
 *
 * Keyword fields with a lowercase normalizer come back lowercased from real
 * OpenMetadata ("tier.tier1"), so compare keys case-insensitively.
 */

export type Scope = 'table' | 'dataAsset'

const HAS_OWNER = { exists: { field: 'ownerDisplayName' } }
const HAS_DOMAIN = { exists: { field: 'domains.id' } }
const INCOMPLETE = { term: { descriptionStatus: 'INCOMPLETE' } }
const SENSITIVE = { term: { 'tags.tagFQN': 'PII.Sensitive' } }

const bool = (b: { must?: object[]; must_not?: object[]; should?: object[] }) => ({ query: { bool: b } })

async function count(index: Scope, queryFilter?: object): Promise<number> {
  const res = await search({ index, size: 0, queryFilter })
  return res.hits.total.value
}

export interface CatalogHealth {
  total: number
  described: number
  owned: number
  withDomain: number
  sensitive: number
  tiers: Bucket[]
  certifications: Bucket[]
  privacyTags: Bucket[]
  domains: Bucket[]
}

export async function getCatalogHealth(index: Scope): Promise<CatalogHealth> {
  const [total, owned, withDomain, sensitive, descBuckets, tiers, certField, tags, domains] = await Promise.all([
    count(index),
    count(index, bool({ must: [HAS_OWNER] })),
    count(index, bool({ must: [HAS_DOMAIN] })),
    count(index, bool({ must: [SENSITIVE] })),
    aggregate('descriptionStatus', { index }, 10),
    aggregate('tier.tagFQN', { index }, 20),
    aggregate('certification.tagLabel.tagFQN', { index }, 20),
    aggregate('tags.tagFQN', { index }, 500),
    aggregate('domains.fullyQualifiedName', { index }, 50),
  ])
  const described = descBuckets.find((b) => b.key.toUpperCase() === 'COMPLETE')?.doc_count ?? 0
  // OpenMetadata 2.x keeps certification in its own field; this app also reads Certification.* tags. Take the larger count per level.
  const certs = new Map<string, number>()
  for (const b of [...certField, ...tags.filter((t) => /^certification\./i.test(t.key))]) {
    const k = b.key.toLowerCase()
    certs.set(k, Math.max(certs.get(k) ?? 0, b.doc_count))
  }
  return {
    total,
    described,
    owned,
    withDomain,
    sensitive,
    tiers,
    certifications: [...certs].map(([key, doc_count]) => ({ key, doc_count })).sort((a, b) => b.doc_count - a.doc_count),
    privacyTags: tags.filter((t) => /^(pii|personaldata)\./i.test(t.key)),
    domains,
  }
}

export interface DomainHealth {
  /** Domain FQN, or null for assets without a domain. */
  domain: string | null
  total: number
  described: number
  owned: number
}

/** Description and ownership coverage per domain FQN (and for assets with no domain, as domain null). */
export async function getDomainHealth(index: Scope, domains: string[]): Promise<DomainHealth[]> {
  const one = async (domain: string | null): Promise<DomainHealth> => {
    const scope = domain === null ? { must_not: [HAS_DOMAIN] } : { must: [{ term: { 'domains.fullyQualifiedName': domain } }] }
    const [total, owned, missingDesc] = await Promise.all([
      count(index, bool({ ...scope })),
      count(index, bool({ must: [...(scope.must ?? []), HAS_OWNER], must_not: scope.must_not })),
      count(index, bool({ must: [...(scope.must ?? []), INCOMPLETE], must_not: scope.must_not })),
    ])
    return { domain, total, owned, described: total - missingDesc }
  }
  return Promise.all([...domains.map(one), one(null)])
}

export interface TeamOwnership {
  team: string
  assets: number
}

/**
 * Assets per owning team. Team owners count for themselves; user owners count
 * for each team they belong to. An asset owned by two people in one team counts once per owner.
 */
export async function getTeamOwnership(index: Scope): Promise<{ teams: TeamOwnership[]; unowned: number }> {
  const [owners, users, teams, total, owned] = await Promise.all([
    aggregate('owners.displayName.keyword', { index }, 200),
    listEntities<User>('user', { fields: 'teams', limit: 1000 }),
    listEntities<Team>('team', { limit: 1000 }),
    count(index),
    count(index, bool({ must: [HAS_OWNER] })),
  ])
  const teamNames = new Set(teams.data.map((t) => (t.displayName || t.name).toLowerCase()))
  const userTeams = new Map(
    users.data.map((u) => [(u.displayName || u.name).toLowerCase(), (u.teams ?? []).map((t) => t.displayName || t.name || '')]),
  )
  const totals = new Map<string, number>()
  for (const b of owners) {
    const key = b.key.toLowerCase()
    const groups = teamNames.has(key)
      ? [teams.data.find((t) => (t.displayName || t.name).toLowerCase() === key)!.displayName || b.key]
      : (userTeams.get(key)?.filter(Boolean) ?? [])
    for (const g of groups.length ? groups : ['No team']) totals.set(g, (totals.get(g) ?? 0) + b.doc_count)
  }
  return {
    teams: [...totals].map(([team, assets]) => ({ team, assets })).sort((a, b) => b.assets - a.assets),
    unowned: total - owned,
  }
}

export type Gap = 'owner' | 'description'

/** The most used (tables) or most recently changed (all assets) assets missing an owner or a description. */
export async function getGaps(index: Scope, gap: Gap, size = 8) {
  const filter = gap === 'owner' ? bool({ must_not: [HAS_OWNER] }) : bool({ must: [INCOMPLETE] })
  // Only tables have usage; sorting a mixed index by it fails where the field isn't mapped.
  const sortField = index === 'table' ? 'usageSummary.weeklyStats.count' : 'updatedAt'
  const res = await search<SearchSource>({ index, size, queryFilter: filter, sortField, sortOrder: 'desc' })
  return { total: res.hits.total.value, hits: res.hits.hits.map((h) => h._source) }
}
