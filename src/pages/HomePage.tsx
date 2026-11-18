import { useState } from 'react'
import { ArrowRight, FileCode2, Info, Search, Star } from 'lucide-react'

import { StatTile } from '@/components/charts/StatTile'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useQuery } from '@/hooks/useQuery'
import { href, navigate } from '@/lib/router'
import { SearchResult } from '@/features/explore/SearchResult'
import { listModels } from '@/features/malloy/api'
import { getHealth, search } from '@/features/om/api'
import { displayName, entityHref, formatCount, formatPercent, timeAgo } from '@/features/om/entity'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { EmptyState, Loaded } from '@/features/om/components/States'
import { useCurrentUser } from '@/features/om/useEntity'

/** Where people start: search, catalog health at a glance, what they follow, and what changed. */
export function HomePage() {
  const me = useCurrentUser()
  const health = useQuery(['health'], getHealth)
  const [q, setQ] = useState('')

  const tables = useQuery(['search', 'home', 'tables'], () => search({ index: 'table', size: 0 }))
  const described = useQuery(['search', 'home', 'described'], () =>
    search({
      index: 'table',
      size: 0,
      queryFilter: { query: { bool: { must_not: [{ term: { description: '' } }], must: [{ exists: { field: 'description' } }] } } },
    }),
  )
  const owned = useQuery(['search', 'home', 'owned'], () =>
    search({ index: 'table', size: 0, queryFilter: { query: { bool: { must: [{ exists: { field: 'owners.id' } }] } } } }),
  )
  const terms = useQuery(['search', 'home', 'terms'], () => search({ index: 'glossaryTerm', size: 0 }))
  const models = useQuery(['malloy', 'models'], listModels)
  const recent = useQuery(['search', 'home', 'recent'], () =>
    search({ index: 'dataAsset', size: 6, sortField: 'updatedAt', sortOrder: 'desc' }),
  )
  const popular = useQuery(['search', 'home', 'popular'], () =>
    search({ index: 'table', size: 6, sortField: 'usageSummary.weeklyStats.count', sortOrder: 'desc' }),
  )
  const following = useQuery(me ? ['search', 'home', 'following', me.id] : null, () =>
    search({
      index: 'dataAsset',
      size: 8, // Real search docs keep followers as a list of user ids; the demo keeps references. Match either.
      queryFilter: { query: { bool: { should: [{ term: { followers: me!.id } }, { term: { 'followers.id': me!.id } }] } } },
    }),
  )

  const total = tables.data?.hits.total.value
  const share = (n: number | undefined) => (total && n !== undefined ? n / total : undefined)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="MonoRail Metadata"
        title={me ? `Welcome back, ${displayName(me).split(' ')[0]}` : 'Welcome'}
        description="Find, understand and trust the data in BigQuery."
      />

      {health.data?.mode === 'demo' && (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm text-info-soft-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            You're looking at the <strong>demo catalog</strong>: BigQuery's public theLook dataset plus a sample analytics layer, served by
            this app's server. Edits last until it restarts. Set <code className="font-mono">OM_URL</code> to connect a real OpenMetadata
            server (see{' '}
            <a href={href('/settings')} className="underline">
              Settings
            </a>
            ).
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          navigate(`/explore${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
        }}
        className="relative"
      >
        <Label htmlFor="home-search" className="sr-only">
          Search the catalog
        </Label>
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="home-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tables, columns, glossary terms…"
          className="h-12 rounded-xl pl-12 text-base"
        />
      </form>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Tables" value={formatCount(total)} hint="In the catalog" />
        <StatTile label="Described" value={formatPercent(share(described.data?.hits.total.value))} hint="Tables with a description" />
        <StatTile label="Owned" value={formatPercent(share(owned.data?.hits.total.value))} hint="Tables with an owner" />
        <StatTile
          label="Glossary terms"
          value={formatCount(terms.data?.hits.total.value)}
          hint={models.data ? `${models.data.length} Malloy model${models.data.length === 1 ? '' : 's'}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle>Most used tables</CardTitle>
            <CardDescription>By queries in the last week.</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => navigate('/explore?scope=table&sort=usageSummary.weeklyStats.count')}>
                View all
                <ArrowRight />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="divide-y border-t px-0">
            <Loaded query={popular}>{(r) => r.hits.hits.map((h) => <SearchResult key={h._id} hit={h._source} />)}</Loaded>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="size-4 text-muted-foreground" aria-hidden />
                Following
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Loaded query={following}>
                {(r) =>
                  !r.hits.hits.length ? (
                    <p className="text-sm text-muted-foreground">Follow a table to see it here.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {r.hits.hits.map(({ _source: h }) => (
                        <li key={h.id}>
                          <a
                            href={entityHref(h.entityType, h.fullyQualifiedName!)}
                            className="flex items-center gap-2 text-sm hover:underline"
                          >
                            <EntityIcon type={h.entityType} tableType={h.tableType} bare />
                            <span className="truncate">{displayName(h)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )
                }
              </Loaded>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recently changed</CardTitle>
            </CardHeader>
            <CardContent>
              <Loaded query={recent}>
                {(r) => (
                  <ul className="flex flex-col gap-3">
                    {r.hits.hits.map(({ _source: h }) => (
                      <li key={h.id} className="flex items-center gap-2 text-sm">
                        <EntityIcon type={h.entityType} tableType={h.tableType} bare />
                        <a href={entityHref(h.entityType, h.fullyQualifiedName!)} className="min-w-0 flex-1 truncate hover:underline">
                          {displayName(h)}
                        </a>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {h.updatedBy} · {timeAgo(h.updatedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Loaded>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCode2 className="size-4 text-muted-foreground" aria-hidden />
                Malloy models
              </CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" onClick={() => navigate('/malloy')}>
                  Open
                  <ArrowRight />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Loaded query={models}>
                {(ms) =>
                  !ms.length ? (
                    <EmptyState title="No models yet" className="py-6" />
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {ms.slice(0, 5).map((m) => (
                        <li key={m.path} className="flex items-center justify-between gap-2 text-sm">
                          <a
                            href={href(`/malloy/workbench?path=${encodeURIComponent(m.path)}`)}
                            className="truncate font-mono hover:underline"
                          >
                            {m.path}
                          </a>
                          <span className="shrink-0 text-xs text-muted-foreground">{m.sources.length} sources</span>
                        </li>
                      ))}
                    </ul>
                  )
                }
              </Loaded>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
