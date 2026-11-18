import { Award, BookOpen, Boxes, Tag as TagIcon, Users } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { displayName, entityHref, formatDate, isExpired, refHref } from '../entity'
import type { AssetCertification, EntityReference, TagLabel } from '../types'

/** Small read-only labels shared by every entity view: tags, tier, certification, owners, domains. */

export function TagChip({ tag, onRemove }: { tag: TagLabel; onRemove?: () => void }) {
  const glossary = tag.source === 'Glossary'
  const label = glossary ? displayName({ name: tag.name, displayName: tag.displayName, fullyQualifiedName: tag.tagFQN }) : tag.tagFQN
  const chip = (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium',
        glossary ? 'border-highlight/30 bg-highlight-soft text-highlight-soft-foreground' : 'bg-card text-foreground',
      )}
    >
      {glossary ? (
        <BookOpen className="size-3 shrink-0" aria-hidden />
      ) : (
        <TagIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <a href={entityHref(glossary ? 'glossaryTerm' : 'tag', tag.tagFQN)} className="truncate hover:underline">
        {label}
      </a>
      {tag.labelType !== 'Manual' && <span className="text-muted-foreground">· {tag.labelType.toLowerCase()}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 rounded text-muted-foreground hover:text-foreground"
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </span>
  )
  if (!tag.description) return chip
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{tag.description}</TooltipContent>
    </Tooltip>
  )
}

export function TagList({ tags, empty = '–', className }: { tags: TagLabel[] | undefined; empty?: string; className?: string }) {
  if (!tags?.length) return <span className="text-sm text-muted-foreground">{empty}</span>
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {tags.map((t) => (
        <TagChip key={t.tagFQN} tag={t} />
      ))}
    </div>
  )
}

const TIER_VARIANT: Record<string, 'destructive' | 'warning' | 'info' | 'secondary'> = {
  Tier1: 'destructive',
  Tier2: 'warning',
  Tier3: 'info',
}

export function TierBadge({ tier }: { tier: TagLabel | undefined }) {
  if (!tier) return null
  const name = tier.tagFQN.split('.').pop() ?? tier.tagFQN
  return (
    <Badge variant={TIER_VARIANT[name] ?? 'secondary'} title={tier.description}>
      {name.replace('Tier', 'Tier ')}
    </Badge>
  )
}

const CERT_VARIANT: Record<string, 'success' | 'secondary' | 'outline'> = { Gold: 'success', Silver: 'secondary', Bronze: 'outline' }

/** A certification level, from the `certification` field (or a legacy `Certification.*` tag). Expired ones say so. */
export function CertificationBadge({ certification }: { certification: AssetCertification | undefined }) {
  if (!certification) return null
  const tag = certification.tagLabel
  const name = tag.tagFQN.split('.').pop() ?? tag.tagFQN
  const expired = isExpired(certification)
  const dates = [
    certification.appliedDate ? `Certified ${formatDate(certification.appliedDate)}` : '',
    certification.expiryDate ? `${expired ? 'expired' : 'expires'} ${formatDate(certification.expiryDate)}` : '',
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Badge
      variant={expired ? 'outline' : (CERT_VARIANT[name] ?? 'outline')}
      title={[tag.description, dates].filter(Boolean).join('\n') || undefined}
    >
      <Award aria-hidden />
      {name}
      {expired && <span className="text-muted-foreground">(expired)</span>}
    </Badge>
  )
}

export function initials(name: string) {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

export function OwnerAvatar({ owner, className }: { owner: EntityReference; className?: string }) {
  return (
    <Avatar className={cn('size-6', className)}>
      <AvatarFallback className="bg-secondary text-[10px] font-semibold text-secondary-foreground">
        {owner.type === 'team' ? <Users className="size-3" aria-hidden /> : initials(displayName(owner))}
      </AvatarFallback>
    </Avatar>
  )
}

export function OwnerList({
  owners,
  empty = 'No owner',
  compact,
}: {
  owners: EntityReference[] | undefined
  empty?: string
  compact?: boolean
}) {
  if (!owners?.length) return <span className="text-sm text-muted-foreground">{empty}</span>
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {owners.map((o) => (
        <a key={o.id} href={refHref(o)} className="flex min-w-0 items-center gap-1.5 text-sm hover:underline">
          <OwnerAvatar owner={o} className={compact ? 'size-5' : undefined} />
          <span className="truncate">{displayName(o)}</span>
        </a>
      ))}
    </div>
  )
}

export function DomainList({ domains, empty = 'No domain' }: { domains: EntityReference[] | undefined; empty?: string }) {
  if (!domains?.length) return <span className="text-sm text-muted-foreground">{empty}</span>
  return (
    <div className="flex flex-wrap items-center gap-2">
      {domains.map((d) => (
        <a key={d.id} href={refHref(d)} className="inline-flex items-center gap-1.5 text-sm hover:underline">
          <Boxes className="size-3.5 text-muted-foreground" aria-hidden />
          {displayName(d)}
        </a>
      ))}
    </div>
  )
}
