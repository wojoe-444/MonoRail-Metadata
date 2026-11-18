import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useQuery } from '@/hooks/useQuery'
import { SearchResult } from '@/features/explore/SearchResult'
import { formatCount } from '@/features/om/entity'
import { EmptyState, ErrorState, LoadingState } from '@/features/om/components/States'
import type { SearchResponse, SearchSource } from '@/features/om/types'

/** A card of assets from a search (owned by, followed by). */
export function AssetList({
  title,
  description,
  queryKey,
  load,
  empty,
}: {
  title: string
  description?: string
  queryKey: unknown[]
  load: () => Promise<SearchResponse<SearchSource>>
  empty: string
}) {
  const res = useQuery(['search', ...queryKey], load)
  const hits = res.data?.hits.hits ?? []
  const total = res.data?.hits.total.value ?? 0
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {res.data
            ? `${formatCount(total)} asset${total === 1 ? '' : 's'}${description ? ` · ${description}` : ''}`
            : (description ?? ' ')}
        </CardDescription>
      </CardHeader>
      <CardContent className={hits.length ? 'px-0' : undefined}>
        {res.error && !res.data ? (
          <ErrorState error={res.error} onRetry={res.refetch} />
        ) : !res.data ? (
          <LoadingState />
        ) : !hits.length ? (
          <EmptyState title={empty} />
        ) : (
          <div className="divide-y border-t">
            {hits.map((h) => (
              <SearchResult key={h._id} hit={h._source} />
            ))}
            {total > hits.length && (
              <p className="px-4 pt-3 text-xs text-muted-foreground">
                Showing {hits.length} of {formatCount(total)}.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
