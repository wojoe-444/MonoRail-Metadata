import { useState } from 'react'

import { StatTile } from '@/components/charts/StatTile'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { OwnerList, TierBadge } from '@/features/om/components/Labels'
import { EmptyState, ErrorState, Loaded, LoadingState } from '@/features/om/components/States'
import { displayName, entityHref, entityLabel, formatCount, formatPercent, splitFqn } from '@/features/om/entity'
import { useQuery } from '@/hooks/useQuery'
import {
  getCatalogHealth,
  getDomainHealth,
  getGaps,
  getTeamOwnership,
  type CatalogHealth,
  type Gap,
  type Scope,
} from '@/features/insights/api'
import { BarList, CoverageRow, tagKeyLabel } from '@/features/insights/components'

export function InsightsPage() {
  const [scope, setScope] = useState<Scope>('table')
  const health = useQuery(['insights', 'health', scope], () => getCatalogHealth(scope))
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Insights"
        description="How well the catalog is documented, owned and classified, and what to fix first."
        actions={
          <Segmented
            aria-label="Assets to include"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'table', label: 'Tables' },
              { value: 'dataAsset', label: 'All data assets' },
            ]}
          />
        }
      />
      {health.error && !health.data ? (
        <ErrorState error={health.error} onRetry={health.refetch} />
      ) : !health.data ? (
        <LoadingState />
      ) : health.data.total === 0 ? (
        <EmptyState title="No assets yet" description="Run metadata ingestion to fill the catalog." />
      ) : (
        <Health h={health.data} scope={scope} />
      )}
    </div>
  )
}

function Health({ h, scope }: { h: CatalogHealth; scope: Scope }) {
  const tiered = h.tiers.reduce((n, b) => n + b.doc_count, 0)
  const certified = h.certifications.reduce((n, b) => n + b.doc_count, 0)
  const noun = scope === 'table' ? 'tables' : 'assets'
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label={scope === 'table' ? 'Tables' : 'Assets'} value={formatCount(h.total)} />
        <StatTile label="Described" value={formatPercent(h.described / h.total)} hint={`${formatCount(h.total - h.described)} missing`} />
        <StatTile label="Owned" value={formatPercent(h.owned / h.total)} hint={`${formatCount(h.total - h.owned)} unowned`} />
        <StatTile label="Tiered" value={formatPercent(tiered / h.total)} />
        <StatTile label="Certified" value={formatCount(certified)} hint={formatPercent(certified / h.total) + ` of ${noun}`} />
        <StatTile label="Sensitive PII" value={formatCount(h.sensitive)} hint={noun} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Coverage</CardTitle>
            <CardDescription>Share of {noun} with each piece of metadata.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <CoverageRow label="Description" value={h.described} total={h.total} />
            <CoverageRow label="Owner" value={h.owned} total={h.total} />
            <CoverageRow label="Domain" value={h.withDomain} total={h.total} />
            <CoverageRow label="Tier" value={tiered} total={h.total} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tiers</CardTitle>
            <CardDescription>How critical {noun} are, Tier 1 most.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              of={h.total}
              items={[
                ...[...h.tiers]
                  .sort((a, b) => a.key.localeCompare(b.key))
                  .map((b) => ({ key: b.key, label: tagKeyLabel(b.key), value: b.doc_count })),
                ...(h.total - tiered > 0
                  ? [
                      {
                        key: 'none',
                        label: <span className="text-muted-foreground">No tier</span>,
                        value: h.total - tiered,
                        color: 'var(--series-other)',
                      },
                    ]
                  : []),
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Certification</CardTitle>
            <CardDescription>Trust level owners have signed off on.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              of={h.total}
              items={[
                ...h.certifications.map((b) => ({ key: b.key, label: tagKeyLabel(b.key), value: b.doc_count })),
                ...(h.total - certified > 0
                  ? [
                      {
                        key: 'none',
                        label: <span className="text-muted-foreground">Not certified</span>,
                        value: h.total - certified,
                        color: 'var(--series-other)',
                      },
                    ]
                  : []),
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DomainCard scope={scope} domains={h.domains.slice(0, 8).map((b) => b.key)} />
        <TeamCard scope={scope} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Personal data</CardTitle>
          <CardDescription>
            {noun.charAt(0).toUpperCase() + noun.slice(1)} carrying privacy tags, on the asset or any of its columns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {h.privacyTags.length ? (
            <BarList
              of={h.total}
              items={h.privacyTags.map((b, i) => ({
                key: b.key,
                label: <span className="font-mono text-xs">{b.key}</span>,
                value: b.doc_count,
                color: `var(--series-${(i % 6) + 1})`,
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No {noun} are tagged with PII or PersonalData yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <GapCard scope={scope} gap="owner" />
        <GapCard scope={scope} gap="description" />
      </div>
    </>
  )
}

function DomainCard({ scope, domains }: { scope: Scope; domains: string[] }) {
  const query = useQuery(['insights', 'domains', scope, domains], () => getDomainHealth(scope, domains))
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>By domain</CardTitle>
        <CardDescription>Description and owner coverage within each domain.</CardDescription>
      </CardHeader>
      <CardContent>
        <Loaded query={query}>
          {(rows) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead className="text-right">Assets</TableHead>
                  <TableHead className="text-right">Described</TableHead>
                  <TableHead className="text-right">Owned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows
                  .filter((r) => r.total > 0)
                  .map((r) => (
                    <TableRow key={r.domain ?? '(none)'}>
                      <TableCell className="max-w-48 truncate">
                        {r.domain === null ? (
                          <span className="text-muted-foreground">No domain</span>
                        ) : (
                          <a href={entityHref('domain', r.domain)} className="hover:underline">
                            {splitFqn(r.domain).pop()}
                          </a>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(r.total)}</TableCell>
                      <PercentCell value={r.described} total={r.total} />
                      <PercentCell value={r.owned} total={r.total} />
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </Loaded>
      </CardContent>
    </Card>
  )
}

function PercentCell({ value, total }: { value: number; total: number }) {
  const share = total ? value / total : 0
  return (
    <TableCell className="text-right tabular-nums">
      <span className={share >= 0.999 ? 'text-success' : share < 0.5 ? 'text-warning-soft-foreground' : undefined}>
        {formatPercent(share)}
      </span>
      <span className="ml-1.5 text-xs text-muted-foreground">
        {value}/{total}
      </span>
    </TableCell>
  )
}

function TeamCard({ scope }: { scope: Scope }) {
  const query = useQuery(['insights', 'teams', scope], () => getTeamOwnership(scope))
  return (
    <Card>
      <CardHeader>
        <CardTitle>By owner team</CardTitle>
        <CardDescription>Assets owned by each team or its members.</CardDescription>
      </CardHeader>
      <CardContent>
        <Loaded query={query}>
          {(res) =>
            res.teams.length || res.unowned ? (
              <BarList
                items={[
                  ...res.teams.slice(0, 8).map((t) => ({
                    key: t.team,
                    label:
                      t.team === 'No team' ? (
                        <span className="text-muted-foreground">No team</span>
                      ) : (
                        <a href={entityHref('team', t.team)} className="hover:underline">
                          {t.team}
                        </a>
                      ),
                    value: t.assets,
                  })),
                  ...(res.unowned
                    ? [
                        {
                          key: 'unowned',
                          label: <span className="text-muted-foreground">Unowned</span>,
                          value: res.unowned,
                          color: 'var(--series-other)',
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No owners assigned yet.</p>
            )
          }
        </Loaded>
      </CardContent>
    </Card>
  )
}

function GapCard({ scope, gap }: { scope: Scope; gap: Gap }) {
  const query = useQuery(['insights', 'gaps', scope, gap], () => getGaps(scope, gap))
  const ranked = scope === 'table' ? 'Most used' : 'Most recently changed'
  return (
    <Card>
      <CardHeader>
        <CardTitle>{gap === 'owner' ? 'Missing an owner' : 'Missing a description'}</CardTitle>
        <CardDescription>
          {ranked} first{query.data ? ` · ${formatCount(query.data.total)} in all` : ''}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Loaded query={query}>
          {(res) =>
            res.hits.length ? (
              <ul className="flex flex-col divide-y">
                {res.hits.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <EntityIcon type={a.entityType} tableType={a.tableType} className="size-8" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <a
                        href={entityHref(a.entityType, a.fullyQualifiedName ?? a.name)}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {displayName(a)}
                      </a>
                      <span className="truncate text-xs text-muted-foreground">
                        {entityLabel(a.entityType)}
                        {a.databaseSchema ? ` · ${displayName(a.databaseSchema)}` : ''}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <TierBadge tier={a.tier} />
                      {gap === 'description' && (
                        <span className="hidden sm:block">
                          <OwnerList owners={a.owners} compact empty="No owner" />
                        </span>
                      )}
                      {scope === 'table' && (
                        <span className="w-16 text-right text-xs text-muted-foreground tabular-nums" title="Queries in the last week">
                          {formatCount(a.usageSummary?.weeklyStats?.count ?? 0)} / wk
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={gap === 'owner' ? 'Every asset has an owner' : 'Every asset has a description'} />
            )
          }
        </Loaded>
      </CardContent>
    </Card>
  )
}
