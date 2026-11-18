import { Activity, Columns3 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { certificationOf, displayName, entityHref, entityLabel, formatCount, plainTags, timeAgo } from '@/features/om/entity'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import { CertificationBadge, OwnerList, TagChip, TierBadge } from '@/features/om/components/Labels'
import type { SearchSource } from '@/features/om/types'

/** One search hit: icon, name, where it lives, description, and its labels. */
export function SearchResult({ hit }: { hit: SearchSource }) {
  const where = [hit.service?.displayName ?? hit.service?.name, hit.database?.name, hit.databaseSchema?.name].filter(Boolean).join(' › ')
  const tags = plainTags(hit.tags).slice(0, 4)
  const usage = hit.usageSummary?.weeklyStats?.count
  return (
    <div className="relative flex gap-3 px-4 py-4 hover:bg-accent/50 has-[a.result-link:focus-visible]:bg-accent">
      <EntityIcon type={hit.entityType} tableType={hit.tableType} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* The name link covers the whole row; owner and tag links sit above it. */}
          <a
            href={entityHref(hit.entityType, hit.fullyQualifiedName ?? hit.name)}
            className="result-link truncate font-medium outline-none after:absolute after:inset-0"
          >
            {displayName(hit)}
          </a>
          <TierBadge tier={hit.tier} />
          <CertificationBadge tag={certificationOf(hit.tags)} />
          {hit.tableType && hit.tableType !== 'Regular' && (
            <Badge variant="outline">{hit.tableType.replace(/([A-Z])/g, ' $1').trim()}</Badge>
          )}
          {hit.deleted && <Badge variant="destructive">Deleted</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {entityLabel(hit.entityType)}
          {where && ` · ${where}`}
          {!where && hit.fullyQualifiedName && hit.fullyQualifiedName !== hit.name && ` · ${hit.fullyQualifiedName}`}
        </div>
        {hit.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{hit.description.replace(/[`*_#>]/g, '')}</p>
        ) : (
          <p className="text-sm text-muted-foreground/70 italic">No description</p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
          {hit.owners && hit.owners.length > 0 && (
            <div className="relative z-10">
              <OwnerList owners={hit.owners} compact />
            </div>
          )}
          {tags.length > 0 && (
            <div className="relative z-10 flex flex-wrap gap-1">
              {tags.map((t) => (
                <TagChip key={t.tagFQN} tag={t} />
              ))}
            </div>
          )}
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            {hit.columns && (
              <span className="flex items-center gap-1 tabular-nums">
                <Columns3 className="size-3.5" aria-hidden /> {hit.columns.length}
              </span>
            )}
            {usage !== undefined && (
              <span className="flex items-center gap-1 tabular-nums" title="Queries in the last week">
                <Activity className="size-3.5" aria-hidden /> {formatCount(usage)}/wk
              </span>
            )}
            {hit.updatedAt && <span>Updated {timeAgo(hit.updatedAt)}</span>}
          </span>
        </div>
      </div>
    </div>
  )
}
